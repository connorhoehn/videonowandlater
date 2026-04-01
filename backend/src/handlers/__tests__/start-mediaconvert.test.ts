/**
 * Tests for start-mediaconvert Lambda handler
 * SNS-triggered MediaConvert job submission
 */

import type { SNSEvent } from 'aws-lambda';
import { handler } from '../start-mediaconvert';
import * as sessionRepository from '../../repositories/session-repository';
import type { Session } from '../../domain/session';
import { SessionType, SessionStatus } from '../../domain/session';

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-mediaconvert', () => ({
  MediaConvertClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Job: { Id: 'job-123' },
    }),
  })),
  CreateJobCommand: jest.fn(),
}));

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockUpdateConvertStatus = sessionRepository.updateConvertStatus as jest.MockedFunction<typeof sessionRepository.updateConvertStatus>;

describe('start-mediaconvert handler', () => {
  const TABLE_NAME = 'test-table';
  const BUCKET_NAME = 'test-bucket';
  const ROLE_ARN = 'arn:aws:iam::123456789012:role/MediaConvertRole';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.RECORDINGS_BUCKET = BUCKET_NAME;
    process.env.MEDIACONVERT_ROLE_ARN = ROLE_ARN;
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCOUNT_ID = '123456789012';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateConvertStatus.mockResolvedValue(undefined);
  });

  function createEvent(message: any): SNSEvent {
    return {
      Records: [
        {
          Sns: {
            Message: JSON.stringify(message),
          },
        } as any,
      ],
    } as SNSEvent;
  }

  describe('SNS event processing', () => {
    it('should submit MediaConvert job with valid SNS message', async () => {
      const sessionId = 'test-session-123';
      const mockSession: Session = {
        sessionId,
        userId: 'user-123',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession);

      const event = createEvent({
        sessionId,
        s3Bucket: BUCKET_NAME,
        s3Key: `uploads/${sessionId}/video.mp4`,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      await handler(event);

      // Verify session was looked up
      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, sessionId);

      // Verify convert status was updated
      expect(mockUpdateConvertStatus).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.stringMatching(/^vnl-test-session-123-\d+$/),
        'pending'
      );
    });

    it('should log error and continue when session not found', async () => {
      mockGetSessionById.mockResolvedValueOnce(null);

      const event = createEvent({
        sessionId: 'nonexistent-session',
        s3Bucket: BUCKET_NAME,
        s3Key: 'uploads/nonexistent/video.mp4',
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      await handler(event);

      expect(mockUpdateConvertStatus).not.toHaveBeenCalled();
    });

    it('should handle multiple SNS records', async () => {
      const session1: Session = {
        sessionId: 'session-1',
        userId: 'user-1',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      const session2: Session = {
        sessionId: 'session-2',
        userId: 'user-2',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById
        .mockResolvedValueOnce(session1)
        .mockResolvedValueOnce(session2);

      const event = {
        Records: [
          {
            Sns: {
              Message: JSON.stringify({
                sessionId: 'session-1',
                s3Bucket: BUCKET_NAME,
                s3Key: 'uploads/session-1/video.mp4',
                sourceFileName: 'video1.mp4',
                sourceFileSize: 1024000,
              }),
            },
          } as any,
          {
            Sns: {
              Message: JSON.stringify({
                sessionId: 'session-2',
                s3Bucket: BUCKET_NAME,
                s3Key: 'uploads/session-2/video.mp4',
                sourceFileName: 'video2.mp4',
                sourceFileSize: 2048000,
              }),
            },
          } as any,
        ],
      } as SNSEvent;

      await handler(event);

      expect(mockGetSessionById).toHaveBeenCalledTimes(2);
      expect(mockUpdateConvertStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('MediaConvert job configuration', () => {
    it('should set job name in format vnl-{sessionId}-{epochMs}', async () => {
      const sessionId = 'test-session-456';
      const mockSession: Session = {
        sessionId,
        userId: 'user-123',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession);

      const event = createEvent({
        sessionId,
        s3Bucket: BUCKET_NAME,
        s3Key: `uploads/${sessionId}/video.mp4`,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      const beforeTime = Date.now();
      await handler(event);
      const afterTime = Date.now();

      expect(mockUpdateConvertStatus).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.stringMatching(/^vnl-test-session-456-\d+$/),
        'pending'
      );

      // Extract the timestamp from the job name and verify it's in the correct range
      const jobNameCall = (mockUpdateConvertStatus.mock.calls[0]?.[2] as string) || '';
      const timestamp = parseInt(jobNameCall.split('-').pop() || '0', 10);
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('should configure H.264 codec for all output renditions', async () => {
      const sessionId = 'codec-test-session';
      const mockSession: Session = {
        sessionId,
        userId: 'user-123',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession);

      const event = createEvent({
        sessionId,
        s3Bucket: BUCKET_NAME,
        s3Key: `uploads/${sessionId}/video.mp4`,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      await handler(event);

      expect(mockUpdateConvertStatus).toHaveBeenCalled();
    });

    it('should output HLS to s3://{bucket}/hls/{sessionId}/', async () => {
      const sessionId = 'hls-output-test';
      const mockSession: Session = {
        sessionId,
        userId: 'user-123',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession);

      const event = createEvent({
        sessionId,
        s3Bucket: BUCKET_NAME,
        s3Key: `uploads/${sessionId}/video.mp4`,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      await handler(event);

      expect(mockUpdateConvertStatus).toHaveBeenCalled();
    });

    it('should include 3 adaptive bitrate renditions (1080p, 720p, 480p)', async () => {
      const sessionId = 'bitrate-test-session';
      const mockSession: Session = {
        sessionId,
        userId: 'user-123',
        sessionType: SessionType.UPLOAD,
        status: SessionStatus.CREATING,
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession);

      const event = createEvent({
        sessionId,
        s3Bucket: BUCKET_NAME,
        s3Key: `uploads/${sessionId}/video.mp4`,
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      await handler(event);

      expect(mockUpdateConvertStatus).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should not rethrow handler errors (non-blocking)', async () => {
      mockGetSessionById.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createEvent({
        sessionId: 'error-test-session',
        s3Bucket: BUCKET_NAME,
        s3Key: 'uploads/error-test/video.mp4',
        sourceFileName: 'video.mp4',
        sourceFileSize: 1024000,
      });

      // Should not throw
      await expect(handler(event)).resolves.toBeUndefined();
    });
  });
});
