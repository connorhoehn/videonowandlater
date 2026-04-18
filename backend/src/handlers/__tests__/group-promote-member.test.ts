/**
 * Tests for group-promote-member Lambda handler.
 * PATCH /groups/{groupId}/members/{userId} — change a member's role.
 * Owner-only (or global admin). Owner role is not settable here.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-promote-member';
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
const mockPromoteMember = groupRepo.promoteMember as jest.MockedFunction<
  typeof groupRepo.promoteMember
>;

function createEvent(
  pathParams: Record<string, string> | null,
  body: object | string | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: pathParams,
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

describe('group-promote-member handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('400 when path params missing', async () => {
    const result = await handler(
      createEvent({ groupId: 'g1' }, { groupRole: 'admin' }),
    );
    expect(result.statusCode).toBe(400);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('401 when unauthenticated', async () => {
    const event: APIGatewayProxyEvent = {
      pathParameters: { groupId: 'g1', userId: 'bob' },
      body: JSON.stringify({ groupRole: 'admin' }),
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
      createEvent(
        { groupId: 'g-missing', userId: 'bob' },
        { groupRole: 'admin' },
      ),
    );
    expect(result.statusCode).toBe(404);
    expect(mockPromoteMember).not.toHaveBeenCalled();
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
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { groupRole: 'admin' },
        { 'cognito:username': 'charlie' },
      ),
    );
    expect(result.statusCode).toBe(403);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('400 when target is the owner', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'alice' },
        { groupRole: 'admin' },
      ),
    );
    expect(result.statusCode).toBe(400);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('400 when groupRole is invalid', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { groupRole: 'owner' }, // owner is intentionally not settable here
      ),
    );
    expect(result.statusCode).toBe(400);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('400 for invalid JSON body', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(
      createEvent({ groupId: 'g1', userId: 'bob' }, 'not-json'),
    );
    expect(result.statusCode).toBe(400);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('404 when target member not found', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember.mockResolvedValueOnce(null);

    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { groupRole: 'admin' },
      ),
    );
    expect(result.statusCode).toBe(404);
    expect(mockPromoteMember).not.toHaveBeenCalled();
  });

  test('happy path: owner promotes member to admin (200)', async () => {
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
    mockPromoteMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'bob',
      groupRole: 'admin',
      addedAt: 'x',
      addedBy: 'alice',
    });

    const result = await handler(
      createEvent(
        { groupId: 'g1', userId: 'bob' },
        { groupRole: 'admin' },
      ),
    );
    expect(result.statusCode).toBe(200);
    expect(mockPromoteMember).toHaveBeenCalledWith(
      'test-table',
      'g1',
      'bob',
      'admin',
    );
    const body = JSON.parse(result.body);
    expect(body.member.groupRole).toBe('admin');
  });
});
