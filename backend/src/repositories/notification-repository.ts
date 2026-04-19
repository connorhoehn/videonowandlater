/**
 * Per-user notification inbox.
 *
 * Schema:
 *   PK: USER#<recipientId>    SK: NOTIF#<createdAt>#<uuid>
 *   { type, subject, payload, createdAt, seen?: boolean, readAt?: ISO }
 *     GSI5PK: USER_UNREAD#<recipientId>   GSI5SK: <createdAt>  (only when !seen)
 *     — set to undefined once seen to drop the row from the unread index.
 *
 * Supported types (extend as needed):
 *   'creator_live'   — a creator you follow went live
 *   'session_invite' — bridged from existing INVITE flow (not required, just an example)
 *   'ad_overlay'     — placeholder
 */

import { QueryCommand, UpdateCommand, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { v4 as uuidv4 } from 'uuid';

export interface Notification {
  recipientId: string;
  notificationId: string;
  createdAt: string;
  type: string;
  subject: string;
  payload: Record<string, unknown>;
  seen: boolean;
  readAt?: string;
}

export async function writeNotification(
  tableName: string,
  recipientId: string,
  n: { type: string; subject: string; payload?: Record<string, unknown> },
): Promise<Notification> {
  const createdAt = new Date().toISOString();
  const notificationId = uuidv4();
  const sk = `NOTIF#${createdAt}#${notificationId}`;
  await getDocumentClient().send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `USER#${recipientId}`,
      SK: sk,
      GSI5PK: `USER_UNREAD#${recipientId}`,
      GSI5SK: createdAt,
      entityType: 'NOTIFICATION',
      notificationId,
      recipientId,
      type: n.type,
      subject: n.subject,
      payload: n.payload ?? {},
      createdAt,
      seen: false,
    },
  }));
  return {
    recipientId,
    notificationId,
    createdAt,
    type: n.type,
    subject: n.subject,
    payload: n.payload ?? {},
    seen: false,
  };
}

/**
 * Fan-out writer. Used by the go-live notifier when N followers need the same
 * notification delivered. BatchWrite handles up to 25 per request.
 */
export async function fanOutNotification(
  tableName: string,
  recipientIds: string[],
  n: { type: string; subject: string; payload?: Record<string, unknown> },
): Promise<number> {
  if (recipientIds.length === 0) return 0;
  const createdAt = new Date().toISOString();
  const docClient = getDocumentClient();

  // BatchWrite has a hard limit of 25 items per call.
  let written = 0;
  for (let i = 0; i < recipientIds.length; i += 25) {
    const chunk = recipientIds.slice(i, i + 25);
    const items = chunk.map((rid) => {
      const notificationId = uuidv4();
      return {
        PutRequest: {
          Item: {
            PK: `USER#${rid}`,
            SK: `NOTIF#${createdAt}#${notificationId}`,
            GSI5PK: `USER_UNREAD#${rid}`,
            GSI5SK: createdAt,
            entityType: 'NOTIFICATION',
            notificationId,
            recipientId: rid,
            type: n.type,
            subject: n.subject,
            payload: n.payload ?? {},
            createdAt,
            seen: false,
          },
        },
      };
    });
    await docClient.send(new BatchWriteCommand({
      RequestItems: { [tableName]: items },
    }));
    written += items.length;
  }
  return written;
}

export async function listNotifications(
  tableName: string,
  userId: string,
  opts: { onlyUnread?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const limit = opts.limit ?? 50;
  if (opts.onlyUnread) {
    const res = await getDocumentClient().send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI5',
      KeyConditionExpression: 'GSI5PK = :pk',
      ExpressionAttributeValues: { ':pk': `USER_UNREAD#${userId}` },
      ScanIndexForward: false,
      Limit: limit,
    }));
    return (res.Items ?? []).map(rowToNotif);
  }
  const res = await getDocumentClient().send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'NOTIF#' },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (res.Items ?? []).map(rowToNotif);
}

function rowToNotif(item: Record<string, unknown>): Notification {
  return {
    recipientId: item.recipientId as string,
    notificationId: item.notificationId as string,
    createdAt: item.createdAt as string,
    type: item.type as string,
    subject: item.subject as string,
    payload: (item.payload as Record<string, unknown>) ?? {},
    seen: (item.seen as boolean) ?? false,
    readAt: item.readAt as string | undefined,
  };
}

export async function markRead(
  tableName: string,
  userId: string,
  notificationId: string,
  createdAt: string,
): Promise<void> {
  const sk = `NOTIF#${createdAt}#${notificationId}`;
  // REMOVE the unread-GSI projection to drop the row from the unread index.
  await getDocumentClient().send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `USER#${userId}`, SK: sk },
    UpdateExpression: 'SET seen = :t, readAt = :now REMOVE GSI5PK, GSI5SK',
    ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
  }));
}
