/**
 * Tests for admin-list-surveys handler
 * GET /admin/surveys?since=ISO
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-list-surveys';
import * as surveyRepo from '../../repositories/survey-repository';
import * as adminAuth from '../../lib/admin-auth';

jest.mock('../../repositories/survey-repository');
jest.mock('../../lib/admin-auth');

const mockListRecent = surveyRepo.listRecentSurveys as jest.MockedFunction<
  typeof surveyRepo.listRecentSurveys
>;
const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;

const TABLE = 'test-table';

function createEvent(query: Record<string, string> = {}): APIGatewayProxyEvent {
  return {
    queryStringParameters: Object.keys(query).length ? query : null,
    requestContext: { authorizer: { claims: { 'cognito:username': 'admin-1' } } },
  } as any;
}

describe('admin-list-surveys handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    // Use the real computeAggregate for aggregate assertions
    (surveyRepo.computeAggregate as unknown as jest.Mock) = jest.requireActual(
      '../../repositories/survey-repository',
    ).computeAggregate;
  });

  test('returns 403 when caller is not admin', async () => {
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(403);
    expect(mockListRecent).not.toHaveBeenCalled();
  });

  test('returns 400 on invalid since', async () => {
    mockIsAdmin.mockReturnValue(true);
    const result = await handler(createEvent({ since: 'not-a-date' }));
    expect(result.statusCode).toBe(400);
  });

  test('returns 400 on invalid limit', async () => {
    mockIsAdmin.mockReturnValue(true);
    const result = await handler(createEvent({ limit: '9999' }));
    expect(result.statusCode).toBe(400);
  });

  test('defaults the since window to 30 days ago', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListRecent.mockResolvedValueOnce([]);
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const call = mockListRecent.mock.calls[0];
    expect(call[0]).toBe(TABLE);
    const sinceIso = (call[1] as any).since as string;
    const sinceMs = new Date(sinceIso).getTime();
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    // within a minute
    expect(Math.abs(sinceMs - expected)).toBeLessThan(60_000);
  });

  test('returns surveys + aggregate on success', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListRecent.mockResolvedValueOnce([
      {
        PK: 'SESSION#s1',
        SK: 'SURVEY#u1',
        sessionId: 's1',
        userId: 'u1',
        nps: 10,
        submittedAt: '2026-04-18T00:00:00Z',
      },
      {
        PK: 'SESSION#s2',
        SK: 'SURVEY#u2',
        sessionId: 's2',
        userId: 'u2',
        nps: 9,
        submittedAt: '2026-04-17T00:00:00Z',
      },
      {
        PK: 'SESSION#s3',
        SK: 'SURVEY#u3',
        sessionId: 's3',
        userId: 'u3',
        nps: 3,
        submittedAt: '2026-04-16T00:00:00Z',
      },
    ]);

    const result = await handler(createEvent({ since: '2026-04-01T00:00:00Z' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.surveys).toHaveLength(3);
    expect(body.aggregate.count).toBe(3);
    expect(body.aggregate.promoters).toBe(2);
    expect(body.aggregate.detractors).toBe(1);
    // 2/3 promoters - 1/3 detractors = 33
    expect(body.aggregate.npsScore).toBe(33);
    expect(body.since).toBe('2026-04-01T00:00:00.000Z');
  });

  test('honors custom limit', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockListRecent.mockResolvedValueOnce([]);
    const result = await handler(createEvent({ limit: '10' }));
    expect(result.statusCode).toBe(200);
    expect(mockListRecent).toHaveBeenCalledWith(
      TABLE,
      expect.objectContaining({ limit: 10 }),
    );
  });
});
