/**
 * POST /sessions/{sessionId}/agent/join
 * Request the AI agent to join a live hangout session (session owner only).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { updateAgentStatus, writeAgentAuditRecord } from '../repositories/agent-repository';
import { getIntentFlow } from '../repositories/intent-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'agent-join-session' } });

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

    if (session.status !== SessionStatus.LIVE) {
      return resp(400, { error: 'Session must be LIVE to add an agent' });
    }

    if (session.sessionType !== SessionType.HANGOUT) {
      return resp(400, { error: 'Agent can only join HANGOUT sessions' });
    }

    const body = JSON.parse(event.body || '{}');
    const { intentFlowId } = body;

    // Validate intent flow exists if provided
    if (intentFlowId) {
      const flow = await getIntentFlow(tableName, sessionId, intentFlowId);
      if (!flow) return resp(404, { error: 'Intent flow not found' });
    }

    // Update session agent status
    await updateAgentStatus(tableName, sessionId, 'joining');

    // Write audit record
    await writeAgentAuditRecord(tableName, sessionId, 'join', {
      requestedBy: userId,
      intentFlowId: intentFlowId ?? null,
    });

    logger.info('Agent join requested', { sessionId, userId, intentFlowId });
    return resp(202, { message: 'Agent joining', sessionId });
  } catch (err: any) {
    logger.error('Error requesting agent join', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
