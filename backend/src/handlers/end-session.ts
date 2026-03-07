/**
 * POST /sessions/{sessionId}/end
 * Called by the frontend when stopping a broadcast.
 * Transitions session LIVE → ENDING immediately so the feed shows it as processing.
 * The recording-ended Lambda still handles ENDING → ENDED once IVS finishes.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, updateSessionStatus, updateSpotlight } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';

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

    if (session.status === SessionStatus.ENDING || session.status === SessionStatus.ENDED) {
      return resp(200, { message: 'Session already ending/ended', status: session.status });
    }

    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    console.log(`[end-session] ${sessionId} → ENDING by ${userId}`);

    // Clear any spotlight on this session (non-blocking)
    try {
      await updateSpotlight(tableName, sessionId, null, null);
    } catch (spotlightErr) {
      console.warn('[end-session] spotlight cleanup failed:', spotlightErr);
    }

    return resp(200, { message: 'Session ending', status: 'ending' });
  } catch (err: any) {
    console.error('[end-session] error:', err);
    return resp(500, { error: err.message });
  }
}
