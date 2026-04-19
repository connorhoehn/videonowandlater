/**
 * Tests for search-sessions handler (GET /search).
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../search-sessions';
import * as profileRepo from '../../repositories/profile-repository';

jest.mock('../../repositories/profile-repository');

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));

const mockGetProfile = profileRepo.getProfile as jest.MockedFunction<typeof profileRepo.getProfile>;

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

/**
 * The handler runs 3 GSI1 queries in parallel (LIVE / ENDING / ENDED).
 * Each mock below mirrors that call order: live, ending, ended.
 */
function mockStatusQueries(live: any[], ending: any[], ended: any[]) {
  mockDocSend.mockResolvedValueOnce({ Items: live });
  mockDocSend.mockResolvedValueOnce({ Items: ending });
  mockDocSend.mockResolvedValueOnce({ Items: ended });
}

describe('search-sessions handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = TABLE;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProfile.mockResolvedValue(null);
  });

  test('unauthenticated request returns only public sessions', async () => {
    const publicLive = {
      sessionId: 's-pub',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
      title: 'Public live',
    };
    const unlistedLive = {
      sessionId: 's-unl',
      userId: 'u2',
      status: 'live',
      createdAt: '2026-04-14T10:05:00Z',
      visibility: 'unlisted',
      title: 'Unlisted',
    };
    const privateLive = {
      sessionId: 's-prv',
      userId: 'u3',
      status: 'live',
      createdAt: '2026-04-14T10:10:00Z',
      visibility: 'private',
      title: 'Private',
    };

    mockStatusQueries([publicLive, unlistedLive, privateLive], [], []);

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe('s-pub');
  });

  test('authenticated caller sees same public-only result set', async () => {
    const publicLive = {
      sessionId: 's-pub',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
    };
    const privateLive = {
      sessionId: 's-prv',
      userId: 'caller',
      status: 'live',
      createdAt: '2026-04-14T10:10:00Z',
      visibility: 'private',
    };
    mockStatusQueries([publicLive, privateLive], [], []);

    const result = await handler(createEvent({}, 'caller'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe('s-pub');
  });

  test('q narrows to title / description / tag / creator handle match', async () => {
    const byTitle = {
      sessionId: 's-t',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
      title: 'Cooking live',
    };
    const byTag = {
      sessionId: 's-tag',
      userId: 'u2',
      status: 'live',
      createdAt: '2026-04-14T10:05:00Z',
      visibility: 'public',
      tags: ['cooking', 'food'],
    };
    const byHandle = {
      sessionId: 's-h',
      userId: 'u3',
      status: 'live',
      createdAt: '2026-04-14T10:10:00Z',
      visibility: 'public',
    };
    const noMatch = {
      sessionId: 's-none',
      userId: 'u4',
      status: 'live',
      createdAt: '2026-04-14T10:15:00Z',
      visibility: 'public',
      title: 'Golf',
    };

    mockStatusQueries([byTitle, byTag, byHandle, noMatch], [], []);

    mockGetProfile.mockImplementation(async (_t, uid) => {
      if (uid === 'u3') return { userId: 'u3', handle: 'chef-cookie', displayName: 'Chef Cookie' };
      return null;
    });

    const result = await handler(createEvent({ q: 'cook' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    const ids = body.items.map((i: any) => i.sessionId).sort();
    expect(ids).toEqual(['s-h', 's-t', 's-tag']);
  });

  test('filter=live narrows to live sessions only', async () => {
    const live = {
      sessionId: 's-live',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
    };
    const ended = {
      sessionId: 's-ended',
      userId: 'u2',
      status: 'ended',
      createdAt: '2026-04-14T09:00:00Z',
      endedAt: '2026-04-14T11:00:00Z',
      visibility: 'public',
    };
    mockStatusQueries([live], [], [ended]);

    const result = await handler(createEvent({ filter: 'live' }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].sessionId).toBe('s-live');
  });

  test('filter=upcoming returns empty list (Phase 5 placeholder)', async () => {
    const result = await handler(createEvent({ filter: 'upcoming' }));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toEqual([]);
    expect(mockDocSend).not.toHaveBeenCalled();
  });

  test('denormalizes creator handle + displayName on items', async () => {
    const live = {
      sessionId: 's1',
      userId: 'u1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
      title: 'Hi',
    };
    mockStatusQueries([live], [], []);
    mockGetProfile.mockResolvedValue({
      userId: 'u1', handle: 'alice', displayName: 'Alice',
    });

    const result = await handler(createEvent());
    const body = JSON.parse(result.body);
    expect(body.items[0].creatorHandle).toBe('alice');
    expect(body.items[0].creatorDisplayName).toBe('Alice');
  });
});
