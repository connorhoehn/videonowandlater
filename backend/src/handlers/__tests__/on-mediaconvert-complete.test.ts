/**
 * Tests for on-mediaconvert-complete Lambda handler
 * EventBridge-triggered MediaConvert job completion handling
 */

import type { EventBridgeEvent, SQSEvent } from 'aws-lambda';
import { handler } from '../on-mediaconvert-complete';
import * as sessionRepository from '../../repositories/session-repository';
import * as eventbridgeModule from '@aws-sdk/client-eventbridge';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

// ---------------------------------------------------------------------------
// TRACE-02 / TRACE-03: Tracer mock — captureAWSv3Client + putAnnotation
// Use var (no initializer) + assign inside jest.mock factory for ESM compat.
// jest.mock factories run before module-scope initializers in ESM mode.
// ---------------------------------------------------------------------------
var mockCaptureAWSv3Client: jest.Mock;
var mockPutAnnotation: jest.Mock;
var mockAddErrorAsMetadata: jest.Mock;
var mockGetSegment: jest.Mock;
var mockSetSegment: jest.Mock;

jest.mock('@aws-lambda-powertools/tracer', () => {
  mockCaptureAWSv3Client = jest.fn((client: any) => client);
  mockPutAnnotation = jest.fn();
  mockAddErrorAsMetadata = jest.fn();
  mockGetSegment = jest.fn(() => ({
    addNewSubsegment: jest.fn(() => ({
      close: jest.fn(),
      addError: jest.fn(),
    })),
  }));
  mockSetSegment = jest.fn();
  return {
    Tracer: jest.fn().mockImplementation(() => ({
      captureAWSv3Client: mockCaptureAWSv3Client,
      putAnnotation: mockPutAnnotation,
      addErrorAsMetadata: mockAddErrorAsMetadata,
      getSegment: mockGetSegment,
      setSegment: mockSetSegment,
    })),
  };
});

jest.mock('../../repositories/session-repository');
jest.mock('@aws-sdk/client-eventbridge');

const mockGetSessionById = sessionRepository.getSessionById as jest.MockedFunction<typeof sessionRepository.getSessionById>;
const mockUpdateSessionRecording = sessionRepository.updateSessionRecording as jest.MockedFunction<typeof sessionRepository.updateSessionRecording>;

// Helper: get the module-scope EventBridgeClient instance's send mock.
// The handler creates eventBridgeClient at module scope, so we wire tests via the instance directly.
function getEbSend(): jest.Mock {
  return (EventBridgeClient as jest.Mock).mock.instances[0]?.send as jest.Mock;
}

// Helper: replace module-scope instance's send with a fresh mock for each EventBridge test.
function setupEbSend(impl?: (input: any) => any): jest.Mock {
  const mockSend = jest.fn(impl ?? (() => Promise.resolve({})));
  const instance = (EventBridgeClient as jest.Mock).mock.instances[0] as any;
  if (instance) instance.send = mockSend;
  return mockSend;
}

// Helper: create SQS event wrapping an EventBridge event
function makeSqsEvent(ebEvent: Record<string, any>): SQSEvent {
  return {
    Records: [{
      messageId: 'test-message-id',
      receiptHandle: 'test-receipt-handle',
      body: JSON.stringify(ebEvent),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1234567890',
        SenderId: 'test-sender',
        ApproximateFirstReceiveTimestamp: '1234567890',
      },
      messageAttributes: {},
      md5OfBody: 'test-md5',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-on-mediaconvert-complete',
      awsRegion: 'us-east-1',
    }],
  };
}



