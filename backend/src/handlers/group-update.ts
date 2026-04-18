/**
 * PATCH /groups/{groupId} — update group metadata. Owner-only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import { getGroupById, updateGroup } from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-update' },
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

    if (group.ownerId !== userId && role !== 'admin') {
      return resp(403, { error: 'Forbidden: only the owner may update this group' });
    }

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return resp(400, { error: 'Invalid JSON body' });
      }
    }

    const patch: any = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.description === 'string')
      patch.description = body.description.trim();
    if (body.visibility === 'public' || body.visibility === 'private')
      patch.visibility = body.visibility;

    const updated = await updateGroup(tableName, groupId, patch);
    logger.info('Group updated', { groupId, by: userId });
    return resp(200, { group: updated });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to update group', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
