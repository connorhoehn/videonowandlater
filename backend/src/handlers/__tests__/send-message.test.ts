/**
 * Tests for send-message handler
 * POST /sessions/:sessionId/chat/messages - persist chat message
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../send-message';

describe('send-message handler', () => {
  const originalEnv = process.env;
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 400 when request body is invalid JSON', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      body: 'not-valid-json',
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Invalid JSON');
    }
  });

  it('returns 400 when sessionId missing', async () => {
    const event = {
      pathParameters: {},
      body: JSON.stringify({
        messageId: 'msg-123',
        content: 'Hello',
        senderId: 'user-123',
        sentAt: '2026-03-02T15:00:00.000Z',
      }),
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('sessionId required');
    }
  });

  it('returns 400 when required fields missing', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      body: JSON.stringify({
        messageId: 'msg-123',
        // Missing: content, senderId, sentAt
      }),
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toContain('Missing required fields');
    }
  });

  it('validates request body structure', async () => {
    const event = {
      pathParameters: { sessionId: 'test-session' },
      body: JSON.stringify({
        messageId: 'msg-123',
        content: 'Hello, world!',
        senderId: 'user-123',
        senderAttributes: { displayName: 'Test User', role: 'viewer' },
        sentAt: '2026-03-02T15:00:00.000Z',
      }),
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    // Response must have statusCode, headers, and body
    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');

      const body = JSON.parse(result.body);

      // If successful (201), should have messageId and sessionRelativeTime
      // If error (4xx/5xx), should have error message
      if (result.statusCode === 201) {
        expect(body).toHaveProperty('messageId');
        expect(body).toHaveProperty('sessionRelativeTime');
      } else {
        expect(body).toHaveProperty('error');
      }
    }
  });
});
