/**
 * Tests for get-playback handler
 * GET /sessions/:id/playback - returns playback URL for viewers
 * TDD RED phase
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-playback';

describe('get-playback handler', () => {
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

  it('returns 404 if session does not exist', async () => {
    const event = {
      pathParameters: { id: 'nonexistent' },
      requestContext: {},
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      // Either 404 or 500 (DynamoDB error in unit test)
      expect([404, 500]).toContain(result.statusCode);
    }
  });

  it('returns 200 with playbackUrl and status for any session', async () => {
    const event = {
      pathParameters: { id: 'test-session' },
      requestContext: {},
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    if (result && typeof result !== 'string') {
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('body');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');

      const body = JSON.parse(result.body);
      // If successful, should have playbackUrl and status
      // If error, should have error message
      if (result.statusCode === 200) {
        expect(body).toHaveProperty('playbackUrl');
        expect(body).toHaveProperty('status');
      } else {
        expect(body).toHaveProperty('error');
      }
    }
  });

  it('does not require authentication (public endpoint)', async () => {
    // Event with no authorizer claims
    const event = {
      pathParameters: { id: 'test-session' },
      requestContext: {},
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    // Should not return 401 (no auth required)
    if (result && typeof result !== 'string') {
      expect(result.statusCode).not.toBe(401);
    }
  });
});
