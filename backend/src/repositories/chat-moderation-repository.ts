/**
 * Chat moderation flag repository.
 *
 * Flags are written when the classifier marks a chat message as harmful. Rows
 * live on the session partition for session-scoped queries, and project into
 * GSI5 under a single `CHATFLAG_QUEUE` partition for the admin cross-session
 * queue view.
 *
 * PK:     SESSION#<sessionId>
 * SK:     CHATFLAG#<createdAt>#<uuid>
 * GSI5PK: CHATFLAG_QUEUE
 * GSI5SK: <createdAt>
 */

import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({ serviceName: 'vnl-repository', persistentKeys: { repo: 'chat-moderation' } });

export const CHATFLAG_QUEUE_GSI5PK = 'CHATFLAG_QUEUE';

export type ChatFlagStatus = 'pending' | 'resolved';
export type ChatFlagResolutionAction = 'approve' | 'reject';

export interface ChatFlagInput {
  sessionId: string;
  userId: string;
  messageId: string;
  text: string;
  categories: string[];
  confidence: number;
  reasoning: string;
  createdAt?: string;
}

export interface ChatFlag {
  sessionId: string;
  userId: string;
  messageId: string;
  text: string;
  categories: string[];
  confidence: number;
  reasoning: string;
  createdAt: string;
  status: ChatFlagStatus;
  action?: ChatFlagResolutionAction;
  resolvedBy?: string;
  resolvedAt?: string;
  // Raw composite key bits — exposed for admin APIs that round-trip the SK.
  PK: string;
  SK: string;
}

function flagPk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

function flagSk(createdAt: string, id: string): string {
  return `CHATFLAG#${createdAt}#${id}`;
}

/**
 * Write a new pending chat-moderation flag. Returns the composite PK/SK so the
 * caller can surface it in the admin queue.
 */
export async function writeFlag(
  tableName: string,
  input: ChatFlagInput,
): Promise<ChatFlag> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const id = uuidv4();
  const PK = flagPk(input.sessionId);
  const SK = flagSk(createdAt, id);

  const item: Record<string, unknown> = {
    PK,
    SK,
    entityType: 'CHAT_FLAG',
    sessionId: input.sessionId,
    userId: input.userId,
    messageId: input.messageId,
    text: input.text,
    categories: input.categories,
    confidence: input.confidence,
    reasoning: input.reasoning,
    status: 'pending',
    createdAt,
    GSI5PK: CHATFLAG_QUEUE_GSI5PK,
    GSI5SK: createdAt,
  };

  try {
    await getDocumentClient().send(
      new PutCommand({ TableName: tableName, Item: item }),
    );
  } catch (err) {
    logger.error('Failed to write chat flag', {
      sessionId: input.sessionId,
      messageId: input.messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  return {
    PK,
    SK,
    sessionId: input.sessionId,
    userId: input.userId,
    messageId: input.messageId,
    text: input.text,
    categories: input.categories,
    confidence: input.confidence,
    reasoning: input.reasoning,
    createdAt,
    status: 'pending',
  };
}

/**
 * List pending flags across all sessions via GSI5. Newest first.
 */
export async function listPendingFlags(
  tableName: string,
  options: { limit?: number } = {},
): Promise<ChatFlag[]> {
  const limit = options.limit ?? 50;

  try {
    const result = await getDocumentClient().send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': CHATFLAG_QUEUE_GSI5PK,
          ':status': 'pending',
        },
        ScanIndexForward: false, // newest first
        Limit: limit,
      }),
    );
    return (result.Items ?? []).map((item) => mapItemToFlag(item));
  } catch (err) {
    logger.error('Failed to list pending chat flags', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Resolve a pending flag. Sets status='resolved' and records the action +
 * resolving admin. Idempotent — applying the same resolution twice is fine.
 */
export async function resolveFlag(
  tableName: string,
  sessionId: string,
  sk: string,
  action: ChatFlagResolutionAction,
  resolvedBy: string,
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  try {
    await getDocumentClient().send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: flagPk(sessionId), SK: sk },
        UpdateExpression:
          'SET #status = :resolved, #action = :action, resolvedBy = :by, resolvedAt = :at',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#action': 'action',
        },
        ExpressionAttributeValues: {
          ':resolved': 'resolved',
          ':action': action,
          ':by': resolvedBy,
          ':at': resolvedAt,
        },
      }),
    );
  } catch (err) {
    logger.error('Failed to resolve chat flag', {
      sessionId,
      sk,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function mapItemToFlag(item: Record<string, any>): ChatFlag {
  return {
    PK: item.PK,
    SK: item.SK,
    sessionId: item.sessionId,
    userId: item.userId,
    messageId: item.messageId,
    text: item.text,
    categories: Array.isArray(item.categories) ? item.categories : [],
    confidence: typeof item.confidence === 'number' ? item.confidence : 0,
    reasoning: typeof item.reasoning === 'string' ? item.reasoning : '',
    createdAt: item.createdAt,
    status: item.status === 'resolved' ? 'resolved' : 'pending',
    action: item.action,
    resolvedBy: item.resolvedBy,
    resolvedAt: item.resolvedAt,
  };
}
