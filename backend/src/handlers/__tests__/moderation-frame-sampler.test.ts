/**
 * Tests for moderation-frame-sampler Lambda handler
 * Scheduled Lambda — samples frames from live sessions and runs Rekognition moderation.
 */

import { handler } from '../moderation-frame-sampler';
import { SessionType } from '../../domain/session';

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));

const mockRekSend = jest.fn();
jest.mock('@aws-sdk/client-rekognition', () => {
  return {
    RekognitionClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockRekSend(...args),
    })),
    DetectModerationLabelsCommand: jest.fn(),
  };
});

const mockIvsSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-ivs', () => {
  return {
    IvsClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockIvsSend(...args),
    })),
    StopStreamCommand: jest.fn(),
  };
});

const mockChatSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-ivschat', () => {
  return {
    IvschatClient: jest.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockChatSend(...args),
    })),
    SendEventCommand: jest.fn(),
  };
});

jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

// Mock getRandomSamplingInterval to return 0 so tests don't wait
jest.mock('../../domain/moderation', () => {
  const actual = jest.requireActual('../../domain/moderation');
  return {
    ...actual,
    getRandomSamplingInterval: () => 0,
  };
});

// Override LAMBDA_TIMEOUT_MS by making Date.now increment quickly
// We need the while loop to run exactly once. We'll control via mock behavior.

global.fetch = jest.fn();

describe('moderation-frame-sampler handler', () => {
  const TABLE_NAME = 'test-table';

  const liveBroadcast = {
    PK: 'SESSION#session-1',
    SK: 'META',
    sessionId: 'session-1',
    sessionType: SessionType.BROADCAST,
    status: 'live',
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    channelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/channel-1',
    claimedResources: { chatRoom: 'room-1' },
  };

  const liveHangout = {
    PK: 'SESSION#session-2',
    SK: 'META',
    sessionId: 'session-2',
    sessionType: SessionType.HANGOUT,
    status: 'live',
    thumbnailUrl: 'https://cdn.example.com/thumb2.jpg',
  };

  const broadcastNoThumb = {
    PK: 'SESSION#session-3',
    SK: 'META',
    sessionId: 'session-3',
    sessionType: SessionType.BROADCAST,
    status: 'live',
    // no thumbnailUrl
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });

    // By default, make Date.now cause the loop to run once then exit
    let callCount = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call (start): return 0, subsequent calls: return huge value to exit loop
      return callCount <= 2 ? 0 : 999999999;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should query GSI1 for live sessions', async () => {
    mockDocSend.mockResolvedValue({ Items: [] });

    await handler();

    expect(mockDocSend).toHaveBeenCalled();
    const queryCall = mockDocSend.mock.calls[0][0];
    expect(queryCall.input.IndexName).toBe('GSI1');
    expect(queryCall.input.ExpressionAttributeValues[':status']).toBe('STATUS#LIVE');
  });

  test('should skip non-BROADCAST sessions', async () => {
    mockDocSend.mockResolvedValue({ Items: [liveHangout] });

    await handler();

    // Should not fetch any thumbnails since hangout is filtered out
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRekSend).not.toHaveBeenCalled();
  });

  test('should skip sessions without thumbnailUrl', async () => {
    mockDocSend.mockResolvedValue({ Items: [broadcastNoThumb] });

    await handler();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockRekSend).not.toHaveBeenCalled();
  });

  test('should call Rekognition DetectModerationLabels with fetched image', async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [liveBroadcast] });
    mockRekSend.mockResolvedValueOnce({ ModerationLabels: [] });

    await handler();

    expect(global.fetch).toHaveBeenCalledWith(liveBroadcast.thumbnailUrl);
    expect(mockRekSend).toHaveBeenCalled();

    const { DetectModerationLabelsCommand } = require('@aws-sdk/client-rekognition');
    expect(DetectModerationLabelsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: { Bytes: expect.any(Uint8Array) },
        MinConfidence: 70,
      }),
    );
  });

  test('should write MOD# record when labels detected above threshold', async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [liveBroadcast] });
    // PutCommand for moderation record
    mockDocSend.mockResolvedValue({});

    mockRekSend.mockResolvedValueOnce({
      ModerationLabels: [
        { Name: 'Suggestive', Confidence: 75, ParentName: '' },
      ],
    });

    await handler();

    // Find the PutCommand call that writes MOD# record
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('MOD#');
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0]?.input || putCall![0]).Item;
    expect(item.PK).toBe('SESSION#session-1');
    expect(item.actionType).toBe('ML_FLAG');
    expect(item.actorId).toBe('SYSTEM');
  });

  test('should auto-kill session when confidence > 90% (calls StopStreamCommand)', async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [liveBroadcast] });
    mockDocSend.mockResolvedValue({}); // subsequent puts

    mockRekSend.mockResolvedValueOnce({
      ModerationLabels: [
        { Name: 'Explicit Nudity', Confidence: 95, ParentName: '' },
      ],
    });

    await handler();

    // Should write MOD# record with ML_AUTO_KILL
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('MOD#');
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0]?.input || putCall![0]).Item;
    expect(item.actionType).toBe('ML_AUTO_KILL');

    // Should have called StopStreamCommand
    const { StopStreamCommand } = require('@aws-sdk/client-ivs');
    expect(StopStreamCommand).toHaveBeenCalledWith({ channelArn: liveBroadcast.channelArn });
    expect(mockIvsSend).toHaveBeenCalled();

    // Should have sent chat notification
    const { SendEventCommand } = require('@aws-sdk/client-ivschat');
    expect(SendEventCommand).toHaveBeenCalled();
  });

  test('should not flag when no moderation labels returned', async () => {
    mockDocSend.mockResolvedValueOnce({ Items: [liveBroadcast] });

    mockRekSend.mockResolvedValueOnce({ ModerationLabels: [] });

    await handler();

    // Should not write any MOD# records
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('MOD#');
    });
    expect(putCall).toBeUndefined();
  });

  test('should handle Rekognition errors gracefully (continues to next session)', async () => {
    mockDocSend.mockResolvedValue({ Items: [liveBroadcast] });
    mockRekSend.mockRejectedValueOnce(new Error('Rekognition service error'));

    // Should not throw
    await expect(handler()).resolves.not.toThrow();

    // Should not write any moderation record
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('MOD#');
    });
    expect(putCall).toBeUndefined();
  });
});
