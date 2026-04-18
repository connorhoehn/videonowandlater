/**
 * POST /sessions/{sessionId}/invite-group
 *
 * Body: { groupId }
 *
 * Bulk-invite every member of a group to a session. Authz:
 *   - Caller must be the session owner (session.userId === callerUserId).
 *   - Caller must be owner or admin of the group.
 *
 * Writes idempotent INVITE rows via invitation-repository.createInvitation
 * and emits a best-effort `group_invited` chat event for the session's IVS
 * chat room so the host UI can show a live confirmation toast.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import { getSessionById, getHangoutParticipants } from '../repositories/session-repository';
import { getGroupById, getMember, listMembers } from '../repositories/group-repository';
import { createInvitation } from '../repositories/invitation-repository';
import { getIVSChatClient } from '../lib/ivs-clients';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'invite-group-to-session' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  let body: { groupId?: string } = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return resp(400, { error: 'Invalid JSON body' });
    }
  }
  const groupId = typeof body.groupId === 'string' ? body.groupId.trim() : '';
  if (!groupId) return resp(400, { error: 'groupId is required' });

  try {
    const { userId: callerId } = await identify(event);

    // Session must exist and caller must own it.
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });
    if (session.userId !== callerId) {
      return resp(403, {
        error: 'Forbidden: only the session owner can invite a group',
      });
    }

    // Group must exist and caller must be owner/admin of the group.
    const group = await getGroupById(tableName, groupId);
    if (!group) return resp(404, { error: 'Group not found' });

    const callerMember = await getMember(tableName, groupId, callerId);
    const canInvite =
      group.ownerId === callerId ||
      callerMember?.groupRole === 'owner' ||
      callerMember?.groupRole === 'admin';
    if (!canInvite) {
      return resp(403, {
        error: 'Forbidden: only group owners or admins may invite the group',
      });
    }

    const members = await listMembers(tableName, groupId);

    // Skip users who have already joined the hangout (best-effort — only
    // HANGOUT sessions have a PARTICIPANT sub-row schema).
    let alreadyJoined: Set<string> = new Set();
    try {
      const participants = await getHangoutParticipants(tableName, sessionId);
      alreadyJoined = new Set(participants.map((p) => p.userId));
    } catch {
      /* non-blocking; participants just means zero skips from joined set */
    }

    let invitedCount = 0;
    let skippedCount = 0;

    for (const m of members) {
      // Skip the caller themselves.
      if (m.userId === callerId) {
        skippedCount += 1;
        continue;
      }
      if (alreadyJoined.has(m.userId)) {
        skippedCount += 1;
        continue;
      }
      try {
        const result = await createInvitation(tableName, {
          sessionId,
          userId: m.userId,
          inviterId: callerId,
          source: `group:${groupId}`,
        });
        if (result.created) {
          invitedCount += 1;
        } else {
          skippedCount += 1; // already invited — idempotent skip
        }
      } catch (err: any) {
        logger.warn('createInvitation failed', {
          error: err?.message ?? String(err),
          targetUserId: m.userId,
        });
        skippedCount += 1;
      }
    }

    // Best-effort chat event so the host's UI can show a toast.
    const chatRoom = session.claimedResources?.chatRoom;
    if (chatRoom && invitedCount > 0) {
      try {
        await getIVSChatClient().send(
          new SendEventCommand({
            roomIdentifier: chatRoom,
            eventName: 'group_invited',
            attributes: {
              groupId,
              count: String(invitedCount),
              inviterId: callerId,
            },
          }),
        );
      } catch (err: any) {
        logger.warn('Failed to emit group_invited chat event', {
          error: err?.message ?? String(err),
        });
      }
    }

    logger.info('Group invited to session', {
      sessionId,
      groupId,
      invitedCount,
      skippedCount,
    });
    return resp(200, { invitedCount, skippedCount });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('invite-group-to-session failed', {
      error: err instanceof Error ? err.message : String(err),
      sessionId,
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
