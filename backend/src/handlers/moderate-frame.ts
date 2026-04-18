/**
 * S3 ObjectCreated handler for moderation-frames bucket.
 *
 * Flow:
 *   1. Parse sessionId + userId from key `moderation-frames/session-<id>/participant-<userId>/<ts>.jpg`
 *   2. Load session → get rulesetName + pinned rulesetVersion
 *   3. Load ruleset (at the pinned version — never CURRENT at runtime)
 *   4. Fetch image from S3
 *   5. Invoke Nova Lite
 *   6. If flagged above severity threshold:
 *      - Increment moderationStrikes
 *      - Write MOD row (AUTO_MOD_IMAGE)
 *      - If strikes >= 3: auto-bounce (hangout) or stop stream (broadcast)
 *      - Emit moderation_violation chat event
 *   7. Delete S3 object
 */

import type { S3Event, S3EventRecord } from 'aws-lambda';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DisconnectUserCommand, IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import {
  IVSRealTimeClient,
  DisconnectParticipantCommand,
} from '@aws-sdk/client-ivs-realtime';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById, getHangoutParticipants } from '../repositories/session-repository';
import { getRuleset } from '../repositories/ruleset-repository';
import { classifyImage } from '../lib/nova-moderation';
import { thresholdForSeverity } from '../domain/ruleset';
import { SessionType } from '../domain/session';
import { emitSessionEvent } from '../lib/emit-session-event';
import { SessionEventType } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-moderation', persistentKeys: { handler: 'moderate-frame' } });

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}
let ivsChat: IvschatClient | null = null;
function getIvsChat(): IvschatClient {
  if (!ivsChat) ivsChat = new IvschatClient({});
  return ivsChat;
}
let ivsRealtime: IVSRealTimeClient | null = null;
function getIvsRealtime(): IVSRealTimeClient {
  if (!ivsRealtime) ivsRealtime = new IVSRealTimeClient({});
  return ivsRealtime;
}
let ivs: IvsClient | null = null;
function getIvs(): IvsClient {
  if (!ivs) ivs = new IvsClient({});
  return ivs;
}

const STRIKE_LIMIT = 3;

interface ParsedKey {
  sessionId: string;
  userId: string;
}

export function parseModerationKey(key: string): ParsedKey | null {
  // Supports multi-segment userIds (some Cognito usernames include hyphens/underscores)
  const match = /^moderation-frames\/session-([^/]+)\/participant-([^/]+)\/[^/]+\.jpg$/.exec(key);
  if (!match) return null;
  return { sessionId: match[1], userId: match[2] };
}

async function streamToUint8Array(body: any): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (typeof body.transformToByteArray === 'function') {
    return body.transformToByteArray();
  }
  // Fallback: node stream
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

