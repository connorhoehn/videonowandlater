import { handler } from '../start-transcribe';
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { mockClient } from 'aws-sdk-client-mock';

const transcribeMock = mockClient(TranscribeClient);

// Mock environment variables
process.env.TABLE_NAME = 'test-table';
process.env.TRANSCRIPTION_BUCKET = 'test-transcription-bucket';

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-start-transcribe',
      awsRegion: 'us-east-1',
    }],
  };
}

describe('start-transcribe handler', () => {
  beforeEach(() => {
    transcribeMock.reset();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should successfully start Transcribe job for valid Upload Recording Available event', async () => {
    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-test-session-123-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'test-session-123',
        recordingHlsUrl: 's3://test-bucket/hls/test-session-123/master.m3u8',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];
    expect(command.input.TranscriptionJobName).toMatch(/^vnl-test-session-123-\d+$/);
    expect(command.input.Media?.MediaFileUri).toBe('s3://test-bucket/recordings/test-session-123/audio.mp4');
    expect(command.input.OutputBucketName).toBe('test-transcription-bucket');
    expect(command.input.OutputKey).toBe('test-session-123/transcript.json');
    expect(command.input.LanguageCode).toBe('en-US');
  });

  it('should handle missing sessionId in event detail gracefully', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        recordingHlsUrl: 's3://test-bucket/hls/test-session-123/master.m3u8',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);
    // Verify no Transcribe job was started (handler returns early on missing fields)
    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(0);
  });

  it('should handle Transcribe API errors without throwing', async () => {
    const mockError = new Error('Transcribe service unavailable');
    transcribeMock.on(StartTranscriptionJobCommand).rejects(mockError);

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'test-session-123',
        recordingHlsUrl: 's3://test-bucket/hls/test-session-123/master.m3u8',
      },
    }));

    // Should not fail — non-blocking error handling pattern
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should correctly format job name as vnl-{sessionId}-{epochMs}', async () => {
    const beforeTime = Date.now();

    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-my-special-session-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'my-special-session',
        recordingHlsUrl: 's3://test-bucket/hls/my-special-session/master.m3u8',
      },
    }));

    const afterTime = Date.now();

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];
    const jobName = command.input.TranscriptionJobName;

    // Check format
    expect(jobName).toMatch(/^vnl-my-special-session-\d+$/);

    // Extract and validate timestamp
    const timestamp = parseInt(jobName!.split('-').pop()!);
    expect(timestamp).toBeGreaterThanOrEqual(beforeTime);
    expect(timestamp).toBeLessThanOrEqual(afterTime);
  });

  it('should set correct S3 output location for transcript', async () => {
    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-output-test-session-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'output-test-session',
        recordingHlsUrl: 's3://test-bucket/hls/output-test-session/master.m3u8',
      },
    }));

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];

    // Verify output location
    expect(command.input.OutputBucketName).toBe('test-transcription-bucket');
    expect(command.input.OutputKey).toBe('output-test-session/transcript.json');
  });

  it('should include ShowSpeakerLabels: true and MaxSpeakerLabels: 2 in transcribe params', async () => {
    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-speaker-test-session-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-speaker',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-10T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'speaker-test-session',
        recordingHlsUrl: 's3://test-bucket/hls/speaker-test-session/master.m3u8',
      },
    }));

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];
    expect(command.input.Settings).toEqual({
      ShowSpeakerLabels: true,
      MaxSpeakerLabels: 2,
    });
  });

  it('should handle different HLS URL formats correctly', async () => {
    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-url-format-test-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-id',
      'detail-type': 'Upload Recording Available',
      source: 'vnl.upload',
      account: '123456789012',
      time: '2026-03-06T10:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'url-format-test',
        recordingHlsUrl: 's3://different-bucket/hls/url-format-test/master.m3u8',
      },
    }));

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];

    // Should convert HLS URL to audio MP4 URL
    expect(command.input.Media?.MediaFileUri).toBe('s3://different-bucket/recordings/url-format-test/audio.mp4');
  });

  it('should return batchItemFailures with messageId when JSON body is malformed', async () => {
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
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-start-transcribe',
        awsRegion: 'us-east-1',
      }],
    };

    const result = await handler(malformedSqsEvent);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('bad-message-id');
  });

  // =========================================================================
  // Validation Failure Tests (Plan 01)
  // =========================================================================

  it('should add invalid event to batchItemFailures without calling Transcribe SDK', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'Upload Recording Available',
      'source': 'vnl.upload',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        // Missing required sessionId field
        recordingHlsUrl: 's3://bucket/hls/session/master.m3u8',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
    // Verify Transcribe SDK was NOT called
    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(0);
  });

  it('should handle multiple records with one invalid', async () => {
    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: 'vnl-valid-session-1234567890',
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    const result = await handler({
      Records: [
        {
          messageId: 'valid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'valid-event-id',
            'detail-type': 'Upload Recording Available',
            'source': 'vnl.upload',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              sessionId: 'valid-session',
              recordingHlsUrl: 's3://bucket/hls/valid-session/master.m3u8',
            },
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'test-sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-start-transcribe',
          awsRegion: 'us-east-1',
        },
        {
          messageId: 'invalid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'invalid-event-id',
            'detail-type': 'Upload Recording Available',
            'source': 'vnl.upload',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              // Missing sessionId
              recordingHlsUrl: 's3://bucket/hls/invalid/master.m3u8',
            },
          }),
          attributes: {
            ApproximateReceiveCount: '1',
            SentTimestamp: '1234567890',
            SenderId: 'test-sender',
            ApproximateFirstReceiveTimestamp: '1234567890',
          },
          messageAttributes: {},
          md5OfBody: 'test-md5',
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-start-transcribe',
          awsRegion: 'us-east-1',
        },
      ],
    });

    // One invalid, one valid (valid should have been processed)
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('invalid-message-id');
    // Verify Transcribe was called once for the valid record
    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
  });

  it('should rethrow transient Transcribe errors to trigger SQS retry', async () => {
    const mockError = new Error('Service Unavailable');
    mockError.name = 'ServiceUnavailableException';
    transcribeMock.on(StartTranscriptionJobCommand).rejects(mockError);

    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'Upload Recording Available',
      'source': 'vnl.upload',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        sessionId: 'test-session',
        recordingHlsUrl: 's3://bucket/hls/test-session/master.m3u8',
      },
    }));

    // Handler should NOT catch this error; it should propagate to SQS for retry
    // This test documents the expected behavior (implementation in Plan 04)
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });
});
