/**
 * Tests for get-comments handler
 * Validates GET /sessions/:sessionId/comments endpoint
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-comments';

// Mock dynamodb-client
jest.mock('../../lib/dynamodb-client');

describe('get-comments handler', () => {
  const TABLE_NAME = 'test-table';
  let mockSend: jest.Mock;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn();
    const { getDocumentClient } = require('../../lib/dynamodb-client');
    (getDocumentClient as jest.Mock).mockReturnValue({ send: mockSend });
  });

  const createEvent = (
    opts: { sessionId?: string | null; userId?: string | null } = {}
  ): APIGatewayProxyEvent => {
    const sessionId = opts.sessionId !== undefined ? opts.sessionId : 'session-123';
    const userId = opts.userId !== undefined ? opts.userId : 'user-123';
    return {
      pathParameters: sessionId ? { sessionId } : null,
      requestContext: {
        authorizer: {
          claims: userId ? { 'cognito:username': userId } : {},
        },
      } as any,
    } as any as APIGatewayProxyEvent;
  };

  describe('validation', () => {
    it('should return 400 if sessionId is missing from pathParameters', async () => {
      const event = createEvent({ sessionId: null });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('sessionId');
      }
    });

    it('should return 401 if cognito:username not in authorizer claims', async () => {
      const event = createEvent({ userId: null });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(401);
        expect(JSON.parse(result.body).error).toContain('Unauthorized');
      }
    });
  });

  describe('success', () => {
    it('should return 200 with empty comments array when no comments exist', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body).toHaveProperty('comments');
        expect(body.comments).toEqual([]);
      }
    });

    it('should return 200 with comments array in ascending videoPositionMs order', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            commentId: 'c1',
            sessionId: 'session-123',
            userId: 'user-a',
            text: 'hello',
            videoPositionMs: 5000,
            createdAt: '2026-03-11T00:00:00.000Z',
          },
          {
            commentId: 'c2',
            sessionId: 'session-123',
            userId: 'user-b',
            text: 'world',
            videoPositionMs: 10000,
            createdAt: '2026-03-11T00:00:01.000Z',
          },
        ],
      });

      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        expect(body.comments).toHaveLength(2);
        expect(body.comments[0].videoPositionMs).toBe(5000);
        expect(body.comments[1].videoPositionMs).toBe(10000);
      }
    });

    it('should return comments with all required fields', async () => {
      mockSend.mockResolvedValue({
        Items: [
          {
            commentId: 'c1',
            sessionId: 'session-123',
            userId: 'user-a',
            text: 'hello',
            videoPositionMs: 5000,
            createdAt: '2026-03-11T00:00:00.000Z',
          },
        ],
      });

      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);
        const comment = body.comments[0];
        expect(comment).toHaveProperty('commentId', 'c1');
        expect(comment).toHaveProperty('sessionId', 'session-123');
        expect(comment).toHaveProperty('userId', 'user-a');
        expect(comment).toHaveProperty('text', 'hello');
        expect(comment).toHaveProperty('videoPositionMs', 5000);
        expect(comment).toHaveProperty('createdAt', '2026-03-11T00:00:00.000Z');
      }
    });

    it('should query with begins_with SK COMMENT# and Limit 500', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const event = createEvent();

      await handler(event, {} as any, {} as any);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArg = mockSend.mock.calls[0][0];
      const input = callArg.input;
      expect(input.TableName).toBe(TABLE_NAME);
      expect(input.KeyConditionExpression).toContain('begins_with');
      expect(input.ExpressionAttributeValues[':pk']).toBe('SESSION#session-123');
      expect(input.ExpressionAttributeValues[':prefix']).toBe('COMMENT#');
      expect(input.Limit).toBe(500);
    });

    it('should include CORS headers in response', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      }
    });
  });
});
