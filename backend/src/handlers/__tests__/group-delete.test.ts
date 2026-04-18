/**
 * Tests for group-delete Lambda handler.
 * DELETE /groups/{groupId} — owner-only (or global admin).
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-delete';
import * as groupRepo from '../../repositories/group-repository';

jest.mock('../../repositories/group-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockGetGroupById = groupRepo.getGroupById as jest.MockedFunction<
  typeof groupRepo.getGroupById
>;
const mockDeleteGroup = groupRepo.deleteGroup as jest.MockedFunction<
  typeof groupRepo.deleteGroup
>;

function createEvent(
  groupId: string | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: groupId ? { groupId } : null,
    body: null,
    httpMethod: 'DELETE',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-delete handler', () => {
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
    expect(mockDeleteGroup).not.toHaveBeenCalled();
  });

  test('401 when unauthenticated', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: { groupId: 'g1' },
      body: null,
      httpMethod: 'DELETE',
      headers: {},
      requestContext: {},
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
    expect(mockDeleteGroup).not.toHaveBeenCalled();
  });

  test('404 when group not found', async () => {
    mockGetGroupById.mockResolvedValueOnce(null);
    const result = await handler(createEvent('g-missing'));
    expect(result.statusCode).toBe(404);
    expect(mockDeleteGroup).not.toHaveBeenCalled();
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
      createEvent('g1', { 'cognito:username': 'charlie' }),
    );
    expect(result.statusCode).toBe(403);
    expect(mockDeleteGroup).not.toHaveBeenCalled();
  });

  test('happy path: owner deletes group (200)', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockDeleteGroup.mockResolvedValueOnce(undefined);

    const result = await handler(createEvent('g1'));
    expect(result.statusCode).toBe(200);
    expect(mockDeleteGroup).toHaveBeenCalledWith('test-table', 'g1');
    const body = JSON.parse(result.body);
    expect(body.groupId).toBe('g1');
  });

  test('global admin can delete any group', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockDeleteGroup.mockResolvedValueOnce(undefined);

    const result = await handler(
      createEvent('g1', {
        'cognito:username': 'root',
        'custom:role': 'admin',
      }),
    );
    expect(result.statusCode).toBe(200);
    expect(mockDeleteGroup).toHaveBeenCalled();
  });
});
