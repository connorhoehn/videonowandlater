/**
 * Tests for approve-lobby-request Lambda handler
 * POST /sessions/{sessionId}/lobby/{userId}/approve
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../approve-lobby-request';
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
const mockAddHangoutParticipant = sessionRepository.addHangoutParticipant as jest.MockedFunction<
  typeof sessionRepository.addHangoutParticipant
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

describe('approve-lobby-request handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const OWNER_ID = 'user-owner';
  const TARGET_USER_ID = 'user-target';
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
    mockRealtimeSend.mockResolvedValue({
      participantToken: {
        token: 'new-upgraded-token',
        participantId: 'participant-upgraded',
        expirationTime: new Date('2026-04-18T22:00:00Z'),
      },
    });
    mockChatSend.mockResolvedValue({});
    mockAddHangoutParticipant.mockResolvedValue(undefined);
    mockUpdateLobbyRequestStatus.mockResolvedValue(undefined);
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

  test('returns 400 when sessionId or userId is missing', async () => {
    const event = createEvent({ actorId: OWNER_ID });
    event.pathParameters = { sessionId: SESSION_ID };
    const res = await handler(event) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when caller is neither session owner nor admin', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    const res = await handler(createEvent({ actorId: 'random-user' })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
    expect(mockRealtimeSend).not.toHaveBeenCalled();
  });

  test('owner: mints upgraded token, updates lobby, adds participant, emits chat event', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('approved');
    expect(body.userId).toBe(TARGET_USER_ID);
    expect(body.token).toBe('new-upgraded-token');
    expect(body.participantId).toBe('participant-upgraded');

    // CreateParticipantToken was invoked with PUBLISH+SUBSCRIBE, 720min
    expect(mockRealtimeSend).toHaveBeenCalledTimes(1);
    const tokenCall = mockRealtimeSend.mock.calls[0][0];
    expect(tokenCall.input).toMatchObject({
      stageArn: STAGE_ARN,
      userId: TARGET_USER_ID,
      duration: 720,
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
    });

    expect(mockUpdateLobbyRequestStatus).toHaveBeenCalledWith(TABLE_NAME, SESSION_ID, TARGET_USER_ID, 'approved');
    expect(mockAddHangoutParticipant).toHaveBeenCalledWith(
      TABLE_NAME,
      SESSION_ID,
      TARGET_USER_ID,
      TARGET_USER_ID,
      'participant-upgraded',
    );

    expect(mockChatSend).toHaveBeenCalledTimes(1);
    const chatCall = mockChatSend.mock.calls[0][0];
    expect(chatCall.input).toMatchObject({
      roomIdentifier: CHAT_ROOM,
      eventName: 'lobby_update',
    });
  });

  test('admin (non-owner) can approve', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockIsAdmin.mockReturnValueOnce(true);
    const res = await handler(createEvent({ actorId: 'admin-user' })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    expect(mockRealtimeSend).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when session is not a HANGOUT', async () => {
    mockGetSessionById.mockResolvedValueOnce({
      ...hangoutSession,
      sessionType: SessionType.BROADCAST,
    } as Session);
    const res = await handler(createEvent({ actorId: OWNER_ID })) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });
});
