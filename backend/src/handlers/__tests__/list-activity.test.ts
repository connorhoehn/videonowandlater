/**
 * Tests for list-activity Lambda handler
 * GET /activity - list recent activity (broadcasts and hangouts)
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../list-activity';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus, RecordingStatus } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetRecentActivity = sessionRepository.getRecentActivity as jest.MockedFunction<
  typeof sessionRepository.getRecentActivity
>;

describe('list-activity handler', () => {
  const TABLE_NAME = 'test-table';
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(): APIGatewayProxyEvent {
    return {
      requestContext: {},
    } as any;
  }

  test('should return sessions in reverse chronological order', async () => {
    const sessions = [
      {
        sessionId: 'session-3',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 5,
      },
      {
        sessionId: 'session-2',
        userId: 'user2',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T09:00:00Z',
        endedAt: '2026-03-06T09:45:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-2' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 3,
        messageCount: 12,
      },
      {
        sessionId: 'session-1',
        userId: 'user3',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T08:00:00Z',
        endedAt: '2026-03-06T08:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-3' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 3,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce({ items: sessions });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(3);
    // Verify order is DESC by endedAt
    expect(body.sessions[0].sessionId).toBe('session-3');
    expect(body.sessions[1].sessionId).toBe('session-2');
    expect(body.sessions[2].sessionId).toBe('session-1');
  });

  test('should include reactionSummary for broadcasts', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        reactionSummary: { heart: 42, fire: 17, clap: 8 },
        messageCount: 10,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce({ items: sessions });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].reactionSummary).toEqual({ heart: 42, fire: 17, clap: 8 });
  });

  test('should include participantCount for hangouts', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        userId: 'user1',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 4,
        messageCount: 15,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce({ items: sessions });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].participantCount).toBe(4);
  });

  test('should include messageCount for both types', async () => {
    const sessions = [
      {
        sessionId: 'session-broadcast',
        userId: 'user1',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T10:00:00Z',
        endedAt: '2026-03-06T10:30:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
        recordingStatus: RecordingStatus.AVAILABLE,
        messageCount: 25,
      },
      {
        sessionId: 'session-hangout',
        userId: 'user2',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.ENDED,
        createdAt: '2026-03-06T09:00:00Z',
        endedAt: '2026-03-06T09:45:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-2' },
        recordingStatus: RecordingStatus.AVAILABLE,
        participantCount: 3,
        messageCount: 18,
      },
    ];

    mockGetRecentActivity.mockResolvedValueOnce({ items: sessions });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions[0].messageCount).toBe(25);
    expect(body.sessions[1].messageCount).toBe(18);
  });

  test('should return 20 most recent sessions', async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => ({
      sessionId: `session-${i}`,
      userId: `user-${i}`,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: `2026-03-06T${String(10 + i).padStart(2, '0')}:00:00Z`,
      endedAt: `2026-03-06T${String(10 + i).padStart(2, '0')}:30:00Z`,
      version: 1,
      claimedResources: { chatRoom: `room-${i}` },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: i + 1,
    }));

    mockGetRecentActivity.mockResolvedValueOnce({ items: sessions });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(20);
  });

  test('should handle empty session list', async () => {
    mockGetRecentActivity.mockResolvedValueOnce({ items: [] });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toEqual([]);
  });

  test('should return 500 on repository error', async () => {
    mockGetRecentActivity.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Failed to list activity');
  });

  test('should return 500 when TABLE_NAME is not set', async () => {
    const originalTableName = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal server error');

    process.env.TABLE_NAME = originalTableName;
  });

  test('should include CORS headers', async () => {
    mockGetRecentActivity.mockResolvedValueOnce({ items: [] });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers!['Access-Control-Allow-Headers']).toBe('*');
    expect(result.headers!['Content-Type']).toBe('application/json');
  });

  // ============================================================
  // Private Session Filtering Tests (Phase 22)
  // ============================================================

  test('should return public sessions to all users', async () => {
    const publicSession = {
      sessionId: 'sess-public-1',
      userId: 'user-alice',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T10:00:00Z',
      endedAt: '2026-03-06T10:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 5,
    };

    const privateSessionAlice = {
      sessionId: 'sess-private-1',
      userId: 'user-alice',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T11:00:00Z',
      endedAt: '2026-03-06T11:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-2' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 3,
    };

    const privateSessionBob = {
      sessionId: 'sess-private-2',
      userId: 'user-bob',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T09:00:00Z',
      endedAt: '2026-03-06T09:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-3' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 2,
    };

    mockGetRecentActivity.mockResolvedValueOnce({ items: [
      publicSession,
      privateSessionAlice,
      privateSessionBob,
    ] });

    // User charlie (not owner of any private session)
    const event = {
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-charlie' },
        },
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('sess-public-1');
  });

  test('should show owner their private sessions along with public sessions', async () => {
    const publicSession = {
      sessionId: 'sess-public-1',
      userId: 'user-dave',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T10:00:00Z',
      endedAt: '2026-03-06T10:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 5,
    };

    const privateSessionAlice = {
      sessionId: 'sess-private-1',
      userId: 'user-alice',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T11:00:00Z',
      endedAt: '2026-03-06T11:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-2' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 3,
    };

    const privateSessionBob = {
      sessionId: 'sess-private-2',
      userId: 'user-bob',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T09:00:00Z',
      endedAt: '2026-03-06T09:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-3' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 2,
    };

    mockGetRecentActivity.mockResolvedValueOnce({ items: [
      publicSession,
      privateSessionAlice,
      privateSessionBob,
    ] });

    // User alice (owner of sess-private-1)
    const event = {
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-alice' },
        },
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // Alice should see: her private session + public session
    expect(body.sessions).toHaveLength(2);
    const sessionIds = body.sessions.map((s: any) => s.sessionId);
    expect(sessionIds).toContain('sess-public-1');
    expect(sessionIds).toContain('sess-private-1');
    expect(sessionIds).not.toContain('sess-private-2');
  });

  test('should hide private sessions from other authenticated users', async () => {
    const publicSession = {
      sessionId: 'sess-public-1',
      userId: 'user-dave',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T10:00:00Z',
      endedAt: '2026-03-06T10:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 5,
    };

    const privateSessionBob = {
      sessionId: 'sess-private-2',
      userId: 'user-bob',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T09:00:00Z',
      endedAt: '2026-03-06T09:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-3' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 2,
    };

    mockGetRecentActivity.mockResolvedValueOnce({ items: [publicSession, privateSessionBob] });

    // User alice (not owner)
    const event = {
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-alice' },
        },
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('sess-public-1');
  });

  test('should hide all private sessions from unauthenticated users', async () => {
    const publicSession = {
      sessionId: 'sess-public-1',
      userId: 'user-alice',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T10:00:00Z',
      endedAt: '2026-03-06T10:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 5,
    };

    const privateSessionAlice = {
      sessionId: 'sess-private-1',
      userId: 'user-alice',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T11:00:00Z',
      endedAt: '2026-03-06T11:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-2' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 3,
    };

    const privateSessionBob = {
      sessionId: 'sess-private-2',
      userId: 'user-bob',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T09:00:00Z',
      endedAt: '2026-03-06T09:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-3' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 2,
    };

    mockGetRecentActivity.mockResolvedValueOnce({ items: [
      publicSession,
      privateSessionAlice,
      privateSessionBob,
    ] });

    // No auth
    const event = {
      requestContext: {
        authorizer: undefined,
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('sess-public-1');
  });

  test('should treat sessions without isPrivate field as public', async () => {
    const legacySession = {
      sessionId: 'sess-legacy',
      userId: 'user-dave',
      // isPrivate is undefined
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T08:00:00Z',
      endedAt: '2026-03-06T08:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 1,
    };

    const privateSessionAlice = {
      sessionId: 'sess-private-1',
      userId: 'user-alice',
      isPrivate: true,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T11:00:00Z',
      endedAt: '2026-03-06T11:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-2' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 3,
    };

    mockGetRecentActivity.mockResolvedValueOnce({ items: [legacySession, privateSessionAlice] });

    // User eve (not owner)
    const event = {
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-eve' },
        },
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // Should see legacy session (treated as public) but not private session
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('sess-legacy');
  });

  test('should maintain sort order from getRecentActivity after filtering', async () => {
    const session1 = {
      sessionId: 'sess-1',
      userId: 'user-alice',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T08:00:00Z',
      endedAt: '2026-03-06T08:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-1' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 1,
    };

    const session2 = {
      sessionId: 'sess-2',
      userId: 'user-alice',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T12:00:00Z',
      endedAt: '2026-03-06T12:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-2' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 2,
    };

    const session3 = {
      sessionId: 'sess-3',
      userId: 'user-alice',
      isPrivate: false,
      sessionType: SessionType.BROADCAST,
      status: SessionStatus.ENDED,
      createdAt: '2026-03-06T10:00:00Z',
      endedAt: '2026-03-06T10:30:00Z',
      version: 1,
      claimedResources: { chatRoom: 'room-3' },
      recordingStatus: RecordingStatus.AVAILABLE,
      messageCount: 3,
    };

    // Mock already returns sessions in sorted order (DESC by createdAt)
    mockGetRecentActivity.mockResolvedValueOnce({ items: [session2, session3, session1] });

    const event = {
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user-test' },
        },
      },
    } as any;

    const result = (await handler(event, mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    // Should maintain sort order from getRecentActivity (DESC by createdAt)
    expect(body.sessions[0].sessionId).toBe('sess-2');
    expect(body.sessions[1].sessionId).toBe('sess-3');
    expect(body.sessions[2].sessionId).toBe('sess-1');
  });
});
