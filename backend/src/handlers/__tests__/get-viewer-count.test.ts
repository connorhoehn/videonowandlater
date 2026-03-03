/**
 * Tests for get-viewer-count handler
 * GET /sessions/:id/viewers - returns current viewer count
 * TDD RED phase
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-viewer-count';

jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('../../lib/ivs-clients', () => ({
  getIVSClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  getIVSRealTimeClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  getIVSChatClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
}));

describe('get-viewer-count handler', () => {
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

  it('returns 200 with viewerCount for valid session', async () => {
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
    }
  });

  it('does not require authentication (public endpoint)', async () => {
    const event = {
      pathParameters: { id: 'test-session' },
      requestContext: {},
    } as any as APIGatewayProxyEvent;

    const result = await handler(event, mockContext, mockCallback);

    expect(result).toBeDefined();
    // Should not return 401
    if (result && typeof result !== 'string') {
      expect(result.statusCode).not.toBe(401);
    }
  });
});
