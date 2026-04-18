/**
 * Tests for moderate-frame handler (S3 ObjectCreated → Nova Lite classification).
 */

import type { S3Event } from 'aws-lambda';

// Shared mocks
const mockDocSend = jest.fn();
const mockS3Send = jest.fn();
const mockIvsChatSend = jest.fn();
const mockIvsRealtimeSend = jest.fn();
const mockIvsSend = jest.fn();
const mockClassifyImage = jest.fn();

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: () => ({ send: mockDocSend }),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((input) => ({ input, __type: 'GetObjectCommand' })),
  DeleteObjectCommand: jest.fn((input) => ({ input, __type: 'DeleteObjectCommand' })),
}));

jest.mock('@aws-sdk/client-ivschat', () => ({
  IvschatClient: jest.fn().mockImplementation(() => ({ send: mockIvsChatSend })),
  SendEventCommand: jest.fn((input) => ({ input, __type: 'SendEventCommand' })),
  DisconnectUserCommand: jest.fn((input) => ({ input, __type: 'DisconnectUserCommand' })),
}));

jest.mock('@aws-sdk/client-ivs-realtime', () => ({
  IVSRealTimeClient: jest.fn().mockImplementation(() => ({ send: mockIvsRealtimeSend })),
  DisconnectParticipantCommand: jest.fn((input) => ({ input, __type: 'DisconnectParticipantCommand' })),
}));

jest.mock('@aws-sdk/client-ivs', () => ({
  IvsClient: jest.fn().mockImplementation(() => ({ send: mockIvsSend })),
  StopStreamCommand: jest.fn((input) => ({ input, __type: 'StopStreamCommand' })),
}));

jest.mock('../../lib/nova-moderation', () => ({
  classifyImage: (...args: any[]) => mockClassifyImage(...args),
}));

// Mock repositories
const mockGetSessionById = jest.fn();
const mockGetHangoutParticipants = jest.fn();
jest.mock('../../repositories/session-repository', () => ({
  getSessionById: (...args: any[]) => mockGetSessionById(...args),
  getHangoutParticipants: (...args: any[]) => mockGetHangoutParticipants(...args),
}));

const mockGetRuleset = jest.fn();
jest.mock('../../repositories/ruleset-repository', () => ({
  getRuleset: (...args: any[]) => mockGetRuleset(...args),
}));

// Stub emitSessionEvent (fire-and-forget)
jest.mock('../../lib/emit-session-event', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
}));

import { handler, parseModerationKey } from '../moderate-frame';
import { SessionType } from '../../domain/session';

describe('parseModerationKey', () => {
  it('parses a valid key', () => {
    const parsed = parseModerationKey(
      'moderation-frames/session-abc-123/participant-user-xyz/1723450000.jpg',
    );
    expect(parsed).toEqual({ sessionId: 'abc-123', userId: 'user-xyz' });
  });

  it('rejects unrelated keys', () => {
    expect(parseModerationKey('garbage.jpg')).toBeNull();
    expect(parseModerationKey('moderation-frames/session-a/frame.jpg')).toBeNull();
  });
});

