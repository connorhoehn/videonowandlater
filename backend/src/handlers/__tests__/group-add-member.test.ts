/**
 * Tests for group-add-member Lambda handler.
 * POST /groups/{groupId}/members — add a member (owner/admin only).
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-add-member';
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
const mockAddMember = groupRepo.addMember as jest.MockedFunction<
  typeof groupRepo.addMember
>;

function createEvent(
  groupId: string,
  body: object | null,
  username: string,
): APIGatewayProxyEvent {
  return {
    pathParameters: { groupId },
    body: body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: { claims: { 'cognito:username': username } },
    },
  } as any;
}

describe('group-add-member handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('400 when userId missing', async () => {
    // Handler returns 400 before touching the repo, so no need to seed mocks.
    const result = await handler(createEvent('g1', {}, 'alice'));
    expect(result.statusCode).toBe(400);
  });

  test('404 when group not found', async () => {
    mockGetGroupById.mockResolvedValueOnce(null);
    const result = await handler(
      createEvent('g-missing', { userId: 'bob' }, 'alice'),
    );
    expect(result.statusCode).toBe(404);
  });

  test('403 when caller is not owner/admin', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    // Caller "charlie" is a plain member, not owner/admin.
    mockGetMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'charlie',
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'alice',
    });

    const result = await handler(
      createEvent('g1', { userId: 'bob' }, 'charlie'),
    );
    expect(result.statusCode).toBe(403);
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  test('happy path: owner adds a new member (201)', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    // First getMember = caller lookup (owner), second = target lookup (not a member yet).
    mockGetMember
      .mockResolvedValueOnce({
        groupId: 'g1',
        userId: 'alice',
        groupRole: 'owner',
        addedAt: 'x',
        addedBy: 'alice',
      })
      .mockResolvedValueOnce(null);
    mockAddMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'bob',
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'alice',
    });

    const result = await handler(
      createEvent('g1', { userId: 'bob' }, 'alice'),
    );
    expect(result.statusCode).toBe(201);
    expect(mockAddMember).toHaveBeenCalledWith('test-table', {
      groupId: 'g1',
      userId: 'bob',
      groupRole: 'member',
      addedBy: 'alice',
    });
  });

  test('returns existing member when target is already in the group', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember
      .mockResolvedValueOnce({
        groupId: 'g1',
        userId: 'alice',
        groupRole: 'owner',
        addedAt: 'x',
        addedBy: 'alice',
      })
      .mockResolvedValueOnce({
        groupId: 'g1',
        userId: 'bob',
        groupRole: 'member',
        addedAt: 'y',
        addedBy: 'alice',
      });

    const result = await handler(
      createEvent('g1', { userId: 'bob' }, 'alice'),
    );
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.alreadyMember).toBe(true);
    expect(mockAddMember).not.toHaveBeenCalled();
  });

  test('group-admin (role=admin within group) can add members', async () => {
    mockGetGroupById.mockResolvedValueOnce({
      groupId: 'g1',
      ownerId: 'alice',
      name: 'G',
      visibility: 'private',
      createdAt: 'x',
    });
    mockGetMember
      .mockResolvedValueOnce({
        groupId: 'g1',
        userId: 'carol',
        groupRole: 'admin',
        addedAt: 'x',
        addedBy: 'alice',
      })
      .mockResolvedValueOnce(null);
    mockAddMember.mockResolvedValueOnce({
      groupId: 'g1',
      userId: 'bob',
      groupRole: 'member',
      addedAt: 'x',
      addedBy: 'carol',
    });

    const result = await handler(
      createEvent('g1', { userId: 'bob' }, 'carol'),
    );
    expect(result.statusCode).toBe(201);
    expect(mockAddMember).toHaveBeenCalled();
  });
});
