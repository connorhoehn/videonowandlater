/**
 * Tests for admin-cost-summary Lambda handler
 * GET /admin/costs/summary - return aggregate cost data for a given period
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../admin-cost-summary';
import * as adminAuth from '../../lib/admin-auth';
import * as costRepository from '../../repositories/cost-repository';

jest.mock('../../lib/admin-auth');
jest.mock('../../repositories/cost-repository');

const mockIsAdmin = adminAuth.isAdmin as jest.MockedFunction<typeof adminAuth.isAdmin>;
const mockQueryCostsByDateRange = costRepository.queryCostsByDateRange as jest.MockedFunction<
  typeof costRepository.queryCostsByDateRange
>;

describe('admin-cost-summary handler', () => {
  const TABLE_NAME = 'test-table';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockReturnValue(false);
  });

  function createEvent(queryParams?: Record<string, string>): APIGatewayProxyEvent {
    return {
      queryStringParameters: queryParams ?? null,
      requestContext: {
        authorizer: {
          claims: { 'cognito:username': 'admin-user' },
        },
      },
      headers: { Authorization: 'Bearer admin-token' },
      body: null,
      httpMethod: 'GET',
    } as any;
  }

  test('should return 403 when user is not admin', async () => {
    mockIsAdmin.mockReturnValue(false);

    const result = await handler(createEvent());

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error).toMatch(/forbidden/i);
  });

  test('should return aggregated cost data for daily period', async () => {
    mockIsAdmin.mockReturnValue(true);

    mockQueryCostsByDateRange.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        service: 'ivs' as any,
        costUsd: 0.05,
        quantity: 1,
        unit: 'hour',
        rateApplied: 0.05,
        sessionType: 'BROADCAST',
        userId: 'user-1',
        createdAt: '2026-04-14T10:00:00Z',
      },
      {
        sessionId: 'session-2',
        service: 'mediaconvert' as any,
        costUsd: 0.02,
        quantity: 1,
        unit: 'minute',
        rateApplied: 0.02,
        sessionType: 'HANGOUT',
        userId: 'user-2',
        createdAt: '2026-04-14T11:00:00Z',
      },
    ]);

    const result = await handler(createEvent({ period: 'daily', date: '2026-04-14' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalCostUsd).toBe(0.07);
    expect(body.byService.ivs).toBe(0.05);
    expect(body.byService.mediaconvert).toBe(0.02);
    expect(body.bySessionType.BROADCAST).toBe(0.05);
    expect(body.bySessionType.HANGOUT).toBe(0.02);
    expect(body.period).toBe('daily');
    expect(body.date).toBe('2026-04-14');

    // Verify queryCostsByDateRange was called with same start/end for daily
    expect(mockQueryCostsByDateRange).toHaveBeenCalledWith(TABLE_NAME, '2026-04-14', '2026-04-14');
  });

  test('should return aggregated cost data for monthly period', async () => {
    mockIsAdmin.mockReturnValue(true);

    mockQueryCostsByDateRange.mockResolvedValueOnce([
      {
        sessionId: 'session-1',
        service: 'ivs' as any,
        costUsd: 1.5,
        quantity: 30,
        unit: 'hour',
        rateApplied: 0.05,
        sessionType: 'BROADCAST',
        userId: 'user-1',
        createdAt: '2026-04-01T10:00:00Z',
      },
    ]);

    const result = await handler(createEvent({ period: 'monthly', date: '2026-04-14' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalCostUsd).toBe(1.5);
    expect(body.period).toBe('monthly');

    // Verify queryCostsByDateRange was called with full month range
    expect(mockQueryCostsByDateRange).toHaveBeenCalledWith(TABLE_NAME, '2026-04-01', '2026-04-30');
  });

  test('should return zero totals when no cost data exists', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockQueryCostsByDateRange.mockResolvedValueOnce([]);

    const result = await handler(createEvent({ period: 'daily', date: '2026-04-14' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.totalCostUsd).toBe(0);
    expect(body.byService).toEqual({});
    expect(body.bySessionType).toEqual({});
  });

  test('should default to daily period when not specified', async () => {
    mockIsAdmin.mockReturnValue(true);
    mockQueryCostsByDateRange.mockResolvedValueOnce([]);

    const result = await handler(createEvent({ date: '2026-04-14' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.period).toBe('daily');

    // Daily means start === end
    expect(mockQueryCostsByDateRange).toHaveBeenCalledWith(TABLE_NAME, '2026-04-14', '2026-04-14');
  });
});
