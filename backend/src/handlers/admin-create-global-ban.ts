/**
 * POST /admin/bans
 * Admin-only endpoint to create a global chat ban for a user.
 * Body: { userId: string, reason: string, ttlDays?: number }
 *
 * Side effects:
 *   - Writes a GLOBAL_BAN row (via ban-repository.createGlobalBan).
 *   - Best-effort: if the request includes `activeRoomIdentifier`, fires a
 *     `user_kicked` event + DisconnectUser on that room. For MVP we do NOT
 *     scan every active room the user might be in — the global ban denies
 *     new chat tokens on their next reconnect, which is sufficient.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DisconnectUserCommand, SendEventCommand } from '@aws-sdk/client-ivschat';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { createGlobalBan } from '../repositories/ban-repository';
import { getIVSChatClient } from '../lib/ivs-clients';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-create-global-ban' },
});

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

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  let body: any;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const ttlDaysRaw = body?.ttlDays;
  const ttlDays =
    typeof ttlDaysRaw === 'number' && ttlDaysRaw > 0 ? Math.floor(ttlDaysRaw) : undefined;
  const activeRoomIdentifier: string | undefined =
    typeof body?.activeRoomIdentifier === 'string' ? body.activeRoomIdentifier : undefined;

  if (!userId) return resp(400, { error: 'userId required' });
  if (!reason) return resp(400, { error: 'reason required' });

  try {
    const ban = await createGlobalBan(tableName, userId, adminUserId, reason, ttlDays);
    logger.info('Created global ban', { userId, adminUserId, ttlDays });

    // Best-effort: boot the user from the currently-known active room.
    if (activeRoomIdentifier) {
      const chatClient = getIVSChatClient();
      try {
        await chatClient.send(
          new SendEventCommand({
            roomIdentifier: activeRoomIdentifier,
            eventName: 'user_kicked',
            attributes: {
              userId,
              reason,
              scope: 'global',
            },
          }),
        );
      } catch (err) {
        logger.warn('SendEvent (user_kicked / global) failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        await chatClient.send(
          new DisconnectUserCommand({
            roomIdentifier: activeRoomIdentifier,
            userId,
            reason: `Globally banned: ${reason}`,
          }),
        );
      } catch (err: any) {
        if (err?.name !== 'ResourceNotFoundException') {
          logger.warn('DisconnectUser (global ban) failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return resp(201, { ban });
  } catch (err: any) {
    logger.error('Error creating global ban', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
