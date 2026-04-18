/**
 * Tests for deny-lobby-request Lambda handler
 * POST /sessions/{sessionId}/lobby/{userId}/deny
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../deny-lobby-request';
import * as sessionRepository from '../../repositories/session-repository';
import * as ivsClients from '../../lib/ivs-clients';
import * as adminAuth from '../../lib/admin-auth';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');
jest.mock('../../lib/admin-auth');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetLobbyRequest = sessionRepository.getLobbyRequest as jest.MockedFunction<
  typeof sessionRepository.getLobbyRequest
>;
const mockUpdateLobbyRequestStatus = sessionRepository.updateLobbyRequestStatus as jest.MockedFunction<
  typeof sessionRepository.updateLobbyRequestStatus
>;
const mockGetIVSRealTimeClient = ivsClients.getIVSRealTimeClient as jest.MockedFunction<
  typeof ivsClients.getIVSRealTimeClient
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;

describe('deny-lobby-request handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const OWNER_ID = 'user-owner';
  const TARGET_USER_ID = 'user-target';
  const IVS_PARTICIPANT_ID = 'participant-pending-123';
  const STAGE_ARN = 'arn:aws:ivs:us-east-1:123:stage/xyz';
  const CHAT_ROOM = 'arn:aws:ivschat:us-east-1:123:room/foo';

  const hangoutSession: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.HANGOUT,
    status: SessionStatus.LIVE,
    requireApproval: true,
    claimedResources: { stage: STAGE_ARN, chatRoom: CHAT_ROOM },
    createdAt: '2026-04-18T10:00:00Z',
    version: 1,
  };

  const mockRealtimeSend = jest.fn();
  const mockChatSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    mockGetIVSRealTimeClient.mockReturnValue({ send: mockRealtimeSend } as any);
    mockGetIVSChatClient.mockReturnValue({ send: mockChatSend } as any);
    mockRealtimeSend.mockResolvedValue({});
    mockChatSend.mockResolvedValue({});
    mockUpdateLobbyRequestStatus.mockResolvedValue(undefined);
    mockGetLobbyRequest.mockResolvedValue({
      sessionId: SESSION_ID,
      userId: TARGET_USER_ID,
      displayName: TARGET_USER_ID,
      requestedAt: '2026-04-18T10:05:00Z',
      status: 'pending',
      ivsParticipantId: IVS_PARTICIPANT_ID,
    });
  });

  function createEvent(opts: { actorId?: string; sessionId?: string; userId?: string }): APIGatewayProxyEvent {
    return {
      pathParameters: {
        sessionId: opts.sessionId ?? SESSION_ID,
        userId: opts.userId ?? TARGET_USER_ID,
      },
      requestContext: {
        authorizer: opts.actorId ? { claims: { 'cognito:username': opts.actorId } } : undefined,
      },
    } as any;
  }

  test('returns 401 when caller is unauthenticated', async () => {
    const res = await handler(createEvent({})) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when caller is neither owner nor admin', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    const res = await handler(createEvent({ actorId: 'random-user' })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
    expect(mockRealtimeSend).not.toHaveBeenCalled();
  });

  test('returns 404 when lobby row is missing', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetLobbyRequest.mockResolvedValueOnce(null);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('owner: disconnects participant, updates lobby, emits chat event', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('denied');
    expect(body.userId).toBe(TARGET_USER_ID);

    // DisconnectParticipant was called with the stored ivsParticipantId
    expect(mockRealtimeSend).toHaveBeenCalledTimes(1);
    const disconnectCall = mockRealtimeSend.mock.calls[0][0];
    expect(disconnectCall.input).toMatchObject({
      stageArn: STAGE_ARN,
      participantId: IVS_PARTICIPANT_ID,
    });

    expect(mockUpdateLobbyRequestStatus).toHaveBeenCalledWith(TABLE_NAME, SESSION_ID, TARGET_USER_ID, 'denied');

    expect(mockChatSend).toHaveBeenCalledTimes(1);
    const chatCall = mockChatSend.mock.calls[0][0];
    expect(chatCall.input).toMatchObject({
      roomIdentifier: CHAT_ROOM,
      eventName: 'lobby_update',
    });
  });

  test('still returns 200 even if DisconnectParticipant throws', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockRealtimeSend.mockRejectedValueOnce(new Error('participant already gone'));
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(mockUpdateLobbyRequestStatus).toHaveBeenCalled();
  });

  test('admin (non-owner) can deny', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockIsAdmin.mockReturnValueOnce(true);
    const res = await handler(createEvent({ actorId: 'admin-user' })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
  });
});