async function processRecord(record: S3EventRecord, tableName: string, modelId: string): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

  const parsed = parseModerationKey(key);
  if (!parsed) {
    logger.warn('Key did not match moderation pattern — skipping', { bucket, key });
    return;
  }
  const { sessionId, userId } = parsed;

  // 1. Load session
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    logger.warn('Session not found — deleting orphan frame', { sessionId });
    await safeDelete(bucket, key);
    return;
  }

  const rulesetName = (session as any).rulesetName as string | undefined;
  const rulesetVersion = (session as any).rulesetVersion as number | undefined;
  if (!rulesetName || rulesetVersion === undefined) {
    logger.info('Session has no pinned ruleset — skipping frame', { sessionId });
    await safeDelete(bucket, key);
    return;
  }

  // 2. Load ruleset (pinned version — never CURRENT)
  const ruleset = await getRuleset(tableName, rulesetName, rulesetVersion);
  if (!ruleset) {
    logger.warn('Ruleset version missing — skipping frame', { sessionId, rulesetName, rulesetVersion });
    await safeDelete(bucket, key);
    return;
  }

  // 3. Fetch image
  let imageBytes: Uint8Array;
  try {
    const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    imageBytes = await streamToUint8Array(res.Body);
  } catch (err) {
    logger.error('Failed to fetch moderation frame from S3', {
      bucket, key, error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 4. Invoke Nova Lite
  const classification = await classifyImage(modelId, ruleset, imageBytes);
  logger.info('Nova classification', {
    sessionId, userId, rulesetName, rulesetVersion,
    flagged: classification.flagged, confidence: classification.confidence,
    items: classification.items,
  });

  const threshold = thresholdForSeverity(ruleset.severity);
  const shouldAct = classification.flagged && classification.confidence >= threshold;

  if (shouldAct) {
    await handleFlaggedFrame({
      tableName, session, userId, ruleset, key, classification,
    });
  }

  // 5. Delete object (lifecycle rule is a backup; clean up proactively)
  await safeDelete(bucket, key);
}

async function handleFlaggedFrame(args: {
  tableName: string;
  session: any;
  userId: string;
  ruleset: any;
  key: string;
  classification: { flagged: boolean; items: string[]; confidence: number; reasoning: string };
}) {
  const { tableName, session, userId, ruleset, key, classification } = args;
  const sessionId = session.sessionId;
  const docClient = getDocumentClient();
  const createdAt = new Date().toISOString();

  // Increment strike counter atomically and read back new count
  let newStrikes = 1;
  try {
    const res = await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'ADD #strikes :one SET #version = #version + :one',
        ExpressionAttributeNames: {
          '#strikes': 'moderationStrikes',
          '#version': 'version',
        },
        ExpressionAttributeValues: { ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    newStrikes = (res.Attributes?.moderationStrikes as number) ?? newStrikes;
  } catch (err) {
    logger.warn('Failed to increment strike counter', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Write MOD row
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `SESSION#${sessionId}`,
        SK: `MOD#${createdAt}#${uuidv4()}`,
        entityType: 'MODERATION',
        actionType: 'AUTO_MOD_IMAGE',
        actorId: 'SYSTEM',
        userId,
        sessionId,
        createdAt,
        rulesetName: ruleset.name,
        rulesetVersion: ruleset.version,
        items: classification.items,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        imageKey: key,
        strikeCount: newStrikes,
        GSI5PK: 'MODERATION',
        GSI5SK: createdAt,
      },
    }),
  );

  // Emit chat violation event
  if (session.claimedResources?.chatRoom) {
    try {
      await getIvsChat().send(
        new SendEventCommand({
          roomIdentifier: session.claimedResources.chatRoom,
          eventName: 'moderation_violation',
          attributes: {
            userId,
            items: classification.items.join(', '),
            confidence: String(classification.confidence),
            strikeCount: String(newStrikes),
          },
        }),
      );
    } catch (err) {
      logger.warn('SendEvent (moderation_violation) failed', {
        sessionId, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Emit durable session event (non-blocking)
  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId,
      eventType: SessionEventType.MODERATION_FLAGGED,
      timestamp: createdAt,
      actorId: 'SYSTEM',
      actorType: 'system',
      details: {
        userId,
        rulesetName: ruleset.name,
        rulesetVersion: ruleset.version,
        items: classification.items,
        confidence: classification.confidence,
        strikeCount: newStrikes,
      },
    });
  } catch { /* non-blocking */ }

  if (newStrikes >= STRIKE_LIMIT) {
    await bounceUser({ tableName, session, userId, reason: 'Content moderation violations' });
  }
}

/**
 * Auto-bounce: for hangouts, disconnect the offending participant; for broadcasts,
 * stop the stream (only one streamer). Writes a BOUNCE MOD row.
 */
async function bounceUser(args: {
  tableName: string;
  session: any;
  userId: string;
  reason: string;
}) {
  const { tableName, session, userId, reason } = args;
  const sessionId = session.sessionId;
  const createdAt = new Date().toISOString();

  try {
    if (session.sessionType === SessionType.HANGOUT && session.stageArn) {
      const participants = await getHangoutParticipants(tableName, sessionId);
      const target = participants.find((p) => p.userId === userId);
      if (target) {
        await getIvsRealtime().send(
          new DisconnectParticipantCommand({
            stageArn: session.stageArn,
            participantId: target.participantId,
            reason,
          }),
        );
      }
      // Also remove from chat room
      if (session.claimedResources?.chatRoom) {
        try {
          await getIvsChat().send(
            new DisconnectUserCommand({
              roomIdentifier: session.claimedResources.chatRoom,
              userId,
              reason,
            }),
          );
        } catch { /* best-effort */ }
      }
    } else if (session.sessionType === SessionType.BROADCAST && session.channelArn) {
      try {
        await getIvs().send(new StopStreamCommand({ channelArn: session.channelArn }));
      } catch (err) {
        logger.warn('StopStream failed during auto-bounce', {
          sessionId, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.warn('Disconnect failed during auto-bounce', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
  }

  // Write BOUNCE audit row
  try {
    await getDocumentClient().send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `MOD#${createdAt}#${uuidv4()}`,
          entityType: 'MODERATION',
          actionType: 'BOUNCE',
          actorId: 'SYSTEM',
          userId,
          sessionId,
          createdAt,
          reason,
          GSI5PK: 'MODERATION',
          GSI5SK: createdAt,
        },
      }),
    );
  } catch (err) {
    logger.warn('Failed to write BOUNCE audit row', {
      sessionId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeDelete(bucket: string, key: string): Promise<void> {
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    logger.warn('Failed to delete moderation frame', {
      bucket, key, error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handler(event: S3Event): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  const modelId = process.env.NOVA_MODEL_ID || 'amazon.nova-lite-v1:0';
  if (!tableName) {
    logger.error('TABLE_NAME not set');
    return;
  }

  for (const record of event.Records) {
    try {
      await processRecord(record, tableName, modelId);
    } catch (err) {
      logger.error('Failed to process moderation record', {
        key: record.s3?.object?.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
