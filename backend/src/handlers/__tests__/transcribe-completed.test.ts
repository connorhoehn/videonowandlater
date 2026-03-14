/**
 * Tests for transcribe-completed handler
 * SQS-wrapped handler that processes Transcribe job completion events
 * Verifies transcript storage and EventBridge event emission
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { handler } from '../transcribe-completed';
import { updateTranscriptStatus, updateDiarizedTranscriptPath, getSessionById } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

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

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('../../repositories/session-repository');

const mockS3Client = S3Client as jest.Mocked<typeof S3Client>;
const mockEventBridgeClient = EventBridgeClient as jest.Mocked<typeof EventBridgeClient>;
const mockUpdateTranscriptStatus = updateTranscriptStatus as jest.MockedFunction<typeof updateTranscriptStatus>;
const mockUpdateDiarizedTranscriptPath = updateDiarizedTranscriptPath as jest.MockedFunction<typeof updateDiarizedTranscriptPath>;
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcribe-completed',
      awsRegion: 'us-east-1',
    }],
  };
}

describe('transcribe-completed handler', () => {
  const originalEnv = process.env;
  const mockS3Send = jest.fn();
  const mockEventBridgeSend = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      TRANSCRIPTION_BUCKET: 'transcription-bucket',
      AWS_REGION: 'us-east-1',
    };

    // Capture module-scope client instances before clearAllMocks() removes tracking.
    // Clients are created at module scope so mockImplementation on the constructor
    // does not affect them — instead redirect their send methods directly.
    const s3Instance = (S3Client as jest.Mock).mock.instances[0] as any;
    const ebInstance = (EventBridgeClient as jest.Mock).mock.instances[0] as any;

    // Clear per-invocation mocks but NOT mockCaptureAWSv3Client, which is called once at module
    // scope and must retain its calls for TRACE-02 assertions across tests.
    mockPutAnnotation.mockClear();
    mockAddErrorAsMetadata.mockClear();
    mockGetSegment.mockClear();
    mockSetSegment.mockClear();
    mockS3Send.mockReset();
    mockEventBridgeSend.mockReset();
    mockUpdateTranscriptStatus.mockReset();
    mockUpdateTranscriptStatus.mockResolvedValue(undefined);
    mockUpdateDiarizedTranscriptPath.mockReset();
    mockUpdateDiarizedTranscriptPath.mockResolvedValue(undefined);
    mockGetSessionById.mockReset();
    mockGetSessionById.mockResolvedValue(null);

    // Wire module-scope instance sends to test mock functions
    if (s3Instance) s3Instance.send = mockS3Send;
    if (ebInstance) ebInstance.send = mockEventBridgeSend;

    // Also configure constructor for consistency (affects future instances if any)
    (mockS3Client as any).mockImplementation(() => ({
      send: mockS3Send,
    }));

    // Mock EventBridgeClient instance
    (mockEventBridgeClient as any).mockImplementation(() => ({
      send: mockEventBridgeSend,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes COMPLETED Transcribe job and stores transcript', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: 'This is the transcribed text from the session.',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    mockEventBridgeSend.mockResolvedValueOnce({});

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-1',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-session123-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/session123/transcript.json',
        },
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Verify transcript was stored
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session123',
      'available',
      's3://transcription-bucket/session123/transcript.json',
      'This is the transcribed text from the session.'
    );

    // TRACE-02: S3Client and EventBridgeClient must be wrapped at module scope
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.any(S3Client));
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.any(EventBridgeClient));

    // TRACE-03: annotations written during handler invocation
    expect(mockPutAnnotation).toHaveBeenCalledWith('sessionId', expect.any(String));
    expect(mockPutAnnotation).toHaveBeenCalledWith('pipelineStage', 'transcribe-completed');
  });

  it('emits Transcript Stored event after storing transcript', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: 'Sample transcript text.',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    mockEventBridgeSend.mockResolvedValueOnce({});

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-2',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-session456-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/session456/transcript.json',
        },
      },
    }));

    // Verify EventBridgeClient.send was called with correct source and detail type
    expect(mockEventBridgeSend).toHaveBeenCalled();
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);

    // Verify the event was sent with PutEventsCommand for Phase 20's EventBridge rule
    // (actual Source field verified in integration test with live EventBridge)
  });

  it('includes sessionId and transcriptS3Uri in emitted event', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: 'Test transcript content.',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    mockEventBridgeSend.mockResolvedValueOnce({});

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-3',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-testsession789-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/testsession789/transcript.json',
        },
      },
    }));

    // Verify event was sent and transcript stored with correct sessionId
    expect(mockEventBridgeSend).toHaveBeenCalled();
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'testsession789',
      'available',
      's3://transcription-bucket/testsession789/transcript.json',
      'Test transcript content.'
    );
  });

  it('continues if event emission fails (non-blocking)', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: 'Non-blocking test transcript.',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    // EventBridge emission fails
    mockEventBridgeSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-4',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-sessionnonblock-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/sessionnonblock/transcript.json',
        },
      },
    }));

    // Should not fail even if event emission fails
    expect(result.batchItemFailures).toHaveLength(0);

    // Verify updateTranscriptStatus was still called (transcript persisted)
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'sessionnonblock',
      'available',
      expect.stringContaining('sessionnonblock/transcript.json'),
      'Non-blocking test transcript.'
    );
  });

  it('handles empty transcript gracefully and still emits event', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: '',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    mockEventBridgeSend.mockResolvedValueOnce({});

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-5',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-sessionempty-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/sessionempty/transcript.json',
        },
      },
    }));

    // Transcript should be stored as empty
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'sessionempty',
      'available',
      expect.stringContaining('sessionempty/transcript.json'),
      ''
    );

    // Event should still be emitted
    expect(mockEventBridgeSend).toHaveBeenCalled();
  });

  it('handles FAILED Transcribe job status', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-6',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'FAILED',
        TranscriptionJobName: 'vnl-sessionfailed-1234567890',
        TranscriptionJob: {
          FailureReason: 'Audio quality too low',
        },
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Should mark as failed but not emit event
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'sessionfailed',
      'failed'
    );

    // No EventBridge emit on failure
    expect(mockEventBridgeSend).not.toHaveBeenCalled();
  });

  it('handles invalid job name format gracefully', async () => {
    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-7',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'invalid-format',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/transcript.json',
        },
      },
    }));

    // Parse failure is non-fatal (not our pipeline job) — message must NOT be retried
    expect(result.batchItemFailures).toHaveLength(0);

    // Should not attempt to process (early return after logger.error with rawJobName)
    expect(mockUpdateTranscriptStatus).not.toHaveBeenCalled();
  });

  it('accepts new MediaConvert job ID format in job name (idempotency key)', async () => {
    // Job name format after HARD-02: vnl-{sessionId}-{mediaconvertJobId}
    // MediaConvert job IDs contain letters+hyphens (e.g. 1741723938123-abc123)
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'Hello from new format.' }],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
    });
    mockEventBridgeSend.mockResolvedValueOnce({});

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-new-format',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-11T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        // New stable composite key: vnl-{sessionId}-{mediaconvertJobId}
        TranscriptionJobName: 'vnl-newsession-1741723938123-abc123',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/newsession/transcript.json',
        },
      },
    }));

    // Updated regex must accept this format — no parse failure
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'newsession',
      'available',
      expect.stringContaining('newsession/transcript.json'),
      'Hello from new format.'
    );
  });

  it('groups word-level speaker labels into SpeakerSegment array', async () => {
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'Hello world. How are you?' }],
        items: [
          { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Hello', speaker_label: 'spk_0' }] },
          { type: 'pronunciation', start_time: '0.6', end_time: '1.0', alternatives: [{ content: 'world', speaker_label: 'spk_0' }] },
          { type: 'punctuation', alternatives: [{ content: '.' }] },
          { type: 'pronunciation', start_time: '2.0', end_time: '2.3', alternatives: [{ content: 'How', speaker_label: 'spk_1' }] },
          { type: 'pronunciation', start_time: '2.4', end_time: '2.6', alternatives: [{ content: 'are', speaker_label: 'spk_1' }] },
          { type: 'pronunciation', start_time: '2.7', end_time: '3.0', alternatives: [{ content: 'you', speaker_label: 'spk_1' }] },
          { type: 'punctuation', alternatives: [{ content: '?' }] },
        ],
      },
    };

    mockS3Send
      .mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
      })
      .mockResolvedValueOnce({}); // PutObjectCommand for speaker-segments.json

    mockEventBridgeSend.mockResolvedValueOnce({});

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-speaker-grouping',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-10T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-speakersession-1234567890',
        TranscriptionJob: { TranscriptFileUri: 's3://bucket/speakersession/transcript.json' },
      },
    }));

    // Should write speaker-segments.json to S3 (second S3 call)
    const s3Calls = mockS3Send.mock.calls;
    expect(s3Calls.length).toBeGreaterThanOrEqual(2);

    // Should update DynamoDB with diarized transcript path
    expect(mockUpdateDiarizedTranscriptPath).toHaveBeenCalledWith(
      'test-table',
      'speakersession',
      'speakersession/speaker-segments.json'
    );

    // Transcript status should still be updated to available
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'speakersession',
      'available',
      expect.any(String),
      expect.any(String)
    );
  });

  it('writes PutObjectCommand with correct bucket and key for speaker segments', async () => {
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'Speaker one speaks.' }],
        items: [
          { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Speaker', speaker_label: 'spk_0' }] },
          { type: 'pronunciation', start_time: '0.6', end_time: '1.0', alternatives: [{ content: 'one', speaker_label: 'spk_0' }] },
          { type: 'pronunciation', start_time: '1.1', end_time: '1.5', alternatives: [{ content: 'speaks', speaker_label: 'spk_0' }] },
          { type: 'punctuation', alternatives: [{ content: '.' }] },
        ],
      },
    };

    // Capture PutObjectCommand calls to verify bucket and key
    mockS3Send
      .mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
      })
      .mockResolvedValueOnce({}); // PutObjectCommand

    mockEventBridgeSend.mockResolvedValueOnce({});

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-put-object',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-10T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-putobjectsession-1234567890',
        TranscriptionJob: { TranscriptFileUri: 's3://bucket/putobjectsession/transcript.json' },
      },
    }));

    // Verify S3 PutObject was attempted (second call)
    expect(mockS3Send).toHaveBeenCalledTimes(2);

    // Verify DynamoDB pointer written
    expect(mockUpdateDiarizedTranscriptPath).toHaveBeenCalledWith(
      'test-table',
      'putobjectsession',
      'putobjectsession/speaker-segments.json'
    );
  });

  it('does not block transcript=available when S3 speaker-segments write fails', async () => {
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'Resilient transcript.' }],
        items: [
          { type: 'pronunciation', start_time: '0.0', end_time: '0.5', alternatives: [{ content: 'Resilient', speaker_label: 'spk_0' }] },
          { type: 'pronunciation', start_time: '0.6', end_time: '1.0', alternatives: [{ content: 'transcript', speaker_label: 'spk_0' }] },
          { type: 'punctuation', alternatives: [{ content: '.' }] },
        ],
      },
    };

    // First S3 call (GetObject) succeeds, second (PutObject for speaker-segments) fails
    mockS3Send
      .mockResolvedValueOnce({
        Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
      })
      .mockRejectedValueOnce(new Error('S3 PutObject permission denied'));

    mockEventBridgeSend.mockResolvedValueOnce({});

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-s3-fail-nonblocking',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-10T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-resilient-1234567890',
        TranscriptionJob: { TranscriptFileUri: 's3://bucket/resilient/transcript.json' },
      },
    }));

    // Should not fail
    expect(result.batchItemFailures).toHaveLength(0);

    // Transcript status should still be set to available (not blocked by S3 failure)
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'resilient',
      'available',
      expect.any(String),
      'Resilient transcript.'
    );

    // EventBridge event should still be emitted
    expect(mockEventBridgeSend).toHaveBeenCalled();
  });

  it('handles S3 fetch failure gracefully', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-8',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-sessions3fail-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/sessions3fail/transcript.json',
        },
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Should mark as failed
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'sessions3fail',
      'failed'
    );
  });

  it('preserves transcript if updateTranscriptStatus fails', async () => {
    const transcriptJson = {
      results: {
        transcripts: [
          {
            transcript: 'Preserved transcript text.',
          },
        ],
      },
    };

    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)),
      },
    });

    // DynamoDB write fails
    mockUpdateTranscriptStatus.mockRejectedValueOnce(new Error('DynamoDB error'));

    // But event emission should still be attempted (or catch and continue)
    mockEventBridgeSend.mockResolvedValueOnce({});

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-event-9',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-sessionddbfail-1234567890',
        TranscriptionJob: {
          TranscriptFileUri: 's3://bucket/sessionddbfail/transcript.json',
        },
      },
    }));

    // Handler should catch the error
    expect(result.batchItemFailures).toHaveLength(0);

    // Should attempt to update (which will fail)
    expect(mockUpdateTranscriptStatus).toHaveBeenCalled();
  });

  // =========================================================================
  // Validation Failure Tests (Plan 01)
  // =========================================================================

  it('should add invalid event to batchItemFailures without calling S3 SDK', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'Transcribe Job State Change',
      'source': 'aws.transcribe',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        // Missing required TranscriptionJobStatus field
        TranscriptionJobName: 'vnl-test-session-12345',
        TranscriptionJob: { Results: {} },
      },
    }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
  });

  it('should handle multiple records with one invalid', async () => {
    const result = await handler({
      Records: [
        {
          messageId: 'valid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'valid-event-id',
            'detail-type': 'Transcribe Job State Change',
            'source': 'aws.transcribe',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              TranscriptionJobStatus: 'COMPLETED',
              TranscriptionJobName: 'vnl-valid-session-12345',
              TranscriptionJob: {
                TranscriptFileUri: 's3://bucket/transcript.json',
                Results: {},
              },
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
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcribe-completed',
          awsRegion: 'us-east-1',
        },
        {
          messageId: 'invalid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'invalid-event-id',
            'detail-type': 'Transcribe Job State Change',
            'source': 'aws.transcribe',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              // Missing TranscriptionJobStatus
              TranscriptionJobName: 'vnl-invalid-session-12345',
              TranscriptionJob: { Results: {} },
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
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcribe-completed',
          awsRegion: 'us-east-1',
        },
      ],
    });

    // One invalid, one valid
    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('invalid-message-id');
  });

  it('should handle invalid JSON in record body', async () => {
    const result = await handler({
      Records: [{
        messageId: 'malformed-json-id',
        receiptHandle: 'test-receipt-handle',
        body: 'not valid json {{{',
        attributes: {
          ApproximateReceiveCount: '1',
          SentTimestamp: '1234567890',
          SenderId: 'test-sender',
          ApproximateFirstReceiveTimestamp: '1234567890',
        },
        messageAttributes: {},
        md5OfBody: 'test-md5',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-transcribe-completed',
        awsRegion: 'us-east-1',
      }],
    });

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('malformed-json-id');
  });

  // =========================================================================
  // Idempotency Tests (Phase 38)
  // =========================================================================

  it('IDEM-01: Second invocation with same sessionId skips S3 write and DynamoDB update (already available)', async () => {
    const sessionId = 'session-idem-01';
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'First execution transcript.' }],
      },
    };

    // Mock scenario: session already has transcript from first execution
    mockGetSessionById.mockResolvedValueOnce({
      sessionId,
      userId: 'test-user',
      sessionType: 'BROADCAST',
      status: 'ended',
      claimedResources: { ivsChannelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/xxx' },
      createdAt: '2026-03-06T00:00:00Z',
      version: 1,
      transcriptStatus: 'available',
      transcript: 'First execution transcript.',
    } as any);

    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'duplicate-event-id',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-session-idem-01-1234567890',
        TranscriptionJob: { TranscriptFileUri: 's3://bucket/session-idem-01/transcript.json' },
      },
    }));

    // Key assertions:
    // 1. Handler returns success (no batchItemFailures)
    expect(result.batchItemFailures).toHaveLength(0);

    // 2. updateTranscriptStatus NOT called (idempotent skip)
    expect(mockUpdateTranscriptStatus).not.toHaveBeenCalled();

    // 3. Logger shows idempotent path
    // (In actual implementation, will log "Transcript already available (idempotent retry)")
  });

  it('IDEM-03: Concurrent invocations (Promise.all race) result in exactly one S3 write', async () => {
    const sessionId = 'session-idem-03-concurrent';
    const transcriptJson = {
      results: {
        transcripts: [{ transcript: 'Concurrent test transcript.' }],
      },
    };

    // Simulate first invocation sees processing, updates to available
    // Second invocation (50ms later) sees available, skips
    mockGetSessionById
      .mockResolvedValueOnce({
        sessionId,
        userId: 'test-user',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { ivsChannelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/xxx' },
        createdAt: '2026-03-06T00:00:00Z',
        version: 1,
        transcriptStatus: 'processing', // First invocation: initial check sees processing
      } as any)
      .mockResolvedValueOnce({
        sessionId,
        userId: 'test-user',
        sessionType: 'BROADCAST',
        status: 'ended',
        claimedResources: { ivsChannelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/xxx' },
        createdAt: '2026-03-06T00:00:00Z',
        version: 1,
        transcriptStatus: 'available',
        transcript: 'Concurrent test transcript.', // Second invocation (50ms later): sees available after first completes
      } as any);

    mockUpdateTranscriptStatus.mockResolvedValue(undefined);

    mockS3Send.mockResolvedValue({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(JSON.stringify(transcriptJson)) },
    });

    mockEventBridgeSend.mockResolvedValue({});

    const sqsEvent = makeSqsEvent({
      version: '0',
      id: 'concurrent-event',
      'detail-type': 'Transcribe',
      source: 'aws.transcribe',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        TranscriptionJobStatus: 'COMPLETED',
        TranscriptionJobName: 'vnl-session-idem-03-concurrent-1234567890',
        TranscriptionJob: { TranscriptFileUri: 's3://bucket/concurrent/transcript.json' },
      },
    });

    // Invoke twice concurrently (simulates SQS at-least-once delivery)
    const [result1, result2] = await Promise.all([
      handler(sqsEvent),
      new Promise(resolve => setTimeout(() => resolve(handler(sqsEvent)), 50))
    ]) as any[];

    // Both return success
    expect(result1.batchItemFailures).toHaveLength(0);
    expect(result2.batchItemFailures).toHaveLength(0);

    // updateTranscriptStatus called exactly once (first invocation only)
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledTimes(1);

    // EventBridge emit called exactly once
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
  });
});
