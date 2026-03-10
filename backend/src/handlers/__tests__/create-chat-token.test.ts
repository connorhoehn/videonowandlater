/**
 * Tests for create-chat-token handler
 * POST /sessions/:sessionId/chat/token - generate IVS Chat token
 * Includes tests for isBounced blocklist check (Phase 28).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../create-chat-token';
import * as dynamodbClient from '../../lib/dynamodb-client';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;

describe('create-chat-token handler', () => {
  const originalEnv = process.env;
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;
  const mockDynamoSend = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
    };
    jest.clearAllMocks();
    // Default: user is NOT bounced (Count = 0) so existing tests aren't affected
    mockGetDocumentClient.mockReturnValue({ send: mockDynamoSend } as any);
    mockDynamoSend.mockResolvedValue({ Count: 0, Items: [] });
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

  describe('isBounced blocklist check', () => {
    it('returns 403 with "You have been removed from this chat" when user is bounced', async () => {
      // Simulate a BOUNCE record being found (Count = 1)
      mockDynamoSend.mockResolvedValueOnce({ Count: 1, Items: [{ actionType: 'BOUNCE' }] });

      const event = {
        pathParameters: { sessionId: 'session-123' },
        requestContext: {
          authorizer: {
            claims: { 'cognito:username': 'bounced-user' },
          },
        },
      } as any as APIGatewayProxyEvent;

      const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('You have been removed from this chat');
    });

    it('calls QueryCommand with correct parameters for isBounced check', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Count: 1, Items: [{ actionType: 'BOUNCE' }] });

      const event = {
        pathParameters: { sessionId: 'session-abc' },
        requestContext: {
          authorizer: {
            claims: { 'cognito:username': 'user-xyz' },
          },
        },
      } as any as APIGatewayProxyEvent;

      await handler(event, mockContext, mockCallback);

      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      const queryArg = mockDynamoSend.mock.calls[0][0];
      expect(queryArg.input).toMatchObject({
        TableName: 'test-table',
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'actionType = :actionType AND #userId = :userId',
        ExpressionAttributeNames: { '#userId': 'userId' },
        ExpressionAttributeValues: {
          ':pk': 'SESSION#session-abc',
          ':skPrefix': 'MOD#',
          ':actionType': 'BOUNCE',
          ':userId': 'user-xyz',
        },
        Limit: 1,
      });
    });

    it('proceeds to generateChatToken when isBounced returns false (Count = 0)', async () => {
      // Not bounced — DynamoDB returns Count: 0
      mockDynamoSend.mockResolvedValueOnce({ Count: 0, Items: [] });

      const event = {
        pathParameters: { sessionId: 'session-123' },
        requestContext: {
          authorizer: {
            claims: { 'cognito:username': 'allowed-user' },
          },
        },
      } as any as APIGatewayProxyEvent;

      const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

      // Should NOT return 403 — proceeds to generateChatToken (which will fail in unit test without real session)
      expect(result.statusCode).not.toBe(403);
      // Will be 404 or 500 (no real DynamoDB/IVS connection in unit test)
      expect([404, 500]).toContain(result.statusCode);
    });
  });
});
