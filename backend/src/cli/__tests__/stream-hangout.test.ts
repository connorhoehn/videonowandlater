/**
 * Tests for stream-hangout command
 */

import { streamHangout } from '../commands/stream-hangout';
import { SessionType } from '../../domain/session';

// Mock dependencies
jest.mock('../../repositories/session-repository');
jest.mock('../lib/ffmpeg-streamer');
jest.mock('@aws-sdk/client-ivs-realtime');

const mockGetSessionById = require('../../repositories/session-repository').getSessionById as jest.MockedFunction<any>;
const mockStreamToWHIP = require('../lib/ffmpeg-streamer').streamToWHIP as jest.MockedFunction<any>;
const mockIVSRealTimeClient = require('@aws-sdk/client-ivs-realtime').IVSRealTimeClient;
const mockCreateParticipantTokenCommand = require('@aws-sdk/client-ivs-realtime').CreateParticipantTokenCommand;

describe('stream-hangout command', () => {
  const mockSession = {
    sessionId: 'test-session-123',
    userId: 'test-user',
    sessionType: SessionType.HANGOUT,
    status: 'live',
    claimedResources: {
      stage: 'arn:aws:ivs:us-west-2:123456789:stage/abcd1234',
      chatRoom: 'arn:aws:ivschat:us-west-2:123456789:room/xyz',
    },
    createdAt: '2026-03-03T10:00:00Z',
    version: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-table';

    // Mock IVS RealTime client
    mockIVSRealTimeClient.prototype.send = jest.fn().mockResolvedValue({
      participantToken: {
        token: 'test-participant-token',
        participantId: 'cli-stream',
      },
    });

    mockStreamToWHIP.mockResolvedValue(undefined);
  });

  it('should validate session.sessionType === HANGOUT', async () => {
    const broadcastSession = {
      ...mockSession,
      sessionType: SessionType.BROADCAST,
    };
    mockGetSessionById.mockResolvedValue(broadcastSession);

    await expect(streamHangout('test-session-123', '/path/to/video.mp4')).rejects.toThrow(
      'Session test-session-123 is not a HANGOUT session'
    );
  });

  it('should call CreateParticipantTokenCommand with PUBLISH capability', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);

    await streamHangout('test-session-123', '/path/to/video.mp4');

    expect(mockCreateParticipantTokenCommand).toHaveBeenCalledWith({
      stageArn: 'arn:aws:ivs:us-west-2:123456789:stage/abcd1234',
      capabilities: expect.arrayContaining(['PUBLISH', 'SUBSCRIBE']),
      duration: 720,
      userId: 'cli-stream',
      attributes: expect.objectContaining({
        displayName: 'CLI Stream',
      }),
    });
  });

  it('should construct WHIP URL with participant token query param', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);

    await streamHangout('test-session-123', '/path/to/video.mp4');

    expect(mockStreamToWHIP).toHaveBeenCalledWith(
      expect.objectContaining({
        videoFile: '/path/to/video.mp4',
        participantToken: 'test-participant-token',
      })
    );
  });

  it('should throw error when session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);

    await expect(streamHangout('nonexistent', '/path/to/video.mp4')).rejects.toThrow(
      'Session nonexistent not found'
    );
  });
});
