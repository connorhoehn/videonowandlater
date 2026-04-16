/**
 * Tests for admin-review-moderation Lambda handler
 * POST /admin/moderation/{sessionId}/review — dismiss or confirm kill
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-review-moderation';
import * as sessionRepository from '../../repositories/session-repository';
import * as resourcePoolRepository from '../../repositories/resource-pool-repository';
import * as adminAuth from '../../lib/admin-auth';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/resource-pool-repository');

const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('@aws-sdk/client-ivs', () => ({
  IvsClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  StopStreamCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-ivs-realtime', () => ({
  IVSRealTimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  DisconnectParticipantCommand: jest.fn(),
}));
jest.mock('@aws-sdk/client-ivschat', () => ({
  IvschatClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendEventCommand: jest.fn(),
}));
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));
jest.mock('../../lib/admin-auth');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetHangoutParticipants = sessionRepository.getHangoutParticipants as jest.MockedFunction<
  typeof sessionRepository.getHangoutParticipants
>;
const mockUpdateSessionStatus = sessionRepository.updateSessionStatus as jest.MockedFunction<
  typeof sessionRepository.updateSessionStatus
>;
const mockReleasePoolResource = resourcePoolRepository.releasePoolResource as jest.MockedFunction<
  typeof resourcePoolRepository.releasePoolResource
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<
  typeof adminAuth.getAdminUserId
>;

describe('admin-review-moderation handler', () => {
  const TABLE_NAME = 'test-table';

  const modRecord = {
    PK: 'SESSION#session-1',
    SK: 'MOD#2026-04-14T10:00:00Z#mod-uuid',
    entityType: 'MODERATION',
    actionType: 'ML_FLAG',
    actorId: 'SYSTEM',
    reason: 'Suggestive',
    sessionId: 'session-1',
    createdAt: '2026-04-14T10:00:00Z',
  };

  const liveBroadcast: Session = {
    sessionId: 'session-1',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    createdAt: '2026-04-14T10:00:00Z',
    version: 1,
    channelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/channel-1',
    claimedResources: { channel: 'channel-1', chatRoom: 'room-1' },
  };

  const endedSession: Session = {
    sessionId: 'session-1',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-14T09:00:00Z',
    version: 2,
    claimedResources: { chatRoom: 'room-1' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    mockGetAdminUserId.mockReturnValue(undefined);
  });

  function createEvent(
    sessionId: string,
    body: object,
  ): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'admin-user' },
        },
      },
      headers: { Authorization: 'Bearer admin-token' },
      body: JSON.stringify(body),
      httpMethod: 'POST',
    } as any;
  }

  test('should return 403 when not admin', async () => {
    mockIsAdmin.mockReturnValue(false);

    const result = await handler(createEvent('session-1', { action: 'dismiss' }));

    expect(result.statusCode).toBe(403);
  });

  test('should return 404 when no MOD# record found for session', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [] }); // No MOD# records

    const result = await handler(createEvent('session-1', { action: 'dismiss' }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/no moderation record/i);
  });

  test('should dismiss moderation record (updates reviewStatus to dismissed)', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    // QueryCommand returns MOD# record
    mockDocSend.mockResolvedValueOnce({ Items: [modRecord] });
    // UpdateCommand, PutCommand
    mockDocSend.mockResolvedValue({});

    const result = await handler(createEvent('session-1', { action: 'dismiss', notes: 'false positive' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.action).toBe('dismiss');

    // Should not have attempted to kill the session
    expect(mockGetSessionById).not.toHaveBeenCalled();
    expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
  });

  test('should confirm kill — triggers kill logic when session is LIVE', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    // QueryCommand returns MOD# record
    mockDocSend.mockResolvedValueOnce({ Items: [modRecord] });
    // UpdateCommand, PutCommand
    mockDocSend.mockResolvedValue({});

    mockGetSessionById.mockResolvedValueOnce(liveBroadcast);
    mockUpdateSessionStatus.mockResolvedValueOnce(undefined);
    mockReleasePoolResource.mockResolvedValue(undefined);

    const result = await handler(createEvent('session-1', { action: 'confirm_kill' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.action).toBe('confirm_kill');

    // Should have killed the session
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(
      TABLE_NAME,
      'session-1',
      SessionStatus.ENDING,
      'endedAt',
    );

    // Should have released pool resources
    expect(mockReleasePoolResource).toHaveBeenCalled();
  });

  test('should confirm kill — skips kill when session already ENDED', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    // QueryCommand returns MOD# record
    mockDocSend.mockResolvedValueOnce({ Items: [modRecord] });
    // UpdateCommand, PutCommand
    mockDocSend.mockResolvedValue({});

    mockGetSessionById.mockResolvedValueOnce(endedSession);

    const result = await handler(createEvent('session-1', { action: 'confirm_kill' }));

    expect(result.statusCode).toBe(200);
    // Should NOT have updated session status since it's already ended
    expect(mockUpdateSessionStatus).not.toHaveBeenCalled();
  });

  test('should write ADMIN_REVIEW audit record', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [modRecord] });
    mockDocSend.mockResolvedValue({});

    await handler(createEvent('session-1', { action: 'dismiss' }));

    // Find the PutCommand call that writes the audit record
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.actionType === 'ADMIN_REVIEW';
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0]?.input || putCall![0]).Item;
    expect(item.PK).toBe('SESSION#session-1');
    expect(item.SK).toMatch(/^MOD#/);
    expect(item.actorId).toBe('admin-user');
    expect(item.reviewAction).toBe('dismiss');
  });

  test('should return 400 for invalid action', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');

    const result = await handler(createEvent('session-1', { action: 'invalid_action' }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/action must be/i);
  });
});
