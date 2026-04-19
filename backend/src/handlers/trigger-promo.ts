/**
 * POST /sessions/{sessionId}/promo/trigger handler
 *
 * Host-only. Body: `{ creativeId, triggerType: 'manual' }`.
 * 1. Calls vnl-ads triggerAd → overlay payload.
 * 2. Broadcasts the overlay:
 *    - BROADCAST sessions → IVS `PutMetadataCommand` on `session.channelArn`
 *    - HANGOUT  sessions → IVS Chat `SendEventCommand` (eventName: `ad_overlay`)
 *      on `session.claimedResources.chatRoom`.
 * 3. Best-effort: log errors but always 200 to caller with `{ delivered }`.
 *
 * IVS PutMetadata has a 1KB payload cap — we truncate defensively.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { PutMetadataCommand } from '@aws-sdk/client-ivs';
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSClient, getIVSChatClient } from '../lib/ivs-clients';
import { getSessionById } from '../repositories/session-repository';
import { SessionType } from '../domain/session';
import { triggerAd, adsEnabled, type OverlayPayload } from '../lib/ad-service-client';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'trigger-promo' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

// IVS PutMetadata payload cap is 1KB (1024 bytes).
const IVS_METADATA_MAX_BYTES = 1024;

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

/**
 * Serialize overlay payload with the `type: 'ad'` envelope, and truncate keys
 * if the resulting JSON exceeds IVS's 1KB cap. Returns the final string and
 * whether truncation occurred.
 */
export function serializeOverlayForIvs(payload: OverlayPayload): { json: string; truncated: boolean } {
  // Envelope adds an outer `type: 'ad'` and preserves the upstream type under
  // `overlayType` so viewers can distinguish sponsor banner vs product pin.
  const { type: innerType, ...rest } = payload;
  const envelope = { type: 'ad', overlayType: innerType, ...rest };
  const json = JSON.stringify(envelope);
  if (Buffer.byteLength(json, 'utf8') <= IVS_METADATA_MAX_BYTES) {
    return { json, truncated: false };
  }
  // Drop non-essential fields progressively — in practice vnl-ads should send
  // compact payloads, but we never want PutMetadata to throw on size.
  const minimal = { type: 'ad', creativeId: rest.creativeId, overlayType: innerType };
  return { json: JSON.stringify(minimal), truncated: true };
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const actorId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!actorId) return resp(401, { error: 'Unauthorized' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId required' });

  let creativeId: string | undefined;
  let triggerType: 'manual' | 'scheduled' = 'manual';
  try {
    const body = JSON.parse(event.body ?? '{}');
    creativeId = body?.creativeId;
    if (body?.triggerType === 'scheduled') triggerType = 'scheduled';
  } catch {
    return resp(400, { error: 'Invalid request body' });
  }
  if (!creativeId) return resp(400, { error: 'creativeId required' });

  const session = await getSessionById(tableName, sessionId);
  if (!session) return resp(404, { error: 'Session not found' });

  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can trigger promotions' });
  }

  // Feature-flag off → nothing to deliver. Caller gets {delivered: false}.
  if (!adsEnabled()) {
    return resp(200, { delivered: false, reason: 'ads_disabled' });
  }

  const outcome = await triggerAd({
    creativeId,
    sessionId,
    creatorId: session.userId,
    triggerType,
  });
  // v0.3: overlayPayload can be null with an explicit reason ('cap_reached',
  // 'schedule_out_of_window', 'no_creative'). Surface it verbatim so telemetry
  // sees why nothing was broadcast.
  if (!outcome.overlayPayload) {
    return resp(200, {
      delivered: false,
      reason: outcome.reason ?? 'no_overlay',
    });
  }

  const overlayWithCreative: OverlayPayload = { ...outcome.overlayPayload, creativeId };
  const { json: metadataJson, truncated } = serializeOverlayForIvs(overlayWithCreative);
  if (truncated) {
    logger.warn('Overlay payload exceeded 1KB — truncated for IVS PutMetadata', {
      sessionId,
      creativeId,
      originalBytes: Buffer.byteLength(JSON.stringify(overlayWithCreative), 'utf8'),
    });
  }

  let delivered = false;

  if (session.sessionType === SessionType.BROADCAST) {
    if (!session.channelArn) {
      logger.warn('BROADCAST session has no channelArn — cannot PutMetadata', { sessionId });
      return resp(200, { delivered: false, reason: 'no_channel' });
    }
    try {
      await getIVSClient().send(
        new PutMetadataCommand({
          channelArn: session.channelArn,
          metadata: metadataJson,
        }),
      );
      delivered = true;
    } catch (err) {
      logger.warn('PutMetadata failed — ad overlay not broadcast', {
        sessionId,
        creativeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (session.sessionType === SessionType.HANGOUT) {
    const room = session.claimedResources?.chatRoom;
    if (!room) {
      logger.warn('HANGOUT session has no chatRoom — cannot SendEvent', { sessionId });
      return resp(200, { delivered: false, reason: 'no_chat_room' });
    }
    try {
      // IVS Chat SendEvent.attributes must be Record<string, string>. Pass the
      // overlay payload as a stringified JSON blob so the viewer can parse.
      await getIVSChatClient().send(
        new SendEventCommand({
          roomIdentifier: room,
          eventName: 'ad_overlay',
          attributes: { payload: metadataJson },
        }),
      );
      delivered = true;
    } catch (err) {
      logger.warn('SendEvent (ad_overlay) failed — ad overlay not broadcast', {
        sessionId,
        creativeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.info('Session type does not support live overlays', {
      sessionId,
      sessionType: session.sessionType,
    });
    return resp(200, { delivered: false, reason: 'unsupported_session_type' });
  }

  return resp(200, { delivered });
};
