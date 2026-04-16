/**
 * Tests for admin-audit-log Lambda handler
 * GET /admin/audit-log - list recent moderation/appeal actions
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-audit-log';
import * as adminAuth from '../../lib/admin-auth';

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('../../lib/admin-auth');

const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;

describe('admin-audit-log handler', () => {
  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
  });

  function createEvent(queryParams?: Record<string, string>): APIGatewayProxyEvent {
    return {
      queryStringParameters: queryParams ?? null,
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'admin-user' },
        },
      },
      headers: { Authorization: 'Bearer admin-token' },
      body: null,
      httpMethod: 'GET',
    } as any;
  }

  test('should return 403 when user is not admin', async () => {
    mockIsAdmin.mockReturnValue(false);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/forbidden/i);
  });

  test('should return moderation entries from GSI5 when type=moderation (default)', async () => {
    mockIsAdmin.mockReturnValue(true);

    const moderationItem = {
      sessionId: 'session-1',
      actionType: 'kill_session',
      actorId: 'admin-user',
      reason: 'Inappropriate content',
      createdAt: '2026-04-14T10:00:00Z',
      sessionType: 'BROADCAST',
    };

    mockDocSend.mockResolvedValueOnce({ Items: [moderationItem] });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].sessionId).toBe('session-1');
    expect(body.entries[0].actionType).toBe('kill_session');
    expect(body.entries[0].actorId).toBe('admin-user');
    expect(body.entries[0].reason).toBe('Inappropriate content');

    // Verify the query used MODERATION as GSI5PK
    const queryInput = mockDocSend.mock.calls[0][0].input;
    expect(queryInput.IndexName).toBe('GSI5');
    expect(queryInput.ExpressionAttributeValues[':pk']).toBe('MODERATION');
  });

  test('should return appeal entries from GSI5 when type=appeal', async () => {
    mockIsAdmin.mockReturnValue(true);

    const appealItem = {
      sessionId: 'session-2',
      actionType: 'appeal_submitted',
      actorId: 'user-1',
      reason: 'False positive moderation',
      createdAt: '2026-04-14T11:00:00Z',
      sessionType: 'HANGOUT',
      entityType: 'session',
      userId: 'user-1',
      status: 'pending',
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
    };

    mockDocSend.mockResolvedValueOnce({ Items: [appealItem] });

    const result = await handler(createEvent({ type: 'appeal' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].entityType).toBe('session');
    expect(body.entries[0].userId).toBe('user-1');
    expect(body.entries[0].status).toBe('pending');

    // Verify the query used APPEAL as GSI5PK
    const queryInput = mockDocSend.mock.calls[0][0].input;
    expect(queryInput.ExpressionAttributeValues[':pk']).toBe('APPEAL');
  });

  test('should respect limit query parameter', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    await handler(createEvent({ limit: '10' }));

    const queryInput = mockDocSend.mock.calls[0][0].input;
    expect(queryInput.Limit).toBe(10);
  });

  test('should return empty array when no entries', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.entries).toEqual([]);
  });
});
