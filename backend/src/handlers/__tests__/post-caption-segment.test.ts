/**
 * Tests for post-caption-segment Lambda handler
 * POST /sessions/{sessionId}/captions — broadcast a live caption segment
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler, __resetCaptionRateLimiter } from '../post-caption-segment';
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

describe('post-caption-segment handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-cap-post';
  const OWNER_ID = 'user-owner';
  const CHAT_ROOM_ARN = 'arn:aws:ivschat:us-east-1:123456789012:room/room1';

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
    __resetCaptionRateLimiter();
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
      body:
        body !== null
          ? JSON.stringify(
              body ?? { text: 'hello world', startSec: 1, endSec: 2, isFinal: true }
            )
          : null,
    } as any;
  }

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  test('returns 401 when unauthenticated', async () => {
    const event = createEvent({ actorId: undefined });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when sessionId missing', async () => {
    const event = createEvent({ actorId: OWNER_ID, sessionId: null });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when text missing or empty', async () => {
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: '', startSec: 1, endSec: 2, isFinal: true },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when text exceeds max length', async () => {
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: 'x'.repeat(600), startSec: 1, endSec: 2, isFinal: true },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when startSec/endSec not numbers', async () => {
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: 'hi', startSec: 'a', endSec: 2, isFinal: true },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when isFinal missing', async () => {
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: 'hi', startSec: 1, endSec: 2 },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when session missing', async () => {
    mockGetSessionById.mockResolvedValue(null);
    const event = createEvent({ actorId: OWNER_ID });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(404);
  });

  test('returns 403 when caller is not session owner', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({ actorId: 'not-owner' });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
    expect(mockIvsSend).not.toHaveBeenCalled();
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('emits caption event and persists CAPTION row for final segment', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: 'hello world', startSec: 1.25, endSec: 2.5, isFinal: true, speakerLabel: 'spk_0' },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);

    // Chat event emitted
    expect(mockIvsSend).toHaveBeenCalledTimes(1);
    const sendArg = mockIvsSend.mock.calls[0][0];
    expect(sendArg.input).toMatchObject({
      roomIdentifier: CHAT_ROOM_ARN,
      eventName: 'caption',
      attributes: {
        text: 'hello world',
        startSec: '1.25',
        endSec: '2.5',
        isFinal: 'true',
        speakerLabel: 'spk_0',
      },
    });

    // Persisted to DynamoDB
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
    const putArg = mockDynamoSend.mock.calls[0][0];
    expect(putArg.input.Item).toMatchObject({
      PK: `SESSION#${SESSION_ID}`,
      entityType: 'CAPTION',
      text: 'hello world',
      isFinal: true,
      speakerLabel: 'spk_0',
      GSI6PK: `CAPTION_FOR#${SESSION_ID}`,
    });
    expect(putArg.input.Item.SK).toMatch(/^CAPTION#/);
  });

  test('skips persistence for interim (non-final) segments but still broadcasts', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const event = createEvent({
      actorId: OWNER_ID,
      body: { text: 'partial', startSec: 1, endSec: 1.5, isFinal: false },
    });
    const result = await handler(event, mockContext, mockCallback) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(mockIvsSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend).not.toHaveBeenCalled();
  });

  test('rate limits to 5 requests per second per session', async () => {
    mockGetSessionById.mockResolvedValue(baseSession);
    const makeReq = () =>
      handler(createEvent({ actorId: OWNER_ID, body: { text: 't', startSec: 1, endSec: 2, isFinal: false } }),
        mockContext,
        mockCallback
      ) as Promise<APIGatewayProxyResult>;

    const results = await Promise.all([makeReq(), makeReq(), makeReq(), makeReq(), makeReq(), makeReq()]);
    const statusCodes = results.map((r) => r.statusCode);
    const successes = statusCodes.filter((c) => c === 200).length;
    const rateLimited = statusCodes.filter((c) => c === 429).length;

    expect(successes).toBe(5);
    expect(rateLimited).toBe(1);
  });
});
