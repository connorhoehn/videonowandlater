/**
 * Tests for go-live Lambda handler
 * POST /sessions/{sessionId}/go-live — SCHEDULED → CREATING, claims pool resources
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../go-live';
import * as sessionRepository from '../../repositories/session-repository';
import * as sessionService from '../../services/session-service';
import * as dynamodbClient from '../../lib/dynamodb-client';
import * as emitModule from '../../lib/emit-session-event';
import * as adClient from '../../lib/ad-service-client';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../services/session-service');
jest.mock('../../lib/dynamodb-client');
jest.mock('../../lib/emit-session-event');
jest.mock('../../lib/ad-service-client');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockClaim = sessionService.claimSessionResources as jest.MockedFunction<
  typeof sessionService.claimSessionResources
>;
const mockGetDocClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;
const mockEmit = emitModule.emitSessionEvent as jest.MockedFunction<
  typeof emitModule.emitSessionEvent
>;

describe('go-live handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const HOST_USER = 'host-user';

  const scheduledSession: Session = {
    sessionId: SESSION_ID,
    userId: HOST_USER,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.SCHEDULED,
    claimedResources: { chatRoom: '' },
    createdAt: '2026-04-18T10:00:00Z',
    version: 1,
    scheduledFor: '2026-04-18T20:00:00Z',
  };

  const mockSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocClient.mockReturnValue({ send: mockSend } as any);
    mockEmit.mockResolvedValue(undefined);
    (adClient.startAdsSession as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  });

  function createEvent(opts: { userId?: string; sessionId?: string | null }): APIGatewayProxyEvent {
    return {
      pathParameters: opts.sessionId !== null ? { sessionId: opts.sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: opts.userId ? { claims: { 'cognito:username': opts.userId } } : undefined,
      },
      body: null,
    } as any;
  }

  const mockCtx = {} as any;
  const mockCb = (() => {}) as any;

  test('returns 401 when unauthorized', async () => {
    const result = await handler(createEvent({}), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 403 when caller is not the owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    const result = await handler(createEvent({ userId: 'other-user' }), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(403);
  });

  test('returns 400 when session is not in SCHEDULED state (wrong-status)', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...scheduledSession, status: SessionStatus.LIVE });
    const result = await handler(createEvent({ userId: HOST_USER }), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/SCHEDULED/);
  });

  test('returns 503 when pool is exhausted during resource claim', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    mockClaim.mockResolvedValueOnce({ error: 'No available channels - pool exhausted' });
    const result = await handler(createEvent({ userId: HOST_USER }), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(503);
  });

  test('claims resources, transitions SCHEDULED → CREATING, returns 200 with claimedResources', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    mockClaim.mockResolvedValueOnce({
      channelArn: 'arn:aws:ivs:::channel/abc',
      chatRoomArn: 'arn:aws:ivschat:::room/xyz',
    });
    mockSend.mockResolvedValueOnce({}); // UpdateCommand

    const result = await handler(createEvent({ userId: HOST_USER }), mockCtx, mockCb) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.status).toBe(SessionStatus.CREATING);
    expect(body.claimedResources.channel).toBe('arn:aws:ivs:::channel/abc');

    // Confirm conditional update was attempted
    const updateCall = mockSend.mock.calls[0][0];
    expect(updateCall.input.ConditionExpression).toMatch(/status/);
    expect(updateCall.input.ExpressionAttributeValues[':scheduled']).toBe(SessionStatus.SCHEDULED);
  });

  test('returns 409 if conditional update fails (concurrent go-live)', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    mockClaim.mockResolvedValueOnce({
      channelArn: 'arn:aws:ivs:::channel/abc',
      chatRoomArn: 'arn:aws:ivschat:::room/xyz',
    });
    const condErr: any = new Error('conditional check');
    condErr.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(condErr);

    const result = await handler(createEvent({ userId: HOST_USER }), mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(409);
  });
});
