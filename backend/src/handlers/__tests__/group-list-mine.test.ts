/**
 * Tests for group-list-mine Lambda handler.
 * GET /groups/mine — list groups the caller belongs to (via GSI1), annotated
 * with the caller's role per group.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-list-mine';
import * as groupRepo from '../../repositories/group-repository';

jest.mock('../../repositories/group-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockListGroupsForUser = groupRepo.listGroupsForUser as jest.MockedFunction<
  typeof groupRepo.listGroupsForUser
>;
const mockGetGroupsByIds = groupRepo.getGroupsByIds as jest.MockedFunction<
  typeof groupRepo.getGroupsByIds
>;

function createEvent(
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: null,
    body: null,
    httpMethod: 'GET',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-list-mine handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('401 when unauthenticated', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: null,
      body: null,
      httpMethod: 'GET',
      headers: {},
      requestContext: {},
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(mockListGroupsForUser).not.toHaveBeenCalled();
  });

  test('500 when TABLE_NAME missing', async () => {
    const saved = process.env.TABLE_NAME;
    delete process.env.TABLE_NAME;
    try {
      const result = await handler(createEvent());
      expect(result.statusCode).toBe(500);
    } finally {
      process.env.TABLE_NAME = saved;
    }
  });

  test('happy path: returns empty list when user has no memberships', async () => {
    mockListGroupsForUser.mockResolvedValueOnce([]);
    mockGetGroupsByIds.mockResolvedValueOnce([]);

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.groups).toEqual([]);
    expect(mockListGroupsForUser).toHaveBeenCalledWith('test-table', 'alice');
  });

  test('happy path: returns annotated groups with myRole', async () => {
    mockListGroupsForUser.mockResolvedValueOnce([
      { groupId: 'g1', groupRole: 'owner', addedAt: 'x' },
      { groupId: 'g2', groupRole: 'member', addedAt: 'y' },
    ]);
    mockGetGroupsByIds.mockResolvedValueOnce([
      {
        groupId: 'g1',
        ownerId: 'alice',
        name: 'First',
        visibility: 'private',
        createdAt: 'x',
      },
      {
        groupId: 'g2',
        ownerId: 'bob',
        name: 'Second',
        visibility: 'public',
        createdAt: 'y',
      },
    ]);

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.groups).toHaveLength(2);
    const byId = new Map<string, any>(
      body.groups.map((g: any) => [g.groupId, g]),
    );
    expect(byId.get('g1')?.myRole).toBe('owner');
    expect(byId.get('g2')?.myRole).toBe('member');
    expect(mockGetGroupsByIds).toHaveBeenCalledWith('test-table', ['g1', 'g2']);
  });

  test('falls back to "member" when role lookup misses for a returned group', async () => {
    // Unusual but defensible: a group is returned even though the membership
    // list didn't have it (e.g. race). myRole defaults to "member".
    mockListGroupsForUser.mockResolvedValueOnce([]);
    mockGetGroupsByIds.mockResolvedValueOnce([
      {
        groupId: 'g-orphan',
        ownerId: 'someone',
        name: 'Orphan',
        visibility: 'public',
        createdAt: 'x',
      },
    ]);

    const result = await handler(createEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.groups[0].myRole).toBe('member');
  });

  test('500 when repository throws an unexpected error', async () => {
    mockListGroupsForUser.mockRejectedValueOnce(new Error('dynamo down'));
    const result = await handler(createEvent());
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/dynamo down/);
  });
});
