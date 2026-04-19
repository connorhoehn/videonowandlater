/**
 * GET /admin/surveys?since=ISO&limit=N
 *
 * Admin-only cross-session survey view. Default window is the last 30 days.
 * Returns the raw surveys plus a pre-computed NPS aggregate so the admin panel
 * can render a scorecard without re-walking the list.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin } from '../lib/admin-auth';
import { listRecentSurveys, computeAggregate } from '../repositories/survey-repository';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-list-surveys' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  // Resolve `since` — prefer explicit query param, else fall back to 30d ago.
  let since = event.queryStringParameters?.since;
  if (since !== undefined) {
    const parsed = new Date(since);
    if (Number.isNaN(parsed.getTime())) {
      return resp(400, { error: 'since must be an ISO-8601 timestamp' });
    }
    since = parsed.toISOString();
  } else {
    since = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }

  const rawLimit = event.queryStringParameters?.limit;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_LIMIT) {
      return resp(400, { error: `limit must be between 1 and ${MAX_LIMIT}` });
    }
    limit = parsed;
  }

  try {
    const surveys = await listRecentSurveys(tableName, { limit, since });
    const aggregate = computeAggregate(surveys);
    logger.info('Listed recent surveys', { count: surveys.length, since });
    return resp(200, { surveys, aggregate, since });
  } catch (err: any) {
    logger.error('Error listing surveys', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
