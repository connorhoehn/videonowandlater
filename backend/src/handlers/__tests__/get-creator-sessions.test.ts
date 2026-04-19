/**
 * Tests for get-creator-sessions handler
 * GET /creators/{handle}/sessions
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-creator-sessions';
import * as profileRepo from '../../repositories/profile-repository';

jest.mock('../../repositories/profile-repository');

const mockDocSend = jest.fn();
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({ send: mockDocSend })),
}));

const mockGetProfileByHandle = profileRepo.getProfileByHandle as jest.MockedFunction<
  typeof profileRepo.getProfileByHandle
>;

const TABLE = 'test-table';

function createEvent(
  handle: string | undefined,
  query: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    pathParameters: handle !== undefined ? { handle } : null,
    queryStringParameters: Object.keys(query).length ? query : null,
    requestContext: {} as any,
    headers: {},
    httpMethod: 'GET',
    body: null,
  } as any;
}

describe('get-creator-sessions handler', () => {
  beforeAll(() => { process.env.TABLE_NAME = TABLE; });
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns 400 when handle missing', async () => {
    const result = await handler(createEvent(undefined));
    expect(result.statusCode).toBe(400);
  });

  test('returns 404 when handle not found', async () => {
    mockGetProfileByHandle.mockResolvedValue(null);
    const result = await handler(createEvent('ghost'));
    expect(result.statusCode).toBe(404);
  });

  test('resolves handle and filters to that creator, excluding private sessions', async () => {
    mockGetProfileByHandle.mockResolvedValue({
      userId: 'creator-1', handle: 'alice', displayName: 'Alice',
    });

    const aliceLive = {
      sessionId: 's-a-live',
      userId: 'creator-1',
      status: 'live',
      createdAt: '2026-04-14T10:00:00Z',
      visibility: 'public',
    };
    const aliceEnded = {
      sessionId: 's-a-end',
      userId: 'creator-1',
      status: 'ended',
      createdAt: '2026-04-14T09:00:00Z',
      visibility: 'unlisted',
    };
    const alicePrivate = {
      sessionId: 's-a-prv',
      userId: 'creator-1',
      status: 'live',
      createdAt: '2026-04-14T11:00:00Z',
      visibility: 'private',
    };
    const bobLive = {
      sessionId: 's-b-live',
      userId: 'creator-2',
      status: 'live',
      createdAt: '2026-04-14T12:00:00Z',
      visibility: 'public',
    };

    // default (no status filter) queries LIVE + ENDING + ENDED partitions
    mockDocSend.mockResolvedValueOnce({ Items: [aliceLive, alicePrivate, bobLive] });
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    mockDocSend.mockResolvedValueOnce({ Items: [aliceEnded] });

    const result = await handler(createEvent('alice'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    const ids = body.items.map((i: any) => i.sessionId).sort();
    expect(ids).toEqual(['s-a-end', 's-a-live']);
    expect(body.items[0].creatorHandle).toBe('alice');
  });

  test('status=live only queries live partitions', async () => {
    mockGetProfileByHandle.mockResolvedValue({
      userId: 'u1', handle: 'alice', displayName: 'Alice',
    });
    mockDocSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 's1', userId: 'u1', status: 'live',
        createdAt: '2026-04-14T10:00:00Z', visibility: 'public',
      }],
    });
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent('alice', { status: 'live' }));
    expect(result.statusCode).toBe(200);
    expect(mockDocSend).toHaveBeenCalledTimes(2); // LIVE + ENDING
    expect(JSON.parse(result.body).items).toHaveLength(1);
  });

  test('status=ended filters to ended sessions', async () => {
    mockGetProfileByHandle.mockResolvedValue({
      userId: 'u1', handle: 'alice', displayName: 'Alice',
    });
    mockDocSend.mockResolvedValueOnce({
      Items: [{
        sessionId: 's-end', userId: 'u1', status: 'ended',
        createdAt: '2026-04-14T08:00:00Z', visibility: 'public',
      }],
    });

    const result = await handler(createEvent('alice', { status: 'ended' }));
    expect(result.statusCode).toBe(200);
    expect(mockDocSend).toHaveBeenCalledTimes(1); // only ENDED
    expect(JSON.parse(result.body).items).toHaveLength(1);
  });

  test('strips leading @ from handle', async () => {
    mockGetProfileByHandle.mockResolvedValue({ userId: 'u1', handle: 'alice' });
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    mockDocSend.mockResolvedValueOnce({ Items: [] });
    mockDocSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(createEvent('@alice'));
    expect(result.statusCode).toBe(200);
    expect(mockGetProfileByHandle).toHaveBeenCalledWith(TABLE, 'alice');
  });
});
