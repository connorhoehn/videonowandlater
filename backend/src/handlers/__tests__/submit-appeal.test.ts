/**
 * Tests for submit-appeal Lambda handler
 * POST /sessions/{sessionId}/appeal — submit an appeal for a killed session
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../submit-appeal';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockDocSend = jest.fn().mockResolvedValue({});
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));
jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;

describe('submit-appeal handler', () => {
  const TABLE_NAME = 'test-table';

  const killedSession: Session = {
    sessionId: 'session-killed',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-10T10:00:00Z',
    version: 2,
    claimedResources: { chatRoom: 'room-1' },
  };

  // Kill date must stay within the 7-day appeal window, so compute relative to now
  const killCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const killRecord = {
    PK: 'SESSION#session-killed',
    SK: `MOD#${killCreatedAt}#mod-uuid`,
    entityType: 'MODERATION',
    actionType: 'ADMIN_KILL',
    actorId: 'admin-user',
    reason: 'Inappropriate content',
    sessionId: 'session-killed',
    createdAt: killCreatedAt,
  };

  const existingAppeal = {
    PK: 'SESSION#session-killed',
    SK: 'APPEAL#2026-04-11T10:00:00Z#appeal-uuid',
    entityType: 'APPEAL',
    sessionId: 'session-killed',
    userId: 'user-owner',
    reason: 'I did nothing wrong',
    status: 'pending',
    createdAt: '2026-04-11T10:00:00Z',
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(
    sessionId: string,
    body: object | null,
    userId?: string,
  ): APIGatewayProxyEvent {
    return {
      pathParameters: { sessionId },
      requestContext: {
        authorizer: userId
          ? { claims: { 'cognito:username': userId } }
          : undefined,
      },
      headers: { Authorization: 'Bearer user-token' },
      body: body ? JSON.stringify(body) : null,
      httpMethod: 'POST',
    } as any;
  }

  test('should return 401 when not authenticated', async () => {
    const result = await handler(createEvent('session-killed', { reason: 'This is my appeal reason' }, undefined));

    expect(result.statusCode).toBe(401);
  });

  test('should return 400 when reason is too short (< 10 chars)', async () => {
    const result = await handler(createEvent('session-killed', { reason: 'short' }, 'user-owner'));

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/at least 10 characters/i);
  });

  test('should return 403 when user is not session owner', async () => {
    mockGetSessionById.mockResolvedValueOnce(killedSession);

    const result = await handler(
      createEvent('session-killed', { reason: 'This is my appeal reason text' }, 'other-user'),
    );

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/not the session owner/i);
  });

  test('should return 400 when no kill record exists for session', async () => {
    mockGetSessionById.mockResolvedValueOnce(killedSession);
    // MOD# query returns no kill records
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(
      createEvent('session-killed', { reason: 'This is my appeal reason text' }, 'user-owner'),
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/not killed/i);
  });

  test('should return 409 when appeal already exists', async () => {
    mockGetSessionById.mockResolvedValueOnce(killedSession);
    // MOD# query returns kill record
    mockDocSend.mockResolvedValueOnce({ Items: [killRecord] });
    // APPEAL# query returns existing appeal
    mockDocSend.mockResolvedValueOnce({ Items: [existingAppeal] });

    const result = await handler(
      createEvent('session-killed', { reason: 'This is my appeal reason text' }, 'user-owner'),
    );

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/already been submitted/i);
  });

  test('should successfully create APPEAL# record', async () => {
    mockGetSessionById.mockResolvedValueOnce(killedSession);
    // MOD# query returns kill record
    mockDocSend.mockResolvedValueOnce({ Items: [killRecord] });
    // APPEAL# query returns no existing appeals
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand for appeal
    mockDocSend.mockResolvedValueOnce({});

    const result = await handler(
      createEvent('session-killed', { reason: 'This is my appeal reason text' }, 'user-owner'),
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/appeal submitted/i);

    // Verify the PutCommand wrote the appeal record
    const putCall = mockDocSend.mock.calls.find((call: any[]) => {
      const input = call[0]?.input || call[0];
      return input?.Item?.SK?.startsWith?.('APPEAL#');
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0]?.input || putCall![0]).Item;
    expect(item.PK).toBe('SESSION#session-killed');
    expect(item.entityType).toBe('APPEAL');
    expect(item.userId).toBe('user-owner');
    expect(item.status).toBe('pending');
  });

  test('should return 400 when appeal window (7 days) has expired', async () => {
    mockGetSessionById.mockResolvedValueOnce(killedSession);

    // Kill record from 8 days ago
    const oldKillRecord = {
      ...killRecord,
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    mockDocSend.mockResolvedValueOnce({ Items: [oldKillRecord] });

    const result = await handler(
      createEvent('session-killed', { reason: 'This is my appeal reason text' }, 'user-owner'),
    );

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/expired/i);
  });
});
