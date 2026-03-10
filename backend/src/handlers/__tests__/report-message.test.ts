/**
 * Tests for report-message Lambda handler
 * POST /sessions/{sessionId}/report - record a user-submitted message report
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../report-message';
import * as dynamodbClient from '../../lib/dynamodb-client';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;

describe('report-message handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const REPORTER_ID = 'user-reporter';
  const REPORTED_USER_ID = 'user-reported';
  const MSG_ID = 'msg-xyz';

  const mockDynamoSend = jest.fn();
  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockDynamoSend } as any);
    mockDynamoSend.mockResolvedValue({});
  });

  function createEvent(overrides: {
    reporterId?: string;
    sessionId?: string | null;
    body?: object | null;
  }): APIGatewayProxyEvent {
    const { reporterId, sessionId, body } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: reporterId
          ? { claims: { 'cognito:username': reporterId } }
          : undefined,
      },
      body: body !== null ? JSON.stringify(body ?? { msgId: MSG_ID, reportedUserId: REPORTED_USER_ID }) : null,
    } as any;
  }

  test('returns 401 when caller cognito:username is absent', async () => {
    const event = createEvent({ reporterId: undefined });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 400 when sessionId is missing', async () => {
    const event = createEvent({ reporterId: REPORTER_ID, sessionId: null });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 400 when msgId is missing from body', async () => {
    const event = createEvent({ reporterId: REPORTER_ID, body: { reportedUserId: REPORTED_USER_ID } });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 400 when reportedUserId is missing from body', async () => {
    const event = createEvent({ reporterId: REPORTER_ID, body: { msgId: MSG_ID } });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 200 and writes REPORT record to DynamoDB', async () => {
    const event = createEvent({ reporterId: REPORTER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(JSON.parse(result.body).message).toBe('Message reported');

    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const dynamoSendArg = mockDynamoSend.mock.calls[0][0];
    expect(dynamoSendArg.input.Item).toMatchObject({
      PK: `SESSION#${SESSION_ID}`,
      entityType: 'MODERATION',
      actionType: 'REPORT',
      msgId: MSG_ID,
      reporterId: REPORTER_ID,
      reportedUserId: REPORTED_USER_ID,
      sessionId: SESSION_ID,
    });
    expect(dynamoSendArg.input.Item.SK).toMatch(/^MOD#/);
    expect(dynamoSendArg.input.Item.createdAt).toBeDefined();
  });

  test('written REPORT record has correct PK/SK structure', async () => {
    const event = createEvent({ reporterId: REPORTER_ID });
    await handler(event, mockContext, mockCallback);

    const dynamoSendArg = mockDynamoSend.mock.calls[0][0];
    const item = dynamoSendArg.input.Item;

    expect(item.PK).toBe(`SESSION#${SESSION_ID}`);
    expect(item.SK).toMatch(/^MOD#\d{4}-\d{2}-\d{2}T/);
    expect(item.entityType).toBe('MODERATION');
    expect(item.actionType).toBe('REPORT');
    expect(item.reporterId).toBe(REPORTER_ID);
    expect(item.reportedUserId).toBe(REPORTED_USER_ID);
    expect(item.msgId).toBe(MSG_ID);
  });
});
