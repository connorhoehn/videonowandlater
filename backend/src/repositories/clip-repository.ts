/**
 * Clip repository — persistence for session clips.
 *
 * Data model (single-table DynamoDB):
 *  Row A (session-scoped): PK=SESSION#{sessionId}, SK=CLIP#{clipId}
 *    Used to list a session's clips and for ownership checks.
 *  Row B (pointer): PK=CLIP#{clipId}, SK=METADATA
 *    Used for direct /clip/:id lookups without knowing the session.
 *  GSI5PK=CLIP_PUBLIC / GSI5SK=createdAt on row A when the session is public,
 *    to power future discovery feeds.
 *  GSI6PK=USER_CLIPS#{authorId} / GSI6SK=createdAt on row A — list the
 *    caller's own clips for the "My Clips" panel (both live + post-session).
 */

import { PutCommand, GetCommand, UpdateCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Clip, ClipStatus, LiveClipStatus } from '../domain/clip';

const CLIP_PUBLIC_GSI_PK = 'CLIP_PUBLIC';
const USER_CLIPS_GSI_PK_PREFIX = 'USER_CLIPS#';

function sessionClipKey(sessionId: string, clipId: string) {
  return { PK: `SESSION#${sessionId}`, SK: `CLIP#${clipId}` };
}

function clipPointerKey(clipId: string) {
  return { PK: `CLIP#${clipId}`, SK: 'METADATA' };
}

function stripKeys<T extends Record<string, any>>(item: T): any {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { PK, SK, GSI5PK, GSI5SK, GSI6PK, GSI6SK, entityType, ...rest } = item;
  return rest;
}

/**
 * Create a clip with both the session-scoped row and the pointer row in one transaction.
 * Fails atomically if either row already exists.
 */
export async function createClip(
  tableName: string,
  clip: Clip,
  opts: { isPublic: boolean }
): Promise<void> {
  const docClient = getDocumentClient();

  const sessionRow: Record<string, any> = {
    ...sessionClipKey(clip.sessionId, clip.clipId),
    entityType: 'CLIP',
    ...clip,
    // GSI6: per-user "My Clips" feed.
    GSI6PK: `${USER_CLIPS_GSI_PK_PREFIX}${clip.authorId}`,
    GSI6SK: clip.createdAt,
  };
  if (opts.isPublic) {
    sessionRow.GSI5PK = CLIP_PUBLIC_GSI_PK;
    sessionRow.GSI5SK = clip.createdAt;
  }

  const pointerRow = {
    ...clipPointerKey(clip.clipId),
    entityType: 'CLIP_POINTER',
    clipId: clip.clipId,
    sessionId: clip.sessionId,
  };

  await docClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: tableName,
          Item: sessionRow,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: pointerRow,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ],
  }));
}

/**
 * Look up a clip by its clipId using the pointer row.
 */
export async function getClipById(tableName: string, clipId: string): Promise<Clip | null> {
  const docClient = getDocumentClient();

  const pointer = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: clipPointerKey(clipId),
  }));

  if (!pointer.Item) return null;
  const sessionId = pointer.Item.sessionId as string;

  const full = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
  }));

  if (!full.Item) return null;
  return stripKeys(full.Item) as Clip;
}

/**
 * Mark a clip as ready (terminal success) and record the S3 key.
 */
export async function markClipReady(
  tableName: string,
  sessionId: string,
  clipId: string,
  s3Key: string
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
    UpdateExpression: 'SET #status = :ready, #s3Key = :s3Key',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#s3Key': 's3Key',
    },
    ExpressionAttributeValues: {
      ':ready': 'ready' satisfies ClipStatus,
      ':s3Key': s3Key,
    },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

/**
 * Mark a clip as failed (terminal).
 */
export async function markClipFailed(
  tableName: string,
  sessionId: string,
  clipId: string
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
    UpdateExpression: 'SET #status = :failed',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':failed': 'failed' satisfies ClipStatus },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

/**
 * Soft-delete a clip (MVP). Leaves the S3 object in place; a lifecycle
 * rule can purge deleted clips later.
 */
export async function softDeleteClip(
  tableName: string,
  sessionId: string,
  clipId: string
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
    // Also remove GSI5 so deleted clips don't surface in the public feed.
    UpdateExpression: 'SET #status = :deleted REMOVE GSI5PK, GSI5SK',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':deleted': 'deleted' satisfies ClipStatus },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

/**
 * List non-deleted clips for a session, newest first.
 */
export async function listClipsBySession(
  tableName: string,
  sessionId: string,
  limit: number = 50
): Promise<Clip[]> {
  const docClient = getDocumentClient();
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    FilterExpression: '#status <> :deleted',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'CLIP#',
      ':deleted': 'deleted' satisfies ClipStatus,
    },
    Limit: safeLimit,
  }));

  const clips = (result.Items ?? []).map((item) => stripKeys(item) as Clip);
  clips.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return clips;
}

/**
 * List non-deleted clips authored by a user (across all sessions), newest first.
 * Backed by GSI6 (USER_CLIPS#{authorId} / createdAt). Returns clips of both
 * flavors (live + postSession).
 */
export async function listClipsByAuthor(
  tableName: string,
  authorId: string,
  limit: number = 50,
): Promise<Clip[]> {
  const docClient = getDocumentClient();
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI6',
    KeyConditionExpression: 'GSI6PK = :pk',
    FilterExpression: '#status <> :deleted',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':pk': `${USER_CLIPS_GSI_PK_PREFIX}${authorId}`,
      ':deleted': 'deleted' satisfies ClipStatus,
    },
    ScanIndexForward: false, // newest first (GSI6SK = createdAt)
    Limit: safeLimit,
  }));

  return (result.Items ?? []).map((item) => stripKeys(item) as Clip);
}

/**
 * Mark a LIVE clip as ready and record its playback URL.
 * Live clips have a simpler lifecycle than post-session ones — no s3Key
 * round-trip through MediaConvert, just an mp4Url produced by the
 * segment-pull Lambda.
 */
export async function markLiveClipReady(
  tableName: string,
  sessionId: string,
  clipId: string,
  mp4Url: string,
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
    UpdateExpression: 'SET #status = :ready, #mp4Url = :mp4Url',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#mp4Url': 'mp4Url',
    },
    ExpressionAttributeValues: {
      ':ready': 'ready' satisfies LiveClipStatus,
      ':mp4Url': mp4Url,
    },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}

/**
 * Mark a LIVE clip as failed (terminal).
 */
export async function markLiveClipFailed(
  tableName: string,
  sessionId: string,
  clipId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: sessionClipKey(sessionId, clipId),
    UpdateExpression: 'SET #status = :failed',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':failed': 'failed' satisfies LiveClipStatus },
    ConditionExpression: 'attribute_exists(PK)',
  }));
}
