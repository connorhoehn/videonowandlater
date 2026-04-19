/**
 * POST /me/training-claim
 * Body: { creativeId: string, sessionId?: string }
 *
 * Passthrough to vnl-ads `POST /v1/training/claim`. Server injects `userId`
 * from the Cognito claim so the caller can't claim on someone else's behalf.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { claimTraining, AdsHttpError } from '../lib/ad-service-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'claim-my-training' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  let body: { creativeId?: string; sessionId?: string; orgId?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON' });
  }

  if (!body.creativeId || typeof body.creativeId !== 'string') {
    return resp(400, { error: 'creativeId required' });
  }

  try {
    const result = await claimTraining({
      userId,
      creativeId: body.creativeId,
      sessionId: body.sessionId,
      orgId: body.orgId ?? 'default',
    });
    return resp(200, result);
  } catch (err) {
    if (err instanceof AdsHttpError) {
      logger.warn('vnl-ads non-2xx on training-claim', { userId, status: err.status, code: err.code });
      return resp(err.status >= 500 ? 502 : err.status, { error: err.code, message: err.message });
    }
    logger.error('training-claim unexpected error', { userId, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: 'Internal error' });
  }
};
