/**
 * POST /sessions/{sessionId}/promo/click handler
 *
 * Any authenticated user can click a promo. Body: `{ creativeId }`.
 * Passes through to vnl-ads `trackClick` and returns `{ ctaUrl }` for the
 * client to open. Feature-flag off → returns `{ ctaUrl: null }`.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { trackClick } from '../lib/ad-service-client';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'track-ad-click' } });

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
  const viewerId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!viewerId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  let creativeId: string | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    creativeId = body?.creativeId;
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }
  if (!creativeId) return resp(400, { error: 'creativeId required' });

  try {
    const result = await trackClick({ creativeId, sessionId, viewerId });
    return resp(200, { ctaUrl: result?.ctaUrl ?? null });
  } catch (err) {
    logger.warn('trackClick threw unexpectedly — returning null ctaUrl', {
      sessionId,
      creativeId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(200, { ctaUrl: null });
  }
};
