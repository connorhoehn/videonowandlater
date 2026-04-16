/**
 * POST /sessions/{sessionId}/end
 * Called by the frontend when stopping a broadcast.
 * Transitions session LIVE → ENDING immediately so the feed shows it as processing.
 * The recording-ended Lambda still handles ENDING → ENDED once IVS finishes.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, updateSessionStatus, updateSpotlight, getHangoutParticipants } from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'end-session' } });

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

    // Hangout sessions transition to ENDING to wait for per-participant recording events.
    // recording-ended handler will transition ENDING → ENDED once all participant recordings arrive.
    if (session.sessionType === SessionType.HANGOUT) {
      const participants = await getHangoutParticipants(tableName, sessionId);

      if (participants.length === 0) {
        // No participants ever joined — go directly to ENDED
        await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
        logger.info('Hangout session with 0 participants transitioned directly to ENDED', { sessionId, userId });

        try {
          await updateSpotlight(tableName, sessionId, null, null);
        } catch (spotlightErr) {
          logger.warn('Spotlight cleanup failed', { error: spotlightErr instanceof Error ? spotlightErr.message : String(spotlightErr) });
        }

        try {
          if (session.claimedResources?.stage) {
            await releasePoolResource(tableName, session.claimedResources.stage);
          }
          if (session.claimedResources?.chatRoom) {
            await releasePoolResource(tableName, session.claimedResources.chatRoom);
          }
        } catch (releaseErr) {
          logger.warn('Resource release failed', { error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr) });
        }

        return resp(200, { message: 'Session ended', status: 'ended' });
      }

      await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
      logger.info('Hangout session transitioning to ENDING', { sessionId, userId });

      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.SESSION_ENDING,
          timestamp: new Date().toISOString(), actorId: userId,
          actorType: 'user', details: { sessionType: session.sessionType },
        });
      } catch { /* non-blocking */ }

      try {
        await updateSpotlight(tableName, sessionId, null, null);
      } catch (spotlightErr) {
        logger.warn('Spotlight cleanup failed', { error: spotlightErr instanceof Error ? spotlightErr.message : String(spotlightErr) });
      }

      return resp(200, { message: 'Session ending', status: 'ending' });
    }

    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    logger.info('Session transitioning to ENDING', { sessionId, userId });

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId, eventType: SessionEventType.SESSION_ENDING,
        timestamp: new Date().toISOString(), actorId: userId,
        actorType: 'user', details: { sessionType: session.sessionType },
      });
    } catch { /* non-blocking */ }

    // Clear any spotlight on this session (non-blocking)
    try {
      await updateSpotlight(tableName, sessionId, null, null);
    } catch (spotlightErr) {
      logger.warn('Spotlight cleanup failed', { error: spotlightErr instanceof Error ? spotlightErr.message : String(spotlightErr) });
    }

    return resp(200, { message: 'Session ending', status: 'ending' });
  } catch (err: any) {
    logger.error('Error ending session', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
