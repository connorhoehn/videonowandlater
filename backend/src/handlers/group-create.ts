/**
 * POST /groups — create a new user-owned group.
 * Any authenticated user may call this; caller becomes the group owner.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import { createGroup } from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-create' },
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

  try {
    const { userId } = await identify(event);

    let body: any = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        return resp(400, { error: 'Invalid JSON body' });
      }
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return resp(400, { error: 'name is required' });
    const description =
      typeof body.description === 'string' ? body.description.trim() : undefined;
    const visibility =
      body.visibility === 'public' ? 'public' : 'private';

    const group = await createGroup(tableName, {
      ownerId: userId,
      name,
      description,
      visibility,
    });

    logger.info('Group created', { groupId: group.groupId, ownerId: userId });
    return resp(201, { group });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to create group', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
