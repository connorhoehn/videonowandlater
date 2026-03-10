/**
 * GET /sessions/{sessionId}/speaker-segments handler
 * Returns the speaker-attributed transcript segments stored in S3 for a session.
 * Requires transcribe-completed to have run with ShowSpeakerLabels: true.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSessionById } from '../repositories/session-repository';

interface SpeakerSegment {
  speaker: string;   // 'Speaker 1' or 'Speaker 2'
  startTime: number; // ms
  endTime: number;   // ms
  text: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET!;
  const sessionId = event.pathParameters?.sessionId;

  if (!sessionId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'sessionId required' }),
    };
  }

  try {
    // Get session to locate diarized transcript S3 path
    const session = await getSessionById(tableName, sessionId);

    if (!session) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Check if speaker segments are available
    if (!session.diarizedTranscriptS3Path) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Speaker segments not available' }),
      };
    }

    // Fetch speaker segments JSON from S3
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const command = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: session.diarizedTranscriptS3Path,
    });

    const response = await s3Client.send(command);
    const segmentsData = await response.Body?.transformToString();

    if (!segmentsData) {
      throw new Error('Empty speaker segments file');
    }

    const segments: SpeakerSegment[] = JSON.parse(segmentsData);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        sessionId,
        segments,
      }),
    };
  } catch (error: any) {
    console.error('Error fetching speaker segments:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to fetch speaker segments',
        details: error.message,
      }),
    };
  }
};
