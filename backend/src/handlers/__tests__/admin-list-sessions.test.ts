/**
 * Tests for admin-list-sessions Lambda handler
 * GET /admin/sessions - list all active (LIVE and ENDING) sessions
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-list-sessions';
import * as adminAuth from '../../lib/admin-auth';

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('../../lib/admin-auth');

const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;

describe('admin-list-sessions handler', () => {
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

  test('should return empty array when no live or ending sessions', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockDocSend.mockResolvedValueOnce({ Items: [] }); // LIVE query
    mockDocSend.mockResolvedValueOnce({ Items: [] }); // ENDING query

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toEqual([]);
  });

  test('should return combined LIVE and ENDING sessions sorted by createdAt desc', async () => {
    mockIsAdmin.mockReturnValue(true);

    const liveSession = {
      sessionId: 'session-1',
      userId: 'user-1',
      sessionType: 'BROADCAST',
      status: 'LIVE',
      createdAt: '2026-04-14T10:00:00Z',
      participantCount: 5,
      messageCount: 12,
    };

    const endingSession = {
      sessionId: 'session-2',
      userId: 'user-2',
      sessionType: 'HANGOUT',
      status: 'ENDING',
      createdAt: '2026-04-14T11:00:00Z',
      participantCount: 3,
      messageCount: 7,
    };

    const olderLiveSession = {
      sessionId: 'session-3',
      userId: 'user-3',
      sessionType: 'BROADCAST',
      status: 'LIVE',
      createdAt: '2026-04-14T09:00:00Z',
      participantCount: 1,
      messageCount: 0,
    };

    mockDocSend.mockResolvedValueOnce({ Items: [liveSession, olderLiveSession] }); // LIVE query
    mockDocSend.mockResolvedValueOnce({ Items: [endingSession] }); // ENDING query

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(3);
    // Should be sorted by createdAt desc
    expect(body.sessions[0].sessionId).toBe('session-2'); // 11:00
    expect(body.sessions[1].sessionId).toBe('session-1'); // 10:00
    expect(body.sessions[2].sessionId).toBe('session-3'); // 09:00
  });

  test('should include sessionId, userId, sessionType, status, participantCount fields in response', async () => {
    mockIsAdmin.mockReturnValue(true);

    const sessionItem = {
      sessionId: 'session-abc',
      userId: 'user-xyz',
      sessionType: 'HANGOUT',
      status: 'LIVE',
      createdAt: '2026-04-14T12:00:00Z',
      participantCount: 4,
      messageCount: 20,
      // Extra fields that should NOT appear in the response
      channelArn: 'arn:aws:ivs:us-east-1:123:channel/ch-1',
      claimedResources: { stage: 'stage-1' },
    };

    mockDocSend.mockResolvedValueOnce({ Items: [sessionItem] });
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    const session = body.sessions[0];
    expect(session.sessionId).toBe('session-abc');
    expect(session.userId).toBe('user-xyz');
    expect(session.sessionType).toBe('HANGOUT');
    expect(session.status).toBe('LIVE');
    expect(session.participantCount).toBe(4);
    expect(session.messageCount).toBe(20);
    expect(session.createdAt).toBe('2026-04-14T12:00:00Z');
    // Should not leak internal fields
    expect(session.channelArn).toBeUndefined();
    expect(session.claimedResources).toBeUndefined();
  });
});
