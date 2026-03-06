/**
 * Tests for get-part-presigned-url Lambda handler
 * POST /upload/part-url - generate presigned URL for chunk upload
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../get-part-presigned-url';
import * as sessionRepository from '../../repositories/session-repository';

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;

describe('get-part-presigned-url handler', () => {
  const TABLE_NAME = 'test-table';
  const BUCKET_NAME = 'test-bucket';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.RECORDINGS_BUCKET = BUCKET_NAME;
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/sessionId|missing/i);
    });

    it('returns 400 when uploadId is missing', async () => {
      const event = createEvent({
        sessionId: 'session-123',
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/uploadId|missing/i);
    });

    it('returns 400 when partNumber is missing', async () => {
      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/partNumber|missing/i);
    });
  });

  describe('Session Lookup', () => {
    it('returns 404 when session not found', async () => {
      mockGetSessionById.mockResolvedValueOnce(null);

      const event = createEvent({
        sessionId: 'nonexistent-session',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/not found/i);
    });

    it('calls getSessionById with correct parameters', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'processing',
        uploadProgress: 50,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      await handler(event);

      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, 'session-123');
    });
  });

  describe('Upload Status Check', () => {
    it('returns 404 when uploadStatus is failed', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'failed',
        uploadProgress: 0,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/failed|no new parts/i);
    });
  });

  describe('Response Format', () => {
    it('returns 200 with presignedUrl and expiresIn=3600', async () => {
      mockGetSessionById.mockResolvedValueOnce({
        sessionId: 'session-123',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'processing',
        uploadProgress: 75,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partNumber: 3,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('presignedUrl');
      expect(body).toHaveProperty('expiresIn');
      expect(body.expiresIn).toBe(3600);
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
        uploadStatus: 'processing',
        uploadProgress: 50,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on DynamoDB error', async () => {
      mockGetSessionById.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createEvent({
        sessionId: 'session-123',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
    });
  });
});
