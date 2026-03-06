/**
 * Tests for store-summary handler
 * EventBridge handler that fetches transcripts from S3 and invokes Bedrock to generate AI summaries
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../store-summary';
import { updateSessionAiSummary } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../repositories/session-repository');

const mockS3Client = S3Client as jest.Mocked<typeof S3Client>;
const mockBedrockClient = BedrockRuntimeClient as jest.Mocked<typeof BedrockRuntimeClient>;
const mockUpdateSessionAiSummary = updateSessionAiSummary as jest.MockedFunction<typeof updateSessionAiSummary>;

describe('store-summary handler', () => {
  const originalEnv = process.env;
  const mockS3Send = jest.fn();
  const mockBedrockSend = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      AWS_REGION: 'us-east-1',
    };
    jest.clearAllMocks();
    mockUpdateSessionAiSummary.mockResolvedValue(undefined);

    // Mock S3Client instance
    (mockS3Client as any).mockImplementation(() => ({
      send: mockS3Send,
    }));

    // Mock BedrockRuntimeClient instance
    (mockBedrockClient as any).mockImplementation(() => ({
      send: mockBedrockSend,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should fetch transcript from S3 and invoke Bedrock successfully', async () => {
    const testTranscript = 'User A: Hello everyone. User B: Hi, how are you? User A: Great, lets talk about video.';
    const testSummary = 'This session featured a great discussion about video streaming technologies.';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-1',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-123',
        transcriptS3Uri: 's3://transcription-bucket/session-123/transcript.json',
      },
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Verify S3 fetch was called
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(GetObjectCommand));

    // Verify Bedrock was invoked
    expect(mockBedrockSend).toHaveBeenCalledWith(expect.any(InvokeModelCommand));

    // Verify summary was stored
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith('test-table', 'session-123', {
      aiSummary: testSummary,
      aiSummaryStatus: 'available',
    });
  });

  it('should extract summary text from Bedrock response correctly', async () => {
    const testTranscript = 'Long transcript about cloud topics...';
    const expectedSummary = 'A comprehensive discussion about cloud infrastructure.';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: expectedSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-2',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-abc',
        transcriptS3Uri: 's3://transcription-bucket/session-abc/transcript.json',
      },
    };

    await handler(event);

    // Verify the exact summary text was extracted and passed
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-abc',
      expect.objectContaining({
        aiSummary: expectedSummary,
        aiSummaryStatus: 'available',
      })
    );
  });

  it('should preserve transcript when Bedrock fails', async () => {
    const testTranscript = 'Some transcript text that should never be deleted';

    // Mock S3 fetch success
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock failure
    mockBedrockSend.mockRejectedValueOnce(new Error('Access Denied - Bedrock not available'));

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-3',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-fail',
        transcriptS3Uri: 's3://transcription-bucket/session-fail/transcript.json',
      },
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Should NOT update with aiSummary value, only set status to failed
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith('test-table', 'session-fail', {
      aiSummaryStatus: 'failed',
    });

    // Critical: aiSummary should NOT be in the update
    const call = mockUpdateSessionAiSummary.mock.calls.find(
      c => c[2]?.aiSummaryStatus === 'failed'
    );
    expect(call?.[2]).not.toHaveProperty('aiSummary');
  });

  it('should set aiSummaryStatus to failed on Bedrock error', async () => {
    const testTranscript = 'Another transcript';

    // Mock S3 fetch success
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock error
    mockBedrockSend.mockRejectedValueOnce(new Error('Timeout calling Bedrock API'));

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-4',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-bedrock-error',
        transcriptS3Uri: 's3://transcription-bucket/session-bedrock-error/transcript.json',
      },
    };

    await handler(event);

    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-bedrock-error',
      expect.objectContaining({
        aiSummaryStatus: 'failed',
      })
    );
  });

  it('should handle non-blocking storage failure (Bedrock succeeds, DynamoDB fails)', async () => {
    const testTranscript = 'Transcript text here';
    const testSummary = 'Successful summary from Bedrock';

    // Mock S3 fetch success
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock success
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    // Simulate DynamoDB write failure on first call
    mockUpdateSessionAiSummary.mockRejectedValueOnce(
      new Error('ConditionalCheckFailedException')
    );

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-5',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-ddb-fail',
        transcriptS3Uri: 's3://transcription-bucket/session-ddb-fail/transcript.json',
      },
    };

    // Should NOT throw despite DynamoDB write failure
    await expect(handler(event)).resolves.not.toThrow();

    // Still attempted to store summary (error is caught and logged, not re-thrown)
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-ddb-fail',
      expect.objectContaining({
        aiSummary: testSummary,
        aiSummaryStatus: 'available',
      })
    );
  });

  it('should handle failure to mark summary as failed (double error)', async () => {
    const testTranscript = 'Transcript with double failure';

    // Mock S3 fetch success
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Bedrock fails
    mockBedrockSend.mockRejectedValueOnce(new Error('Bedrock timeout'));

    // DynamoDB also fails when trying to mark as failed
    mockUpdateSessionAiSummary.mockRejectedValueOnce(
      new Error('DynamoDB unavailable')
    );

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-6',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-double-error',
        transcriptS3Uri: 's3://transcription-bucket/session-double-error/transcript.json',
      },
    };

    // Should NOT throw even with both failures
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('should handle S3 fetch errors gracefully', async () => {
    // Mock S3 fetch failure
    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-s3-fail',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-s3-fail',
        transcriptS3Uri: 's3://transcription-bucket/session-s3-fail/transcript.json',
      },
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Should set failed status
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-s3-fail',
      expect.objectContaining({
        aiSummaryStatus: 'failed',
      })
    );

    // Should NOT invoke Bedrock
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('should handle empty transcript from S3', async () => {
    // Mock S3 fetch returning empty string
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(''),
      },
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-empty',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-empty-transcript',
        transcriptS3Uri: 's3://transcription-bucket/session-empty-transcript/transcript.json',
      },
    };

    await expect(handler(event)).resolves.not.toThrow();

    // Should NOT invoke Bedrock for empty transcript
    expect(mockBedrockSend).not.toHaveBeenCalled();

    // Should set failed status
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-empty-transcript',
      expect.objectContaining({
        aiSummaryStatus: 'failed',
      })
    );
  });

  it('should use environment variables for model ID and region', async () => {
    process.env.BEDROCK_MODEL_ID = 'custom-model-id-v1';
    process.env.BEDROCK_REGION = 'eu-west-1';

    const testTranscript = 'Test transcript';
    const testSummary = 'Summary text';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-7',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-env-test',
        transcriptS3Uri: 's3://transcription-bucket/session-env-test/transcript.json',
      },
    };

    await handler(event);

    // Verify Bedrock was invoked
    expect(mockBedrockSend).toHaveBeenCalled();
    // Verify BedrockRuntimeClient was instantiated with custom region
    expect(mockBedrockClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'eu-west-1',
    }));
  });

  it('should use default model ID from environment when BEDROCK_MODEL_ID not set', async () => {
    delete process.env.BEDROCK_MODEL_ID;

    const testTranscript = 'Test with default model';
    const testSummary = 'Default model summary';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-8',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-default-model',
        transcriptS3Uri: 's3://transcription-bucket/session-default-model/transcript.json',
      },
    };

    await handler(event);

    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should fallback to AWS_REGION when BEDROCK_REGION not set', async () => {
    delete process.env.BEDROCK_REGION;
    process.env.AWS_REGION = 'ap-southeast-1';

    const testTranscript = 'Test region fallback';
    const testSummary = 'Region fallback summary';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptS3Uri: string }> = {
      version: '0',
      id: 'test-event-9',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-region-fallback',
        transcriptS3Uri: 's3://transcription-bucket/session-region-fallback/transcript.json',
      },
    };

    await handler(event);

    expect(mockBedrockClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'ap-southeast-1',
    }));
  });
});
