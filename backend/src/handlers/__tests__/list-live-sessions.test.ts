/**
 * Tests for list-live-sessions Lambda handler
 * GET /sessions/live - list public live sessions for spotlight selection
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../list-live-sessions';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetLivePublicSessions = sessionRepository.getLivePublicSessions as jest.MockedFunction<
  typeof sessionRepository.getLivePublicSessions
>;

describe('list-live-sessions handler', () => {
  const TABLE_NAME = 'test-table';
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(userId?: string): APIGatewayProxyEvent {
    return {
      requestContext: {
        authorizer: userId
          ? { claims: { 'cognito:username': userId } }
          : undefined,
      },
    } as any;
  }

  test('should return 200 with array of public live sessions excluding caller own session', async () => {
    const sessions = [
      {
        sessionId: 'session-1',
        userId: 'user-other',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.LIVE,
        createdAt: '2026-03-06T10:00:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-1' },
      },
      {
        sessionId: 'session-2',
        userId: 'user-another',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.LIVE,
        createdAt: '2026-03-06T09:00:00Z',
        version: 1,
        claimedResources: { chatRoom: 'room-2' },
      },
    ];

    mockGetLivePublicSessions.mockResolvedValueOnce(sessions);

    const result = (await handler(createEvent('user-me'), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].sessionId).toBe('session-1');

    // Verify repository called with excludeUserId
    expect(mockGetLivePublicSessions).toHaveBeenCalledWith(TABLE_NAME, 'user-me');
  });

  test('should return empty array when no live sessions', async () => {
    mockGetLivePublicSessions.mockResolvedValueOnce([]);

    const result = (await handler(createEvent('user-me'), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toEqual([]);
  });

  test('should return 500 when TABLE_NAME not set', async () => {
    const originalTableName = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;

    const result = (await handler(createEvent('user-me'), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('TABLE_NAME not set');

    process.env.TABLE_NAME = originalTableName;
  });

  test('should return 401 when not authenticated', async () => {
    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Unauthorized');
  });

  test('should include CORS headers', async () => {
    mockGetLivePublicSessions.mockResolvedValueOnce([]);

    const result = (await handler(createEvent('user-me'), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers!['Access-Control-Allow-Headers']).toBe('*');
    expect(result.headers!['Content-Type']).toBe('application/json');
  });

  test('should return 500 on repository error', async () => {
    mockGetLivePublicSessions.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = (await handler(createEvent('user-me'), mockContext, mockCallback)) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
  });
});
