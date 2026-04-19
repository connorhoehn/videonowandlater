/**
 * Tests for get-feed handler (GET /feed)
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-feed';
import * as profileRepo from '../../repositories/profile-repository';
import * as followRepo from '../../repositories/follow-repository';

jest.mock('../../repositories/profile-repository');
jest.mock('../../repositories/follow-repository');

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));

const mockGetProfile = profileRepo.getProfile as jest.MockedFunction<typeof profileRepo.getProfile>;
const mockListFollowing = followRepo.listFollowing as jest.MockedFunction<typeof followRepo.listFollowing>;

const TABLE = 'test-table';

function createEvent(
  query: Record<string, string> = {},
  authUser?: string,
): APIGatewayProxyEvent {
  return {
    queryStringParameters: Object.keys(query).length ? query : null,
    requestContext: authUser
      ? { authorizer: { claims: { 'cognito:username': authUser } } }
      : ({} as any),
    headers: {},
    httpMethod: 'GET',
    body: null,
  } as any;
}

describe('get-feed handler', () => {
  beforeAll(() => { process.env.TABLE_NAME = TABLE; });
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfile.mockResolvedValue(null);
  });

  test('tab=live returns public LIVE sessions ordered by participantCount desc', async () => {
    const low = {
      sessionId: 's-low',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T11:00:00Z',
      visibility: 'public',
      participantCount: 2,
    };
    const high = {
      sessionId: 's-high',
      userId: 'u2',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
      participantCount: 20,
    };
    const unlistedIgnored = {
      sessionId: 's-unl',
      userId: 'u3',
      status: 'live',
      createdAt: '2026-04-14T12:00:00Z',
      visibility: 'unlisted',
      participantCount: 50,
    };

    mockDocSend.mockResolvedValueOnce({ Items: [low, high, unlistedIgnored] });

    const result = await handler(createEvent({ tab: 'live' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items.map((i: any) => i.sessionId)).toEqual(['s-high', 's-low']);
  });

  test('tab=upcoming returns empty list (Phase 5 placeholder)', async () => {
    const result = await handler(createEvent({ tab: 'upcoming' }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toEqual([]);
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  test('tab=recent returns ENDED public sessions within last 7 days', async () => {
    const now = Date.now();
    const recentIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const recent = {
      sessionId: 's-recent',
      userId: 'u1',
      status: 'ended',
      createdAt: recentIso,
      endedAt: recentIso,
      visibility: 'public',
    };
    const old = {
      sessionId: 's-old',
      userId: 'u2',
      status: 'ended',
      createdAt: oldIso,
      endedAt: oldIso,
      visibility: 'public',
    };
    const unlisted = {
      sessionId: 's-unl',
      userId: 'u3',
      status: 'ended',
      createdAt: recentIso,
      endedAt: recentIso,
      visibility: 'unlisted',
    };

    mockDocSend.mockResolvedValueOnce({ Items: [recent, old, unlisted] });

    const result = await handler(createEvent({ tab: 'recent' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe('s-recent');
  });

  test('tab=following requires auth — 401 when missing', async () => {
    const result = await handler(createEvent({ tab: 'following' }));
    expect(result.statusCode).toBe(401);
    expect(mockDocSend).not.toHaveBeenCalled();
    expect(mockListFollowing).not.toHaveBeenCalled();
  });

  test('tab=following returns live sessions owned by followed users', async () => {
    mockListFollowing.mockResolvedValue([
      { follower: 'caller', followee: 'u1', followedAt: '2026-04-01T00:00:00Z' },
      { follower: 'caller', followee: 'u3', followedAt: '2026-04-02T00:00:00Z' },
    ]);

    const follow1 = {
      sessionId: 's-f1',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
    };
    const notFollowed = {
      sessionId: 's-nope',
      userId: 'u2',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
    };
    const follow3Private = {
      sessionId: 's-f3p',
      userId: 'u3',
      status: 'live',
      createdAt: '2026-04-14T11:00:00Z',
      visibility: 'private',
    };

    mockDocSend.mockResolvedValueOnce({ Items: [follow1, notFollowed, follow3Private] });

    const result = await handler(createEvent({ tab: 'following' }, 'caller'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items.map((i: any) => i.sessionId)).toEqual(['s-f1']);
  });

  test('tab=following returns empty when user follows nobody', async () => {
    mockListFollowing.mockResolvedValue([]);
    const result = await handler(createEvent({ tab: 'following' }, 'caller'));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toEqual([]);
    expect(mockDocSend).not.toHaveBeenCalled();
  });
});