describe('moderate-frame handler', () => {
  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.NOVA_MODEL_ID = 'amazon.nova-lite-v1:0';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockResolvedValue({
      Body: {
        // simulate a fresh SDK v3 body with transformToByteArray
        transformToByteArray: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      },
    });
    mockDocSend.mockResolvedValue({ Attributes: { moderationStrikes: 1 } });
    mockIvsChatSend.mockResolvedValue({});
    mockIvsRealtimeSend.mockResolvedValue({});
    mockIvsSend.mockResolvedValue({});
  });

  const BUCKET = 'vnl-moderation-frames';
  const KEY = 'moderation-frames/session-s1/participant-u1/1.jpg';

  function makeEvent(): S3Event {
    return {
      Records: [
        {
          s3: {
            bucket: { name: BUCKET },
            object: { key: KEY },
          } as any,
        } as any,
      ],
    } as any;
  }

  const ruleset = {
    name: 'hangout',
    version: 1,
    description: 'social',
    disallowedItems: ['weapons'],
    severity: 'high',
    createdBy: 'SYSTEM',
    createdAt: 'n',
    active: true,
  };

  const hangoutSession: any = {
    sessionId: 's1',
    userId: 'owner',
    sessionType: SessionType.HANGOUT,
    stageArn: 'arn:aws:ivs:us-east-1:000000000000:stage/abc',
    claimedResources: { chatRoom: 'arn:aws:ivschat:us-east-1:000:room/r1', stage: 'arn:stage' },
    rulesetName: 'hangout',
    rulesetVersion: 1,
    moderationStrikes: 0,
  };

  it('does nothing when session has no pinned ruleset', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...hangoutSession, rulesetName: undefined, rulesetVersion: undefined });

    await handler(makeEvent());

    expect(mockGetRuleset).not.toHaveBeenCalled();
    expect(mockClassifyImage).not.toHaveBeenCalled();
    // Still deletes the orphan frame
    const deleteCall = mockS3Send.mock.calls.find((c) => c[0]?.__type === 'DeleteObjectCommand');
    expect(deleteCall).toBeDefined();
  });

  it('writes MOD row when classification flagged above threshold', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetRuleset.mockResolvedValueOnce(ruleset);
    mockClassifyImage.mockResolvedValueOnce({
      flagged: true,
      items: ['weapons'],
      confidence: 0.9,
      reasoning: 'visible weapon',
    });

    // Sequence of DDB calls:
    // 1. UpdateCommand (strike increment) returns strikes=1
    // 2. PutCommand (MOD row)
    // 3. emitSessionEvent writes (mocked out — doesn't hit docSend here)
    mockDocSend
      .mockResolvedValueOnce({ Attributes: { moderationStrikes: 1 } })
      .mockResolvedValueOnce({});

    await handler(makeEvent());

    expect(mockClassifyImage).toHaveBeenCalled();

    // Verify MOD row was written
    const modPut = mockDocSend.mock.calls.find(
      (c) => c[0]?.input?.Item?.actionType === 'AUTO_MOD_IMAGE',
    );
    expect(modPut).toBeDefined();
    expect(modPut[0].input.Item.rulesetName).toBe('hangout');
    expect(modPut[0].input.Item.rulesetVersion).toBe(1);
    expect(modPut[0].input.Item.confidence).toBe(0.9);

    // No bounce (only 1 strike)
    const disconnectCall = mockIvsRealtimeSend.mock.calls.find(
      (c) => c[0]?.__type === 'DisconnectParticipantCommand',
    );
    expect(disconnectCall).toBeUndefined();
  });

  it('does NOT flag when confidence below severity threshold', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetRuleset.mockResolvedValueOnce(ruleset); // severity=high → threshold 0.6
    mockClassifyImage.mockResolvedValueOnce({
      flagged: true,
      items: ['maybe'],
      confidence: 0.4,
      reasoning: 'unsure',
    });

    await handler(makeEvent());

    // No MOD row written
    const modPut = mockDocSend.mock.calls.find(
      (c) => c[0]?.input?.Item?.actionType === 'AUTO_MOD_IMAGE',
    );
    expect(modPut).toBeUndefined();

    // S3 delete still happens
    const deleteCall = mockS3Send.mock.calls.find((c) => c[0]?.__type === 'DeleteObjectCommand');
    expect(deleteCall).toBeDefined();
  });

  it('auto-bounces on 3rd strike in a hangout', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetRuleset.mockResolvedValueOnce(ruleset);
    mockClassifyImage.mockResolvedValueOnce({
      flagged: true,
      items: ['weapons'],
      confidence: 0.95,
      reasoning: 'visible',
    });
    mockGetHangoutParticipants.mockResolvedValueOnce([
      { userId: 'u1', participantId: 'p-1' },
    ]);

    // docSend: strike increment returns 3, then MOD row put, then BOUNCE audit put
    mockDocSend
      .mockResolvedValueOnce({ Attributes: { moderationStrikes: 3 } })
      .mockResolvedValueOnce({}) // MOD row put
      .mockResolvedValueOnce({}); // BOUNCE audit put

    await handler(makeEvent());

    const disconnectCall = mockIvsRealtimeSend.mock.calls.find(
      (c) => c[0]?.__type === 'DisconnectParticipantCommand',
    );
    expect(disconnectCall).toBeDefined();
    expect(disconnectCall[0].input.participantId).toBe('p-1');

    // BOUNCE audit row
    const bouncePut = mockDocSend.mock.calls.find(
      (c) => c[0]?.input?.Item?.actionType === 'BOUNCE',
    );
    expect(bouncePut).toBeDefined();
  });

  it('deletes orphan frames when session is missing', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    await handler(makeEvent());
    const deleteCall = mockS3Send.mock.calls.find((c) => c[0]?.__type === 'DeleteObjectCommand');
    expect(deleteCall).toBeDefined();
  });
});
