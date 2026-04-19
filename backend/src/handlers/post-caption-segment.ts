/**
 * POST /sessions/{sessionId}/captions handler
 *
 * Accepts finalized (or interim) caption segments from the host's browser-side
 * Transcribe Streaming client and broadcasts them to viewers via IVS Chat
 * `SendEvent` using a `caption` event name.
 *
 * Also best-effort persists each segment as a CAPTION row on the session so
 * replay can surface a post-hoc transcript if desired. The row is cheap and
 * opt-in — failures are never fatal to the live broadcast path.
 *
 * Authz: session owner only. Rate-limited per-Lambda-instance to 5 posts/sec
 * per session via an in-memory counter, mirroring the "host-scoped" simple
 * design called out in the feature spec.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'post-caption-segment' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// Maximum caption text length accepted — Transcribe partials rarely exceed this
// and IVS Chat SendEvent has a hard attribute-value cap around 1KB.
const MAX_TEXT_LENGTH = 500;

// Rate limiter — per-session, per-Lambda-instance (host-scoped, good enough for MVP).
// We allow up to RATE_LIMIT_WINDOW captions within any RATE_LIMIT_WINDOW_MS window.
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_WINDOW = 5;
const rateState = new Map<string, number[]>();

function allowByRateLimit(sessionId: string, now: number): boolean {
  const arr = rateState.get(sessionId) ?? [];
  const pruned = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (pruned.length >= RATE_LIMIT_WINDOW) {
    rateState.set(sessionId, pruned);
    return false;
  }
  pruned.push(now);
  rateState.set(sessionId, pruned);
  return true;
}

// Exported for tests so they can reset the limiter state between cases.
export function __resetCaptionRateLimiter() {
  rateState.clear();
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // 1. Auth
  const actorId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!actorId) {
    return resp(401, { error: 'Unauthorized' });
  }

  // 2. Path
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return resp(400, { error: 'sessionId required' });
  }

  // 3. Body
  let text: unknown;
  let startSec: unknown;
  let endSec: unknown;
  let isFinal: unknown;
  let speakerLabel: unknown;
  try {
    const body = JSON.parse(event.body ?? '{}');
    text = body?.text;
    startSec = body?.startSec;
    endSec = body?.endSec;
    isFinal = body?.isFinal;
    speakerLabel = body?.speakerLabel;
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    return resp(400, { error: 'text (non-empty string) required' });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return resp(400, { error: `text must be <= ${MAX_TEXT_LENGTH} characters` });
  }
  if (typeof startSec !== 'number' || typeof endSec !== 'number') {
    return resp(400, { error: 'startSec and endSec (numbers) required' });
  }
  if (typeof isFinal !== 'boolean') {
    return resp(400, { error: 'isFinal (boolean) required' });
  }

  // 4. Session + ownership
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return resp(404, { error: 'Session not found' });
  }
  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can post captions' });
  }

  // 5. Rate limit (host-scoped, in-memory — simple enough for MVP)
  if (!allowByRateLimit(sessionId, Date.now())) {
    return resp(429, { error: 'Too many caption segments; slow down' });
  }

  // 6. Emit IVS Chat caption event so viewers can render live.
  if (session.claimedResources?.chatRoom) {
    try {
      await getIVSChatClient().send(
        new SendEventCommand({
          roomIdentifier: session.claimedResources.chatRoom,
          eventName: 'caption',
          attributes: {
            text,
            startSec: String(startSec),
            endSec: String(endSec),
            isFinal: String(isFinal),
            ...(typeof speakerLabel === 'string' ? { speakerLabel } : {}),
          },
        })
      );
    } catch (err) {
      logger.warn('SendEvent (caption) failed — continuing with best-effort persist', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 7. Persist the caption row (only for finalized segments to keep writes bounded).
  //    Writing interim partials would spam DynamoDB without adding replay value.
  if (isFinal === true) {
    const now = new Date().toISOString();
    try {
      await getDocumentClient().send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: `CAPTION#${now}#${uuidv4()}`,
            entityType: 'CAPTION',
            sessionId,
            text,
            startSec,
            endSec,
            isFinal,
            ...(typeof speakerLabel === 'string' ? { speakerLabel } : {}),
            createdAt: now,
            GSI6PK: `CAPTION_FOR#${sessionId}`,
            // Zero-padded start-time so SK ordering matches playback order
            GSI6SK: String(Math.floor(startSec)).padStart(10, '0'),
          },
        })
      );
    } catch (err) {
      logger.warn('Caption persist failed — broadcast already delivered', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return resp(200, { message: 'Caption broadcast' });
};
