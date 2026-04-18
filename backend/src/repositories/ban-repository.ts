/**
 * Ban repository — consolidates global and per-session chat ban queries.
 *
 * Two row patterns:
 *   1. Global ban: PK=USER#<userId>, SK=GLOBAL_BAN — blocks tokens across ALL sessions.
 *   2. Per-session BOUNCE: PK=SESSION#<sessionId>, SK=MOD#<ts>#<uuid>
 *      with { actionType: 'BOUNCE', userId } — blocks tokens only for that session.
 *
 * Phase 3: `isUserBanned(userId, sessionId)` is the OR of the two, and is the
 * single call used by the chat-token handler going forward.
 */

import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({ serviceName: 'vnl-repository' });

const GLOBAL_BAN_SK = 'GLOBAL_BAN';
const GLOBAL_BAN_GSI5PK = 'GLOBAL_BAN';

export interface GlobalBan {
  userId: string;
  bannedBy: string;
  reason: string;
  bannedAt: string;
  expiresAt?: string;
}

function userPk(userId: string): string {
  return `USER#${userId}`;
}

/**
 * Check whether the user currently has an active (unexpired) global ban.
 */
export async function isUserGloballyBanned(
  tableName: string,
  userId: string,
): Promise<boolean> {
  const docClient = getDocumentClient();
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { PK: userPk(userId), SK: GLOBAL_BAN_SK },
      }),
    );
    if (!result.Item) return false;

    // If expiresAt is set and in the past, treat as not-banned.
    const expiresAt = result.Item.expiresAt as string | undefined;
    if (expiresAt) {
      if (new Date(expiresAt).getTime() <= Date.now()) return false;
    }
    return true;
  } catch (err) {
    logger.error('Error checking global ban', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Per-session bounce check — mirrors the original isBounced logic from
 * create-chat-token.ts. Uses Limit: 1 to short-circuit on the first match.
 */
export async function isUserBannedInSession(
  tableName: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const docClient = getDocumentClient();
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'actionType = :actionType AND #userId = :userId',
        ExpressionAttributeNames: { '#userId': 'userId' },
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':skPrefix': 'MOD#',
          ':actionType': 'BOUNCE',
          ':userId': userId,
        },
        Limit: 1,
      }),
    );
    return (result.Count ?? 0) > 0;
  } catch (err) {
    logger.error('Error checking session bounce', {
      userId,
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Combined check — OR of global ban + per-session bounce. This is the single
 * function the chat-token handler should use going forward.
 */
export async function isUserBanned(
  tableName: string,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  // Check global first — if globally banned, short-circuit without the Query.
  if (await isUserGloballyBanned(tableName, userId)) return true;
  return isUserBannedInSession(tableName, userId, sessionId);
}

/**
 * Create a global ban row for `userId`. Idempotent — overwrites any existing row.
 */
export async function createGlobalBan(
  tableName: string,
  userId: string,
  bannedBy: string,
  reason: string,
  ttlDays?: number,
): Promise<GlobalBan> {
  const bannedAt = new Date().toISOString();
  const expiresAt =
    ttlDays && ttlDays > 0
      ? new Date(Date.now() + ttlDays * 86400 * 1000).toISOString()
      : undefined;

  const item: Record<string, unknown> = {
    PK: userPk(userId),
    SK: GLOBAL_BAN_SK,
    entityType: 'GLOBAL_BAN',
    userId,
    bannedBy,
    reason,
    bannedAt,
    GSI5PK: GLOBAL_BAN_GSI5PK,
    GSI5SK: bannedAt,
  };
  if (expiresAt) item.expiresAt = expiresAt;

  const docClient = getDocumentClient();
  try {
    await docClient.send(
      new PutCommand({ TableName: tableName, Item: item }),
    );
  } catch (err) {
    logger.error('Error creating global ban', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const ban: GlobalBan = { userId, bannedBy, reason, bannedAt };
  if (expiresAt) ban.expiresAt = expiresAt;
  return ban;
}

/**
 * Lift (delete) a user's global ban. Idempotent — deleting a non-existent row
 * is not an error.
 */
export async function liftGlobalBan(
  tableName: string,
  userId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: userPk(userId), SK: GLOBAL_BAN_SK },
      }),
    );
  } catch (err) {
    logger.error('Error lifting global ban', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * List every global ban via GSI5 (GSI5PK = 'GLOBAL_BAN').
 */
export async function listGlobalBans(tableName: string): Promise<GlobalBan[]> {
  const docClient = getDocumentClient();
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        ExpressionAttributeValues: { ':pk': GLOBAL_BAN_GSI5PK },
        ScanIndexForward: false, // newest first
      }),
    );
    return (result.Items ?? []).map((item) => {
      const ban: GlobalBan = {
        userId: item.userId,
        bannedBy: item.bannedBy,
        reason: item.reason,
        bannedAt: item.bannedAt,
      };
      if (item.expiresAt) ban.expiresAt = item.expiresAt;
      return ban;
    });
  } catch (err) {
    logger.error('Error listing global bans', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
