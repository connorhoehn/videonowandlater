/**
 * POST /sessions/{sessionId}/lobby/{userId}/deny
 *
 * Host denies a pending lobby join request. Disconnects the waiting IVS
 * participant, updates the lobby row to 'denied', and emits a chat
 * 'lobby_update' event so the user's client knows to leave the waiting room.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DisconnectParticipantCommand } from '@aws-sdk/client-ivs-realtime';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSRealTimeClient, getIVSChatClient } from '../lib/ivs-clients';
import {
  getSessionById,
  getLobbyRequest,
  updateLobbyRequestStatus,
} from '../repositories/session-repository';
import { SessionType } from '../domain/session';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'deny-lobby-request' } });

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

  const actorId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!actorId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  const targetUserId = event.pathParameters?.userId;
  if (!sessionId || !targetUserId) {
    return resp(400, { error: 'sessionId and userId are required in the path' });
  }

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });
  if (session.sessionType !== SessionType.HANGOUT) {
    return resp(400, { error: 'Session is not a HANGOUT' });
  }

  // Authz: session owner OR admin
  if (actorId !== session.userId && !isAdmin(event)) {
    return resp(403, { error: 'Only the session owner can deny lobby requests' });
  }

  const stageArn = session.claimedResources?.stage;

  // Look up the pending lobby row to get the ivsParticipantId
  const lobbyRow = await getLobbyRequest(tableName, sessionId, targetUserId);
  if (!lobbyRow) {
    return resp(404, { error: 'Lobby request not found' });
  }

  // Disconnect the waiting IVS participant (best-effort — they may have left)
  if (stageArn && lobbyRow.ivsParticipantId) {
    try {
      await getIVSRealTimeClient().send(new DisconnectParticipantCommand({
        stageArn,
        participantId: lobbyRow.ivsParticipantId,
        reason: 'Join request denied by host',
      }));
    } catch (err: any) {
      logger.warn('DisconnectParticipant failed', {
        sessionId, targetUserId, error: err.message,
      });
    }
  }

  // Update lobby row status
  try {
    await updateLobbyRequestStatus(tableName, sessionId, targetUserId, 'denied');
  } catch (err: any) {
    logger.warn('Failed to update lobby request status', { error: err.message });
  }

  // Emit chat lobby_update event so the waiting user's client knows to exit
  if (session.claimedResources?.chatRoom) {
    try {
      await getIVSChatClient().send(new SendEventCommand({
        roomIdentifier: session.claimedResources.chatRoom,
        eventName: 'lobby_update',
        attributes: {
          userId: targetUserId,
          action: 'denied',
          deniedBy: actorId,
        },
      }));
    } catch (err: any) {
      logger.warn('Failed to emit lobby_update chat event', { error: err.message });
    }
  }

  return resp(200, { status: 'denied', userId: targetUserId });
}
