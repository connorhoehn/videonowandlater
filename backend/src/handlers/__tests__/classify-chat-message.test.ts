/**
 * Tests for classify-chat-message handler
 * POST /sessions/{sessionId}/chat/classify
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../classify-chat-message';
import * as novaTextModeration from '../../lib/nova-text-moderation';
import * as chatModerationRepo from '../../repositories/chat-moderation-repository';
import * as sessionRepo from '../../repositories/session-repository';
import * as dynamodbClient from '../../lib/dynamodb-client';
import * as ivsClients from '../../lib/ivs-clients';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../lib/nova-text-moderation');
jest.mock('../../repositories/chat-moderation-repository');
jest.mock('../../repositories/session-repository');
jest.mock('../../lib/dynamodb-client');
jest.mock('../../lib/ivs-clients');

const mockClassify = novaTextModeration.classifyChatMessage as jest.MockedFunction<
  typeof novaTextModeration.classifyChatMessage
>;
const mockWriteFlag = chatModerationRepo.writeFlag as jest.MockedFunction<
  typeof chatModerationRepo.writeFlag
>;
const mockGetSessionById = sessionRepo.getSessionById as jest.MockedFunction<
  typeof sessionRepo.getSessionById
>;
const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;
const mockGetIVSChatClient = ivsClients.getIVSChatClient as jest.MockedFunction<
  typeof ivsClients.getIVSChatClient
>;

const TABLE = 'test-table';
const SESSION_ID = 'sess-1';
const USER_ID = 'user-1';
const CHAT_ROOM = 'arn:aws:ivschat:us-east-1:123:room/abc';

const liveSession: Session = {
  sessionId: SESSION_ID,
  userId: 'owner',
  sessionType: SessionType.BROADCAST,
  status: SessionStatus.LIVE,
  createdAt: '2026-04-01T00:00:00Z',
  version: 1,
  claimedResources: { chatRoom: CHAT_ROOM },
};

describe('classify-chat-message handler', () => {
  const mockDocSend = jest.fn();
  const mockIvsSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockDocSend } as any);
    mockGetIVSChatClient.mockReturnValue({ send: mockIvsSend } as any);
    mockDocSend.mockResolvedValue({}); // default: no Item found -> no dedup
    mockIvsSend.mockResolvedValue({});
    mockGetSessionById.mockResolvedValue(liveSession);
    mockWriteFlag.mockResolvedValue({
      PK: 'SESSION#sess-1',
      SK: 'CHATFLAG#ts#uuid',
      sessionId: SESSION_ID,
      userId: USER_ID,
      messageId: 'msg-1',
      text: 't',
      categories: [],
      confidence: 0,
      reasoning: '',
      createdAt: '2026-04-18T00:00:00Z',
      status: 'pending',
    });
  });

  function createEvent(opts: {
    userId?: string | null;
    sessionId?: string | null;
    body?: any;
  } = {}): APIGatewayProxyEvent {
    return {
      pathParameters:
        opts.sessionId === null ? {} : { sessionId: opts.sessionId ?? SESSION_ID },
      requestContext: {
        authorizer:
          opts.userId === null
            ? undefined
            : { claims: { 'cognito:username': opts.userId ?? USER_ID } },
      },
      body: opts.body === undefined ? JSON.stringify({ messageId: 'msg-1', text: 'hello' }) : JSON.stringify(opts.body),
    } as any;
  }

  const mockContext = {} as any;
  const mockCallback = (() => {}) as any;

  test('returns 401 when caller has no cognito:username', async () => {
    const result = (await handler(
      createEvent({ userId: null }),
      mockContext,
      mockCallback,
    )) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when messageId is missing', async () => {
    const result = (await handler(
      createEvent({ body: { text: 'hi' } }),
      mockContext,
      mockCallback,
    )) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 200 unflagged when classification says not flagged', async () => {
    mockClassify.mockResolvedValue({
      flagged: false,
      categories: [],
      confidence: 0.2,
      reasoning: 'benign',
    });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flagged).toBe(false);
    expect(mockWriteFlag).not.toHaveBeenCalled();
  });

  test('returns 200 unflagged and does NOT write flag when confidence is below threshold', async () => {
    mockClassify.mockResolvedValue({
      flagged: true,
      categories: ['spam'],
      confidence: 0.4,
      reasoning: 'maybe spam',
    });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flagged).toBe(false);
    expect(mockWriteFlag).not.toHaveBeenCalled();
  });

  test('writes a flag + emits chat_flag event when classification crosses threshold', async () => {
    mockClassify.mockResolvedValue({
      flagged: true,
      categories: ['harassment'],
      confidence: 0.95,
      reasoning: 'clearly harassment',
    });
    // dedup check returns empty, then put, then strike update returns strikes=1
    mockDocSend.mockResolvedValueOnce({}); // GetCommand dedup -> no Item
    mockDocSend.mockResolvedValueOnce({}); // PutCommand idempotency row
    mockDocSend.mockResolvedValueOnce({ Attributes: { strikes: 1 } }); // UpdateCommand strike

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flagged).toBe(true);
    expect(body.bounced).toBe(false);
    expect(body.strikes).toBe(1);
    expect(mockWriteFlag).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({
        sessionId: SESSION_ID,
        userId: USER_ID,
        messageId: 'msg-1',
        categories: ['harassment'],
        confidence: 0.95,
      }),
    );

    // chat_flag SendEvent fired
    const sendEventCalls = mockIvsSend.mock.calls.filter(
      (c: any[]) => c[0]?.input?.eventName === 'chat_flag',
    );
    expect(sendEventCalls.length).toBe(1);
  });

  test('auto-bounces when strike count reaches STRIKE_LIMIT', async () => {
    mockClassify.mockResolvedValue({
      flagged: true,
      categories: ['threats'],
      confidence: 0.99,
      reasoning: 'direct threat',
    });
    // 1) dedup get -> empty, 2) idempotency put, 3) strike update -> 3
    mockDocSend.mockResolvedValueOnce({});
    mockDocSend.mockResolvedValueOnce({});
    mockDocSend.mockResolvedValueOnce({ Attributes: { strikes: 3 } });
    // 4) BOUNCE MOD put
    mockDocSend.mockResolvedValueOnce({});

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flagged).toBe(true);
    expect(body.bounced).toBe(true);
    expect(body.strikes).toBe(3);

    // user_kicked + DisconnectUser should have been called
    const eventNames = mockIvsSend.mock.calls.map((c: any[]) => c[0]?.input?.eventName).filter(Boolean);
    expect(eventNames).toContain('chat_flag');
    expect(eventNames).toContain('user_kicked');

    // BOUNCE MOD row written — find it in the put calls
    const putCalls = mockDocSend.mock.calls.filter(
      (c: any[]) => c[0]?.input?.Item?.actionType === 'BOUNCE',
    );
    expect(putCalls.length).toBe(1);
    expect(putCalls[0][0].input.Item).toMatchObject({
      actionType: 'BOUNCE',
      userId: USER_ID,
      actorId: 'SYSTEM',
      sessionId: SESSION_ID,
    });
  });

  test('returns 200 even when Bedrock classifier throws — never blocks chat', async () => {
    // Simulate the library's "throw" behavior by making it reject. Note:
    // in production the lib catches internally and returns unflagged — but we
    // defensively wrap the whole handler in a try/catch.
    mockClassify.mockRejectedValue(new Error('bedrock down'));
    mockDocSend.mockResolvedValue({}); // all DDB ops succeed

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.flagged).toBe(false);
  });

  test('returns 200 deduped when an idempotency row already exists', async () => {
    // First GetCommand returns an Item -> dedup short-circuit.
    mockDocSend.mockResolvedValueOnce({ Item: { PK: 'SESSION#s', SK: 'CHATMSG#msg-1' } });

    const result = (await handler(createEvent(), mockContext, mockCallback)) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.deduped).toBe(true);
    expect(mockClassify).not.toHaveBeenCalled();
  });
});
