/**
 * Lambda handler for POST /upload/init
 * Initializes S3 multipart upload for video file uploads
 * Validates file metadata, creates UPLOAD session, and initiates multipart upload on S3
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';
import { createUploadSession } from '../repositories/session-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'init-upload' } });

const SUPPORTED_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB
const MAX_CHUNK_SIZE = 52 * 1024 * 1024; // 52MB

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600',
};

interface InitUploadRequest {
  filename: string;
  filesize: number;
  mimeType: string;
}

interface InitUploadResponse {
  sessionId: string;
  uploadId: string;
  presignedUrl: string;
  maxChunkSize: number;
  expiresIn: number;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME!;
    const bucketName = process.env.RECORDINGS_BUCKET!;
    const userId = event.requestContext?.authorizer?.claims['cognito:username'];

    if (!userId) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const body = JSON.parse(event.body || '{}') as InitUploadRequest;
    const { filename, filesize, mimeType } = body;

    // Validate input
    if (!filename || filesize === undefined || !mimeType) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing required fields: filename, filesize, mimeType' }),
      };
    }

    if (!SUPPORTED_MIME_TYPES.includes(mimeType)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          error: `Unsupported mime type. Supported: ${SUPPORTED_MIME_TYPES.join(', ')}`,
        }),
      };
    }

    if (filesize > MAX_FILE_SIZE) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          error: `File too large. Maximum size: ${MAX_FILE_SIZE / (1024 ** 3)}GB`,
        }),
      };
    }

    // Create UPLOAD session
    const session = await createUploadSession(tableName, userId, filename, filesize, undefined);

    // Initiate multipart upload on S3
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const s3Key = `uploads/${session.sessionId}/${filename}`;

    const multipartUpload = await s3Client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucketName,
        Key: s3Key,
        ContentType: mimeType,
      })
    );

    const uploadId = multipartUpload.UploadId!;

    const response: InitUploadResponse = {
      sessionId: session.sessionId,
      uploadId,
      presignedUrl: s3Key, // Client will use uploadId + partNumbers with getSignedUrl per part
      maxChunkSize: MAX_CHUNK_SIZE,
      expiresIn: 900, // 15 minutes for init request
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('init-upload error', { error: error instanceof Error ? error.message : String(error) });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
