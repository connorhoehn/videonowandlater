/**
 * POST /sessions/{sessionId}/chat/classify
 *
 * Fire-and-forget chat message moderation. The sender (or any authenticated
 * user) calls this Lambda AFTER their message has already been broadcast via
 * IVS Chat — it runs Bedrock Nova Lite classification, writes a moderation
 * flag row if the model reports harmful content, and emits a `chat_flag` chat
 * event so admin surfaces can react in real time.
 *
 * Auto-bounce: per-session chat strikes are tracked on the session's METADATA
 * row (atomic ADD). When a user reaches 3 strikes we disconnect them from the
 * chat room and write a BOUNCE MOD row using the same shape as `bounce-user`.
 *
 * This endpoint never blocks the send flow — any internal error returns 200
 * with `{ flagged: false, reason: 'classifier-error' }`.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DisconnectUserCommand, SendEventCommand } from '@aws-sdk/client-ivschat';
import { PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById } from '../repositories/session-repository';
import { writeFlag } from '../repositories/chat-moderation-repository';
import { classifyChatMessage } from '../lib/nova-text-moderation';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'classify-chat-message' },
});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

// Threshold above which we treat the model's result as "high confidence".
const FLAG_CONFIDENCE_THRESHOLD = 0.7;
const STRIKE_LIMIT = 3;

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  let body: { messageId?: string; text?: string; rulesetName?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const rulesetName = typeof body.rulesetName === 'string' ? body.rulesetName : undefined;

  if (!messageId) return resp(400, { error: 'messageId required' });
  if (!text) return resp(400, { error: 'text required' });

  try {
    // Idempotency: quick check for a pre-existing flag with this messageId.
    // We keep a compact lookup row at SK=CHATMSG#<messageId>. If present, skip.
    const alreadySeen = await getDocumentClient().send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: `CHATMSG#${messageId}`,
        },
      }),
    );
    if (alreadySeen.Item) {
      return resp(200, { flagged: false, deduped: true });
    }

    // Record the lookup row FIRST so concurrent retries are no-ops. This is
    // best-effort — if it fails we still proceed to classify.
    try {
      await getDocumentClient().send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: `CHATMSG#${messageId}`,
            entityType: 'CHAT_CLASSIFIED',
            sessionId,
            userId,
            messageId,
            createdAt: new Date().toISOString(),
          },
          // Best-effort: only set if not exists.
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (err: any) {
      // ConditionalCheckFailed means another concurrent classification
      // already recorded it — treat as a no-op.
      if (err?.name === 'ConditionalCheckFailedException') {
        return resp(200, { flagged: false, deduped: true });
      }
      logger.warn('Failed to record idempotency row — continuing', {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const classification = await classifyChatMessage(text, rulesetName);

    const shouldFlag =
      classification.flagged && classification.confidence >= FLAG_CONFIDENCE_THRESHOLD;

    if (!shouldFlag) {
      return resp(200, {
        flagged: false,
        confidence: classification.confidence,
        categories: classification.categories,
      });
    }

    // Write flag row.
    const flag = await writeFlag(tableName, {
      sessionId,
      userId,
      messageId,
      text,
      categories: classification.categories,
      confidence: classification.confidence,
      reasoning: classification.reasoning,
    });

    // Load session (needed for chatRoom ARN + strike handling).
    const session = await getSessionById(tableName, sessionId);

    // Emit a `chat_flag` IVS Chat event (best-effort).
    if (session?.claimedResources?.chatRoom) {
      try {
        await getIVSChatClient().send(
          new SendEventCommand({
            roomIdentifier: session.claimedResources.chatRoom,
            eventName: 'chat_flag',
            attributes: {
              userId,
              messageId,
              categories: classification.categories.join(','),
              confidence: String(classification.confidence),
            },
          }),
        );
      } catch (err) {
        logger.warn('SendEvent (chat_flag) failed — continuing', {
          sessionId,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Increment chat strike counter (per-user-per-session) and read back.
    let newStrikes = 1;
    try {
      const res = await getDocumentClient().send(
        new UpdateCommand({
          TableName: tableName,
          Key: {
            PK: `SESSION#${sessionId}`,
            SK: `CHATSTRIKE#${userId}`,
          },
          UpdateExpression: 'ADD #strikes :one SET userId = :uid, sessionId = :sid, updatedAt = :ts',
          ExpressionAttributeNames: { '#strikes': 'strikes' },
          ExpressionAttributeValues: {
            ':one': 1,
            ':uid': userId,
            ':sid': sessionId,
            ':ts': new Date().toISOString(),
          },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      newStrikes = (res.Attributes?.strikes as number) ?? newStrikes;
    } catch (err) {
      logger.warn('Failed to increment chat strike counter', {
        sessionId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Auto-bounce at the strike limit — mirrors bounce-user.ts core logic.
    let bounced = false;
    if (newStrikes >= STRIKE_LIMIT && session?.claimedResources?.chatRoom) {
      bounced = true;
      try {
        await getIVSChatClient().send(
          new SendEventCommand({
            roomIdentifier: session.claimedResources.chatRoom,
            eventName: 'user_kicked',
            attributes: {
              userId,
              reason: 'Chat moderation strikes',
              scope: 'session',
            },
          }),
        );
      } catch (err) {
        logger.warn('SendEvent (user_kicked) on auto-bounce failed', {
          sessionId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await getIVSChatClient().send(
          new DisconnectUserCommand({
            roomIdentifier: session.claimedResources.chatRoom,
            userId,
            reason: 'Chat moderation strikes',
          }),
        );
      } catch (err: any) {
        if (err?.name !== 'ResourceNotFoundException') {
          logger.warn('DisconnectUser on auto-bounce failed', {
            sessionId,
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Write BOUNCE MOD row (same shape as bounce-user.ts).
      const now = new Date().toISOString();
      try {
        await getDocumentClient().send(
          new PutCommand({
            TableName: tableName,
            Item: {
              PK: `SESSION#${sessionId}`,
              SK: `MOD#${now}#${uuidv4()}`,
              entityType: 'MODERATION',
              actionType: 'BOUNCE',
              userId,
              actorId: 'SYSTEM',
              sessionId,
              reason: 'Chat moderation strikes',
              strikeCount: newStrikes,
              createdAt: now,
            },
          }),
        );
      } catch (err) {
        logger.warn('Failed to write BOUNCE MOD row on auto-bounce', {
          sessionId,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return resp(200, {
      flagged: true,
      confidence: classification.confidence,
      categories: classification.categories,
      strikes: newStrikes,
      bounced,
      flagSk: flag.SK,
    });
  } catch (err) {
    // Never propagate errors to the client — we must not break chat.
    logger.error('Unexpected error in classify-chat-message — returning 200', {
      sessionId,
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(200, { flagged: false, error: 'classifier-error' });
  }
};
