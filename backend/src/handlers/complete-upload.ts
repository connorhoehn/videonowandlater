/**
 * Lambda handler for POST /upload/complete
 * Completes S3 multipart upload and triggers MediaConvert job
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  S3Client,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getSessionById, updateUploadProgress } from '../repositories/session-repository';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600',
};

interface PartETag {
  partNumber: number;
  eTag: string;
}

interface CompleteUploadRequest {
  sessionId: string;
  uploadId: string;
  partETags: PartETag[];
}

interface CompleteUploadResponse {
  sessionId: string;
  uploadStatus: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME!;
    const bucketName = process.env.RECORDINGS_BUCKET!;
    const mediaConvertTopic = process.env.MEDIACONVERT_TOPIC_ARN!;

    const body = JSON.parse(event.body || '{}') as CompleteUploadRequest;
    const { sessionId, uploadId, partETags } = body;

    // Validate input
    if (!sessionId || !uploadId || !Array.isArray(partETags) || partETags.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          error: 'Missing required fields: sessionId, uploadId, partETags (non-empty array)',
        }),
      };
    }

    // Get session
    const session = await getSessionById(tableName, sessionId);
    if (!session) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Complete multipart upload on S3
    const s3Client = new S3Client({ region: process.env.AWS_REGION });
    const s3Key = `uploads/${sessionId}/${session.sourceFileName}`;

    try {
      await s3Client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucketName,
          Key: s3Key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: partETags.map((tag) => ({
              PartNumber: tag.partNumber,
              ETag: tag.eTag,
            })),
          },
        })
      );

      console.log(`Multipart upload completed: ${sessionId}`);

      // Update session: mark upload as processing (S3 complete, awaiting MediaConvert)
      await updateUploadProgress(tableName, sessionId, 'processing', 100);

      // Publish SNS message to trigger MediaConvert job (handler in Plan 21-03)
      const snsClient = new SNSClient({ region: process.env.AWS_REGION });
      await snsClient.send(
        new PublishCommand({
          TopicArn: mediaConvertTopic,
          Message: JSON.stringify({
            sessionId,
            s3Bucket: bucketName,
            s3Key,
            sourceFileName: session.sourceFileName,
            sourceFileSize: session.sourceFileSize,
          }),
        })
      );

      const response: CompleteUploadResponse = {
        sessionId,
        uploadStatus: 'processing',
      };

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify(response),
      };
    } catch (s3Error) {
      console.error(`Failed to complete multipart upload ${uploadId}:`, s3Error);

      // Abort the multipart upload to prevent orphaned parts
      try {
        await s3Client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucketName,
            Key: s3Key,
            UploadId: uploadId,
          })
        );
        console.log(`Aborted multipart upload: ${uploadId}`);
      } catch (abortError) {
        console.error(`Failed to abort multipart upload ${uploadId}:`, abortError);
      }

      // Mark session as failed
      await updateUploadProgress(tableName, sessionId, 'failed', 0);

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Failed to complete upload. Upload aborted.' }),
      };
    }
  } catch (error) {
    console.error('complete-upload error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
