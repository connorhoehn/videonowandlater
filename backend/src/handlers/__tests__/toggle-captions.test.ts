/**
 * Tests for toggle-captions Lambda handler
 * POST /sessions/{sessionId}/captions/toggle — enable/disable live captions
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../toggle-captions';
import * as sessionRepository from '../../repositories/session-repository';
import * as ivsClients from '../../lib/ivs-clients';
import * as dynamodbClient from '../../lib/dynamodb-client';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../lib/ivs-clients');
jest.mock('../../lib/dynamodb-client');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;
const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;

describe('toggle-captions handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-captions';
  const OWNER_ID = 'user-owner';
  const CHAT_ROOM_ARN = 'arn:aws:ivschat:us-east-1:123456789012:room/abcdef';

  const baseSession: Session = {
    sessionId: SESSION_ID,
    userId: OWNER_ID,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.LIVE,
    claimedResources: { chatRoom: CHAT_ROOM_ARN },
    createdAt: '2026-03-10T10:00:00Z',
    version: 1,
  };

  const mockIvsSend = jest.fn();
  const mockDynamoSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIVSChatClient.mockReturnValue({ send: mockIvsSend } as any);
    mockGetDocumentClient.mockReturnValue({ send: mockDynamoSend } as any);
    mockIvsSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});
  });

  function createEvent(overrides: {
    actorId?: string;
    sessionId?: string | null;
    body?: object | null;
  }): APIGatewayProxyEvent {
    const { actorId, sessionId, body } = overrides;
    return {
      pathParameters: sessionId !== null ? { sessionId: sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: actorId
          ? { claims: { 'cognito:username': actorId } }
          : undefined,
      },
      body: body !== null ? JSON.stringify(body ?? { enabled: true }) : null,
    } as any;
  }

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  test('returns 401 when caller is unauthenticated', async () => {
    const event = createEvent({ actorId: undefined });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when sessionId missing from path', async () => {
    const event = createEvent({ actorId: OWNER_ID, sessionId: null });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when body has no enabled boolean', async () => {
    const event = createEvent({ actorId: OWNER_ID, body: {} });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when body is invalid JSON', async () => {
    const event = {
      pathParameters: { sessionId: SESSION_ID },
      requestContext: { authorizer: { claims: { 'cognito:username': OWNER_ID } } },
      body: 'not-json',
    } as any;
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = createEvent({ actorId: OWNER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(404);
  });

  test('returns 403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: 'not-owner' });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(mockDynamoSend).not.toHaveBeenCalled();
    expect(mockIvsSend).not.toHaveBeenCalled();
  });

  test('persists captionsEnabled=true and emits captions_toggled chat event', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: OWNER_ID, body: { enabled: true } });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ enabled: true });

    // DynamoDB update
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const updateArg = mockDynamoSend.mock.calls[0][0];
    expect(updateArg.input).toMatchObject({
      TableName: TABLE_NAME,
      Key: { PK: `SESSION#${SESSION_ID}`, SK: 'METADATA' },
    });
    expect(updateArg.input.ExpressionAttributeValues).toMatchObject({ ':val': true });

    // IVS Chat SendEvent
    expect(mockIvsSend).toHaveBeenCalledTimes(1);
    const sendArg = mockIvsSend.mock.calls[0][0];
    expect(sendArg.input).toMatchObject({
      roomIdentifier: CHAT_ROOM_ARN,
      eventName: 'captions_toggled',
      attributes: {
        enabled: 'true',
        actorId: OWNER_ID,
      },
    });
  });

  test('persists captionsEnabled=false when disabling', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: OWNER_ID, body: { enabled: false } });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const updateArg = mockDynamoSend.mock.calls[0][0];
    expect(updateArg.input.ExpressionAttributeValues).toMatchObject({ ':val': false });

    const sendArg = mockIvsSend.mock.calls[0][0];
    expect(sendArg.input.attributes).toMatchObject({ enabled: 'false' });
  });

  test('still returns 200 when SendEvent fails (event emission is best-effort)', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    mockIvsSend.mockRejectedValueOnce(new Error('IVS Chat down'));
    const event = createEvent({ actorId: OWNER_ID, body: { enabled: true } });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    // Persist still happened
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });
});
