/**
 * Tests for on-session-created handler (go-live fan-out).
 *
 * Scenarios covered:
 *   - Private session → no fan-out
 *   - STORY session → no fan-out
 *   - Zero followers → no DDB writes
 *   - 100 followers → batchWrite called 4 times (25 per batch)
 *   - Missing profile → subject falls back to userId
 */

import type { EventBridgeEvent } from 'aws-lambda';

// --- Mock DynamoDB doc client (we inspect BatchWrite calls) ---
const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: () => ({ send: mockDocSend }),
}));

// Count BatchWriteCommand invocations.
let batchWriteCalls: Array<{ itemCount: number }> = [];
jest.mock('@aws-sdk/lib-dynamodb', () => {
  class BatchWriteCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
      // Record the first (and only) table's item count.
      const tables = Object.values(input.RequestItems ?? {}) as any[];
      const itemCount = tables[0]?.length ?? 0;
      batchWriteCalls.push({ itemCount });
    }
  }
  return { BatchWriteCommand };
});

// --- Mock repositories ---
const mockGetSessionById = jest.fn();
jest.mock('../../repositories/session-repository', () => ({
  getSessionById: (...args: any[]) => mockGetSessionById(...args),
}));

const mockListFollowers = jest.fn();
jest.mock('../../repositories/follow-repository', () => ({
  listFollowers: (...args: any[]) => mockListFollowers(...args),
}));

const mockGetProfile = jest.fn();
jest.mock('../../repositories/profile-repository', () => ({
  getProfile: (...args: any[]) => mockGetProfile(...args),
}));

import { handler } from '../on-session-created';
import { SessionType, SessionStatus } from '../../domain/session';

function makeEvent(sessionId = 'sess-1', eventType = 'SESSION_CREATED'): EventBridgeEvent<string, any> {
  return {
    version: '0',
    id: 'evt-1',
    'detail-type': `session.${eventType}`,
    source: 'custom.vnl',
    account: '123456789012',
    time: '2026-04-18T00:00:00Z',
    region: 'us-east-1',
    resources: [],
    detail: {
      eventId: 'ev-1',
      sessionId,
      eventType,
      timestamp: '2026-04-18T00:00:00Z',
      actorId: 'creator-abc',
      actorType: 'user',
    },
  };
}

function baseSession(overrides: Record<string, any> = {}) {
  return {
    sessionId: 'sess-1',
    userId: 'creator-abc',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: { chatRoom: 'room-1' },
    createdAt: '2026-04-18T00:00:00Z',
    version: 1,
    visibility: 'public',
    title: 'My show',
    ...overrides,
  };
}

describe('on-session-created handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    batchWriteCalls = [];
    mockDocSend.mockReset();
    mockDocSend.mockResolvedValue({});
    mockGetSessionById.mockReset();
    mockListFollowers.mockReset();
    mockGetProfile.mockReset();
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      NOTIFICATION_EMAIL_ENABLED: 'false',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('skips fan-out for private sessions', async () => {
    mockGetSessionById.mockResolvedValue(baseSession({ visibility: 'private' }));
    mockListFollowers.mockResolvedValue([
      { follower: 'u1', followee: 'creator-abc', followedAt: '2026-01-01' },
    ]);
    mockGetProfile.mockResolvedValue({ userId: 'creator-abc', displayName: 'Alice' });

    await handler(makeEvent());

    expect(mockListFollowers).not.toHaveBeenCalled();
    expect(batchWriteCalls).toHaveLength(0);
  });

  it('skips fan-out for STORY sessions', async () => {
    mockGetSessionById.mockResolvedValue(
      baseSession({ sessionType: SessionType.STORY, visibility: 'public' }),
    );
    mockListFollowers.mockResolvedValue([
      { follower: 'u1', followee: 'creator-abc', followedAt: '2026-01-01' },
    ]);

    await handler(makeEvent());

    expect(mockListFollowers).not.toHaveBeenCalled();
    expect(batchWriteCalls).toHaveLength(0);
  });

  it('writes nothing when creator has zero followers', async () => {
    mockGetSessionById.mockResolvedValue(baseSession());
    mockListFollowers.mockResolvedValue([]);
    mockGetProfile.mockResolvedValue({ userId: 'creator-abc', displayName: 'Alice' });

    await handler(makeEvent());

    expect(mockListFollowers).toHaveBeenCalledWith('test-table', 'creator-abc', 1000);
    expect(batchWriteCalls).toHaveLength(0);
  });

  it('batches 100 followers into 4 BatchWrite calls of 25 each', async () => {
    mockGetSessionById.mockResolvedValue(baseSession());
    mockGetProfile.mockResolvedValue({ userId: 'creator-abc', displayName: 'Alice' });
    const followers = Array.from({ length: 100 }, (_, i) => ({
      follower: `u${i}`,
      followee: 'creator-abc',
      followedAt: '2026-01-01',
    }));
    mockListFollowers.mockResolvedValue(followers);

    await handler(makeEvent());

    expect(batchWriteCalls).toHaveLength(4);
    expect(batchWriteCalls.every((c) => c.itemCount === 25)).toBe(true);
    // DocClient.send gets called once per BatchWriteCommand.
    expect(mockDocSend).toHaveBeenCalledTimes(4);
  });

  it('falls back to userId when profile is missing', async () => {
    mockGetSessionById.mockResolvedValue(baseSession({ title: undefined }));
    mockGetProfile.mockResolvedValue(null);
    mockListFollowers.mockResolvedValue([
      { follower: 'u1', followee: 'creator-abc', followedAt: '2026-01-01' },
    ]);

    // Capture the BatchWrite payload so we can assert on the subject.
    let capturedSubject: string | undefined;
    jest.isolateModules(() => {}); // no-op — just to keep lint happy
    mockDocSend.mockImplementation((cmd: any) => {
      const items = Object.values(cmd.input.RequestItems)[0] as any[];
      capturedSubject = items[0]?.PutRequest?.Item?.subject;
      return Promise.resolve({});
    });

    await handler(makeEvent());

    expect(batchWriteCalls).toHaveLength(1);
    expect(capturedSubject).toBe('creator-abc started a session');
  });

  it('swallows getSessionById errors (non-fatal)', async () => {
    mockGetSessionById.mockRejectedValue(new Error('ddb down'));

    await expect(handler(makeEvent())).resolves.toBeUndefined();
    expect(batchWriteCalls).toHaveLength(0);
  });

  it('fans out for HANGOUT SESSION_STARTED events', async () => {
    mockGetSessionById.mockResolvedValue(
      baseSession({ sessionType: SessionType.HANGOUT, title: 'Coffee chat' }),
    );
    mockGetProfile.mockResolvedValue({ userId: 'creator-abc', displayName: 'Alice', handle: 'alice' });
    mockListFollowers.mockResolvedValue([
      { follower: 'u1', followee: 'creator-abc', followedAt: '2026-01-01' },
    ]);

    await handler(makeEvent('sess-1', 'SESSION_STARTED'));

    expect(batchWriteCalls).toHaveLength(1);
    expect(batchWriteCalls[0].itemCount).toBe(1);
  });
});
