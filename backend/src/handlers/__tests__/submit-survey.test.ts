/**
 * Tests for submit-survey Lambda handler
 * POST /sessions/{sessionId}/survey — submit an NPS survey.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../submit-survey';
import * as sessionRepository from '../../repositories/session-repository';
import * as surveyRepository from '../../repositories/survey-repository';
import { SessionType, SessionStatus } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('../../repositories/survey-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;
const mockGetHangoutParticipants = sessionRepository.getHangoutParticipants as jest.MockedFunction<
  typeof sessionRepository.getHangoutParticipants
>;
const mockWriteSurvey = surveyRepository.writeSurvey as jest.MockedFunction<
  typeof surveyRepository.writeSurvey
>;

const TABLE = 'test-table';

const session: Session = {
  sessionId: 'sess-1',
  userId: 'host-1',
  sessionType: SessionType.BROADCAST,
  status: SessionStatus.ENDED,
  createdAt: '2026-04-10T00:00:00Z',
  version: 1,
  claimedResources: { chatRoom: 'room-1' },
};

function createEvent(
  sessionId: string | undefined,
  body: object | string | null,
  userId?: string,
): APIGatewayProxyEvent {
  return {
    pathParameters: sessionId ? { sessionId } : null,
    requestContext: {
      authorizer: userId ? { claims: { 'cognito:username': userId } } : undefined,
    },
    headers: { Authorization: 'Bearer tok' },
    body: typeof body === 'string' ? body : body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
  } as any;
}

describe('submit-survey handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 401 when unauthenticated', async () => {
    const result = await handler(createEvent('sess-1', { nps: 8 }));
    expect(result.statusCode).toBe(401);
  });

  test('returns 400 when sessionId missing', async () => {
    const result = await handler(createEvent(undefined, { nps: 8 }, 'user-1'));
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 on invalid JSON body', async () => {
    const result = await handler(createEvent('sess-1', '{not-json', 'user-1'));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/invalid json/i);
  });

  test('returns 400 when nps is missing', async () => {
    const result = await handler(createEvent('sess-1', {}, 'user-1'));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/nps/i);
  });

  test('returns 400 when nps is out of range', async () => {
    const low = await handler(createEvent('sess-1', { nps: -1 }, 'user-1'));
    expect(low.statusCode).toBe(400);
    const high = await handler(createEvent('sess-1', { nps: 11 }, 'user-1'));
    expect(high.statusCode).toBe(400);
  });

  test('returns 400 when nps is not an integer', async () => {
    const result = await handler(createEvent('sess-1', { nps: 8.5 }, 'user-1'));
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 when freeText exceeds 1000 chars', async () => {
    const long = 'x'.repeat(1001);
    const result = await handler(createEvent('sess-1', { nps: 8, freeText: long }, 'user-1'));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toMatch(/1000/);
  });

  test('returns 404 when session not found', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);
    const result = await handler(createEvent('sess-1', { nps: 8 }, 'user-1'));
    expect(result.statusCode).toBe(404);
  });

  test('returns 403 when caller is neither host nor a participant', async () => {
    mockGetSessionById.mockResolvedValueOnce(session);
    mockGetHangoutParticipants.mockResolvedValueOnce([]);
    const result = await handler(createEvent('sess-1', { nps: 8 }, 'some-other-user'));
    expect(result.statusCode).toBe(403);
    expect(mockWriteSurvey).not.toHaveBeenCalled();
  });

  test('returns 409 when survey already submitted (ConditionalCheckFailed)', async () => {
    mockGetSessionById.mockResolvedValueOnce(session);
    const err = Object.assign(new Error('dup'), { name: 'ConditionalCheckFailedException' });
    mockWriteSurvey.mockRejectedValueOnce(err);
    const result = await handler(createEvent('sess-1', { nps: 10 }, 'host-1'));
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error).toMatch(/already/i);
  });

  test('returns 201 on happy path for host', async () => {
    mockGetSessionById.mockResolvedValueOnce(session);
    mockWriteSurvey.mockResolvedValueOnce({
      PK: 'SESSION#sess-1',
      SK: 'SURVEY#host-1',
      sessionId: 'sess-1',
      userId: 'host-1',
      nps: 9,
      freeText: 'great',
      submittedAt: '2026-04-18T00:00:00Z',
      sessionType: 'BROADCAST',
    });
    const result = await handler(
      createEvent('sess-1', { nps: 9, freeText: 'great' }, 'host-1'),
    );
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.nps).toBe(9);
    expect(body.freeText).toBe('great');
    expect(body.sessionType).toBe('BROADCAST');
    expect(mockWriteSurvey).toHaveBeenCalledWith(TABLE, {
      sessionId: 'sess-1',
      userId: 'host-1',
      nps: 9,
      freeText: 'great',
      sessionType: SessionType.BROADCAST,
    });
  });

  test('returns 201 for a non-host participant', async () => {
    mockGetSessionById.mockResolvedValueOnce(session);
    mockGetHangoutParticipants.mockResolvedValueOnce([
      { sessionId: 'sess-1', userId: 'guest-1', displayName: 'Guest', participantId: 'p1', joinedAt: 't' },
    ]);
    mockWriteSurvey.mockResolvedValueOnce({
      PK: 'SESSION#sess-1',
      SK: 'SURVEY#guest-1',
      sessionId: 'sess-1',
      userId: 'guest-1',
      nps: 7,
      submittedAt: '2026-04-18T00:00:00Z',
      sessionType: 'BROADCAST',
    });
    const result = await handler(createEvent('sess-1', { nps: 7 }, 'guest-1'));
    expect(result.statusCode).toBe(201);
  });
});
