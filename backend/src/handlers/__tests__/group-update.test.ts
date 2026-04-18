/**
 * Tests for group-update Lambda handler.
 * PATCH /groups/{groupId} — owner-only (or global admin) mutation of group
 * metadata.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-update';
import * as groupRepo from '../../repositories/group-repository';

jest.mock('../../repositories/group-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockGetGroupById = groupRepo.getGroupById as jest.MockedFunction<
  typeof groupRepo.getGroupById
>;
const mockUpdateGroup = groupRepo.updateGroup as jest.MockedFunction<
  typeof groupRepo.updateGroup
>;

function createEvent(
  groupId: string | null,
  body: object | string | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: groupId ? { groupId } : null,
    body:
      body === null
        ? null
        : typeof body === 'string'
          ? body
          : JSON.stringify(body),
    httpMethod: 'PATCH',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-update handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('400 when groupId missing', async () => {
    const result = await handler(createEvent(null, { name: 'New' }));
    expect(result.statusCode).toBe(400);
  });

  test('401 when unauthenticated', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: { groupId: 'g1' },
      body: JSON.stringify({ name: 'New' }),
      httpMethod: 'PATCH',
      headers: {},
      requestContext: {},
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('404 when group not found', async () => {
    mockGetGroupById.mockResolvedValueOnce(null);
    const result = await handler(
      createEvent('g-missing', { name: 'New' }),
    );
    expect(result.statusCode).toBe(404);
    expect(mockUpdateGroup).not.toHaveBeenCalled();
  });

  test('403 when caller is not the owner', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });

    const result = await handler(
      createEvent('g1', { name: 'Hijacked' }, { 'cognito:username': 'charlie' }),
    );
    expect(result.statusCode).toBe(403);
    expect(mockUpdateGroup).not.toHaveBeenCalled();
  });

  test('400 for invalid JSON body', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(createEvent('g1', 'not-json'));
    expect(result.statusCode).toBe(400);
    expect(mockUpdateGroup).not.toHaveBeenCalled();
  });

  test('happy path: owner updates name + visibility (200)', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockUpdateGroup.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'Renamed',
      visibility: 'public',
      createdAt: 'x',
    });

    const result = await handler(
      createEvent('g1', { name: 'Renamed', visibility: 'public' }),
    );
    expect(result.statusCode).toBe(200);
    expect(mockUpdateGroup).toHaveBeenCalledWith('test-table', 'g1', {
      name: 'Renamed',
      visibility: 'public',
    });
    const body = JSON.parse(result.body);
    expect(body.group.name).toBe('Renamed');
  });

  test('global admin can update a group they do not own', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockUpdateGroup.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'Admin-edit',
      visibility: 'private',
      createdAt: 'x',
    });

    const result = await handler(
      createEvent(
        'g1',
        { name: 'Admin-edit' },
        { 'cognito:username': 'root', 'custom:role': 'admin' },
      ),
    );
    expect(result.statusCode).toBe(200);
    expect(mockUpdateGroup).toHaveBeenCalled();
  });

  test('ignores invalid visibility values but keeps other patch fields', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockUpdateGroup.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'Only-name',
      visibility: 'private',
      createdAt: 'x',
    });

    const result = await handler(
      createEvent('g1', { name: 'Only-name', visibility: 'bogus' }),
    );
    expect(result.statusCode).toBe(200);
    expect(mockUpdateGroup).toHaveBeenCalledWith('test-table', 'g1', {
      name: 'Only-name',
    });
  });
});
