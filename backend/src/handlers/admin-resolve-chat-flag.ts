/**
 * POST /admin/chat-flags/{sessionId}/{sk}/resolve
 *
 * Admin-only endpoint to approve (dismiss) or reject (bounce) a flagged chat
 * message. `sk` is the base64url-encoded CHATFLAG#... sort key returned by the
 * list endpoint. On 'reject' we invoke the same bounce logic as bounce-user.ts
 * — disconnect the user + write a BOUNCE MOD row.
 *
 * Body: { action: 'approve' | 'reject' }
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DisconnectUserCommand, SendEventCommand } from '@aws-sdk/client-ivschat';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { resolveFlag } from '../repositories/chat-moderation-repository';
import { getSessionById } from '../repositories/session-repository';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({
  serviceName: 'vnl-admin',
  persistentKeys: { handler: 'admin-resolve-chat-flag' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/**
 * The SK is carried in the URL path. API Gateway URL-decodes path parameters
 * once, so a CHATFLAG#... SK (which contains `#`) will arrive as a readable
 * string. We accept it verbatim and guard against injection by requiring the
 * CHATFLAG# prefix.
 */
function normalizeSk(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // fall through with raw
  }
  if (!decoded.startsWith('CHATFLAG#')) return null;
  return decoded;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  const rawSk = event.pathParameters?.sk;
  if (!sessionId) return resp(400, { error: 'sessionId required' });
  if (!rawSk) return resp(400, { error: 'sk required' });

  const sk = normalizeSk(rawSk);
  if (!sk) return resp(400, { error: 'Invalid sk (must be CHATFLAG#...)' });

  let body: { action?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  const action = body.action;
  if (action !== 'approve' && action !== 'reject') {
    return resp(400, { error: "action must be 'approve' or 'reject'" });
  }

  try {
    // Fetch the flag row first — we need userId + session info for 'reject'.
    const flagRow = await getDocumentClient().send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: sk },
      }),
    );
    if (!flagRow.Item) {
      return resp(404, { error: 'Flag not found' });
    }
    const flag = flagRow.Item as any;
    if (flag.entityType !== 'CHAT_FLAG') {
      return resp(400, { error: 'Row is not a CHAT_FLAG' });
    }

    // Mark the flag resolved first so the queue clears even if IVS calls flake.
    await resolveFlag(tableName, sessionId, sk, action, adminUserId);

    if (action === 'approve') {
      logger.info('Approved chat flag (dismissed)', {
        sessionId,
        sk,
        adminUserId,
      });
      return resp(200, { message: 'Flag approved (dismissed)', action });
    }

    // === action === 'reject' -> bounce the offending user ===
    const targetUserId: string | undefined = flag.userId;
    if (!targetUserId) {
      return resp(500, { error: 'Flag row missing userId' });
    }

    const session = await getSessionById(tableName, sessionId);
    const chatRoom = session?.claimedResources?.chatRoom;

    if (chatRoom) {
      // Emit user_kicked event (best-effort).
      try {
        await getIVSChatClient().send(
          new SendEventCommand({
            roomIdentifier: chatRoom,
            eventName: 'user_kicked',
            attributes: {
              userId: targetUserId,
              reason: 'Removed by admin (chat moderation)',
              scope: 'session',
            },
          }),
        );
      } catch (err) {
        logger.warn('SendEvent (user_kicked) on admin reject failed', {
          sessionId,
          targetUserId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // DisconnectUser (best-effort).
      try {
        await getIVSChatClient().send(
          new DisconnectUserCommand({
            roomIdentifier: chatRoom,
            userId: targetUserId,
            reason: 'Removed by admin (chat moderation)',
          }),
        );
      } catch (err: any) {
        if (err?.name !== 'ResourceNotFoundException') {
          logger.warn('DisconnectUser on admin reject failed', {
            sessionId,
            targetUserId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Write BOUNCE MOD row with actionType=ADMIN_BOUNCE (matches task spec).
    const now = new Date().toISOString();
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `MOD#${now}#${uuidv4()}`,
          entityType: 'MODERATION',
          actionType: 'ADMIN_BOUNCE',
          userId: targetUserId,
          actorId: adminUserId,
          sessionId,
          reason: 'Admin rejected chat flag',
          sourceFlagSk: sk,
          createdAt: now,
        },
      }),
    );

    logger.info('Rejected chat flag — user bounced', {
      sessionId,
      sk,
      targetUserId,
      adminUserId,
    });
    return resp(200, { message: 'Flag rejected — user bounced', action, targetUserId });
  } catch (err: any) {
    logger.error('Error resolving chat flag', {
      sessionId,
      sk,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: err.message });
  }
}
