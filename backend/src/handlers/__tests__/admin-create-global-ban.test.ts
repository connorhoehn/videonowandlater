/**
 * Tests for admin-create-global-ban Lambda handler
 * POST /admin/bans — create a global (cross-session) chat ban.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-create-global-ban';
import * as banRepository from '../../repositories/ban-repository';
import * as adminAuth from '../../lib/admin-auth';
import * as ivsClients from '../../lib/ivs-clients';

jest.mock('../../repositories/ban-repository');
jest.mock('../../lib/admin-auth');
jest.mock('../../lib/ivs-clients');

const mockCreateGlobalBan = banRepository.createGlobalBan as jest.MockedFunction<
  typeof banRepository.createGlobalBan
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<
  typeof adminAuth.getAdminUserId
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;

describe('admin-create-global-ban handler', () => {
  const TABLE = 'test-table';
  const mockChatSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    mockGetAdminUserId.mockReturnValue(undefined);
    mockGetIVSChatClient.mockReturnValue({ send: mockChatSend } as any);
    mockChatSend.mockResolvedValue({});
  });

  function createEvent(opts: {
    admin?: boolean;
    adminUserId?: string;
    body?: any;
  } = {}): APIGatewayProxyEvent {
    return {
      pathParameters: null,
      requestContext: {
        authorizer: { claims: { 'cognito:username': opts.adminUserId ?? 'admin-1' } },
      },
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      httpMethod: 'POST',
    } as any;
  }

  test('returns 403 when caller is not admin', async () => {
    mockIsAdmin.mockReturnValue(false);
    const result = await handler(createEvent({ body: { userId: 'u', reason: 'r' } }));
    expect(result.statusCode).toBe(403);
    expect(mockCreateGlobalBan).not.toHaveBeenCalled();
  });

  test('returns 401 when admin but no cognito:username (defensive)', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue(undefined);
    const result = await handler(createEvent({ body: { userId: 'u', reason: 'r' } }));
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when body is invalid JSON', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const event = {
      requestContext: { authorizer: { claims: { 'cognito:username': 'admin-1' } } },
      body: '{ not json',
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when userId missing', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ body: { reason: 'spam' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/userId/);
  });

  test('returns 400 when reason missing', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ body: { userId: 'target' } }));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/reason/);
  });

  test('happy path: creates ban and returns 201 with ban payload', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateGlobalBan.mockResolvedValueOnce({
      userId: 'target',
      bannedBy: 'admin-1',
      reason: 'spam',
      bannedAt: '2026-04-18T10:00:00.000Z',
    });

    const result = await handler(
      createEvent({ body: { userId: 'target', reason: 'spam' } }),
    );

    expect(result.statusCode).toBe(201);
    expect(mockCreateGlobalBan).toHaveBeenCalledWith(
      TABLE,
      'target',
      'admin-1',
      'spam',
      undefined,
    );
    const body = JSON.parse(result.body);
    expect(body.ban).toMatchObject({ userId: 'target', reason: 'spam', bannedBy: 'admin-1' });
  });

  test('passes ttlDays through to repository when provided', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateGlobalBan.mockResolvedValueOnce({
      userId: 'target',
      bannedBy: 'admin-1',
      reason: 'spam',
      bannedAt: '2026-04-18T10:00:00.000Z',
      expiresAt: '2026-04-25T10:00:00.000Z',
    });

    const result = await handler(
      createEvent({ body: { userId: 'target', reason: 'spam', ttlDays: 7 } }),
    );

    expect(result.statusCode).toBe(201);
    expect(mockCreateGlobalBan).toHaveBeenCalledWith(TABLE, 'target', 'admin-1', 'spam', 7);
  });

  test('best-effort SendEvent + DisconnectUser when activeRoomIdentifier provided', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateGlobalBan.mockResolvedValueOnce({
      userId: 'target',
      bannedBy: 'admin-1',
      reason: 'spam',
      bannedAt: '2026-04-18T10:00:00.000Z',
    });

    const result = await handler(
      createEvent({
        body: {
          userId: 'target',
          reason: 'spam',
          activeRoomIdentifier: 'arn:room-1',
        },
      }),
    );

    expect(result.statusCode).toBe(201);
    // Two chat calls: SendEvent then DisconnectUser.
    expect(mockChatSend).toHaveBeenCalledTimes(2);

    const sendEventArg = mockChatSend.mock.calls[0][0];
    expect(sendEventArg.input).toMatchObject({
      roomIdentifier: 'arn:room-1',
      eventName: 'user_kicked',
      attributes: { userId: 'target', reason: 'spam', scope: 'global' },
    });

    const disconnectArg = mockChatSend.mock.calls[1][0];
    expect(disconnectArg.input).toMatchObject({
      roomIdentifier: 'arn:room-1',
      userId: 'target',
    });
  });

  test('returns 201 even when best-effort IVS calls fail', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateGlobalBan.mockResolvedValueOnce({
      userId: 'target',
      bannedBy: 'admin-1',
      reason: 'spam',
      bannedAt: '2026-04-18T10:00:00.000Z',
    });
    mockChatSend.mockRejectedValue(new Error('boom'));

    const result = await handler(
      createEvent({
        body: { userId: 'target', reason: 'spam', activeRoomIdentifier: 'arn:r' },
      }),
    );

    expect(result.statusCode).toBe(201);
  });

  test('returns 500 when createGlobalBan throws', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateGlobalBan.mockRejectedValueOnce(new Error('dynamo down'));

    const result = await handler(
      createEvent({ body: { userId: 'target', reason: 'spam' } }),
    );

    expect(result.statusCode).toBe(500);
  });
});
