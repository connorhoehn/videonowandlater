/**
 * GET /sessions/{sessionId}/agent/status
 * Get the current agent status, intent flow, and results.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { getIntentFlow, getIntentResults } from '../repositories/intent-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'agent-status' } });

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

    const agentStatus = session.agentStatus ?? 'idle';
    const agentParticipantId = session.agentParticipantId ?? null;

    let intentFlow = null;
    let intentResults = null;

    if (session.intentFlowId) {
      [intentFlow, intentResults] = await Promise.all([
        getIntentFlow(tableName, sessionId, session.intentFlowId),
        getIntentResults(tableName, sessionId),
      ]);
    }

    return resp(200, { agentStatus, agentParticipantId, intentFlow, intentResults });
  } catch (err: any) {
    logger.error('Error getting agent status', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
