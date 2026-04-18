/**
 * Tests for list-my-invites Lambda handler.
 * GET /invites/mine?status=pending
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../list-my-invites';
import * as inviteRepo from '../../repositories/invitation-repository';
import * as sessionRepo from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';

jest.mock('../../repositories/invitation-repository');
jest.mock('../../repositories/session-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockListInvitesForUser =
  inviteRepo.listInvitesForUser as jest.MockedFunction<
    typeof inviteRepo.listInvitesForUser
  >;
const mockGetSessionById = sessionRepo.getSessionById as jest.MockedFunction<
  typeof sessionRepo.getSessionById
>;

function createEvent(
  actorId: string | undefined,
  query: Record<string, string> | null = null,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    pathParameters: null,
    queryStringParameters: query,
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: actorId
        ? { claims: { 'cognito:username': actorId } }
        : undefined,
    },
  } as any;
}

describe('list-my-invites handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('401 when unauthenticated', async () => {
    const res = (await handler(createEvent(undefined))) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('400 when status query param is invalid', async () => {
    const res = (await handler(
      createEvent('bob', { status: 'bogus' }),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('happy path: returns invites joined with session metadata', async () => {
    mockListInvitesForUser.mockResolvedValueOnce([
      {
        sessionId: 'sess-1',
        userId: 'bob',
        inviterId: 'alice',
        invitedAt: '2026-04-18T10:00:00Z',
        source: 'group:g1',
        status: 'pending',
      },
    ]);
    mockGetSessionById.mockResolvedValueOnce({
      sessionId: 'sess-1',
      userId: 'alice',
      sessionType: SessionType.HANGOUT,
      status: SessionStatus.LIVE,
      claimedResources: { chatRoom: 'r' },
      createdAt: '2026-04-18T09:00:00Z',
      version: 1,
    });

    const res = (await handler(
      createEvent('bob', { status: 'pending' }),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({
      sessionId: 'sess-1',
      status: 'pending',
      session: {
        sessionId: 'sess-1',
        hostUserId: 'alice',
        sessionType: 'HANGOUT',
      },
    });
    expect(mockListInvitesForUser).toHaveBeenCalledWith('test-table', 'bob', {
      status: 'pending',
    });
  });

  test('passes no status filter when query param absent', async () => {
    mockListInvitesForUser.mockResolvedValueOnce([]);
    const res = (await handler(createEvent('bob'))) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(mockListInvitesForUser).toHaveBeenCalledWith('test-table', 'bob', {
      status: undefined,
    });
  });

  test('tolerates deleted/missing sessions (returns session=null)', async () => {
    mockListInvitesForUser.mockResolvedValueOnce([
      {
        sessionId: 'sess-gone',
        userId: 'bob',
        inviterId: 'alice',
        invitedAt: 't',
        source: 'direct',
        status: 'pending',
      },
    ]);
    mockGetSessionById.mockResolvedValueOnce(null);

    const res = (await handler(createEvent('bob'))) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invites[0].session).toBeNull();
  });
});
