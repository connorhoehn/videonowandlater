/**
 * GET /sessions/{sessionId}/transcript handler - retrieve transcript for a session
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-transcript' } });

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const transcriptionBucket = process.env.TRANSCRIPTION_BUCKET || 'vnl-transcription-vnl-session';
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
    // Get session to check transcript status
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

    // Check if transcript is available
    if (session.transcriptStatus !== 'available' || !session.transcriptS3Path) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Transcript not available',
          status: session.transcriptStatus || 'pending'
        }),
      };
    }

    // Fetch transcript from S3
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const command = new GetObjectCommand({
      Bucket: transcriptionBucket,
      Key: session.transcriptS3Path,
    });

    const response = await s3Client.send(command);
    const transcriptData = await response.Body?.transformToString();

    if (!transcriptData) {
      throw new Error('Empty transcript file');
    }

    // Parse the transcript JSON from AWS Transcribe
    const transcript = JSON.parse(transcriptData);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        sessionId,
        transcriptStatus: session.transcriptStatus,
        results: transcript.results,
        // Include the full text transcript as well
        transcript: transcript.results?.transcripts?.[0]?.transcript || '',
      }),
    };
  } catch (error: any) {
    logger.error('Error fetching transcript', { error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to fetch transcript',
        details: error.message
      }),
    };
  }
};