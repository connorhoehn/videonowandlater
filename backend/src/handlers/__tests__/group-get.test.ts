/**
 * Tests for group-get Lambda handler.
 * GET /groups/{groupId} — fetch group metadata + members. Private groups
 * require membership (or a global admin role).
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-get';
import * as groupRepo from '../../repositories/group-repository';

jest.mock('../../repositories/group-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockGetGroupById = groupRepo.getGroupById as jest.MockedFunction<
  typeof groupRepo.getGroupById
>;
const mockGetMember = groupRepo.getMember as jest.MockedFunction<
  typeof groupRepo.getMember
>;
const mockListMembers = groupRepo.listMembers as jest.MockedFunction<
  typeof groupRepo.listMembers
>;

function createEvent(
  groupId: string | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: groupId ? { groupId } : null,
    body: null,
    httpMethod: 'GET',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-get handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('400 when groupId missing', async () => {
    const result = await handler(createEvent(null));
    expect(result.statusCode).toBe(400);
  });

  test('401 when no claims / no token (identify fails)', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: { groupId: 'g1' },
      body: null,
      httpMethod: 'GET',
      headers: {},
      requestContext: {},
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('404 when group not found', async () => {
    mockGetGroupById.mockResolvedValueOnce(null);
    const result = await handler(createEvent('g-missing'));
    expect(result.statusCode).toBe(404);
    expect(mockListMembers).not.toHaveBeenCalled();
  });

  test('403 when caller is non-member of a private group', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce(null);

    const result = await handler(
      createEvent('g1', { 'cognito:username': 'charlie' }),
    );
    expect(result.statusCode).toBe(403);
    expect(mockListMembers).not.toHaveBeenCalled();
  });

  test('happy path: member can read a private group (200)', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'alice',
      groupRole: 'owner',
      addedAt: 'x',
      addedBy: 'alice',
    });
    mockListMembers.mockResolvedValueOnce([
      {
        groupId: 'g1',
        userId: 'alice',
        groupRole: 'owner',
        addedAt: 'x',
        addedBy: 'alice',
      },
    ]);

    const result = await handler(createEvent('g1'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.group.groupId).toBe('g1');
    expect(body.members).toHaveLength(1);
  });

  test('public group is readable by non-member', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g-pub',
      ownerId: 'alice',
      name: 'Pub',
      visibility: 'public',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce(null);
    mockListMembers.mockResolvedValueOnce([]);

    const result = await handler(
      createEvent('g-pub', { 'cognito:username': 'charlie' }),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.group.visibility).toBe('public');
  });

  test('global admin can read a private group they are not a member of', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce(null);
    mockListMembers.mockResolvedValueOnce([]);

    const result = await handler(
      createEvent('g1', {
        'cognito:username': 'root',
        'custom:role': 'admin',
      }),
    );
    expect(result.statusCode).toBe(200);
  });
});
