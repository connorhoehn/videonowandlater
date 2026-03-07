/**
 * GET /sessions/live
 * Returns live public sessions for spotlight selection.
 * Excludes the caller's own session and private sessions.
 * Auth required (Cognito JWT).
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getLivePublicSessions } from '../repositories/session-repository';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const sessions = await getLivePublicSessions(tableName, userId);
    return resp(200, { sessions });
  } catch (err: any) {
    console.error('[list-live-sessions] error:', err);
    return resp(500, { error: err.message });
  }
};
