/**
 * Tests for group-create Lambda handler.
 * POST /groups — creates a new user-owned group.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../group-create';
import * as groupRepo from '../../repositories/group-repository';

jest.mock('../../repositories/group-repository');
jest.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: jest.fn(() => ({ verify: jest.fn() })) },
}));

const mockCreateGroup = groupRepo.createGroup as jest.MockedFunction<
  typeof groupRepo.createGroup
>;

function createEvent(
  body: object | null,
  claims: Record<string, any> | undefined = { 'cognito:username': 'alice' },
): APIGatewayProxyEvent {
  return {
    pathParameters: null,
    body: body ? JSON.stringify(body) : null,
    httpMethod: 'POST',
    headers: { Authorization: 'Bearer tok' },
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as any;
}

describe('group-create handler', () => {
  beforeAll(() => {
    process.env.TABLE_NAME = 'test-table';
    delete process.env.USER_POOL_ID;
    delete process.env.USER_POOL_CLIENT_ID;
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('authenticated user can reach the handler (identify succeeds)', async () => {
    // Sanity check: when API Gateway claims are present the handler proceeds
    // past identify() and handles the request. (No-claims/no-token behavior
    // depends on env config + runtime class identity and is covered in
    // authz.test.ts.)
    mockCreateGroup.mockResolvedValueOnce({
      groupId: 'gx',
      ownerId: 'alice',
      name: 'X',
      visibility: 'private',
      createdAt: 'x',
    });
    const result = await handler(
      createEvent({ name: 'X' }, { 'cognito:username': 'alice' }),
    );
    expect(result.statusCode).toBe(201);
  });

  test('400 when name missing', async () => {
    const result = await handler(createEvent({}, { 'cognito:username': 'alice' }));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/name/i);
  });

  test('happy path: creates group as owner (201)', async () => {
    mockCreateGroup.mockResolvedValueOnce({
      groupId: 'g-123',
      ownerId: 'alice',
      name: 'My Group',
      description: 'A test',
      visibility: 'private',
      createdAt: '2026-04-18T00:00:00.000Z',
    });

    const result = await handler(
      createEvent(
        { name: 'My Group', description: 'A test' },
        { 'cognito:username': 'alice' },
      ),
    );

    expect(result.statusCode).toBe(201);
    expect(mockCreateGroup).toHaveBeenCalledWith('test-table', {
      ownerId: 'alice',
      name: 'My Group',
      description: 'A test',
      visibility: 'private',
    });
    const body = JSON.parse(result.body);
    expect(body.group.groupId).toBe('g-123');
    expect(body.group.ownerId).toBe('alice');
  });

  test('supports public visibility', async () => {
    mockCreateGroup.mockResolvedValueOnce({
      groupId: 'g-pub',
      ownerId: 'alice',
      name: 'Pub',
      visibility: 'public',
      createdAt: '2026-04-18T00:00:00.000Z',
    });

    const result = await handler(
      createEvent(
        { name: 'Pub', visibility: 'public' },
        { 'cognito:username': 'alice' },
      ),
    );

    expect(result.statusCode).toBe(201);
    expect(mockCreateGroup).toHaveBeenCalledWith(
      'test-table',
      expect.objectContaining({ visibility: 'public' }),
    );
  });

  test('invalid JSON body → 400', async () => {
    const event: APIGatewayProxyEvent = {
      body: 'not-json',
      httpMethod: 'POST',
      headers: {},
      requestContext: { authorizer: { claims: { 'cognito:username': 'alice' } } },
    } as any;
    const result = await handler(event);
    expect(result.statusCode).toBe(400);
  });
});
