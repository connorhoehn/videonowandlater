/**
 * Invitation repository — session invites in the single-table `vnl-sessions` DynamoDB.
 *
 * Schema:
 *   PK: INVITE#<userId>, SK: <sessionId>
 *     GSI1PK: SESSION#<sessionId>, GSI1SK: INVITE#<userId>   (reverse lookup)
 *   attributes: { sessionId, userId, inviterId, invitedAt,
 *                 source: 'group:<groupId>' | 'direct',
 *                 status: 'pending' | 'accepted' | 'declined' }
 */
import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

export type InvitationStatus = 'pending' | 'accepted' | 'declined';
export type InvitationSource = 'direct' | `group:${string}`;

export interface Invitation {
  sessionId: string;
  userId: string;
  inviterId: string;
  invitedAt: string;
  source: InvitationSource;
  status: InvitationStatus;
}

export interface CreateInvitationInput {
  sessionId: string;
  userId: string;
  inviterId: string;
  source: InvitationSource;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  /** True when a new row was written; false if one already existed (no-op). */
  created: boolean;
}

/**
 * Idempotently create a pending invitation. If an invite row already exists
 * for (userId, sessionId), the existing row is returned and no write happens.
 */
export async function createInvitation(
  tableName: string,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const docClient = getDocumentClient();
  const invitation: Invitation = {
    sessionId: input.sessionId,
    userId: input.userId,
    inviterId: input.inviterId,
    invitedAt: new Date().toISOString(),
    source: input.source,
    status: 'pending',
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `INVITE#${input.userId}`,
          SK: input.sessionId,
          GSI1PK: `SESSION#${input.sessionId}`,
          GSI1SK: `INVITE#${input.userId}`,
          entityType: 'INVITATION',
          ...invitation,
        },
        // Only write if no row exists — makes this idempotent.
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return { invitation, created: true };
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return { invitation, created: false };
    }
    throw err;
  }
}

export interface ListInvitesForUserOptions {
  status?: InvitationStatus;
  limit?: number;
}

/** List invitations addressed to a specific user. */
export async function listInvitesForUser(
  tableName: string,
  userId: string,
  options: ListInvitesForUserOptions = {},
): Promise<Invitation[]> {
  const docClient = getDocumentClient();

  const params: any = {
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `INVITE#${userId}` },
  };

  if (options.status) {
    params.FilterExpression = '#s = :status';
    params.ExpressionAttributeNames = { '#s': 'status' };
    params.ExpressionAttributeValues[':status'] = options.status;
  }

  if (options.limit && options.limit > 0) {
    params.Limit = options.limit;
  }

  const res = await docClient.send(new QueryCommand(params));
  return (res.Items ?? []).map(stripKeys);
}

/** List invitations for a given session (via GSI1 reverse lookup). */
export async function listInvitesForSession(
  tableName: string,
  sessionId: string,
): Promise<Invitation[]> {
  const docClient = getDocumentClient();
  const res = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SESSION#${sessionId}`,
        ':sk': 'INVITE#',
      },
    }),
  );
  return (res.Items ?? []).map(stripKeys);
}

/** Update the status on an existing invite. Returns the updated item (or null). */
export async function updateInviteStatus(
  tableName: string,
  userId: string,
  sessionId: string,
  status: InvitationStatus,
): Promise<Invitation | null> {
  const docClient = getDocumentClient();
  try {
    const res = await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `INVITE#${userId}`, SK: sessionId },
        UpdateExpression: 'SET #s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': status },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    if (!res.Attributes) return null;
    return stripKeys(res.Attributes);
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
}

function stripKeys(item: any): Invitation {
  const { PK, SK, GSI1PK, GSI1SK, entityType, ...rest } = item;
  return rest as Invitation;
}
