/**
 * DELETE /groups/{groupId}/members/{userId} — remove a member.
 * Authz: group owner, group admin, or self-remove. Owner cannot be removed.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  getGroupById,
  getMember,
  removeMember,
} from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-remove-member' },
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

  const groupId = event.pathParameters?.groupId;
  const targetUserId = event.pathParameters?.userId;
  if (!groupId || !targetUserId) {
    return resp(400, { error: 'groupId and userId are required' });
  }

  try {
    const { userId: callerId, role } = await identify(event);

    const group = await getGroupById(tableName, groupId);
    if (!group) return resp(404, { error: 'Group not found' });

    if (targetUserId === group.ownerId) {
      return resp(400, {
        error: 'Cannot remove the group owner. Delete the group instead.',
      });
    }

    const callerMember = await getMember(tableName, groupId, callerId);
    const isSelf = callerId === targetUserId;
    const canRemove =
      role === 'admin' ||
      group.ownerId === callerId ||
      callerMember?.groupRole === 'owner' ||
      callerMember?.groupRole === 'admin' ||
      isSelf;

    if (!canRemove) {
      return resp(403, { error: 'Forbidden: cannot remove this member' });
    }

    await removeMember(tableName, groupId, targetUserId);
    logger.info('Member removed', { groupId, targetUserId, by: callerId });
    return resp(200, { message: 'Member removed', userId: targetUserId });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to remove member', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
