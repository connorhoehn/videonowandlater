/**
 * GET /me/clips
 *
 * Returns clips authored by the caller (both live + post-session), newest
 * first. Backed by GSI6 (USER_CLIPS#{authorId} / createdAt).
 *
 * Used by the frontend "My Clips" panel and by `useLiveClips` to poll for
 * pending live-clips transitioning to 'ready'.
 *
 * Auth: required (Cognito). No admin override — this is strictly the
 * caller's own clips.
 *
 * Query params:
 *   - limit: 1..100 (default 50)
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { listClipsByAuthor } from '../repositories/clip-repository';
import { getClipType } from '../domain/clip';
import { resp, requireUserId, mapKnownError } from '../lib/http';

const logger = new Logger({
  serviceName: 'vnl-api',
  persistentKeys: { handler: 'list-my-clips' },
});

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'Server misconfigured' });

  let userId: string;
  try {
    userId = requireUserId(event);
  } catch (err) {
    const mapped = mapKnownError(err);
    if (mapped) return mapped;
    throw err;
  }

  const limitStr = event.queryStringParameters?.limit;
  let limit = 50;
  if (limitStr !== undefined) {
    const parsed = parseInt(limitStr, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return resp(400, { error: 'limit must be a positive integer' });
    }
    limit = Math.min(parsed, 100);
  }

  try {
    const clips = await listClipsByAuthor(tableName, userId, limit);

    // Return caller-safe fields. We intentionally omit internal fields like
    // mediaConvertJobId, s3Key, and GSI keys — those are already stripped by
    // the repo. We DO include live-clip-specific fields when present.
    const sanitized = clips.map((c) => ({
      clipId: c.clipId,
      sessionId: c.sessionId,
      authorId: c.authorId,
      clipType: getClipType(c),
      title: c.title,
      createdAt: c.createdAt,
      status: c.status,
      // Post-session fields (undefined on live clips)
      startSec: c.startSec,
      endSec: c.endSec,
      durationSec: c.durationSec,
      // Live-clip fields (undefined on post-session clips)
      requestedAt: c.requestedAt,
      clipStartRelativeMs: c.clipStartRelativeMs,
      mp4Url: c.mp4Url,
    }));

    return resp(200, { clips: sanitized });
  } catch (err: any) {
    logger.error('list-my-clips error', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: 'Internal server error' });
  }
}
