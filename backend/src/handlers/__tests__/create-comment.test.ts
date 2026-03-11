/**
 * Tests for create-comment handler
 * Validates POST /sessions/:sessionId/comments endpoint
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../create-comment';

// Mock dependencies
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('../../repositories/session-repository');

describe('create-comment handler', () => {
  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock to default resolved value
    const { getDocumentClient } = require('../../lib/dynamodb-client');
    getDocumentClient.mockReturnValue({
      send: jest.fn().mockResolvedValue({}),
    });
  });

  const createEvent = (
    body: any,
    opts: { sessionId?: string | null; userId?: string | null } = {}
  ): APIGatewayProxyEvent => {
    const sessionId = opts.sessionId !== undefined ? opts.sessionId : 'session-123';
    const userId = opts.userId !== undefined ? opts.userId : 'user-123';
    return {
      body: typeof body === 'string' ? body : JSON.stringify(body),
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
      const event = createEvent({ text: 'hello', videoPositionMs: 1000 }, { sessionId: null });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('sessionId');
      }
    });

    it('should return 400 if body is not valid JSON', async () => {
      const event = createEvent('this is not json', {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('Invalid JSON');
      }
    });

    it('should return 400 if text is missing', async () => {
      const event = createEvent({ videoPositionMs: 1000 }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('text');
      }
    });

    it('should return 400 if text is empty string', async () => {
      const event = createEvent({ text: '', videoPositionMs: 1000 }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('text');
      }
    });

    it('should return 400 if videoPositionMs is missing', async () => {
      const event = createEvent({ text: 'hello' }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('videoPositionMs');
      }
    });

    it('should return 400 if videoPositionMs is negative', async () => {
      const event = createEvent({ text: 'hello', videoPositionMs: -100 }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body).error).toContain('videoPositionMs');
      }
    });

    it('should return 401 if cognito:username not in authorizer claims', async () => {
      const event = createEvent({ text: 'hello', videoPositionMs: 1000 }, { userId: null });

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(401);
        expect(JSON.parse(result.body).error).toContain('Unauthorized');
      }
    });
  });

  describe('success', () => {
    it('should return 201 with commentId, videoPositionMs, createdAt on valid input', async () => {
      const event = createEvent({ text: 'Great point!', videoPositionMs: 1234 }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.statusCode).toBe(201);
        const body = JSON.parse(result.body);
        expect(body).toHaveProperty('commentId');
        expect(body).toHaveProperty('videoPositionMs', 1234);
        expect(body).toHaveProperty('createdAt');
      }
    });

    it('should use 15-digit zero-padded videoPositionMs in SK', async () => {
      const { getDocumentClient } = require('../../lib/dynamodb-client');
      const mockSend = jest.fn().mockResolvedValue({});
      getDocumentClient.mockReturnValue({ send: mockSend });

      const event = createEvent({ text: 'hello', videoPositionMs: 1234 }, {});

      await handler(event, {} as any, {} as any);

      expect(mockSend).toHaveBeenCalled();
      const callArg = mockSend.mock.calls[0][0];
      // Check the input to PutCommand has correct SK format
      const input = callArg.input;
      expect(input.Item.SK).toMatch(/^COMMENT#000000000001234#/);
    });

    it('should include CORS headers in response', async () => {
      const event = createEvent({ text: 'hello', videoPositionMs: 5000 }, {});

      const result = await handler(event, {} as any, {} as any);

      expect(result).toBeDefined();
      if (result && typeof result !== 'string') {
        expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      }
    });
  });
});
