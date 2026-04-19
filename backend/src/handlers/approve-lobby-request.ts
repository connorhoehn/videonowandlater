/**
 * POST /sessions/{sessionId}/lobby/{userId}/approve
 *
 * Host approves a pending lobby join request. Mints a new PUBLISH+SUBSCRIBE
 * participant token, updates the lobby row to 'approved', adds the participant
 * row, and emits a chat 'lobby_update' event so the waiting user's client can
 * re-join the Stage with the upgraded token.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSRealTimeClient, getIVSChatClient } from '../lib/ivs-clients';
import {
  getSessionById,
  addHangoutParticipant,
  updateLobbyRequestStatus,
  getLobbyRequest,
} from '../repositories/session-repository';
import { SessionType } from '../domain/session';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'approve-lobby-request' } });

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
    return resp(403, { error: 'Only the session owner can approve lobby requests' });
  }

  const stageArn = session.claimedResources?.stage;
  if (!stageArn) return resp(500, { error: 'Stage ARN not found in session resources' });

  // Idempotency guard — if the lobby row is already approved, don't re-mint.
  // IVS CreateParticipantToken + an extra PARTICIPANT row per re-call cost money;
  // retries can happen freely (e.g. host double-clicks). Return 200 with the
  // same shape minus the token — the client already has one from the first call.
  const existingLobby = await getLobbyRequest(tableName, sessionId, targetUserId);
  if (existingLobby?.status === 'approved') {
    logger.info('Lobby request already approved — short-circuiting', { sessionId, targetUserId });
    return resp(200, {
      status: 'approved',
      userId: targetUserId,
      alreadyApproved: true,
    });
  }

  // Mint upgraded PUBLISH+SUBSCRIBE token for the approved user
  let participantToken;
  try {
    const ivsRealTimeClient = getIVSRealTimeClient();
    const response = await ivsRealTimeClient.send(new CreateParticipantTokenCommand({
      stageArn,
      userId: targetUserId,
      duration: 720,
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      attributes: { userId: targetUserId },
    }));
    participantToken = response.participantToken;
    if (!participantToken) {
      return resp(500, { error: 'Failed to mint upgraded participant token' });
    }
  } catch (err: any) {
    logger.error('CreateParticipantToken failed', { sessionId, targetUserId, error: err.message });
    return resp(500, { error: 'Failed to mint upgraded participant token' });
  }

  // Update lobby row status (best-effort)
  try {
    await updateLobbyRequestStatus(tableName, sessionId, targetUserId, 'approved');
  } catch (err: any) {
    logger.warn('Failed to update lobby request status', { error: err.message });
  }

  // Persist participant row (best-effort)
  try {
    await addHangoutParticipant(
      tableName,
      sessionId,
      targetUserId,
      targetUserId,
      participantToken.participantId!,
    );
  } catch (err: any) {
    logger.warn('Failed to persist participant row', { error: err.message });
  }

  // Emit chat lobby_update event so the waiting user's client re-joins
  if (session.claimedResources?.chatRoom) {
    try {
      await getIVSChatClient().send(new SendEventCommand({
        roomIdentifier: session.claimedResources.chatRoom,
        eventName: 'lobby_update',
        attributes: {
          userId: targetUserId,
          action: 'approved',
          approvedBy: actorId,
        },
      }));
    } catch (err: any) {
      logger.warn('Failed to emit lobby_update chat event', { error: err.message });
    }
  }

  return resp(200, {
    status: 'approved',
    userId: targetUserId,
    token: participantToken.token,
    participantId: participantToken.participantId,
    expirationTime: participantToken.expirationTime?.toISOString(),
  });
}
