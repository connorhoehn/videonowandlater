/**
 * Tests for on-mediaconvert-complete Lambda handler
 * EventBridge-triggered MediaConvert job completion handling
 */

import type { EventBridgeEvent } from 'aws-lambda';
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, sessionId);
      expect(mockUpdateSessionRecording).toHaveBeenCalled();
    });

    it('should set recordingStatus=available on COMPLETE', async () => {
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          recordingStatus: 'available',
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          convertStatus: 'available',
        })
      );
    });

    it('should set status=ended on COMPLETE', async () => {
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          status: 'ended',
        })
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockGetSessionById).toHaveBeenCalledWith(TABLE_NAME, sessionId);
    });

    it('should log error when jobName cannot be parsed', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Could not parse sessionId/)
      );
      expect(mockGetSessionById).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Session lookup', () => {
    it('should log error when session not found', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      mockGetSessionById.mockResolvedValueOnce(null);

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Session not found/)
      );
      expect(mockUpdateSessionRecording).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Error handling', () => {
    it('should throw on DynamoDB errors (critical error)', async () => {
      mockGetSessionById.mockRejectedValueOnce(new Error('DynamoDB error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      // Should throw — DynamoDB failure is a critical error
      await expect(handler(event)).rejects.toThrow('DynamoDB error');

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('HLS URL construction', () => {
    it('should construct recordingHlsUrl with s3://{bucket}/hls/{sessionId}/master.m3u8 format', async () => {
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

      expect(mockUpdateSessionRecording).toHaveBeenCalledWith(
        TABLE_NAME,
        sessionId,
        expect.objectContaining({
          recordingHlsUrl: `s3://${BUCKET_NAME}/hls/${sessionId}/master.m3u8`,
        })
      );
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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      await handler(event);

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

      const event: EventBridgeEvent<'MediaConvert Job State Change', any> = {
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

      // Should throw — PutEvents failure is a critical error; EventBridge will retry
      await expect(handler(event)).rejects.toThrow('EventBridge publish failed');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringMatching(/on-mediaconvert-complete error/),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});
