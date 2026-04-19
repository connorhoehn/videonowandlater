/**
 * Tests for get-session-chapters Lambda handler
 * GET /sessions/{sessionId}/chapters
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-session-chapters';
import * as sessionRepository from '../../repositories/session-repository';
import { SessionStatus, SessionType } from '../../domain/session';
import type { Session } from '../../domain/session';

jest.mock('../../repositories/session-repository');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<
  typeof sessionRepository.getSessionById
>;

describe('get-session-chapters handler', () => {
  const TABLE_NAME = 'test-table';

  const baseSession: Session = {
    sessionId: 'session-abc',
    userId: 'user-owner',
    sessionType: SessionType.BROADCAST,
    status: SessionStatus.ENDED,
    createdAt: '2026-04-10T10:00:00Z',
    version: 2,
    claimedResources: { chatRoom: 'room-1' },
  };

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createEvent(sessionId?: string): APIGatewayProxyEvent {
    return {
      pathParameters: sessionId ? { sessionId } : null,
      requestContext: {
        authorizer: { claims: { 'cognito:username': 'user-owner' } },
      },
      headers: {},
      httpMethod: 'GET',
    } as any;
  }

  test('returns 400 when sessionId is missing', async () => {
    const result = await handler(createEvent(undefined));
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when session does not exist', async () => {
    mockGetSessionById.mockResolvedValueOnce(null);

    const result = await handler(createEvent('nonexistent'));

    expect(result.statusCode).toBe(404);
  });

  test('returns chapter list when session has chapters', async () => {
    mockGetSessionById.mockResolvedValueOnce({
      ...baseSession,
      chapters: [
        { title: 'Intro', startTimeMs: 0, endTimeMs: 30000 },
        { title: 'Deep dive', startTimeMs: 30000, endTimeMs: 120500 },
      ],
    });

    const result = await handler(createEvent('session-abc'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.chapters).toHaveLength(2);
    expect(body.chapters[0]).toEqual({
      id: 'session-abc-ch-0',
      title: 'Intro',
      startSec: 0,
      endSec: 30,
    });
    expect(body.chapters[1]).toEqual({
      id: 'session-abc-ch-1',
      title: 'Deep dive',
      startSec: 30,
      endSec: 121, // 120500ms rounds to 121s
    });
  });

  test('returns empty chapters array when session has no chapters', async () => {
    mockGetSessionById.mockResolvedValueOnce({ ...baseSession, chapters: undefined });

    const result = await handler(createEvent('session-abc'));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.chapters).toEqual([]);
  });
});
