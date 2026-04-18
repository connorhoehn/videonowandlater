/**
 * GET /sessions/{sessionId}/promo/drawer handler
 * Returns the list of promo/product creatives available for the session host.
 *
 * Authz: session owner only (mirrors bounce-user.ts).
 * Feature-flag off → returns `[]` without calling vnl-ads.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById } from '../repositories/session-repository';
import { getDrawer } from '../lib/ad-service-client';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-promo-drawer' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const actorId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!actorId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });

  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can view the promo drawer' });
  }

  try {
    const items = await getDrawer(session.userId, sessionId);
    return resp(200, { items });
  } catch (err) {
    logger.warn('getDrawer threw unexpectedly — returning empty items', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(200, { items: [] });
  }
};
