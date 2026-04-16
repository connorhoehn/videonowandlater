/**
 * GET /sessions/live
 * Returns live public sessions for spotlight selection.
 * Excludes the caller's own session and private sessions.
 * Auth required (Cognito JWT).
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getLivePublicSessions } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'list-live-sessions' } });

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
    // Return a curated shape for the Live Now feed
    const liveSessions = sessions.map(s => ({
      sessionId: s.sessionId,
      userId: s.userId,
      sessionType: s.sessionType,
      createdAt: s.createdAt,
      participantCount: s.participantCount ?? 0,
      messageCount: s.messageCount ?? 0,
      thumbnailUrl: s.thumbnailUrl ?? null,
      isPrivate: s.isPrivate ?? false,
    }));
    return resp(200, { sessions: liveSessions });
  } catch (err: any) {
    logger.error('Error listing live sessions', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
};
