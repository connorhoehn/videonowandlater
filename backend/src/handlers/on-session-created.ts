/**
 * Fan-out notifications to followers when a creator starts a public/unlisted session.
 *
 * Triggered by EventBridge rule matching `detail-type: session.SESSION_CREATED`
 * (and `session.SESSION_STARTED` for HANGOUT sessions that only "start" when the
 * first participant joins).
 *
 * Rules:
 *   - Only BROADCAST and HANGOUT session types fan out. STORY never does.
 *   - Only visibility = 'public' or 'unlisted' fans out. 'private' never does.
 *   - Creator's followers (via follow-repository.listFollowers) receive a
 *     NOTIFICATION row (type: 'creator_live') with a 7-day TTL.
 *   - If NOTIFICATION_EMAIL_ENABLED === 'true' and SES is available, also send
 *     emails (best-effort). Default off.
 *
 * All failures are non-fatal — the goal is delivering the bell-icon notification
 * to as many followers as we can; email is a bonus.
 */
import type { EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById } from '../repositories/session-repository';
import { listFollowers } from '../repositories/follow-repository';
import { getProfile } from '../repositories/profile-repository';
import { SessionType } from '../domain/session';
import type { SessionEvent } from '../domain/session-event';

const logger = new Logger({
  serviceName: 'vnl-notify',
  persistentKeys: { handler: 'on-session-created' },
});

// 7 days in seconds — DynamoDB TTL is epoch-seconds.
const NOTIF_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * BatchWrite fan-out. Inlined (not using notification-repository.fanOutNotification)
 * so we can attach the `ttl` column that the repository API doesn't expose.
 */
async function fanOutWithTtl(
  tableName: string,
  recipientIds: string[],
  n: { type: string; subject: string; payload: Record<string, unknown> },
): Promise<number> {
  if (recipientIds.length === 0) return 0;
  const createdAt = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + NOTIF_TTL_SECONDS;
  const docClient = getDocumentClient();

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
            payload: n.payload,
            createdAt,
            seen: false,
            ttl,
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

/**
 * Best-effort email blast. Silently no-ops when:
 *   - NOTIFICATION_EMAIL_ENABLED is not 'true', OR
 *   - NOTIFICATION_EMAIL_FROM is unset, OR
 *   - @aws-sdk/client-ses isn't installed (SES is a future-phase dependency)
 */
async function maybeSendEmails(
  _recipients: string[],
  _subject: string,
  _body: string,
): Promise<void> {
  if (process.env.NOTIFICATION_EMAIL_ENABLED !== 'true') return;
  if (!process.env.NOTIFICATION_EMAIL_FROM) {
    logger.warn('NOTIFICATION_EMAIL_ENABLED=true but NOTIFICATION_EMAIL_FROM unset — skipping');
    return;
  }
  // SES SDK isn't currently installed. Log the intent so ops can see the stub path.
  logger.info('Email send stub reached (SES SDK not wired yet)', {
    recipientCount: _recipients.length,
    from: process.env.NOTIFICATION_EMAIL_FROM,
  });
}

type AnyEvent =
  | EventBridgeEvent<string, SessionEvent>
  | EventBridgeEvent<string, { eventType?: string; sessionId?: string; actorId?: string }>;

export const handler = async (event: AnyEvent): Promise<void> => {
  const started = Date.now();
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME env var not set');
    return;
  }

  const detail = event.detail as SessionEvent;
  const sessionId = detail?.sessionId;
  if (!sessionId) {
    logger.warn('Event missing sessionId', { detailType: event['detail-type'] });
    return;
  }

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      logger.warn('Session not found for fan-out', { sessionId });
      return;
    }

    // Skip non-fan-out types.
    if (
      session.sessionType !== SessionType.BROADCAST &&
      session.sessionType !== SessionType.HANGOUT
    ) {
      logger.info('Skipping fan-out for session type', {
        sessionId, sessionType: session.sessionType,
      });
      return;
    }

    // Private → no fan-out. Default (unlisted) still fans out since it's the
    // pre-Phase-1 default and followers generally want to know.
    const visibility = session.visibility ?? 'unlisted';
    if (visibility === 'private') {
      logger.info('Skipping fan-out for private session', { sessionId });
      return;
    }

    const creatorId = session.userId;
    const [followers, creatorProfile] = await Promise.all([
      listFollowers(tableName, creatorId, 1000), // hard cap for sanity
      getProfile(tableName, creatorId).catch(() => null),
    ]);

    if (followers.length === 0) {
      logger.info('Creator has no followers — nothing to fan out', { creatorId });
      return;
    }

    const displayName = creatorProfile?.displayName || creatorProfile?.handle || creatorId;
    const creatorHandle = creatorProfile?.handle;
    const title = session.title?.trim();
    const subject = title
      ? `${displayName} is live: ${title}`
      : `${displayName} started a session`;

    const payload: Record<string, unknown> = {
      sessionId,
      sessionType: session.sessionType,
      creatorId,
      creatorHandle,
      thumbnailUrl: session.thumbnailUrl,
    };

    const recipientIds = followers.map((f) => f.follower);

    let written = 0;
    try {
      written = await fanOutWithTtl(tableName, recipientIds, {
        type: 'creator_live',
        subject,
        payload,
      });
    } catch (err: any) {
      logger.error('fan-out batchWrite failed (non-fatal)', {
        error: err?.message, sessionId, followerCount: followers.length,
      });
    }

    try {
      await maybeSendEmails(recipientIds, subject, subject);
    } catch (err: any) {
      logger.warn('Email fan-out failed (non-fatal)', { error: err?.message });
    }

    logger.info('creator_live fan-out complete', {
      sessionId,
      creatorId,
      followerCount: followers.length,
      notificationsWritten: written,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    // Any uncaught error is swallowed so Lambda retries don't spam duplicates.
    logger.error('Unhandled error during fan-out (non-fatal)', {
      error: err?.message, sessionId,
    });
  }
};
