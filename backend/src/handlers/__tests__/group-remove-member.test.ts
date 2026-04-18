/**
 * Tests for group-remove-member Lambda handler.
 * DELETE /groups/{groupId}/members/{userId} — owner/admin/self may remove.
 * Owner row is not removable via this endpoint.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-remove-member';
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
const mockRemoveMember = groupRepo.removeMember as jest.MockedFunction<
  typeof groupRepo.removeMember
>;

function createEvent(
  pathParams: Record<string, string> | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: pathParams,
    body: null,
    httpMethod: 'DELETE',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-remove-member handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('400 when groupId/userId missing', async () => {
    const result = await handler(createEvent({ groupId: 'g1' }));
    expect(result.statusCode).toBe(400);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  test('401 when unauthenticated', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: { groupId: 'g1', userId: 'bob' },
      body: null,
      httpMethod: 'DELETE',
      headers: {},
      requestContext: {},
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  test('404 when group not found', async () => {
    mockGetGroupById.mockResolvedValueOnce(null);
    const result = await handler(
      createEvent({ groupId: 'g-missing', userId: 'bob' }),
    );
    expect(result.statusCode).toBe(404);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  test('400 when target is the group owner', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(
      createEvent({ groupId: 'g1', userId: 'alice' }),
    );
    expect(result.statusCode).toBe(400);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  test('403 when caller is a plain member trying to remove someone else', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'charlie',
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'alice',
    });

    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { 'cognito:username': 'charlie' },
      ),
    );
    expect(result.statusCode).toBe(403);
    expect(mockRemoveMember).not.toHaveBeenCalled();
  });

  test('happy path: owner removes a member (200)', async () => {
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
    mockRemoveMember.mockResolvedValueOnce(undefined);

    const result = await handler(
      createEvent({ groupId: 'g1', userId: 'bob' }),
    );
    expect(result.statusCode).toBe(200);
    expect(mockRemoveMember).toHaveBeenCalledWith('test-table', 'g1', 'bob');
  });

  test('self-removal is allowed for a plain member', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'bob',
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'alice',
    });
    mockRemoveMember.mockResolvedValueOnce(undefined);

    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { 'cognito:username': 'bob' },
      ),
    );
    expect(result.statusCode).toBe(200);
    expect(mockRemoveMember).toHaveBeenCalledWith('test-table', 'g1', 'bob');
  });

  test('group-admin can remove another member', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'carol',
      groupRole: 'admin',
      addedAt: 'x',
      addedBy: 'alice',
    });
    mockRemoveMember.mockResolvedValueOnce(undefined);

    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { 'cognito:username': 'carol' },
      ),
    );
    expect(result.statusCode).toBe(200);
    expect(mockRemoveMember).toHaveBeenCalled();
  });
});
