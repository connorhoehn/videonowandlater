/**
 * GET /admin/sessions/{sessionId}/surveys
 *
 * Admin-only drill-down view: returns every survey submitted for one session
 * plus its NPS aggregate. Used by the session detail view on the admin panel.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin } from '../lib/admin-auth';
import {
  listSurveysForSession,
  computeAggregate,
} from '../repositories/survey-repository';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-get-session-surveys' },
});

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  try {
    const surveys = await listSurveysForSession(tableName, sessionId);
    const aggregate = computeAggregate(surveys);
    logger.info('Listed surveys for session', { sessionId, count: surveys.length });
    return resp(200, { sessionId, surveys, aggregate });
  } catch (err: any) {
    logger.error('Error listing session surveys', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err instanceof Error ? err.message : String(err) });
  }
}
