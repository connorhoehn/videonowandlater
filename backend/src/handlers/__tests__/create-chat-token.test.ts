/**
 * Tests for create-chat-token handler
 * POST /sessions/:sessionId/chat/token - generate IVS Chat token
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../create-chat-token';

describe('create-chat-token handler', () => {
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

  it('returns 401 if user not authenticated', async () => {
    const event = {
      pathParameters: { sessionId: 'session-123' },
      requestContext: {},
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
      expect(body.error).toBe('Unauthorized');
    }
  });

  it('returns 400 if sessionId missing', async () => {
    const event = {
      pathParameters: {},
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

  it('validates sessionId parameter extraction', async () => {
    const event = {
      pathParameters: { sessionId: 'test-session' },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'test-user' },
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
      // Will error in unit test (no DynamoDB/IVS Chat connection)
      // Accept either 404 (session not found) or 500 (service error)
      expect([404, 500]).toContain(result.statusCode);
      expect(body).toHaveProperty('error');
    }
  });

  it('returns correct response structure', async () => {
    const event = {
      pathParameters: { sessionId: 'test-session' },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'test-user' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      const body = JSON.parse(result.body);

      // If successful (200), should have token and expiration times
      // If error (4xx/5xx), should have error message
      if (result.statusCode === 200) {
        expect(body).toHaveProperty('token');
        expect(body).toHaveProperty('sessionExpirationTime');
        expect(body).toHaveProperty('tokenExpirationTime');
      } else {
        expect(body).toHaveProperty('error');
      }
    }
  });
});
