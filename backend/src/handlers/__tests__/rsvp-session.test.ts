/**
 * Tests for rsvp-session Lambda handler
 * POST / DELETE /sessions/{sessionId}/rsvp
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { handler } from '../rsvp-session';
import * as sessionRepository from '../../repositories/session-repository';
import * as dynamodbClient from '../../lib/dynamodb-client';
import * as emitModule from '../../lib/emit-session-event';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../lib/dynamodb-client');
jest.mock('../../lib/emit-session-event');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;
const mockEmit = emitModule.emitSessionEvent as jest.MockedFunction<
  typeof emitModule.emitSessionEvent
>;

describe('rsvp-session handler', () => {
  const TABLE_NAME = 'test-table';
  const SESSION_ID = 'session-abc';
  const HOST_USER = 'host-user';
  const RSVP_USER = 'rsvp-user';

  const scheduledSession: Session = {
    sessionId: SESSION_ID,
    userId: HOST_USER,
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.SCHEDULED,
    claimedResources: { chatRoom: '' },
    createdAt: '2026-04-18T10:00:00Z',
    version: 1,
    scheduledFor: '2026-04-18T20:00:00Z',
    scheduledEndsAt: '2026-04-18T21:00:00Z',
    title: 'My Event',
  };

  const liveSession: Session = {
    ...scheduledSession,
    status: SessionStatus.LIVE,
  };

  const mockSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
    mockEmit.mockResolvedValue(undefined);
  });

  function createEvent(opts: {
    method: 'POST' | 'DELETE';
    userId?: string;
    sessionId?: string | null;
    body?: object | null;
  }): APIGatewayProxyEvent {
    return {
      httpMethod: opts.method,
      pathParameters: opts.sessionId !== null ? { sessionId: opts.sessionId ?? SESSION_ID } : {},
      requestContext: {
        authorizer: opts.userId ? { claims: { 'cognito:username': opts.userId } } : undefined,
      },
      body: opts.body !== null ? JSON.stringify(opts.body ?? { status: 'going' }) : null,
    } as any;
  }

  const mockCtx = {} as any;
  const mockCb = (() => {}) as any;

  test('returns 401 when cognito:username is missing', async () => {
    const event = createEvent({ method: 'POST' });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when status body is missing', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    const event = createEvent({ method: 'POST', userId: RSVP_USER, body: {} });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 for RSVP on non-SCHEDULED session (wrong-status)', async () => {
    mockGetSessionById.mockResolvedValueOnce(liveSession);
    const event = createEvent({ method: 'POST', userId: RSVP_USER });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/SCHEDULED/i);
  });

  test('POST creates RSVP with correct keys and returns counts', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    // PutCommand + QueryCommand (countRsvps) + UpdateCommand (updateRsvpCounts)
    mockSend
      .mockResolvedValueOnce({}) // Put
      .mockResolvedValueOnce({ Items: [{ status: 'going' }] }) // Query
      .mockResolvedValueOnce({}); // Update counters

    const event = createEvent({ method: 'POST', userId: RSVP_USER, body: { status: 'going' } });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('going');
    expect(body.goingCount).toBe(1);

    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.Item).toEqual(
      expect.objectContaining({
        PK: `SESSION#${SESSION_ID}`,
        SK: `RSVP#${RSVP_USER}`,
        GSI1PK: `RSVP_BY#${RSVP_USER}`,
        GSI1SK: scheduledSession.scheduledFor,
        status: 'going',
      }),
    );
  });

  test('POST is idempotent — repeated RSVP with same status just overwrites', async () => {
    mockGetSessionById.mockResolvedValue(scheduledSession);
    mockSend
      .mockResolvedValueOnce({}) // Put 1
      .mockResolvedValueOnce({ Items: [{ status: 'going' }] })
      .mockResolvedValueOnce({}) // Update counters
      .mockResolvedValueOnce({}) // Put 2 (same Item)
      .mockResolvedValueOnce({ Items: [{ status: 'going' }] })
      .mockResolvedValueOnce({});

    const event = createEvent({ method: 'POST', userId: RSVP_USER, body: { status: 'going' } });
    const first = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;
    const second = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).goingCount).toBe(1); // still 1, no duplicate row
  });

  test('DELETE removes RSVP and returns 200 with updated counts', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    mockSend
      .mockResolvedValueOnce({ Item: { status: 'going' } }) // GetCommand (existing)
      .mockResolvedValueOnce({})                            // DeleteCommand
      .mockResolvedValueOnce({ Items: [] })                 // QueryCommand (count)
      .mockResolvedValueOnce({});                           // Update counters

    const event = createEvent({ method: 'DELETE', userId: RSVP_USER, body: null });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).goingCount).toBe(0);
  });

  test('DELETE is idempotent when no RSVP exists', async () => {
    mockGetSessionById.mockResolvedValueOnce(scheduledSession);
    mockSend
      .mockResolvedValueOnce({ Item: undefined }) // Get returns nothing
      .mockResolvedValueOnce({ Items: [] })       // count
      .mockResolvedValueOnce({});                 // update counters

    const event = createEvent({ method: 'DELETE', userId: RSVP_USER, body: null });
    const result = await handler(event, mockCtx, mockCb) as APIGatewayProxyResult;

    expect(result.statusCode).toBe(200);
  });
});
