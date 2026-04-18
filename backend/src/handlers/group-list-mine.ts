/**
 * GET /groups/mine — list groups the caller belongs to (via GSI1).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { identify, mapAuthError } from '../lib/authz';
import {
  listGroupsForUser,
  getGroupsByIds,
} from '../repositories/group-repository';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'group-list-mine' },
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
    const memberships = await listGroupsForUser(tableName, userId);
    const groups = await getGroupsByIds(
      tableName,
      memberships.map((m) => m.groupId),
    );

    // Annotate each group with the caller's role.
    const roleByGroupId = new Map(
      memberships.map((m) => [m.groupId, m.groupRole]),
    );
    const annotated = groups.map((g) => ({
      ...g,
      myRole: roleByGroupId.get(g.groupId) ?? 'member',
    }));

    return resp(200, { groups: annotated });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return resp(mapped.statusCode, { error: mapped.message });
    logger.error('Failed to list my groups', {
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, {
      error: err instanceof Error ? err.message : 'Internal error',
    });
  }
}
