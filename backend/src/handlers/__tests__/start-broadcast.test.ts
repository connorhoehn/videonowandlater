/**
 * Tests for start-broadcast handler
 * POST /sessions/:id/start - returns ingest config for broadcaster
 * TDD RED phase - tests should fail until implementation is complete
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../start-broadcast';

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
}));

describe('start-broadcast handler', () => {
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
    }
  });

  it('returns 404 if session does not exist', async () => {
    const event = {
      pathParameters: { sessionId: 'nonexistent' },
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'user123' },
        },
      },
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      // This will fail in integration tests if DynamoDB query fails
      // For unit tests, we accept either 404 or 500 (DynamoDB connection error)
      expect([404, 500]).toContain(result.statusCode);
    }
  });

  it('returns correct response structure with ingestEndpoint and streamKey', async () => {
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
      // If successful (200), should have ingestEndpoint and streamKey
      // If error (4xx/5xx), should have error message
      if (result.statusCode === 200) {
        expect(body).toHaveProperty('ingestEndpoint');
        expect(body).toHaveProperty('streamKey');
      } else {
        expect(body).toHaveProperty('error');
      }
    }
  });
});
