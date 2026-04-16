/**
 * POST /sessions/{sessionId}/intent-flow
 * Create an intent flow for a session (session owner only).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { createIntentFlow } from '../repositories/intent-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'create-intent-flow' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    if (session.userId !== userId) return resp(403, { error: 'Forbidden' });

    const body = JSON.parse(event.body || '{}');
    const { flowId, name, sourceAppId, steps, callbackUrl } = body;

    if (!flowId || !name || !sourceAppId || !steps || !Array.isArray(steps)) {
      return resp(400, { error: 'flowId, name, sourceAppId, and steps[] are required' });
    }

    await createIntentFlow(tableName, sessionId, {
      flowId,
      sessionId,
      sourceAppId,
      name,
      steps,
      status: 'pending',
      callbackUrl,
      createdAt: new Date().toISOString(),
    });

    logger.info('Intent flow created', { sessionId, flowId });
    return resp(201, { flowId });
  } catch (err: any) {
    logger.error('Error creating intent flow', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
