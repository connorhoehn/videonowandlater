/**
 * Tests for get-caption-credentials Lambda handler
 * GET /sessions/{sessionId}/captions/credentials
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../get-caption-credentials';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;

describe('get-caption-credentials handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-cred';
  const OWNER_ID = 'user-owner';

  const baseSession: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: { chatRoom: 'arn:aws:ivschat:us-east-1:123456789012:room/abcdef' },
    createdAt: '2026-03-10T10:00:00Z',
    version: 1,
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.IDENTITY_POOL_ID;
    process.env.AWS_REGION = 'us-east-1';
  });

  function createEvent(overrides: {
    actorId?: string;
    sessionId?: string | null;
  }): APIGatewayProxyEvent {
    const { actorId, sessionId } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: actorId
          ? { claims: { 'cognito:username': actorId } }
          : undefined,
      },
      body: null,
    } as any;
  }

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  test('returns 401 when unauthenticated', async () => {
    const event = createEvent({ actorId: undefined });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when sessionId missing', async () => {
    const event = createEvent({ actorId: OWNER_ID, sessionId: null });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = createEvent({ actorId: OWNER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(404);
  });

  test('returns 403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: 'not-owner' });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });

  test('returns captions_not_configured when IDENTITY_POOL_ID is unset', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: OWNER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('captions_not_configured');
  });

  test('returns identity-pool metadata when configured', async () => {
    process.env.IDENTITY_POOL_ID = 'us-east-1:abc-def-pool-id';
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: OWNER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toMatchObject({
      identityPoolId: 'us-east-1:abc-def-pool-id',
      region: 'us-east-1',
      configured: true,
    });
  });
});
