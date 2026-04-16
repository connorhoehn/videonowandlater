/**
 * Join Hangout Lambda handler
 * Generates IVS RealTime participant tokens for authenticated users
 *
 * POST /sessions/{sessionId}/join
 * - Validates session exists and is a HANGOUT type
 * - Generates participant token with PUBLISH+SUBSCRIBE capabilities
 * - Returns token, participantId, and expirationTime
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';
import { getIVSRealTimeClient } from '../lib/ivs-clients';
import { getSessionById, updateSessionStatus, addHangoutParticipant } from '../repositories/session-repository';
import { SessionType, SessionStatus } from '../domain/session';
import { Logger } from '@aws-lambda-powertools/logger';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'join-hangout' } });

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

  if (!tableName) {
    return resp(500, { error: 'TABLE_NAME environment variable not set' });
  }

  try {
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return resp(400, { error: 'sessionId is required' });
    }

    const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
    if (!userId) {
      return resp(400, { error: 'userId not found in authentication context' });
    }

    const session = await getSessionById(tableName, sessionId);

    if (!session || session.sessionType !== SessionType.HANGOUT) {
      return resp(404, { error: 'Session not found or not a HANGOUT session' });
    }

    const stageArn = session.claimedResources.stage;
    if (!stageArn) {
      return resp(500, { error: 'Stage ARN not found in session resources' });
    }

    const ivsRealTimeClient = getIVSRealTimeClient();
    const command = new CreateParticipantTokenCommand({
      stageArn,
      userId,
      duration: 720, // 12 hours in minutes (IVS max: 20160)
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      attributes: { userId },
    });

    const response = await ivsRealTimeClient.send(command);

    // Persist participant join -- best-effort, non-blocking (PTCP-01)
    try {
      await addHangoutParticipant(
        tableName,
        sessionId,
        userId,           // cognito:username
        userId,           // displayName = cognito:username (no separate display name exists)
        response.participantToken!.participantId!,
      );
      try {
        await emitSessionEvent(tableName, {
          eventId: uuidv4(), sessionId, eventType: SessionEventType.PARTICIPANT_JOINED,
          timestamp: new Date().toISOString(), actorId: userId,
          actorType: 'user', details: { participantId: response.participantToken!.participantId!, displayName: userId },
        });
      } catch { /* non-blocking */ }
    } catch (participantErr: any) {
      logger.error('Failed to persist participant', { error: participantErr.message });
    }

    // Transition session to LIVE so send-message accepts chat messages (HANG-11)
    try {
      await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
    } catch (err: any) {
      // Already LIVE (second+ participant joining) — expected, not an error
      logger.info('Status transition skipped (likely already LIVE)', { error: err.message });
    }

    if (!response.participantToken) {
      return resp(500, { error: 'Failed to generate participant token' });
    }

    return resp(200, {
      token: response.participantToken.token,
      participantId: response.participantToken.participantId,
      expirationTime: response.participantToken.expirationTime?.toISOString(),
      userId,
    });
  } catch (error) {
    logger.error('Error generating participant token', { error: error instanceof Error ? error.message : String(error) });
    return resp(500, {
      error: error instanceof Error ? error.message : 'Failed to generate participant token',
    });
  }
}