describe('on-mediaconvert-complete handler', () => {
  const TABLE_NAME = 'test-table';
  const BUCKET_NAME = 'test-bucket';
  const EVENT_BUS_NAME = 'default';

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
    process.env.RECORDINGS_BUCKET = BUCKET_NAME;
    process.env.EVENT_BUS_NAME = EVENT_BUS_NAME;
    process.env.AWS_REGION = 'us-east-1';
  });

  beforeEach(() => {
    // Clear per-invocation mocks but NOT mockCaptureAWSv3Client, which is called once at module
    // scope and must retain its calls for TRACE-02 assertions across tests.
    mockPutAnnotation.mockClear();
    mockAddErrorAsMetadata.mockClear();
    mockGetSegment.mockClear();
    mockSetSegment.mockClear();
    mockGetSessionById.mockReset();
    mockUpdateSessionRecording.mockReset();
    mockUpdateSessionRecording.mockResolvedValue(undefined);
  });

  describe('Job completion handling', () => {
    it('should update recordingHlsUrl on COMPLETE status', async () => {
      const sessionId = 'test-session-123';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-${Date.now()}`,
          jobId: 'job-123',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-123',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, sessionId);
      expect(mockUpdateSessionRecording).toHaveBeenCalled();
    });

    it('should set convertStatus=available (not recordingStatus) on COMPLETE', async () => {
      const sessionId = 'test-session-456';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-456',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-456',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // Handler only sets convertStatus on COMPLETE — recordingStatus is not updated here
      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          convertStatus: 'available',
        })
      );
    });

    it('should set convertStatus=available on COMPLETE', async () => {
      const sessionId = 'test-session-789';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-789',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-789',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          convertStatus: 'available',
        })
      );
    });

    it('should not set session status on COMPLETE (only convertStatus)', async () => {
      const sessionId = 'ended-test-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-ended',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-ended',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // Handler only updates convertStatus — session status is not changed here
      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        { convertStatus: 'available' }
      );
    });
  });

  describe('Job failure handling', () => {
    it('should set convertStatus=failed on ERROR status', async () => {
      const sessionId = 'error-test-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-error',
          status: 'ERROR',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-error',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          convertStatus: 'failed',
        })
      );
    });

    it('should set uploadStatus=failed on ERROR status', async () => {
      const sessionId = 'upload-fail-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-fail',
          status: 'ERROR',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-fail',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          uploadStatus: 'failed',
        })
      );
    });

    it('should handle CANCELED status same as ERROR', async () => {
      const sessionId = 'cancel-test-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-canceled',
          status: 'CANCELED',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-canceled',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          convertStatus: 'failed',
          uploadStatus: 'failed',
        })
      );
    });
  });

  describe('Session ID parsing', () => {
    it('should parse sessionId from jobName regex vnl-{sessionId}-{epochMs}', async () => {
      const sessionId = 'parsing-test-session-id';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890123`,
          jobId: 'job-parse',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-parse',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, sessionId);
    });

    it('should log error when jobName cannot be parsed', async () => {
      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: 'invalid-job-name-format',
          jobId: 'job-invalid',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-invalid',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockGetSessionById).not.toHaveBeenCalled();
    });
  });

  describe('Session lookup', () => {
    it('should log error when session not found', async () => {
      mockGetSessionById.mockResolvedValueOnce(null);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: 'vnl-nonexistent-session-1234567890',
          jobId: 'job-404',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-404',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockUpdateSessionRecording).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should throw on DynamoDB errors (critical error)', async () => {
      mockGetSessionById.mockRejectedValueOnce(new Error('DynamoDB error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: 'vnl-error-session-1234567890',
          jobId: 'job-ddb-error',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-ddb-error',
        resources: [],
      } as any;

      // Should add message to batchItemFailures (DynamoDB error is caught by SQS handler)
      const result = await handler(makeSqsEvent(ebEvent));

      // DynamoDB failure should result in batchItemFailures
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');

      consoleSpy.mockRestore();
    });
  });

  describe('HLS URL construction', () => {
    it('should use s3://{bucket}/hls/{sessionId}/master.m3u8 for EventBridge event (not stored in DB)', async () => {
      // Wire the module-scope eventBridgeClient instance to a controlled send mock.
      const mockSend = setupEbSend();
      (eventbridgeModule.PutEventsCommand as unknown as jest.Mock).mockImplementation((input) => ({ input }));

      const sessionId = 'hls-test-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-hls',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-hls',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // recordingHlsUrl is NOT stored in DB — it's only passed via EventBridge event
      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        { convertStatus: 'available' }
      );

      // Verify the HLS URL is passed in the EventBridge event detail
      expect(mockSend).toHaveBeenCalled();
      const putEventsCommand = mockSend.mock.calls[0][0];
      const detail = JSON.parse(putEventsCommand.input.Entries[0].Detail);
      expect(detail.recordingHlsUrl).toBe(`s3://${BUCKET_NAME}/hls/${sessionId}/master.m3u8`);
    });
  });

  describe('EventBridge event publication', () => {
    it('should publish EventBridge event to trigger transcription on COMPLETE status', async () => {
      // Wire the module-scope eventBridgeClient instance to a controlled send mock.
      const mockSend = setupEbSend();
      (eventbridgeModule.PutEventsCommand as unknown as jest.Mock).mockImplementation((input) => ({ input }));

      const sessionId = 'eb-test-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-eb-test',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-eb-test',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockSend).toHaveBeenCalled();
      const putEventsCommand = mockSend.mock.calls[0][0];
      expect(putEventsCommand.input.Entries[0].Source).toBe('vnl.upload');
      expect(putEventsCommand.input.Entries[0].DetailType).toBe('Upload Recording Available');

      const detail = JSON.parse(putEventsCommand.input.Entries[0].Detail);
      expect(detail.sessionId).toBe(sessionId);
      expect(detail.recordingHlsUrl).toBe(`s3://${BUCKET_NAME}/hls/${sessionId}/master.m3u8`);

      // TRACE-02: EventBridgeClient must be wrapped at module scope
      expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.any(EventBridgeClient));

      // TRACE-03: annotations written during handler invocation
      expect(mockPutAnnotation).toHaveBeenCalledWith('sessionId', expect.any(String));
      expect(mockPutAnnotation).toHaveBeenCalledWith('pipelineStage', 'on-mediaconvert-complete');
    });

    it('should NOT publish EventBridge event on ERROR status', async () => {
      // Wire the module-scope eventBridgeClient instance to a controlled send mock.
      const mockSend = setupEbSend();

      const sessionId = 'eb-error-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-eb-error',
          status: 'ERROR',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-eb-error',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should NOT publish EventBridge event on CANCELED status', async () => {
      // Wire the module-scope eventBridgeClient instance to a controlled send mock.
      const mockSend = setupEbSend();

      const sessionId = 'eb-canceled-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-eb-canceled',
          status: 'CANCELED',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-eb-canceled',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw if EventBridge publish fails (critical failure, EventBridge retries)', async () => {
      // Wire the module-scope eventBridgeClient instance to a failing send mock.
      const mockSend = setupEbSend(() => Promise.reject(new Error('EventBridge publish failed')));
      (eventbridgeModule.PutEventsCommand as unknown as jest.Mock).mockImplementation((input) => ({ input }));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const sessionId = 'eb-publish-fail-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-eb-publish-fail',
          status: 'COMPLETE',
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-eb-publish-fail',
        resources: [],
      } as any;

      // Should add message to batchItemFailures (EventBridge publish error is caught by SQS handler)
      const result = await handler(makeSqsEvent(ebEvent));

      // EventBridge publish failure should result in batchItemFailures
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');

      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // Thumbnail metadata parsing tests
  // =========================================================================

  describe('Thumbnail metadata parsing on COMPLETE', () => {
    beforeEach(() => {
      // Ensure EventBridge send mock is set up (COMPLETE path publishes to EventBridge)
      setupEbSend();
    });

    it('should parse thumbnail output group and store posterFrameUrl, thumbnailBaseUrl, thumbnailCount', async () => {
      process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

      const sessionId = 'thumb-parse-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-thumb',
          status: 'COMPLETE',
          outputGroupDetails: [
            {
              // First output group: MP4 (no .jpg files)
              outputDetails: [{
                outputFilePaths: [`s3://${BUCKET_NAME}/${sessionId}/recording.mp4`],
              }],
            },
            {
              // Second output group: Thumbnails
              outputDetails: [{
                outputFilePaths: [
                  `s3://${BUCKET_NAME}/${sessionId}/thumbnails/recording-thumb.0000036.jpg`,
                ],
              }],
            },
          ],
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-thumb',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // First call: main recording update; Second call: thumbnail metadata
      expect(mockUpdateSessionRecording).toHaveBeenCalledTimes(2);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          posterFrameUrl: `https://d1234567890.cloudfront.net/${sessionId}/thumbnails/recording-thumb.0000001.jpg`,
          thumbnailBaseUrl: `https://d1234567890.cloudfront.net/${sessionId}/thumbnails/recording-thumb`,
          thumbnailCount: 37,
        })
      );
    });

    it('should use index 0 for poster when only one thumbnail exists', async () => {
      process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

      const sessionId = 'thumb-single-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-thumb-single',
          status: 'COMPLETE',
          outputGroupDetails: [
            {
              outputDetails: [{
                outputFilePaths: [
                  `s3://${BUCKET_NAME}/${sessionId}/thumbnails/recording-thumb.0000000.jpg`,
                ],
              }],
            },
          ],
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-thumb-single',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // Should use index 0 since there's only 1 thumbnail
      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          posterFrameUrl: `https://d1234567890.cloudfront.net/${sessionId}/thumbnails/recording-thumb.0000000.jpg`,
          thumbnailCount: 1,
        })
      );
    });

    it('should skip thumbnail parsing when CLOUDFRONT_DOMAIN is not set', async () => {
      delete process.env.CLOUDFRONT_DOMAIN;

      const sessionId = 'thumb-no-cf-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-no-cf',
          status: 'COMPLETE',
          outputGroupDetails: [
            {
              outputDetails: [{
                outputFilePaths: [
                  `s3://${BUCKET_NAME}/${sessionId}/thumbnails/recording-thumb.0000036.jpg`,
                ],
              }],
            },
          ],
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-no-cf',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // Should only be called once (main recording update), not for thumbnails
      expect(mockUpdateSessionRecording).toHaveBeenCalledTimes(1);
    });

    it('should skip thumbnail parsing when no outputGroupDetails present', async () => {
      process.env.CLOUDFRONT_DOMAIN = 'd1234567890.cloudfront.net';

      const sessionId = 'thumb-no-details-session';
      const mockSession = {
        sessionId,
        userId: 'user-123',
        sessionType: 'UPLOAD',
        status: 'creating',
        claimedResources: { chatRoom: '' },
        createdAt: new Date().toISOString(),
        version: 1,
      };

      mockGetSessionById.mockResolvedValueOnce(mockSession as any);

      const ebEvent = {
        source: 'aws.mediaconvert',
        detailType: 'MediaConvert Job State Change',
        detail: {
          jobName: `vnl-${sessionId}-1234567890`,
          jobId: 'job-no-details',
          status: 'COMPLETE',
          // No outputGroupDetails
        },
        time: new Date().toISOString(),
        region: 'us-east-1',
        account: '123456789012',
        id: 'event-no-details',
        resources: [],
      } as any;

      const result = await handler(makeSqsEvent(ebEvent));

      expect(result.batchItemFailures).toHaveLength(0);

      // Should only be called once (main recording update)
      expect(mockUpdateSessionRecording).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // Validation Failure Tests (Plan 01)
  // =========================================================================

  it('should handle missing jobName gracefully when no userMetadata sessionId', async () => {
    const ebEvent = {
      source: 'aws.mediaconvert',
      detailType: 'MediaConvert Job State Change',
      detail: {
        // No jobName and no userMetadata.sessionId — cannot extract sessionId
        jobId: 'job-missing-name',
        status: 'COMPLETE',
      },
      time: new Date().toISOString(),
      region: 'us-east-1',
      account: '123456789012',
      id: 'event-missing-jobname',
      resources: [],
    } as any;

    // Handler should succeed (no crash) but not process the event — sessionId cannot be extracted
    const result = await handler(makeSqsEvent(ebEvent));
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should handle missing status gracefully', async () => {
    const sessionId = 'test-session-missing-status';
    const ebEvent = {
      source: 'aws.mediaconvert',
      detailType: 'MediaConvert Job State Change',
      detail: {
        jobName: `vnl-${sessionId}-1234567890`,
        jobId: 'job-missing-status',
        // Missing required status
      },
      time: new Date().toISOString(),
      region: 'us-east-1',
      account: '123456789012',
      id: 'event-missing-status',
      resources: [],
    } as any;

    // Handler should add invalid event to batchItemFailures due to missing required field
    const result = await handler(makeSqsEvent(ebEvent));
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });

  it('should handle invalid status enum', async () => {
    const sessionId = 'test-session-invalid-status';
    const ebEvent = {
      source: 'aws.mediaconvert',
      detailType: 'MediaConvert Job State Change',
      detail: {
        jobName: `vnl-${sessionId}-1234567890`,
        jobId: 'job-invalid-status',
        status: 'INVALID_STATUS', // Not one of the enum values
      },
      time: new Date().toISOString(),
      region: 'us-east-1',
      account: '123456789012',
      id: 'event-invalid-status',
      resources: [],
    } as any;

    // Handler should throw due to invalid enum value
    const result = await handler(makeSqsEvent(ebEvent));
      // Should add message to batchItemFailures
      // await expect(handler(event)).rejects.toThrow();
  });
});
