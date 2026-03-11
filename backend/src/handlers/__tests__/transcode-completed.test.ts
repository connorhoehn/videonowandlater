/**
 * Tests for transcode-completed handler
 * SQS-wrapped handler for MediaConvert job completion events
 * Verifies Transcribe job submission and session status updates
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { handler } from '../transcode-completed';
import { updateTranscriptStatus } from '../../repositories/session-repository';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';

jest.mock('@aws-sdk/client-transcribe');
jest.mock('../../lib/dynamodb-client', () => ({
  getDocumentClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
}));
jest.mock('../../repositories/session-repository');

const mockTranscribeClient = TranscribeClient as jest.Mocked<typeof TranscribeClient>;
const mockUpdateTranscriptStatus = updateTranscriptStatus as jest.MockedFunction<typeof updateTranscriptStatus>;

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcode-completed',
      awsRegion: 'us-east-1',
    }],
  };
}

describe('transcode-completed handler', () => {
  const originalEnv = process.env;
  const mockTranscribeSend = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      TRANSCRIPTION_BUCKET: 'transcription-bucket',
      AWS_REGION: 'us-east-1',
    };
    jest.clearAllMocks();
    mockUpdateTranscriptStatus.mockResolvedValue(undefined);

    // Mock TranscribeClient instance
    (mockTranscribeClient as any).mockImplementation(() => ({
      send: mockTranscribeSend,
    }));

    // Default: Transcribe job starts successfully
    mockTranscribeSend.mockResolvedValue({
      TranscriptionJob: {
        TranscriptionJobName: 'vnl-test-session-123456',
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('accepts a valid COMPLETE MediaConvert event and returns batchItemFailures: []', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-complete',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'COMPLETE',
        jobId: 'job-abc123',
        userMetadata: {
          sessionId: 'test-session-id',
          phase: '19-transcription',
        },
        outputGroupDetails: [{
          outputDetails: [{
            outputFilePaths: ['s3://transcription-bucket/test-session-id/recordingrecording.mp4'],
          }],
        }],
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('starts a Transcribe job when MediaConvert status is COMPLETE', async () => {
    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-transcribe-start',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'COMPLETE',
        jobId: 'job-def456',
        userMetadata: {
          sessionId: 'session-transcribe-test',
          phase: '19-transcription',
        },
        outputGroupDetails: [{
          outputDetails: [{
            outputFilePaths: ['s3://transcription-bucket/session-transcribe-test/recordingrecording.mp4'],
          }],
        }],
      },
    }));

    // Verify TranscribeClient.send was called (Transcribe job submitted)
    expect(mockTranscribeSend).toHaveBeenCalledTimes(1);
    expect(mockTranscribeSend).toHaveBeenCalledWith(expect.any(StartTranscriptionJobCommand));

    // Verify transcript status was updated to processing
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session-transcribe-test',
      'processing'
    );
  });

  it('handles ERROR status gracefully and returns batchItemFailures: []', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-error',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'ERROR',
        jobId: 'job-failed',
        userMetadata: {
          sessionId: 'session-error-test',
          phase: '19-transcription',
        },
      },
    }));

    // ERROR is handled internally by processEvent — does NOT throw, so batchItemFailures is empty
    expect(result.batchItemFailures).toHaveLength(0);

    // Should mark transcript as failed
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session-error-test',
      'failed'
    );

    // Should NOT start Transcribe job
    expect(mockTranscribeSend).not.toHaveBeenCalled();
  });

  it('handles CANCELED status gracefully and returns batchItemFailures: []', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-canceled',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'CANCELED',
        jobId: 'job-canceled',
        userMetadata: {
          sessionId: 'session-canceled-test',
          phase: '19-transcription',
        },
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Should mark transcript as failed
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session-canceled-test',
      'failed'
    );
  });

  it('returns batchItemFailures with messageId when JSON body is malformed', async () => {
    const malformedSqsEvent: SQSEvent = {
      Records: [{
        messageId: 'bad-message-id',
        receiptHandle: 'test-receipt-handle',
        body: 'not-valid-json{{{',
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1234567890',
          SenderId: 'test-sender',
          ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcode-completed',
        awsRegion: 'us-east-1',
      }],
    };

    const result = await handler(malformedSqsEvent);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('bad-message-id');
  });

  it('handles missing sessionId in userMetadata gracefully', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-no-session',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'COMPLETE',
        jobId: 'job-no-session',
        userMetadata: {
          phase: '19-transcription',
          // sessionId intentionally omitted
        },
        outputGroupDetails: [{
          outputDetails: [{
            outputFilePaths: ['s3://bucket/recording.mp4'],
          }],
        }],
      },
    }));

    // Handler logs warning and returns early — no exception
    expect(result.batchItemFailures).toHaveLength(0);

    // Should NOT start Transcribe job (early return)
    expect(mockTranscribeSend).not.toHaveBeenCalled();
  });

  it('handles Transcribe submission failure without throwing (non-blocking)', async () => {
    mockTranscribeSend.mockRejectedValueOnce(new Error('Transcribe service unavailable'));

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-transcribe-fail',
      'detail-type': 'MediaConvert Job State Change',
      source: 'aws.mediaconvert',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        status: 'COMPLETE',
        jobId: 'job-transcribe-fail',
        userMetadata: {
          sessionId: 'session-transcribe-fail',
          phase: '19-transcription',
        },
        outputGroupDetails: [{
          outputDetails: [{
            outputFilePaths: ['s3://transcription-bucket/session-transcribe-fail/recordingrecording.mp4'],
          }],
        }],
      },
    }));

    // processEvent catches Transcribe failure and marks session as failed
    expect(result.batchItemFailures).toHaveLength(0);

    // Should mark as failed after Transcribe submission fails
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session-transcribe-fail',
      'failed'
    );
  });
});
