/**
 * GET /sessions/{sessionId}/chapters
 *
 * Returns AI-generated chapter markers for a session's recording.
 * Chapters are produced by the chapter-generation pipeline (store-summary.ts)
 * and persisted on the session METADATA record (`chapters` attribute).
 *
 * Response shape:
 *   { chapters: [{ id, title, startSec, endSec }] }
 *
 * When the session has no chapters (short session, failed transcript,
 * pipeline not yet complete), returns `{ chapters: [] }` with 200. The
 * frontend hides the chapter strip when this array is empty.
 *
 * Authz: API Gateway's Cognito authorizer is enforced at the route level,
 * so any authenticated caller may list chapters for a session they can see.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-session-chapters' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export interface ChapterResponseItem {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    const rawChapters = session.chapters ?? [];
    const chapters: ChapterResponseItem[] = rawChapters.map((c, idx) => ({
      id: `${sessionId}-ch-${idx}`,
      title: c.title,
      startSec: Math.max(0, Math.round(c.startTimeMs / 1000)),
      endSec: Math.max(0, Math.round(c.endTimeMs / 1000)),
    }));

    return resp(200, { chapters });
  } catch (err: any) {
    logger.error('get-session-chapters error', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return resp(500, { error: 'Internal server error' });
  }
}
