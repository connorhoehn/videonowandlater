/**
 * Tests for admin-resolve-chat-flag handler
 * POST /admin/chat-flags/{sessionId}/{sk}/resolve
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-resolve-chat-flag';
import * as chatModerationRepo from '../../repositories/chat-moderation-repository';
import * as sessionRepo from '../../repositories/session-repository';
import * as adminAuth from '../../lib/admin-auth';
import * as dynamodbClient from '../../lib/dynamodb-client';
import * as ivsClients from '../../lib/ivs-clients';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/chat-moderation-repository');
jest.mock('../../repositories/session-repository');
jest.mock('../../lib/admin-auth');
jest.mock('../../lib/dynamodb-client');
jest.mock('../../lib/ivs-clients');
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const mockResolveFlag = chatModerationRepo.resolveFlag as jest.MockedFunction<
  typeof chatModerationRepo.resolveFlag
>;
const mockGetSessionById = sessionRepo.getSessionById as jest.MockedFunction<
  typeof sessionRepo.getSessionById
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<
  typeof adminAuth.getAdminUserId
>;
const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;

const TABLE = 'test-table';
const SESSION_ID = 'sess-1';
const SK = 'CHATFLAG#2026-04-18T00:00:00Z#some-uuid';
const CHAT_ROOM = 'arn:aws:ivschat:us-east-1:123:room/r';

const liveSession: Session = {
  sessionId: SESSION_ID,
  userId: 'owner',
  sessionType: SessionType.BROADCAST,
  status: SessionStatus.LIVE,
  createdAt: '2026-04-01T00:00:00Z',
  version: 1,
  claimedResources: { chatRoom: CHAT_ROOM },
};

describe('admin-resolve-chat-flag handler', () => {
  const mockDocSend = jest.fn();
  const mockIvsSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    mockGetAdminUserId.mockReturnValue(undefined);
    mockGetDocumentClient.mockReturnValue({ send: mockDocSend } as any);
    mockGetIVSChatClient.mockReturnValue({ send: mockIvsSend } as any);
    mockDocSend.mockResolvedValue({});
    mockIvsSend.mockResolvedValue({});
    mockGetSessionById.mockResolvedValue(liveSession);
  });

  function createEvent(opts: {
    admin?: boolean;
    adminUserId?: string | undefined;
    sessionId?: string | null;
    sk?: string | null;
    body?: any;
  } = {}): APIGatewayProxyEvent {
    return {
      pathParameters: {
        ...(opts.sessionId === null ? {} : { sessionId: opts.sessionId ?? SESSION_ID }),
        ...(opts.sk === null ? {} : { sk: opts.sk ?? SK }),
      },
      requestContext: { authorizer: { claims: { 'cognito:username': opts.adminUserId ?? 'admin-1' } } },
      body: opts.body === undefined ? JSON.stringify({ action: 'approve' }) : JSON.stringify(opts.body),
    } as any;
  }

  test('returns 403 when caller is not admin', async () => {
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(403);
    expect(mockResolveFlag).not.toHaveBeenCalled();
  });

  test('returns 401 when admin but no cognito:username', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue(undefined);
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when sk does not start with CHATFLAG#', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ sk: 'MOD#bad' }));
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when action is not approve or reject', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ body: { action: 'nope' } }));
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when flag row not found', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockDocSend.mockResolvedValueOnce({}); // GetCommand -> no Item
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(404);
  });

  test('approve: marks flag resolved without bouncing', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    // GetCommand returns the flag row
    mockDocSend.mockResolvedValueOnce({
      Item: {
        PK: `SESSION#${SESSION_ID}`,
        SK,
        entityType: 'CHAT_FLAG',
        userId: 'bad-user',
        sessionId: SESSION_ID,
      },
    });

    const result = await handler(createEvent({ body: { action: 'approve' } }));
    expect(result.statusCode).toBe(200);
    expect(mockResolveFlag).toHaveBeenCalledWith(TABLE, SESSION_ID, SK, 'approve', 'admin-1');
    // No Disconnect / BOUNCE put
    expect(mockIvsSend).not.toHaveBeenCalled();
    // Only the Get was issued on docSend (no ADMIN_BOUNCE put)
    const bouncePuts = mockDocSend.mock.calls.filter(
      (c: any[]) => c[0]?.input?.Item?.actionType === 'ADMIN_BOUNCE',
    );
    expect(bouncePuts.length).toBe(0);
  });

  test('reject: resolves flag, disconnects user, writes ADMIN_BOUNCE MOD row', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockDocSend.mockResolvedValueOnce({
      Item: {
        PK: `SESSION#${SESSION_ID}`,
        SK,
        entityType: 'CHAT_FLAG',
        userId: 'bad-user',
        sessionId: SESSION_ID,
      },
    });

    const result = await handler(createEvent({ body: { action: 'reject' } }));
    expect(result.statusCode).toBe(200);
    expect(mockResolveFlag).toHaveBeenCalledWith(TABLE, SESSION_ID, SK, 'reject', 'admin-1');

    // user_kicked + DisconnectUser fired
    const eventNames = mockIvsSend.mock.calls
      .map((c: any[]) => c[0]?.input?.eventName)
      .filter(Boolean);
    expect(eventNames).toContain('user_kicked');
    // 2 IVS calls (SendEvent + DisconnectUser)
    expect(mockIvsSend).toHaveBeenCalledTimes(2);

    // ADMIN_BOUNCE MOD row written
    const bouncePuts = mockDocSend.mock.calls.filter(
      (c: any[]) => c[0]?.input?.Item?.actionType === 'ADMIN_BOUNCE',
    );
    expect(bouncePuts.length).toBe(1);
    expect(bouncePuts[0][0].input.Item).toMatchObject({
      actionType: 'ADMIN_BOUNCE',
      userId: 'bad-user',
      actorId: 'admin-1',
      sessionId: SESSION_ID,
      sourceFlagSk: SK,
    });
  });

  test('reject: still succeeds when DisconnectUser throws ResourceNotFoundException', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockDocSend.mockResolvedValueOnce({
      Item: {
        PK: `SESSION#${SESSION_ID}`,
        SK,
        entityType: 'CHAT_FLAG',
        userId: 'bad-user',
        sessionId: SESSION_ID,
      },
    });
    // first IVS call (SendEvent) succeeds, second (DisconnectUser) throws.
    mockIvsSend.mockResolvedValueOnce({});
    mockIvsSend.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }),
    );

    const result = await handler(createEvent({ body: { action: 'reject' } }));
    expect(result.statusCode).toBe(200);
    // ADMIN_BOUNCE MOD row still written
    const bouncePuts = mockDocSend.mock.calls.filter(
      (c: any[]) => c[0]?.input?.Item?.actionType === 'ADMIN_BOUNCE',
    );
    expect(bouncePuts.length).toBe(1);
  });
});
