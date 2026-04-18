/**
 * POST /groups/{groupId}/members — add a user to a group.
 * Authz: group owner or group admin.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  getGroupById,
  getMember,
  addMember,
} from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-add-member' },
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
  if (!groupId) return resp(400, { error: 'groupId is required' });

  try {
    const { userId: callerId, role } = await identify(event);

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return resp(400, { error: 'Invalid JSON body' });
      }
    }
    const targetUserId =
      typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!targetUserId) return resp(400, { error: 'userId is required' });

    const group = await getGroupById(tableName, groupId);
    if (!group) return resp(404, { error: 'Group not found' });

    const callerMember = await getMember(tableName, groupId, callerId);
    const canInvite =
      role === 'admin' ||
      group.ownerId === callerId ||
      callerMember?.groupRole === 'owner' ||
      callerMember?.groupRole === 'admin';

    if (!canInvite) {
      return resp(403, {
        error: 'Forbidden: only owners or admins may add members',
      });
    }

    const existing = await getMember(tableName, groupId, targetUserId);
    if (existing) {
      return resp(200, { member: existing, alreadyMember: true });
    }

    const member = await addMember(tableName, {
      groupId,
      userId: targetUserId,
      groupRole: 'member',
      addedBy: callerId,
    });

    logger.info('Member added', { groupId, targetUserId, by: callerId });
    return resp(201, { member });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to add member', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
