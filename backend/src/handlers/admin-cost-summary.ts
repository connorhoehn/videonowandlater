/**
 * GET /admin/costs/summary
 * Admin-only endpoint to return aggregate cost data for a given period.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { queryCostsByDateRange } from '../repositories/cost-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-cost-summary' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  try {
    const params = event.queryStringParameters ?? {};
    const period = params.period === 'monthly' ? 'monthly' : 'daily';
    const date = params.date ?? new Date().toISOString().split('T')[0];

    let startDate: string;
    let endDate: string;

    if (period === 'monthly') {
      // Entire month containing the given date
      const [year, month] = date.split('-');
      startDate = `${year}-${month}-01`;
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    } else {
      // Single day
      startDate = date;
      endDate = date;
    }

    const items = await queryCostsByDateRange(tableName, startDate, endDate);

    // Aggregate by service and session type
    let totalCostUsd = 0;
    const byService: Record<string, number> = {};
    const bySessionType: Record<string, number> = {};

    for (const item of items) {
      totalCostUsd += item.costUsd;
      byService[item.service] = (byService[item.service] ?? 0) + item.costUsd;
      bySessionType[item.sessionType] = (bySessionType[item.sessionType] ?? 0) + item.costUsd;
    }

    // Round to avoid floating point noise
    totalCostUsd = Math.round(totalCostUsd * 1_000_000) / 1_000_000;
    for (const key of Object.keys(byService)) {
      byService[key] = Math.round(byService[key] * 1_000_000) / 1_000_000;
    }
    for (const key of Object.keys(bySessionType)) {
      bySessionType[key] = Math.round(bySessionType[key] * 1_000_000) / 1_000_000;
    }

    logger.info('Cost summary generated', { period, date, totalCostUsd, itemCount: items.length });

    return resp(200, {
      totalCostUsd,
      byService,
      bySessionType,
      period,
      date,
    });
  } catch (err: any) {
    logger.error('Error generating cost summary', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
