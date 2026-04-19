/**
 * GET /sessions/:sessionId/live-channel
 *
 * Service-to-service endpoint for vnl-ads. Returns the IVS channel + HLS
 * playback URL for a LIVE broadcast session so MediaTailor can stitch SSAI
 * ads on top.
 *
 * BROADCAST only. HANGOUT sessions return 404 — they use IVS stages (realtime)
 * and have no single channelArn/playbackUrl; SSAI on hangouts is out of scope.
 *
 * Auth: HS256 JWT, iss=vnl-ads, aud=vnl, shared SERVICE_JWT_SECRET.
 *
 * States:
 *   LIVE                             -> 200 { sessionId, channelArn, playbackUrl, state, startedAt, expiresAt }
 *   SCHEDULED | CREATING | ENDED     -> 410 { state }  (short-circuit hint for caller)
 *   unknown sessionId                -> 404
 *   pool item missing (DynamoDB)     -> 503 (caller falls back to no-ad)
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { verifyAdsServiceToken } from '../lib/ads-service-auth';
import { SessionStatus, SessionType } from '../domain/session';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-live-channel' } });

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const DEFAULT_SESSION_TTL_HOURS = 12;

function resp(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: HEADERS, body: JSON.stringify(body) };
}

function deriveExpiresAt(session: { startedAt?: string; scheduledEndsAt?: string }): string {
  if (session.scheduledEndsAt) return session.scheduledEndsAt;
  const anchor = session.startedAt ? new Date(session.startedAt).getTime() : Date.now();
  return new Date(anchor + DEFAULT_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const auth = verifyAdsServiceToken(event);
  if (!auth.ok) {
    return resp(auth.status, { error: auth.error });
  }

  const tableName = process.env.TABLE_NAME!;
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return resp(400, { error: 'sessionId required' });
  }

  const docClient = getDocumentClient();

  const sessionResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
  }));

  if (!sessionResult.Item) {
    return resp(404, { error: 'Session not found' });
  }

  const session = sessionResult.Item as {
    sessionId: string;
    sessionType: SessionType;
    status: SessionStatus;
    claimedResources?: { channel?: string };
    startedAt?: string;
    scheduledEndsAt?: string;
  };

  // Scope: BROADCAST only. HANGOUT has no single channel — return 404 to make
  // the boundary explicit to callers.
  if (session.sessionType !== SessionType.BROADCAST) {
    return resp(404, { error: 'Not a broadcast session' });
  }

  // 410 for any non-LIVE state; carry the state so vnl-ads can short-circuit.
  if (session.status !== SessionStatus.LIVE) {
    return resp(410, { sessionId, state: session.status.toUpperCase() });
  }

  const channelArn = session.claimedResources?.channel;
  if (!channelArn) {
    logger.error('LIVE broadcast missing channelArn', { sessionId });
    return resp(503, { error: 'Channel not yet assigned' });
  }

  const resourceId = channelArn.split('/').pop();
  const poolResult = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `POOL#CHANNEL#${resourceId}`, SK: 'METADATA' },
  }));

  const poolItem = poolResult.Item;
  if (!poolItem || !poolItem.playbackUrl) {
    logger.error('Pool item missing for LIVE channel', { sessionId, resourceId });
    return resp(503, { error: 'Playback URL unavailable' });
  }

  return resp(200, {
    sessionId,
    channelArn,
    playbackUrl: poolItem.playbackUrl,
    state: 'LIVE',
    startedAt: session.startedAt,
    expiresAt: deriveExpiresAt(session),
  });
};
