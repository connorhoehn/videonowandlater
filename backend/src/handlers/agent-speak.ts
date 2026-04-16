/**
 * POST /sessions/{sessionId}/agent/speak
 * Queue a speech action for the AI agent (session owner only).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { writeAgentAuditRecord } from '../repositories/agent-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'agent-speak' } });

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

    if (session.agentStatus === 'disconnected' || !session.agentStatus) {
      return resp(400, { error: 'No active agent on this session' });
    }

    const body = JSON.parse(event.body || '{}');
    const { text, intentSlot } = body;

    if (!text) return resp(400, { error: 'text is required' });

    // Write audit record for the speech action
    await writeAgentAuditRecord(tableName, sessionId, 'speak', {
      text,
      intentSlot: intentSlot ?? null,
      requestedBy: userId,
    });

    logger.info('Agent speak queued', { sessionId, textLength: text.length, intentSlot });
    return resp(200, { message: 'Speech queued' });
  } catch (err: any) {
    logger.error('Error queuing agent speech', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
