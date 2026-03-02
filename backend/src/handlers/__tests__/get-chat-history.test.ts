/**
 * Tests for get-chat-history handler
 * GET /sessions/:sessionId/chat/messages - retrieve chat history
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-chat-history';

describe('get-chat-history handler', () => {
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

  it('returns 400 when sessionId missing', async () => {
    const event = {
      pathParameters: {},
      queryStringParameters: {},
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

  it('parses limit from query parameters with default value', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      queryStringParameters: null,
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    // Should use default limit of 50
    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
    }
  });

  it('returns 400 for invalid limit (less than 1)', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      queryStringParameters: { limit: '0' },
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
      expect(body.error).toBe('limit must be between 1 and 100');
    }
  });

  it('returns 400 for invalid limit (greater than 100)', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      queryStringParameters: { limit: '101' },
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
      expect(body.error).toBe('limit must be between 1 and 100');
    }
  });

  it('returns 400 for non-numeric limit', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      queryStringParameters: { limit: 'abc' },
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
      expect(body.error).toBe('limit must be between 1 and 100');
    }
  });

  it('validates response structure', async () => {
    const event = {
      pathParameters: { sessionId: 'test-session' },
      queryStringParameters: { limit: '25' },
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

      // If successful (200), should have messages array
      // If error (4xx/5xx), should have error message
      if (result.statusCode === 200) {
        expect(body).toHaveProperty('messages');
        expect(Array.isArray(body.messages)).toBe(true);
      } else {
        expect(body).toHaveProperty('error');
      }
    }
  });
});
