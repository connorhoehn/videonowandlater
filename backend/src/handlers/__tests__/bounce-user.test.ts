/**
 * Tests for bounce-user Lambda handler
 * POST /sessions/{sessionId}/bounce - disconnect a user from IVS Chat and record BOUNCE
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../bounce-user';
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

describe('bounce-user handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-123';
  const ACTOR_ID = 'user-broadcaster';
  const TARGET_USER_ID = 'user-target';
  const CHAT_ROOM_ARN = 'arn:aws:ivschat:us-east-1:123456789012:room/abcdef';

  const mockSession: Session = {
    sessionId: SESSION_ID,
    userId: ACTOR_ID,
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
      body: body !== null ? JSON.stringify(body ?? { userId: TARGET_USER_ID }) : null,
    } as any;
  }

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  test('returns 401 when caller cognito:username is absent', async () => {
    const event = createEvent({ actorId: undefined });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 400 when sessionId is missing from path parameters', async () => {
    const event = createEvent({ actorId: ACTOR_ID, sessionId: null });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 400 when userId is missing from request body', async () => {
    const event = createEvent({ actorId: ACTOR_ID, body: {} });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 404 when session is not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = createEvent({ actorId: ACTOR_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body).error).toBeDefined();
  });

  test('returns 403 when caller is not the session owner', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);
    const event = createEvent({ actorId: 'user-not-owner' });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error).toBe('Only the session owner can bounce users');
    expect(mockIvsSend).not.toHaveBeenCalled();
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('returns 200, calls DisconnectUserCommand, writes BOUNCE record when caller is session owner', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);
    const event = createEvent({ actorId: ACTOR_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(JSON.parse(result.body).message).toBe('User bounced');

    // DisconnectUserCommand was sent to IVS Chat
    expect(mockIvsSend).toHaveBeenCalledTimes(1);
    const ivsSendArg = mockIvsSend.mock.calls[0][0];
    expect(ivsSendArg.input).toMatchObject({
      roomIdentifier: CHAT_ROOM_ARN,
      userId: TARGET_USER_ID,
      reason: 'Removed by broadcaster',
    });

    // BOUNCE record was written to DynamoDB
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const dynamoSendArg = mockDynamoSend.mock.calls[0][0];
    expect(dynamoSendArg.input.Item).toMatchObject({
      PK: `SESSION#${SESSION_ID}`,
      entityType: 'MODERATION',
      actionType: 'BOUNCE',
      userId: TARGET_USER_ID,
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
    });
    expect(dynamoSendArg.input.Item.SK).toMatch(/^MOD#/);
  });

  test('returns 200 and still writes BOUNCE record even when DisconnectUserCommand throws ResourceNotFoundException', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);
    const resourceNotFoundError = Object.assign(new Error('Resource not found'), {
      name: 'ResourceNotFoundException',
    });
    mockIvsSend.mockRejectedValueOnce(resourceNotFoundError);

    const event = createEvent({ actorId: ACTOR_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).message).toBe('User bounced');

    // DynamoDB write still happened
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const dynamoSendArg = mockDynamoSend.mock.calls[0][0];
    expect(dynamoSendArg.input.Item).toMatchObject({
      PK: `SESSION#${SESSION_ID}`,
      actionType: 'BOUNCE',
      userId: TARGET_USER_ID,
      actorId: ACTOR_ID,
    });
  });

  test('written BOUNCE record has correct PK/SK structure and required fields', async () => {
    mockGetSessionById.mockResolvedValue(mockSession);
    const event = createEvent({ actorId: ACTOR_ID });
    await handler(event, mockContext, mockCallback);

    const dynamoSendArg = mockDynamoSend.mock.calls[0][0];
    const item = dynamoSendArg.input.Item;

    expect(item.PK).toBe(`SESSION#${SESSION_ID}`);
    expect(item.SK).toMatch(/^MOD#\d{4}-\d{2}-\d{2}T/); // starts with MOD# + ISO timestamp
    expect(item.entityType).toBe('MODERATION');
    expect(item.actionType).toBe('BOUNCE');
    expect(item.userId).toBe(TARGET_USER_ID);
    expect(item.actorId).toBe(ACTOR_ID);
    expect(item.sessionId).toBe(SESSION_ID);
    expect(item.createdAt).toBeDefined();
  });
});
