/**
 * GET /sessions/{sessionId}/timeline
 * Unified timeline: speaker segments + context events + intent results, sorted by time.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';
import { getContextEvents } from '../repositories/context-repository';
import { getIntentResults } from '../repositories/intent-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-timeline' } });
const s3 = new S3Client({});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface TimelineEvent {
  type: 'speaker' | 'context' | 'intent_captured';
  startTime: number;
  endTime?: number;
  data: Record<string, any>;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET;

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    // Parallel fetch: speaker segments, context events, intent results
    const [speakerSegments, contextEvents, intentResults] = await Promise.all([
      fetchSpeakerSegments(transcriptionBucket, session.diarizedTranscriptS3Path),
      getContextEvents(tableName, sessionId),
      getIntentResults(tableName, sessionId),
    ]);

    const events: TimelineEvent[] = [];

    // Map speaker segments
    for (const seg of speakerSegments) {
      events.push({
        type: 'speaker',
        startTime: seg.start_time ?? seg.startTime ?? 0,
        endTime: seg.end_time ?? seg.endTime,
        data: seg,
      });
    }

    // Map context events
    for (const ctx of contextEvents) {
      events.push({
        type: 'context',
        startTime: ctx.timestamp,
        data: ctx,
      });
    }

    // Map intent results
    for (const ir of intentResults) {
      events.push({
        type: 'intent_captured',
        startTime: new Date(ir.extractedAt).getTime(),
        data: ir,
      });
    }

    // Sort by startTime ascending
    events.sort((a, b) => a.startTime - b.startTime);

    return resp(200, { events });
  } catch (err: any) {
    logger.error('Error building timeline', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}

async function fetchSpeakerSegments(bucket?: string, s3Path?: string): Promise<any[]> {
  if (!bucket || !s3Path) return [];

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: s3Path,
    }));

    const bodyStr = await result.Body?.transformToString('utf-8');
    if (!bodyStr) return [];

    const parsed = JSON.parse(bodyStr);
    // Handle both { segments: [...] } and raw array formats
    return Array.isArray(parsed) ? parsed : (parsed.segments ?? []);
  } catch (err) {
    logger.warn('Failed to fetch speaker segments from S3', {
      error: err instanceof Error ? err.message : String(err),
      bucket,
      s3Path,
    });
    return [];
  }
}
