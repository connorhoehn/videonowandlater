/**
 * Tests for GET /sessions/mine.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../list-my-sessions';
import { getDocumentClient } from '../../lib/dynamodb-client';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient = getDocumentClient as jest.MockedFunction<typeof getDocumentClient>;

function createEvent(
  qs: Record<string, string> | null = null,
  claims: Record<string, any> | null = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: null,
    queryStringParameters: qs,
    body: null,
    httpMethod: 'GET',
    headers: {},
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('list-my-sessions handler', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    jest.resetAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  test('401 when unauthenticated', async () => {
    const result = await handler(createEvent(null, null));
    expect(result.statusCode).toBe(401);
  });

  test('400 on invalid status', async () => {
    const result = await handler(createEvent({ status: 'GARBAGE' }));
    expect(result.statusCode).toBe(400);
  });

  test('default (LIVE) returns only sessions owned by caller', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { sessionId: 's1', userId: 'alice', status: 'LIVE', sessionType: 'HANGOUT', createdAt: '2026-04-01T00:00:00Z' },
        { sessionId: 's2', userId: 'bob', status: 'LIVE', sessionType: 'BROADCAST', createdAt: '2026-04-02T00:00:00Z' },
      ],
    });
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe('s1');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('status=ALL queries LIVE + ENDING + ENDED and merges', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [{ sessionId: 's1', userId: 'alice', status: 'LIVE', createdAt: '2026-04-03T00:00:00Z' }] })
      .mockResolvedValueOnce({ Items: [{ sessionId: 's2', userId: 'alice', status: 'ENDING', createdAt: '2026-04-02T00:00:00Z' }] })
      .mockResolvedValueOnce({ Items: [{ sessionId: 's3', userId: 'alice', status: 'ENDED', createdAt: '2026-04-01T00:00:00Z' }] });
    const result = await handler(createEvent({ status: 'ALL' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessions.map((s: any) => s.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test('filters out sessions owned by other users', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        { sessionId: 's1', userId: 'bob', status: 'LIVE', createdAt: '2026-04-01T00:00:00Z' },
        { sessionId: 's2', userId: 'carol', status: 'LIVE', createdAt: '2026-04-02T00:00:00Z' },
      ],
    });
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).sessions).toEqual([]);
  });

  test('500 when DynamoDB throws', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(500);
  });
});
