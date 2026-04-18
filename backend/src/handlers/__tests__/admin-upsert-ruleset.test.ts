/**
 * Tests for admin-upsert-ruleset handler
 * POST /admin/rulesets/{name}
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-upsert-ruleset';
import * as adminAuth from '../../lib/admin-auth';
import * as rulesetRepo from '../../repositories/ruleset-repository';

jest.mock('../../lib/admin-auth');
jest.mock('../../repositories/ruleset-repository');

const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockGetAdminUserId = adminAuth.getAdminUserId as jest.MockedFunction<typeof adminAuth.getAdminUserId>;
const mockCreateRulesetVersion = rulesetRepo.createRulesetVersion as jest.MockedFunction<
  typeof rulesetRepo.createRulesetVersion
>;

describe('admin-upsert-ruleset handler', () => {
  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
    mockGetAdminUserId.mockReturnValue(undefined);
  });

  function createEvent(body: any, name = 'classroom'): APIGatewayProxyEvent {
    return {
      pathParameters: { name },
      requestContext: {
        authorizer: { claims: { 'cognito:username': 'admin-user' } },
      },
      body: JSON.stringify(body),
      httpMethod: 'POST',
    } as any;
  }

  it('returns 403 for non-admin', async () => {
    mockIsAdmin.mockReturnValue(false);
    const result = await handler(createEvent({ description: 'x', disallowedItems: ['a'], severity: 'high' }));
    expect(result.statusCode).toBe(403);
  });

  it('returns 401 when admin userId missing', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue(undefined);
    const result = await handler(createEvent({ description: 'x', disallowedItems: ['a'], severity: 'high' }));
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 when description missing', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ disallowedItems: ['a'], severity: 'high' }));
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when severity invalid', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ description: 'x', disallowedItems: ['a'], severity: 'extreme' }));
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when disallowedItems is empty', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    const result = await handler(createEvent({ description: 'x', disallowedItems: [], severity: 'high' }));
    expect(result.statusCode).toBe(400);
  });

  it('creates a new version on valid input', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockGetAdminUserId.mockReturnValue('admin-1');
    mockCreateRulesetVersion.mockResolvedValueOnce({
      name: 'classroom',
      version: 2,
      description: 'desc',
      disallowedItems: ['phone', 'watch'],
      severity: 'high',
      createdBy: 'admin-1',
      createdAt: '2026-04-18T00:00:00Z',
      active: true,
    });

    const result = await handler(
      createEvent({
        description: 'desc',
        disallowedItems: ['phone', 'watch'],
        severity: 'high',
      }),
    );

    expect(result.statusCode).toBe(201);
    expect(mockCreateRulesetVersion).toHaveBeenCalledWith(TABLE_NAME, {
      name: 'classroom',
      description: 'desc',
      disallowedItems: ['phone', 'watch'],
      severity: 'high',
      createdBy: 'admin-1',
    });
    const body = JSON.parse(result.body);
    expect(body.ruleset.version).toBe(2);
  });
});
