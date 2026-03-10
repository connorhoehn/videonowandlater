import { handler } from '../start-transcribe';
import { EventBridgeEvent } from 'aws-lambda';
import { TranscribeClient, StartTranscriptionJobCommand } from '@aws-sdk/client-transcribe';
import { mockClient } from 'aws-sdk-client-mock';

const transcribeMock = mockClient(TranscribeClient);

// Mock environment variables
process.env.TABLE_NAME = 'test-table';
process.env.TRANSCRIPTION_BUCKET = 'test-transcription-bucket';

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
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-test-session-123-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(mockEvent);

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];
    expect(command.input.TranscriptionJobName).toMatch(/^vnl-test-session-123-\d+$/);
    expect(command.input.Media?.MediaFileUri).toBe('s3://test-bucket/recordings/test-session-123/audio.mp4');
    expect(command.input.OutputBucketName).toBe('test-transcription-bucket');
    expect(command.input.OutputKey).toBe('test-session-123/transcript.json');
    expect(command.input.LanguageCode).toBe('en-US');
  });

  it('should handle missing sessionId in event detail gracefully', async () => {
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    await handler(mockEvent);

    // Verify no Transcribe job was started (handler returns early on missing fields)
    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(0);
  });

  it('should handle Transcribe API errors without throwing', async () => {
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    const mockError = new Error('Transcribe service unavailable');
    transcribeMock.on(StartTranscriptionJobCommand).rejects(mockError);

    // Should not throw — non-blocking error handling pattern
    await expect(handler(mockEvent)).resolves.not.toThrow();
  });

  it('should correctly format job name as vnl-{sessionId}-{epochMs}', async () => {
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    const beforeTime = Date.now();

    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-my-special-session-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(mockEvent);

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
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-output-test-session-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(mockEvent);

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];

    // Verify output location
    expect(command.input.OutputBucketName).toBe('test-transcription-bucket');
    expect(command.input.OutputKey).toBe('output-test-session/transcript.json');
  });

  it('should handle different HLS URL formats correctly', async () => {
    const mockEvent: EventBridgeEvent<'Upload Recording Available', any> = {
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
    };

    transcribeMock.on(StartTranscriptionJobCommand).resolves({
      TranscriptionJob: {
        TranscriptionJobName: `vnl-url-format-test-${Date.now()}`,
        TranscriptionJobStatus: 'IN_PROGRESS',
      },
    });

    await handler(mockEvent);

    expect(transcribeMock.commandCalls(StartTranscriptionJobCommand)).toHaveLength(1);
    const command = transcribeMock.commandCalls(StartTranscriptionJobCommand)[0].args[0];

    // Should convert HLS URL to audio MP4 URL
    expect(command.input.Media?.MediaFileUri).toBe('s3://different-bucket/recordings/url-format-test/audio.mp4');
  });
});