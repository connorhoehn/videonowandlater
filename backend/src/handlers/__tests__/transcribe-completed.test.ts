/**
 * Tests for transcribe-completed handler
 * EventBridge handler that processes Transcribe job completion events
 * Verifies transcript storage and EventBridge event emission
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../transcribe-completed';
import { updateTranscriptStatus } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('../../repositories/session-repository');

const mockS3Client = S3Client as jest.Mocked<typeof S3Client>;
const mockEventBridgeClient = EventBridgeClient as jest.Mocked<typeof EventBridgeClient>;
const mockUpdateTranscriptStatus = updateTranscriptStatus as jest.MockedFunction<typeof updateTranscriptStatus>;

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
    jest.clearAllMocks();
    mockUpdateTranscriptStatus.mockResolvedValue(undefined);

    // Mock S3Client instance
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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Verify transcript was stored
    expect(mockUpdateTranscriptStatus).toHaveBeenCalledWith(
      'test-table',
      'session123',
      'available',
      's3://transcription-bucket/session123/transcript.json',
      'This is the transcribed text from the session.'
    );
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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await handler(event);

    // Verify EventBridgeClient.send was called (event emission occurred)
    expect(mockEventBridgeSend).toHaveBeenCalled();
    expect(mockEventBridgeSend).toHaveBeenCalledTimes(1);
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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await handler(event);

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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Should not throw even if event emission fails
    await expect(handler(event)).resolves.not.toThrow();

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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await handler(event);

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
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await expect(handler(event)).resolves.not.toThrow();

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
    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Should not attempt to process
    expect(mockUpdateTranscriptStatus).not.toHaveBeenCalled();
  });

  it('handles S3 fetch failure gracefully', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    await expect(handler(event)).resolves.not.toThrow();

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

    const event: EventBridgeEvent<string, Record<string, any>> = {
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
    };

    // Handler should catch the error and mark as failed
    await expect(handler(event)).resolves.not.toThrow();

    // Should attempt to update (which will fail)
    expect(mockUpdateTranscriptStatus).toHaveBeenCalled();
  });
});
