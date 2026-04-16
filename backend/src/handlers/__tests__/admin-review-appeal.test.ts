/**
 * Tests for admin-review-appeal Lambda handler
 * POST /admin/appeals/{sessionId}/review — approve or deny an appeal
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-review-appeal';
import * as adminAuth from '../../lib/admin-auth';

const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));
jest.mock('../../lib/admin-auth');

const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<
  typeof adminAuth.getAdminUserId
>;

describe('admin-review-appeal handler', () => {
  const TABLE_NAME = 'test-table';

  const pendingAppeal = {
    PK: 'SESSION#session-1',
    SK: 'APPEAL#2026-04-11T10:00:00Z#appeal-uuid',
    entityType: 'APPEAL',
    sessionId: 'session-1',
    userId: 'user-owner',
    reason: 'I did not violate any rules',
    status: 'pending',
    createdAt: '2026-04-11T10:00:00Z',
  };

  const reviewedAppeal = {
    ...pendingAppeal,
    status: 'approved',
    reviewedBy: 'admin-user',
    reviewedAt: '2026-04-12T10:00:00Z',
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

    const result = await handler(createEvent('session-1', { action: 'approve' }));

    expect(result.statusCode).toBe(403);
  });

  test('should return 404 when no appeal found', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent('session-1', { action: 'approve' }));

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/no appeal found/i);
  });

  test('should approve appeal — updates status to approved', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    // QueryCommand returns pending appeal
    mockDocSend.mockResolvedValueOnce({ Items: [pendingAppeal] });
    // UpdateCommand, PutCommand
    mockDocSend.mockResolvedValue({});

    const result = await handler(createEvent('session-1', { action: 'approve', notes: 'Content was fine' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.action).toBe('approve');
    expect(body.message).toMatch(/approved/i);

    // Verify the UpdateCommand set status to 'approved'
    const updateCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.UpdateExpression && input?.ExpressionAttributeValues?.[':status'] === 'approved';
    });
    expect(updateCall).toBeDefined();
  });

  test('should deny appeal — updates status to denied', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [pendingAppeal] });
    mockDocSend.mockResolvedValue({});

    const result = await handler(createEvent('session-1', { action: 'deny', notes: 'Violation confirmed' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.action).toBe('deny');
    expect(body.message).toMatch(/denied/i);

    // Verify the UpdateCommand set status to 'denied'
    const updateCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.UpdateExpression && input?.ExpressionAttributeValues?.[':status'] === 'denied';
    });
    expect(updateCall).toBeDefined();
  });

  test('should return 409 when appeal already reviewed (not pending)', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [reviewedAppeal] });

    const result = await handler(createEvent('session-1', { action: 'approve' }));

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/already been reviewed/i);
  });

  test('should write APPEAL_REVIEWED audit record', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');
    mockDocSend.mockResolvedValueOnce({ Items: [pendingAppeal] });
    mockDocSend.mockResolvedValue({});

    await handler(createEvent('session-1', { action: 'approve' }));

    // Find the PutCommand call that writes the audit record
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.actionType === 'APPEAL_REVIEWED';
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0]?.input || putCall![0]).Item;
    expect(item.PK).toBe('SESSION#session-1');
    expect(item.SK).toMatch(/^MOD#/);
    expect(item.actorId).toBe('admin-user');
    expect(item.appealAction).toBe('approve');
    expect(item.GSI5PK).toBe('MODERATION');
  });

  test('should return 400 for invalid action', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-user');

    const result = await handler(createEvent('session-1', { action: 'maybe' }));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/approve.*deny/i);
  });
});
