/**
 * POST /sessions/{sessionId}/context
 * Push a context event into a session timeline (any authenticated participant).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { addContextEvent } from '../repositories/context-repository';
import { createContextId } from '../domain/context-event';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'push-context-event' } });

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
    const body = JSON.parse(event.body || '{}');
    const { sourceAppId, eventType, timestamp, metadata } = body;

    if (!sourceAppId || !eventType || timestamp == null) {
      return resp(400, { error: 'sourceAppId, eventType, and timestamp are required' });
    }

    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const contextId = createContextId();

    await addContextEvent(tableName, sessionId, {
      contextId,
      sessionId,
      sourceAppId,
      eventType,
      timestamp,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
    });

    logger.info('Context event pushed', { sessionId, contextId, eventType });
    return resp(201, { contextId });
  } catch (err: any) {
    logger.error('Error pushing context event', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
