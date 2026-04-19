/**
 * User profile repository — display name, handle, bio, avatar.
 *
 * Schema:
 *   PK: USER#<sub>    SK: PROFILE    { userId, displayName?, handle?, bio?, avatarUrl?, updatedAt }
 *   PK: HANDLE#<lowercase-handle>    SK: POINTER    { userId, claimedAt }
 *
 * Handle uniqueness is enforced by a conditional put on the pointer row.
 * Lowercasing means handle lookups are case-insensitive while preserving
 * display casing in the PROFILE row.
 *
 * Stats (followers/following counts) live in a separate STATS row:
 *   PK: USER#<sub>    SK: STATS    { followersCount, followingCount }
 */

import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

export interface UserProfile {
  userId: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  avatarUrl?: string;
  updatedAt?: string;
}

export interface UserStats {
  userId: string;
  followersCount: number;
  followingCount: number;
}

const HANDLE_REGEX = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export function normalizeHandle(h: string): string {
  return h.trim().toLowerCase();
}

export function isValidHandle(h: string): boolean {
  return HANDLE_REGEX.test(normalizeHandle(h));
}

export async function getProfile(tableName: string, userId: string): Promise<UserProfile | null> {
  const res = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
  }));
  if (!res.Item) return null;
  const { PK, SK, ...rest } = res.Item;
  return rest as UserProfile;
}

export async function getProfileByHandle(tableName: string, handle: string): Promise<UserProfile | null> {
  const h = normalizeHandle(handle);
  const ptr = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: { PK: `HANDLE#${h}`, SK: 'POINTER' },
  }));
  if (!ptr.Item?.userId) return null;
  return getProfile(tableName, ptr.Item.userId);
}

/**
 * Upsert profile. If `handle` is supplied and differs from current, atomically
 * claim the new handle (conditional put on HANDLE pointer row) and release the
 * old one if applicable. Throws `HandleTakenError` if the handle is already claimed.
 */
export class HandleTakenError extends Error {
  constructor(public handle: string) { super(`Handle "${handle}" already taken`); }
}

export async function upsertProfile(
  tableName: string,
  userId: string,
  patch: Partial<Omit<UserProfile, 'userId' | 'updatedAt'>>,
): Promise<UserProfile> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  // Handle claim is the tricky part — do it first so we fail fast if taken.
  if (patch.handle !== undefined) {
    if (!isValidHandle(patch.handle)) {
      throw new Error('Invalid handle: must be 2-30 chars, start with alnum, contain [a-z0-9_-] only');
    }
    const newHandle = normalizeHandle(patch.handle);
    const existing = await getProfile(tableName, userId);
    const oldHandle = existing?.handle ? normalizeHandle(existing.handle) : undefined;

    if (newHandle !== oldHandle) {
      // Conditional put: claim new handle only if no pointer row exists.
      try {
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            PK: `HANDLE#${newHandle}`,
            SK: 'POINTER',
            userId,
            claimedAt: now,
            entityType: 'HANDLE_POINTER',
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }));
      } catch (err: any) {
        if (err?.name === 'ConditionalCheckFailedException') {
          throw new HandleTakenError(newHandle);
        }
        throw err;
      }

      // Release the old handle (best-effort — if it fails we have no data loss,
      // just a squatted pointer row).
      if (oldHandle) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { PK: `HANDLE#${oldHandle}`, SK: 'POINTER' },
            UpdateExpression: 'REMOVE userId',
            ConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId },
          }));
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  // Now write the PROFILE row.
  const setExprs: string[] = ['#updatedAt = :now', 'entityType = :t'];
  const exprNames: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const exprValues: Record<string, unknown> = { ':now': now, ':t': 'USER_PROFILE' };

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    setExprs.push(`#${k} = :${k}`);
    exprNames[`#${k}`] = k;
    exprValues[`:${k}`] = k === 'handle' ? normalizeHandle(v as string) : v;
  }

  const res = await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `USER#${userId}`, SK: 'PROFILE' },
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ReturnValues: 'ALL_NEW',
  }));

  const { PK, SK, ...rest } = res.Attributes ?? {};
  return { userId, ...rest } as UserProfile;
}

export async function getStats(tableName: string, userId: string): Promise<UserStats> {
  const res = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: { PK: `USER#${userId}`, SK: 'STATS' },
  }));
  const item = res.Item ?? {};
  return {
    userId,
    followersCount: (item.followersCount as number) ?? 0,
    followingCount: (item.followingCount as number) ?? 0,
  };
}

export async function incrementStat(
  tableName: string,
  userId: string,
  field: 'followersCount' | 'followingCount',
  delta: number,
): Promise<void> {
  await getDocumentClient().send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `USER#${userId}`, SK: 'STATS' },
    UpdateExpression: 'ADD #f :d SET entityType = if_not_exists(entityType, :t)',
    ExpressionAttributeNames: { '#f': field },
    ExpressionAttributeValues: { ':d': delta, ':t': 'USER_STATS' },
  }));
}
