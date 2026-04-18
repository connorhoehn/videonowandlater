/**
 * Tests for respond-to-invite Lambda handler.
 * POST /invites/{sessionId}/respond
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../respond-to-invite';
import * as inviteRepo from '../../repositories/invitation-repository';

jest.mock('../../repositories/invitation-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockUpdateInviteStatus =
  inviteRepo.updateInviteStatus as jest.MockedFunction<
    typeof inviteRepo.updateInviteStatus
  >;

function createEvent(
  body: object | null,
  actorId: string | undefined,
  sessionId = 'sess-1',
): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    pathParameters: { sessionId },
    body: body ? JSON.stringify(body) : null,
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: actorId
        ? { claims: { 'cognito:username': actorId } }
        : undefined,
    },
  } as any;
}

describe('respond-to-invite handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('401 when unauthenticated', async () => {
    const res = (await handler(
      createEvent({ action: 'accept' }, undefined),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('400 when action is invalid', async () => {
    const res = (await handler(
      createEvent({ action: 'maybe' }, 'bob'),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
    expect(mockUpdateInviteStatus).not.toHaveBeenCalled();
  });

  test('404 when invite does not exist', async () => {
    mockUpdateInviteStatus.mockResolvedValueOnce(null);
    const res = (await handler(
      createEvent({ action: 'accept' }, 'bob'),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('accept: updates status to accepted', async () => {
    mockUpdateInviteStatus.mockResolvedValueOnce({
      sessionId: 'sess-1',
      userId: 'bob',
      inviterId: 'alice',
      invitedAt: 't',
      source: 'direct',
      status: 'accepted',
    });

    const res = (await handler(
      createEvent({ action: 'accept' }, 'bob'),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(mockUpdateInviteStatus).toHaveBeenCalledWith(
      'test-table',
      'bob',
      'sess-1',
      'accepted',
    );
    const body = JSON.parse(res.body);
    expect(body.invitation.status).toBe('accepted');
  });

  test('decline: updates status to declined', async () => {
    mockUpdateInviteStatus.mockResolvedValueOnce({
      sessionId: 'sess-1',
      userId: 'bob',
      inviterId: 'alice',
      invitedAt: 't',
      source: 'direct',
      status: 'declined',
    });

    const res = (await handler(
      createEvent({ action: 'decline' }, 'bob'),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(mockUpdateInviteStatus).toHaveBeenCalledWith(
      'test-table',
      'bob',
      'sess-1',
      'declined',
    );
  });
});
