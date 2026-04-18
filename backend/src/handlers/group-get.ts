/**
 * GET /groups/{groupId} — fetch a group's metadata + members.
 * Private groups are only visible to their members.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  getGroupById,
  listMembers,
  getMember,
} from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-get' },
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
    const { userId, role } = await identify(event);

    const group = await getGroupById(tableName, groupId);
    if (!group) return resp(404, { error: 'Group not found' });

    const isMember = !!(await getMember(tableName, groupId, userId));
    const isAdmin = role === 'admin';

    if (group.visibility === 'private' && !isMember && !isAdmin) {
      return resp(403, { error: 'Forbidden: private group' });
    }

    const members = await listMembers(tableName, groupId);
    return resp(200, { group, members });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to get group', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
