/**
 * Tests for init-upload Lambda handler
 * POST /upload/init - initialize S3 multipart upload session
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../init-upload';
import * as sessionRepository from '../../repositories/session-repository';
import { S3Client, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-s3');

const mockCreateUploadSession = sessionRepository.createUploadSession as jest.MockedFunction<typeof sessionRepository.createUploadSession>;
const mockS3Client = S3Client as jest.MockedClass<typeof S3Client>;

describe('init-upload handler', () => {
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

  function createEvent(body: any, userId?: string): APIGatewayProxyEvent {
    return {
      body: JSON.stringify(body),
      requestContext: {
        authorizer: userId ? { claims: { 'cognito:username': userId } } : undefined,
      },
    } as any as APIGatewayProxyEvent;
  }

  describe('Authorization', () => {
    it('returns 401 when userId is not in request context', async () => {
      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, undefined);

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body)).toHaveProperty('error');
    });
  });

  describe('Input Validation', () => {
    it('returns 400 when filename is missing', async () => {
      const event = createEvent({
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/filename|missing/i);
    });

    it('returns 400 when filesize is missing', async () => {
      const event = createEvent({
        filename: 'video.mp4',
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/filesize|missing/i);
    });

    it('returns 400 when mimeType is missing', async () => {
      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/mimeType|missing/i);
    });

    it('returns 400 for unsupported mimeType', async () => {
      const event = createEvent({
        filename: 'video.webm',
        filesize: 1024000000,
        mimeType: 'video/webm',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/unsupported|mime|type/i);
    });

    it('returns 413 when filesize exceeds 10GB', async () => {
      const event = createEvent({
        filename: 'huge-video.mp4',
        filesize: 10737418241, // 10GB + 1 byte
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(413);
      const body = JSON.parse(result.body);
      expect(body.error).toMatch(/too large|payload|10/i);
    });
  });

  describe('Session Creation', () => {
    it('calls createUploadSession with userId, filename, filesize', async () => {
      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId: 'test-session-id',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: 'myfile.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockResolvedValueOnce({ UploadId: 'test-upload-id' });
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename: 'myfile.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      await handler(event);

      expect(mockCreateUploadSession).toHaveBeenCalledWith(
        TABLE_NAME,
        'user-123',
        'myfile.mp4',
        1024000000,
        undefined
      );
    });
  });

  describe('S3 Multipart Initiation', () => {
    it('initiates S3 multipart upload with CreateMultipartUploadCommand', async () => {
      const sessionId = 'test-session-123';
      const filename = 'myfile.mp4';

      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: filename,
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockResolvedValueOnce({ UploadId: 'upload-id-xyz' });
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename,
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(200);
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('Response', () => {
    it('returns 200 with sessionId, uploadId, presignedUrl, maxChunkSize, expiresIn', async () => {
      const sessionId = 'test-session-abc';
      const uploadId = 'test-upload-id-xyz';

      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockResolvedValueOnce({ UploadId: uploadId });
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(200);
      expect(result.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('sessionId', sessionId);
      expect(body).toHaveProperty('uploadId', uploadId);
      expect(body).toHaveProperty('presignedUrl');
      expect(body).toHaveProperty('maxChunkSize');
      expect(body).toHaveProperty('expiresIn', 900);
    });

    it('returns correct maxChunkSize (54525952 = 52MB)', async () => {
      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId: 'test-session',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockResolvedValueOnce({ UploadId: 'upload-id' });
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      const body = JSON.parse(result.body);
      expect(body.maxChunkSize).toBe(54525952); // 52MB
    });

    it('sets Content-Type application/json', async () => {
      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId: 'test-session',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockResolvedValueOnce({ UploadId: 'upload-id' });
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.headers['Content-Type']).toBe('application/json');
    });
  });

  describe('Error Handling', () => {
    it('returns 500 with error message on DynamoDB failure', async () => {
      mockCreateUploadSession.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
    });

    it('returns 500 with error message on S3 failure', async () => {
      mockCreateUploadSession.mockResolvedValueOnce({
        sessionId: 'test-session',
        userId: 'user-123',
        sessionType: 'UPLOAD' as any,
        status: 'creating' as any,
        claimedResources: { chatRoom: '' },
        createdAt: '2026-03-06T01:00:00Z',
        version: 1,
        uploadStatus: 'pending',
        uploadProgress: 0,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000000,
      } as any);

      const mockS3Send = jest.fn().mockRejectedValueOnce(new Error('S3 service error'));
      mockS3Client.prototype.send = mockS3Send;

      const event = createEvent({
        filename: 'video.mp4',
        filesize: 1024000000,
        mimeType: 'video/mp4',
      }, 'user-123');

      const result = await handler(event) as any;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('error');
    });
  });
});
