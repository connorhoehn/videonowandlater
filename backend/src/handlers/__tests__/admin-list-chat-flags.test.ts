/**
 * Tests for admin-list-chat-flags handler
 * GET /admin/chat-flags?status=pending
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-list-chat-flags';
import * as chatModerationRepo from '../../repositories/chat-moderation-repository';
import * as adminAuth from '../../lib/admin-auth';

jest.mock('../../repositories/chat-moderation-repository');
jest.mock('../../lib/admin-auth');

const mockListPendingFlags = chatModerationRepo.listPendingFlags as jest.MockedFunction<
  typeof chatModerationRepo.listPendingFlags
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;

const TABLE = 'test-table';

describe('admin-list-chat-flags handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
  });

  function createEvent(query: Record<string, string> = {}): APIGatewayProxyEvent {
    return {
      queryStringParameters: Object.keys(query).length ? query : null,
      requestContext: { authorizer: { claims: { 'cognito:username': 'admin-1' } } },
    } as any;
  }

  test('returns 403 when caller is not admin', async () => {
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(403);
    expect(mockListPendingFlags).not.toHaveBeenCalled();
  });

  test('returns 400 when status is not pending', async () => {
    mockIsAdmin.mockReturnValue(true);
    const result = await handler(createEvent({ status: 'resolved' }));
    expect(result.statusCode).toBe(400);
    expect(mockListPendingFlags).not.toHaveBeenCalled();
  });

  test('returns 400 on invalid limit', async () => {
    mockIsAdmin.mockReturnValue(true);
    const result = await handler(createEvent({ limit: '999' }));
    expect(result.statusCode).toBe(400);
  });

  test('returns pending flags with default limit', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListPendingFlags.mockResolvedValue([
      {
        PK: 'SESSION#s',
        SK: 'CHATFLAG#ts#u',
        sessionId: 's',
        userId: 'u',
        messageId: 'm',
        text: 't',
        categories: ['spam'],
        confidence: 0.8,
        reasoning: 'r',
        createdAt: '2026-04-18T00:00:00Z',
        status: 'pending',
      },
    ]);
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flags).toHaveLength(1);
    expect(body.flags[0].sessionId).toBe('s');
    expect(mockListPendingFlags).toHaveBeenCalledWith(TABLE, { limit: 50 });
  });

  test('honors custom limit query param', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListPendingFlags.mockResolvedValue([]);
    const result = await handler(createEvent({ limit: '10' }));
    expect(result.statusCode).toBe(200);
    expect(mockListPendingFlags).toHaveBeenCalledWith(TABLE, { limit: 10 });
  });
});
