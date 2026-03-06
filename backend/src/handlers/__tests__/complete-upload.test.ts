/**
 * Tests for complete-upload Lambda handler
 * POST /upload/complete - finalize multipart upload and trigger MediaConvert
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../complete-upload';
import * as sessionRepository from '../../repositories/session-repository';

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-sns');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockUpdateUploadProgress = sessionRepository.updateUploadProgress as jest.MockedFunction<typeof sessionRepository.updateUploadProgress>;

describe('complete-upload handler', () => {
  const TABLE_NAME = 'test-table';
  const BUCKET_NAME = 'test-bucket';
  const MEDIACONVERT_TOPIC = 'arn:aws:sns:us-east-1:123456789012:mediaconvert-jobs';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.RECORDINGS_BUCKET = BUCKET_NAME;
    process.env.MEDIACONVERT_TOPIC_ARN = MEDIACONVERT_TOPIC;
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUploadProgress.mockResolvedValue(undefined);
  });

  function createEvent(body: any): APIGatewayProxyEvent {
    return {
      body: JSON.stringify(body),
    } as any as APIGatewayProxyEvent;
  }

  describe('Input Validation', () => {
    it('returns 400 when sessionId is missing', async () => {
      const event = createEvent({
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/sessionId|missing/i);
    });

    it('returns 400 when uploadId is missing', async () => {
      const event = createEvent({
        sessionId: 'session-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/uploadId|missing/i);
    });

    it('returns 400 when partETags is missing', async () => {
      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/partETags|missing/i);
    });

    it('returns 400 when partETags is empty array', async () => {
      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/partETags|missing/i);
    });
  });

  describe('Session Lookup', () => {
    it('returns 404 when session not found', async () => {
      mockGetSessionById.mockResolvedValueOnce(null);

      const event = createEvent({
        sessionId: 'nonexistent-session',
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe('Multipart Completion', () => {
    it('completes multipart upload on S3', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 100,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [
          { partNumber: 1, eTag: 'etag1' },
          { partNumber: 2, eTag: 'etag2' },
        ],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(200);
      expect(mockUpdateUploadProgress).toHaveBeenCalledWith(TABLE_NAME, 'session-123', 'processing', 100);
    });
  });

  describe('Response', () => {
    it('returns 200 with sessionId and uploadStatus=processing', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 100,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.sessionId).toBe('session-123');
      expect(body.uploadStatus).toBe('processing');
    });

    it('sets Content-Type application/json', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 100,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on S3 complete failure', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 100,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      // Mock S3 to throw
      const { S3Client } = require('@aws-sdk/client-s3');
      S3Client.prototype.send = jest.fn().mockRejectedValueOnce(new Error('S3 error'));

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/failed/i);
    });

    it('returns 500 on DynamoDB error', async () => {
      mockGetSessionById.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partETags: [{ partNumber: 1, eTag: 'etag1' }],
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
    });
  });
});
