/**
 * Lambda handler for POST /upload/part-url
 * Generates presigned URL for S3 multipart upload chunk
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSessionById } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-part-presigned-url' } });

interface GetPartUrlRequest {
  sessionId: string;
  uploadId: string;
  partNumber: number;
}

interface GetPartUrlResponse {
  presignedUrl: string;
  expiresIn: number;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME!;
    const bucketName = process.env.RECORDINGS_BUCKET!;

    const body = JSON.parse(event.body || '{}') as GetPartUrlRequest;
    const { sessionId, uploadId, partNumber } = body;

    // Validate input
    if (!sessionId || !uploadId || !partNumber) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required fields: sessionId, uploadId, partNumber' }),
      };
    }

    // Get session
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

    // Check upload status
    if (session.uploadStatus === 'failed') {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Upload has failed; no new parts can be uploaded' }),
      };
    }

    // Generate presigned URL for UploadPartCommand
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const s3Key = `uploads/${sessionId}/${session.sourceFileName}`;

    const command = new UploadPartCommand({
      Bucket: bucketName,
      Key: s3Key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

    const response: GetPartUrlResponse = {
      presignedUrl,
      expiresIn: 3600,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('get-part-presigned-url error', { error: error instanceof Error ? error.message : String(error) });
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
