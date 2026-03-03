/**
 * Tests for create-reaction handler
 * Validates POST /sessions/:sessionId/reactions endpoint
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../create-reaction';
import { getSessionById } from '../../repositories/session-repository';
import { persistReaction } from '../../repositories/reaction-repository';
import { broadcastReaction } from '../../services/reaction-service';
import { SessionStatus } from '../../domain/session';
import { EmojiType } from '../../domain/reaction';

// Mock dependencies
jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/reaction-repository');
jest.mock('../../services/reaction-service');

describe('create-reaction handler', () => {
  const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;
  const mockPersistReaction = persistReaction as jest.MockedFunction<typeof persistReaction>;
  const mockBroadcastReaction = broadcastReaction as jest.MockedFunction<typeof broadcastReaction>;

  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createEvent = (body: any, sessionId: string = 'session-123'): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    pathParameters: { sessionId },
    requestContext: {
      authorizer: {
        claims: {
          'cognito:username': 'user-123',
        },
      },
    } as any,
  } as any as APIGatewayProxyEvent);

  describe('validation', () => {
    it('should return 400 if emojiType is missing', async () => {
      const event = createEvent({});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('emojiType');
      }
    });

    it('should return 400 if emojiType is invalid', async () => {
      const event = createEvent({ emojiType: 'invalid' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('Invalid emojiType');
      }
    });

    it('should return 404 if session not found', async () => {
      mockGetSessionById.mockResolvedValue(null);
      const event = createEvent({ emojiType: 'heart' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(404);
        expect(JSON.parse(result.body).error).toContain('Session not found');
      }
    });

    it('should return 400 if session is not live for live reaction', async () => {
      mockGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        userId: 'broadcaster-123',
        status: SessionStatus.ENDED,
        claimedResources: { chatRoom: 'room-arn' },
        createdAt: '2026-03-02T10:00:00Z',
        startedAt: '2026-03-02T10:01:00Z',
        endedAt: '2026-03-02T10:30:00Z',
        version: 1,
      } as any);

      const event = createEvent({ emojiType: 'heart' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('must be live');
      }
    });
  });

  describe('live reactions', () => {
    it('should call broadcastReaction and persistReaction for live session', async () => {
      mockGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        userId: 'broadcaster-123',
        status: SessionStatus.LIVE,
        claimedResources: { chatRoom: 'arn:aws:ivschat:us-east-1:123:room/abc' },
        createdAt: '2026-03-02T10:00:00Z',
        startedAt: '2026-03-02T10:01:00Z',
        version: 1,
      } as any);

      mockBroadcastReaction.mockResolvedValue('event-123');
      mockPersistReaction.mockResolvedValue();

      const event = createEvent({ emojiType: 'heart' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(201);
        expect(mockBroadcastReaction).toHaveBeenCalledWith(
          'arn:aws:ivschat:us-east-1:123:room/abc',
          'user-123',
          EmojiType.HEART,
          expect.any(Number)
        );
        expect(mockPersistReaction).toHaveBeenCalledWith(
          TABLE_NAME,
          expect.objectContaining({
            sessionId: 'session-123',
            userId: 'user-123',
            emojiType: EmojiType.HEART,
            reactionType: 'live',
          })
        );

        const responseBody = JSON.parse(result.body);
        expect(responseBody).toHaveProperty('reactionId');
        expect(responseBody).toHaveProperty('eventId', 'event-123');
        expect(responseBody).toHaveProperty('sessionRelativeTime');
      }
    });

    it('should include CORS headers', async () => {
      mockGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        userId: 'broadcaster-123',
        status: SessionStatus.LIVE,
        claimedResources: { chatRoom: 'arn:aws:ivschat:us-east-1:123:room/abc' },
        createdAt: '2026-03-02T10:00:00Z',
        startedAt: '2026-03-02T10:01:00Z',
        version: 1,
      } as any);

      mockBroadcastReaction.mockResolvedValue('event-123');
      mockPersistReaction.mockResolvedValue();

      const event = createEvent({ emojiType: 'fire' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      }
    });
  });

  describe('replay reactions', () => {
    it('should only call persistReaction for replay reaction', async () => {
      mockGetSessionById.mockResolvedValue({
        sessionId: 'session-123',
        userId: 'broadcaster-123',
        status: SessionStatus.ENDED,
        claimedResources: { chatRoom: 'arn:aws:ivschat:us-east-1:123:room/abc' },
        createdAt: '2026-03-02T10:00:00Z',
        startedAt: '2026-03-02T10:01:00Z',
        endedAt: '2026-03-02T10:30:00Z',
        version: 1,
      } as any);

      mockPersistReaction.mockResolvedValue();

      const event = createEvent({ emojiType: 'clap', reactionType: 'replay' });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(201);
        expect(mockBroadcastReaction).not.toHaveBeenCalled();
        expect(mockPersistReaction).toHaveBeenCalledWith(
          TABLE_NAME,
          expect.objectContaining({
            sessionId: 'session-123',
            userId: 'user-123',
            emojiType: EmojiType.CLAP,
            reactionType: 'replay',
          })
        );

        const responseBody = JSON.parse(result.body);
        expect(responseBody).toHaveProperty('reactionId');
        expect(responseBody).not.toHaveProperty('eventId');
        expect(responseBody).toHaveProperty('sessionRelativeTime');
      }
    });
  });
});
