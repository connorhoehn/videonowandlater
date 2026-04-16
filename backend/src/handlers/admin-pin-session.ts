/**
 * POST /admin/sessions/{sessionId}/pin
 * Admin-only endpoint to pin or unpin a session.
 * Body: { pinned: true } to pin, { pinned: false } to unpin.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { emitSessionEventAtomic } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-pin-session' } });

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

  // 1. Check admin auth
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  // 2. Parse sessionId
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // 3. Parse body
  if (!event.body) return resp(400, { error: 'Request body is required' });

  let pinned: boolean;
  try {
    const body = JSON.parse(event.body);
    if (typeof body.pinned !== 'boolean') {
      return resp(400, { error: 'pinned must be a boolean' });
    }
    pinned = body.pinned;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  try {
    // 4. Get session — return 404 if not found
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const now = new Date().toISOString();

    if (pinned) {
      // 5. Pin session (atomic state change + event)
      await emitSessionEventAtomic(tableName, {
        key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        updateExpression: 'SET isPinned = :pinned, pinnedAt = :at, pinnedBy = :by',
        expressionAttributeValues: { ':pinned': true, ':at': now, ':by': adminUserId },
      }, {
        eventId: uuidv4(), sessionId,
        eventType: SessionEventType.SESSION_PINNED,
        timestamp: now, actorId: adminUserId, actorType: 'user',
        details: { pinned: true },
      });
      logger.info('Session pinned', { sessionId, adminUserId });
    } else {
      // 6. Unpin session (atomic state change + event)
      await emitSessionEventAtomic(tableName, {
        key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        updateExpression: 'REMOVE isPinned, pinnedAt, pinnedBy',
        expressionAttributeValues: {},
      }, {
        eventId: uuidv4(), sessionId,
        eventType: SessionEventType.SESSION_UNPINNED,
        timestamp: now, actorId: adminUserId, actorType: 'user',
        details: { pinned: false },
      });
      logger.info('Session unpinned', { sessionId, adminUserId });
    }

    // 7. Return success
    return resp(200, {
      message: pinned ? 'Session pinned' : 'Session unpinned',
      isPinned: pinned,
    });
  } catch (err: any) {
    logger.error('Error pinning/unpinning session', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
