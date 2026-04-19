/**
 * POST /sessions handler - create new session by claiming pool resources
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SessionType } from '../domain/session';
import { createNewSession } from '../services/session-service';
import { createStorySession } from '../repositories/story-repository';
import { emitSessionEvent } from '../lib/emit-session-event';
import { startAdsSession } from '../lib/ad-service-client';
import { SessionEventType } from '../domain/session-event';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getCurrentVersion, getRuleset } from '../repositories/ruleset-repository';
import { v4 as uuidv4 } from 'uuid';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Parse request body
  let body: {
    sessionType: SessionType;
    requireApproval?: boolean;
    moderationEnabled?: boolean;
    rulesetName?: string;
    captionsEnabled?: boolean;
    // Phase 1: Session metadata for discovery + search
    title?: string;
    description?: string;
    tags?: string[];
    visibility?: 'public' | 'unlisted' | 'private';
    // Phase 5: scheduled sessions (Facebook/Meetup events)
    scheduledFor?: string;
    scheduledEndsAt?: string;
    coverImageUrl?: string;
  };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  if (!body.sessionType || !['BROADCAST', 'HANGOUT', 'STORY'].includes(body.sessionType)) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'sessionType required (BROADCAST, HANGOUT, or STORY)' }),
    };
  }

  // Phase 5: validate scheduledFor is >= 15 min in the future
  const MIN_SCHEDULE_LEAD_MS = 15 * 60 * 1000;
  if (body.scheduledFor) {
    const scheduledMs = Date.parse(body.scheduledFor);
    if (Number.isNaN(scheduledMs)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'scheduledFor must be a valid ISO 8601 timestamp' }),
      };
    }
    if (scheduledMs - Date.now() < MIN_SCHEDULE_LEAD_MS) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'scheduledFor must be at least 15 minutes in the future' }),
      };
    }
    // STORY sessions cannot be scheduled (no IVS path)
    if (body.sessionType === SessionType.STORY) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'STORY sessions cannot be scheduled' }),
      };
    }
  }

  // STORY sessions don't need IVS resources — use dedicated story path
  if (body.sessionType === SessionType.STORY) {
    const session = await createStorySession(tableName, userId);

    try {
      await emitSessionEvent(tableName, {
        eventId: uuidv4(), sessionId: session.sessionId, eventType: SessionEventType.SESSION_CREATED,
        timestamp: new Date().toISOString(), actorId: userId,
        actorType: 'user', details: { sessionType: body.sessionType },
      });
    } catch { /* non-blocking */ }

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(session),
    };
  }

  // Phase 4: pin ruleset version + tunables at session start if moderation enabled
  let rulesetName: string | undefined;
  let rulesetVersion: number | undefined;
  let frameIntervalSec: number | undefined;
  let autoBounceThreshold: number | undefined;
  if (body.moderationEnabled && body.rulesetName) {
    try {
      const version = await getCurrentVersion(tableName, body.rulesetName);
      if (version === null) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: `Unknown ruleset: ${body.rulesetName}` }),
        };
      }
      rulesetName = body.rulesetName;
      rulesetVersion = version;
      const ruleset = await getRuleset(tableName, body.rulesetName, version);
      if (ruleset) {
        frameIntervalSec = ruleset.frameIntervalSec;
        autoBounceThreshold = ruleset.autoBounceThreshold;
      }
    } catch (err) {
      // Non-blocking: fail closed only on validation error above; treat loader errors as soft-fail
    }
  }

  const result = await createNewSession(tableName, {
    userId,
    sessionType: body.sessionType,
    moderationEnabled: Boolean(body.moderationEnabled && rulesetName && rulesetVersion !== undefined),
    rulesetName,
    rulesetVersion,
    frameIntervalSec,
    autoBounceThreshold,
    // Live captions flag — only persisted when explicitly true; default is off
    captionsEnabled: body.captionsEnabled === true,
    // Phase 5: scheduled sessions
    scheduledFor: body.scheduledFor,
    scheduledEndsAt: body.scheduledEndsAt,
    title: body.title,
    description: body.description,
    coverImageUrl: body.coverImageUrl,
  });

  if (result.error) {
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': '60',
      },
      body: JSON.stringify({ error: result.error }),
    };
  }

  // Phase 2: Hangout lobbies — persist requireApproval flag on HANGOUT sessions
  const requireApproval = body.requireApproval === true && body.sessionType === SessionType.HANGOUT;
  if (requireApproval) {
    try {
      await getDocumentClient().send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${result.sessionId}`, SK: 'METADATA' },
        UpdateExpression: 'SET #requireApproval = :val',
        ExpressionAttributeNames: { '#requireApproval': 'requireApproval' },
        ExpressionAttributeValues: { ':val': true },
      }));
    } catch { /* non-blocking, default is no approval */ }
  }

  // Phase 1: Persist session metadata (title / description / tags / visibility).
  // Unlisted by default — aligns with pre-Phase-1 sessions that had no metadata.
  const visibility: 'public' | 'unlisted' | 'private' =
    body.visibility === 'public' || body.visibility === 'private' ? body.visibility : 'unlisted';
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : undefined;
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : undefined;
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 40).slice(0, 10)
    : undefined;
  if (title || description || tags || visibility !== 'unlisted') {
    try {
      const setExprs: string[] = ['#visibility = :visibility'];
      const names: Record<string, string> = { '#visibility': 'visibility' };
      const values: Record<string, unknown> = { ':visibility': visibility };
      if (title) { setExprs.push('#title = :title'); names['#title'] = 'title'; values[':title'] = title; }
      if (description) { setExprs.push('#description = :description'); names['#description'] = 'description'; values[':description'] = description; }
      if (tags && tags.length > 0) { setExprs.push('#tags = :tags'); names['#tags'] = 'tags'; values[':tags'] = tags; }
      await getDocumentClient().send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `SESSION#${result.sessionId}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setExprs.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
    } catch { /* non-blocking */ }
  }

  // Phase 5: scheduled sessions don't claim resources / aren't live — emit
  // SESSION_SCHEDULED and skip the ads-service live notification.
  const isScheduled = Boolean(body.scheduledFor);
  try {
    await emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId: result.sessionId,
      eventType: isScheduled ? SessionEventType.SESSION_SCHEDULED : SessionEventType.SESSION_CREATED,
      timestamp: new Date().toISOString(),
      actorId: userId,
      actorType: 'user',
      details: isScheduled
        ? {
            sessionType: body.sessionType,
            scheduledFor: body.scheduledFor,
            scheduledEndsAt: result.scheduledEndsAt,
            title: body.title,
          }
        : { sessionType: body.sessionType, requireApproval },
    });
  } catch { /* non-blocking */ }

  if (!isScheduled) {
    // Notify vnl-ads that this creator is now LIVE so scheduled campaigns can fire.
    // Fire-and-forget; feature-flag off / SDK failures are swallowed inside.
    void startAdsSession(result.sessionId, userId);
  }

  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      ...result,
      requireApproval,
      captionsEnabled: body.captionsEnabled === true,
    }),
  };
};
