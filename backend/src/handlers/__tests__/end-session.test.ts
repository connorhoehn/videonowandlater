/**
 * Tests for end-session Lambda handler
 * POST /sessions/:sessionId/end - end a broadcast session
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../end-session';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockUpdateSessionStatus = sessionRepository.updateSessionStatus as jest.MockedFunction<
  typeof sessionRepository.updateSessionStatus
>;
const mockUpdateSpotlight = sessionRepository.updateSpotlight as jest.MockedFunction<
  typeof sessionRepository.updateSpotlight
>;

describe('end-session handler', () => {
  const TABLE_NAME = 'test-table';

  const liveSession: Session = {
    sessionId: 'session-abc',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-03-06T10:00:00Z',
    version: 1,
    claimedResources: { chatRoom: 'room-1' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(userId: string, sessionId: string): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': userId },
        },
      },
    } as any;
  }

  test('should end a live session and return 200', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);
    mockUpdateSpotlight.mockResolvedValueOnce(undefined);

    const result = await handler(createEvent('user-owner', 'session-abc'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Session ending');
    expect(body.status).toBe('ending');
  });

  test('should return 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('user-owner', 'nonexistent'));

    expect(result.statusCode).toBe(404);
  });

  test('should return 403 when not session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);

    const result = await handler(createEvent('user-not-owner', 'session-abc'));

    expect(result.statusCode).toBe(403);
  });

  test('should return 200 when session already ending', async () => {
    const endingSession = { ...liveSession, status: SessionStatus.ENDING };
    mockGetSessionById.mockResolvedValueOnce(endingSession);

    const result = await handler(createEvent('user-owner', 'session-abc'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Session already ending/ended');
  });

  test('should return 401 when not authenticated', async () => {
    const event = {
      pathParameters: { sessionId: 'session-abc' },
      requestContext: {},
    } as any;

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  test('should return 400 when sessionId missing', async () => {
    const event = {
      pathParameters: {},
      requestContext: {
        authorizer: { claims: { 'cognito:username': 'user-owner' } },
      },
    } as any;

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
  });

  test('should clear spotlight when session transitions to ENDING', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);
    mockUpdateSpotlight.mockResolvedValueOnce(undefined);

    await handler(createEvent('user-owner', 'session-abc'));

    // Verify updateSpotlight was called to clear spotlight
    expect(mockUpdateSpotlight).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-abc',
      null,
      null
    );
  });

  test('should not fail if spotlight cleanup errors (non-blocking)', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);
    mockUpdateSpotlight.mockRejectedValueOnce(new Error('DynamoDB error'));

    const result = await handler(createEvent('user-owner', 'session-abc'));

    // Should still return 200 even if spotlight cleanup fails
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Session ending');
  });

  test('should return 500 when TABLE_NAME not set', async () => {
    const originalTableName = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;

    const result = await handler(createEvent('user-owner', 'session-abc'));

    expect(result.statusCode).toBe(500);

    process.env.TABLE_NAME = originalTableName;
  });
});
