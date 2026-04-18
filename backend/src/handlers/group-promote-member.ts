/**
 * PATCH /groups/{groupId}/members/{userId} — change a member's role.
 * Authz: group owner only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  getGroupById,
  getMember,
  promoteMember,
} from '../repositories/group-repository';
import type { GroupRole } from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-promote-member' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

function isValidRole(value: unknown): value is GroupRole {
  return value === 'admin' || value === 'member';
  // 'owner' is intentionally not settable via PATCH — ownership transfer
  // would need its own endpoint with additional safeguards.
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

    if (group.ownerId !== callerId && role !== 'admin') {
      return resp(403, {
        error: 'Forbidden: only the owner may promote members',
      });
    }
    if (targetUserId === group.ownerId) {
      return resp(400, { error: 'Cannot change role of the owner' });
    }

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return resp(400, { error: 'Invalid JSON body' });
      }
    }

    if (!isValidRole(body.groupRole)) {
      return resp(400, { error: 'groupRole must be "admin" or "member"' });
    }

    const existing = await getMember(tableName, groupId, targetUserId);
    if (!existing) return resp(404, { error: 'Member not found' });

    const updated = await promoteMember(
      tableName,
      groupId,
      targetUserId,
      body.groupRole,
    );
    logger.info('Member promoted', {
      groupId,
      targetUserId,
      newRole: body.groupRole,
      by: callerId,
    });
    return resp(200, { member: updated });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to promote member', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
