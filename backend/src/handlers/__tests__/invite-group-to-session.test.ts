/**
 * Tests for invite-group-to-session Lambda handler.
 * POST /sessions/{sessionId}/invite-group
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../invite-group-to-session';
import * as sessionRepo from '../../repositories/session-repository';
import * as groupRepo from '../../repositories/group-repository';
import * as inviteRepo from '../../repositories/invitation-repository';
import * as ivsClients from '../../lib/ivs-clients';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/group-repository');
jest.mock('../../repositories/invitation-repository');
jest.mock('../../lib/ivs-clients');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockGetSessionById = sessionRepo.getSessionById as jest.MockedFunction<
  typeof sessionRepo.getSessionById
>;
const mockGetHangoutParticipants =
  sessionRepo.getHangoutParticipants as jest.MockedFunction<
    typeof sessionRepo.getHangoutParticipants
  >;
const mockGetGroupById = groupRepo.getGroupById as jest.MockedFunction<
  typeof groupRepo.getGroupById
>;
const mockGetMember = groupRepo.getMember as jest.MockedFunction<
  typeof groupRepo.getMember
>;
const mockListMembers = groupRepo.listMembers as jest.MockedFunction<
  typeof groupRepo.listMembers
>;
const mockCreateInvitation = inviteRepo.createInvitation as jest.MockedFunction<
  typeof inviteRepo.createInvitation
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;

const TABLE = 'test-table';
const SESSION_ID = 'sess-1';
const CHAT_ROOM = 'arn:aws:ivschat:us-east-1:123:room/foo';
const OWNER = 'alice';
const GROUP_ID = 'g1';

const hangoutSession: Session = {
  sessionId: SESSION_ID,
  userId: OWNER,
  sessionType: SessionType.HANGOUT,
  status: SessionStatus.LIVE,
  claimedResources: { stage: 'stage-arn', chatRoom: CHAT_ROOM },
  createdAt: '2026-04-18T10:00:00Z',
  version: 1,
};

function createEvent(
  body: object | null,
  actorId: string | undefined,
  sessionId = SESSION_ID,
): APIGatewayProxyEvent {
  return {
    pathParameters: { sessionId },
    body: body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: actorId
        ? { claims: { 'cognito:username': actorId } }
        : undefined,
    },
  } as any;
}

describe('invite-group-to-session handler', () => {
  const mockChatSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIVSChatClient.mockReturnValue({ send: mockChatSend } as any);
    mockChatSend.mockResolvedValue({});
    mockGetHangoutParticipants.mockResolvedValue([]);
  });

  test('401 when caller is unauthenticated', async () => {
    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, undefined),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(401);
  });

  test('400 when groupId is missing', async () => {
    const res = (await handler(createEvent({}, OWNER))) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(400);
  });

  test('404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, 'some-other-user'),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  test('404 when group not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetGroupById.mockResolvedValueOnce(null);
    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(404);
  });

  test('403 when caller is session owner but not group owner/admin', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetGroupById.mockResolvedValueOnce({
      groupId: GROUP_ID,
      ownerId: 'someone-else',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: GROUP_ID,
      userId: OWNER,
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'someone-else',
    });

    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(403);
  });

  test('happy path: creates invitations, skips caller + already-joined', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetGroupById.mockResolvedValueOnce({
      groupId: GROUP_ID,
      ownerId: OWNER,
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: GROUP_ID,
      userId: OWNER,
      groupRole: 'owner',
      addedAt: 'x',
      addedBy: OWNER,
    });
    mockListMembers.mockResolvedValueOnce([
      { groupId: GROUP_ID, userId: OWNER, groupRole: 'owner', addedAt: 'x', addedBy: OWNER },
      { groupId: GROUP_ID, userId: 'bob', groupRole: 'member', addedAt: 'x', addedBy: OWNER },
      { groupId: GROUP_ID, userId: 'carol', groupRole: 'member', addedAt: 'x', addedBy: OWNER },
      { groupId: GROUP_ID, userId: 'dave', groupRole: 'member', addedAt: 'x', addedBy: OWNER },
    ]);
    // dave has already joined the hangout
    mockGetHangoutParticipants.mockResolvedValueOnce([
      {
        sessionId: SESSION_ID,
        userId: 'dave',
        displayName: 'dave',
        participantId: 'p-dave',
        joinedAt: 'x',
      },
    ]);
    mockCreateInvitation.mockImplementation(async (_t, input) => ({
      invitation: {
        sessionId: input.sessionId,
        userId: input.userId,
        inviterId: input.inviterId,
        invitedAt: 't',
        source: input.source,
        status: 'pending',
      },
      created: true,
    }));

    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invitedCount).toBe(2);   // bob + carol
    expect(body.skippedCount).toBe(2);   // alice (caller) + dave (already joined)

    expect(mockCreateInvitation).toHaveBeenCalledTimes(2);
    const invitees = mockCreateInvitation.mock.calls.map((c) => c[1].userId);
    expect(invitees.sort()).toEqual(['bob', 'carol']);

    // Chat event was emitted for host UI
    expect(mockChatSend).toHaveBeenCalledTimes(1);
    const chatCall = mockChatSend.mock.calls[0][0];
    expect(chatCall.input).toMatchObject({
      roomIdentifier: CHAT_ROOM,
      eventName: 'group_invited',
    });
    expect(chatCall.input.attributes).toMatchObject({
      groupId: GROUP_ID,
      count: '2',
      inviterId: OWNER,
    });
  });

  test('re-invite is idempotent: counts existing invites as skipped', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetGroupById.mockResolvedValueOnce({
      groupId: GROUP_ID,
      ownerId: OWNER,
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: GROUP_ID,
      userId: OWNER,
      groupRole: 'owner',
      addedAt: 'x',
      addedBy: OWNER,
    });
    mockListMembers.mockResolvedValueOnce([
      { groupId: GROUP_ID, userId: OWNER, groupRole: 'owner', addedAt: 'x', addedBy: OWNER },
      { groupId: GROUP_ID, userId: 'bob', groupRole: 'member', addedAt: 'x', addedBy: OWNER },
    ]);
    // createInvitation returns created=false (already existed)
    mockCreateInvitation.mockResolvedValueOnce({
      invitation: {
        sessionId: SESSION_ID,
        userId: 'bob',
        inviterId: OWNER,
        invitedAt: 't',
        source: `group:${GROUP_ID}`,
        status: 'pending',
      },
      created: false,
    });

    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invitedCount).toBe(0);
    expect(body.skippedCount).toBe(2); // caller + bob (pre-existing)
    // Chat event is NOT emitted when invitedCount is 0
    expect(mockChatSend).not.toHaveBeenCalled();
  });

  test('group-admin (non-owner) can trigger invite if they also own the session', async () => {
    mockGetSessionById.mockResolvedValueOnce(hangoutSession);
    mockGetGroupById.mockResolvedValueOnce({
      groupId: GROUP_ID,
      ownerId: 'someone-else',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: GROUP_ID,
      userId: OWNER,
      groupRole: 'admin',
      addedAt: 'x',
      addedBy: 'someone-else',
    });
    mockListMembers.mockResolvedValueOnce([
      { groupId: GROUP_ID, userId: 'bob', groupRole: 'member', addedAt: 'x', addedBy: OWNER },
    ]);
    mockCreateInvitation.mockResolvedValueOnce({
      invitation: {
        sessionId: SESSION_ID,
        userId: 'bob',
        inviterId: OWNER,
        invitedAt: 't',
        source: `group:${GROUP_ID}`,
        status: 'pending',
      },
      created: true,
    });

    const res = (await handler(
      createEvent({ groupId: GROUP_ID }, OWNER),
    )) as APIGatewayProxyResult;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invitedCount).toBe(1);
  });
});
