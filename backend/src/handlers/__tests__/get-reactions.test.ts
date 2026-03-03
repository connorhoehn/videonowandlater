/**
 * Tests for get-reactions handler
 * Validates GET /sessions/:sessionId/reactions endpoint
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-reactions';
import { getReactionsInTimeRange } from '../../repositories/reaction-repository';
import { EmojiType, ReactionType } from '../../domain/reaction';

// Mock dependencies
jest.mock('../../repositories/reaction-repository');

describe('get-reactions handler', () => {
  const mockGetReactionsInTimeRange = getReactionsInTimeRange as jest.MockedFunction<typeof getReactionsInTimeRange>;

  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createEvent = (sessionId: string = 'session-123', queryStringParameters: any = {}): APIGatewayProxyEvent => ({
    pathParameters: { sessionId },
    queryStringParameters,
    requestContext: {
      authorizer: {
        claims: {
          'cognito:username': 'user-123',
        },
      },
    } as any,
  } as any as APIGatewayProxyEvent);

  describe('query parameters', () => {
    it('should use default params when none provided', async () => {
      mockGetReactionsInTimeRange.mockResolvedValue([]);
      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        expect(mockGetReactionsInTimeRange).toHaveBeenCalledWith(
          TABLE_NAME,
          'session-123',
          0,
          expect.any(Number), // endTime defaults to Date.now()
          100
        );
      }
    });

    it('should use custom startTime and endTime', async () => {
      mockGetReactionsInTimeRange.mockResolvedValue([]);
      const event = createEvent('session-123', { startTime: '1000', endTime: '5000' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        expect(mockGetReactionsInTimeRange).toHaveBeenCalledWith(
          TABLE_NAME,
          'session-123',
          1000,
          5000,
          100
        );
      }
    });

    it('should use custom limit', async () => {
      mockGetReactionsInTimeRange.mockResolvedValue([]);
      const event = createEvent('session-123', { limit: '50' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        expect(mockGetReactionsInTimeRange).toHaveBeenCalledWith(
          TABLE_NAME,
          'session-123',
          0,
          expect.any(Number),
          50
        );
      }
    });

    it('should return 400 if limit exceeds 100', async () => {
      const event = createEvent('session-123', { limit: '101' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('limit');
      }
    });
  });

  describe('response', () => {
    it('should return reactions array', async () => {
      const mockReactions = [
        {
          reactionId: 'reaction-1',
          sessionId: 'session-123',
          userId: 'user-1',
          emojiType: EmojiType.HEART,
          reactionType: ReactionType.LIVE,
          reactedAt: '2026-03-02T10:05:00Z',
          sessionRelativeTime: 60000,
          shardId: 42,
        },
        {
          reactionId: 'reaction-2',
          sessionId: 'session-123',
          userId: 'user-2',
          emojiType: EmojiType.FIRE,
          reactionType: ReactionType.LIVE,
          reactedAt: '2026-03-02T10:05:30Z',
          sessionRelativeTime: 90000,
          shardId: 15,
        },
      ];

      mockGetReactionsInTimeRange.mockResolvedValue(mockReactions);
      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(200);
        const responseBody = JSON.parse(result.body);
        expect(responseBody).toHaveProperty('reactions');
        expect(responseBody.reactions).toHaveLength(2);
        expect(responseBody.reactions[0].reactionId).toBe('reaction-1');
      }
    });

    it('should include CORS headers', async () => {
      mockGetReactionsInTimeRange.mockResolvedValue([]);
      const event = createEvent();

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      }
    });
  });
});
