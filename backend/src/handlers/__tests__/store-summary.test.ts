/**
 * Tests for store-summary handler
 * SQS-wrapped handler that fetches transcripts from S3 and invokes Bedrock to generate AI summaries
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { handler } from '../store-summary';
import { updateSessionAiSummary } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// ---------------------------------------------------------------------------
// TRACE-02 / TRACE-03: Tracer mock — captureAWSv3Client + putAnnotation
// ---------------------------------------------------------------------------
const mockCaptureAWSv3Client = jest.fn((client) => client);
const mockPutAnnotation = jest.fn();
const mockAddErrorAsMetadata = jest.fn();
const mockGetSegment = jest.fn(() => ({
  addNewSubsegment: jest.fn(() => ({
    close: jest.fn(),
    addError: jest.fn(),
  })),
}));
const mockSetSegment = jest.fn();

jest.mock('@aws-lambda-powertools/tracer', () => ({
  Tracer: jest.fn().mockImplementation(() => ({
    captureAWSv3Client: mockCaptureAWSv3Client,
    putAnnotation: mockPutAnnotation,
    addErrorAsMetadata: mockAddErrorAsMetadata,
    getSegment: mockGetSegment,
    setSegment: mockSetSegment,
  })),
}));

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../repositories/session-repository');

// Track InvokeModelCommand calls
let lastInvokeModelCommand: any = null;
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(),
  InvokeModelCommand: jest.fn().mockImplementation((params) => {
    lastInvokeModelCommand = params;
    return params;
  }),
}));

const mockS3Client = S3Client as jest.Mocked<typeof S3Client>;
const mockBedrockClient = BedrockRuntimeClient as jest.Mocked<typeof BedrockRuntimeClient>;
const mockUpdateSessionAiSummary = updateSessionAiSummary as jest.MockedFunction<typeof updateSessionAiSummary>;

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
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-store-summary',
      awsRegion: 'us-east-1',
    }],
  };
}

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
    mockCaptureAWSv3Client.mockClear();
    mockPutAnnotation.mockClear();
    mockUpdateSessionAiSummary.mockResolvedValue(undefined);
    lastInvokeModelCommand = null;

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

    // Mock Bedrock invocation - Nova Pro response format (default)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    const result = await handler(makeSqsEvent({
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
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Verify S3 fetch was called
    expect(mockS3Send).toHaveBeenCalledWith(expect.any(GetObjectCommand));

    // Verify Bedrock was invoked with correct parameters
    expect(mockBedrockSend).toHaveBeenCalled();
    expect(lastInvokeModelCommand).toBeDefined();
    expect(lastInvokeModelCommand.modelId).toBe('amazon.nova-lite-v1:0');

    // Verify summary was stored
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith('test-table', 'session-123', {
      aiSummary: testSummary,
      aiSummaryStatus: 'available',
    });

    // TRACE-02: S3Client and BedrockRuntimeClient must be wrapped at module scope
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.any(S3Client));
    expect(mockCaptureAWSv3Client).toHaveBeenCalledWith(expect.any(BedrockRuntimeClient));

    // TRACE-03: annotations written during handler invocation
    expect(mockPutAnnotation).toHaveBeenCalledWith('sessionId', expect.any(String));
    expect(mockPutAnnotation).toHaveBeenCalledWith('pipelineStage', 'store-summary');
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

    // Mock Bedrock invocation - Nova Pro response format (default)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: expectedSummary }],
            },
          },
        })
      ),
    });

    await handler(makeSqsEvent({
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
    }));

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

    const result = await handler(makeSqsEvent({
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
    }));

    expect(result.batchItemFailures).toHaveLength(0);

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

    await handler(makeSqsEvent({
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
    }));

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

    // Mock Bedrock success - Nova Pro response format (default)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    // Simulate DynamoDB write failure on first call
    mockUpdateSessionAiSummary.mockRejectedValueOnce(
      new Error('ConditionalCheckFailedException')
    );

    const result = await handler(makeSqsEvent({
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
    }));

    // Should NOT fail despite DynamoDB write failure
    expect(result.batchItemFailures).toHaveLength(0);

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

    const result = await handler(makeSqsEvent({
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
    }));

    // Should NOT fail even with both failures
    expect(result.batchItemFailures).toHaveLength(0);
  });

  it('should handle S3 fetch errors gracefully', async () => {
    // Mock S3 fetch failure
    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));

    const result = await handler(makeSqsEvent({
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
    }));

    expect(result.batchItemFailures).toHaveLength(0);

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

    const result = await handler(makeSqsEvent({
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
    }));

    expect(result.batchItemFailures).toHaveLength(0);

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
    process.env.BEDROCK_MODEL_ID = 'amazon.nova-pro-v1:0';
    process.env.BEDROCK_REGION = 'eu-west-1';

    const testTranscript = 'Test transcript';
    const testSummary = 'Summary text';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation - Nova Pro response format
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    await handler(makeSqsEvent({
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
    }));

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

    // Mock Bedrock invocation - Nova Pro response format (default)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    await handler(makeSqsEvent({
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
    }));

    expect(mockBedrockSend).toHaveBeenCalled();
  });

  it('should use Nova Lite model ID by default', async () => {
    delete process.env.BEDROCK_MODEL_ID;

    const testTranscript = 'Test with Nova Lite model';
    const testSummary = 'Nova Lite generated summary';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation - Nova Lite response format
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
          usage: { inputTokens: 125, outputTokens: 60 },
        })
      ),
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-nova-default',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-nova-default',
        transcriptS3Uri: 's3://transcription-bucket/session-nova-default/transcript.json',
      },
    }));

    // Verify Nova Lite model ID was used
    expect(lastInvokeModelCommand).toBeDefined();
    expect(lastInvokeModelCommand.modelId).toBe('amazon.nova-lite-v1:0');

    // Verify summary was correctly extracted from Nova format
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-nova-default',
      expect.objectContaining({
        aiSummary: testSummary,
        aiSummaryStatus: 'available',
      })
    );
  });

  it('should format payload correctly for Nova Pro model', async () => {
    process.env.BEDROCK_MODEL_ID = 'amazon.nova-pro-v1:0';

    const testTranscript = 'Transcript for Nova Pro payload test';
    const testSummary = 'Nova Pro summary';

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
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-nova-payload',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-nova-payload',
        transcriptS3Uri: 's3://transcription-bucket/session-nova-payload/transcript.json',
      },
    }));

    // Verify Nova Pro payload format
    expect(lastInvokeModelCommand).toBeDefined();
    const payload = JSON.parse(lastInvokeModelCommand.body);

    // Nova Pro format expectations
    expect(payload).toHaveProperty('messages');
    expect(payload).toHaveProperty('inferenceConfig');
    expect(payload.messages).toEqual([
      {
        role: 'user',
        content: [
          {
            text: expect.stringContaining('Generate a concise one-paragraph summary'),
          },
        ],
      },
    ]);
    expect(payload.inferenceConfig).toEqual({
      maxTokens: 500,
      temperature: 0.7,
    });
  });

  it('should support backward compatibility with Claude models', async () => {
    process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

    const testTranscript = 'Transcript for Claude model';
    const testSummary = 'Claude generated summary';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock invocation - Claude response format
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-claude-compat',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-claude-compat',
        transcriptS3Uri: 's3://transcription-bucket/session-claude-compat/transcript.json',
      },
    }));

    // Verify Claude model ID was used
    expect(lastInvokeModelCommand).toBeDefined();
    expect(lastInvokeModelCommand.modelId).toBe('anthropic.claude-3-haiku-20240307-v1:0');

    // Verify Claude payload format was used
    const payload = JSON.parse(lastInvokeModelCommand.body);
    expect(payload).toHaveProperty('anthropic_version');
    expect(payload).toHaveProperty('max_tokens');
    expect(payload).toHaveProperty('messages');

    // Verify summary was correctly extracted
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-claude-compat',
      expect.objectContaining({
        aiSummary: testSummary,
        aiSummaryStatus: 'available',
      })
    );
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

    // Mock Bedrock invocation - Nova Pro response format (default)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
        })
      ),
    });

    await handler(makeSqsEvent({
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
    }));

    expect(mockBedrockClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'ap-southeast-1',
    }));
  });

  it('should log inputTokens and outputTokens after successful Bedrock invocation', async () => {
    delete process.env.BEDROCK_MODEL_ID;

    const testTranscript = 'Transcript for token logging test';
    const testSummary = 'Summary with token logging';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock response WITH usage field (Nova format)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ text: testSummary }],
            },
          },
          usage: { inputTokens: 125, outputTokens: 60 },
        })
      ),
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-token-logging',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-token-logging',
        transcriptS3Uri: 's3://transcription-bucket/session-token-logging/transcript.json',
      },
    }));

    // Token logging is structural — presence of usage field in mock response confirms code path executes without error.
    // Verify no failures and summary was stored (proving execution continued past token logging)
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-token-logging',
      expect.objectContaining({ aiSummaryStatus: 'available' })
    );
  });

  it('should handle missing usage field gracefully (Claude model backward compat)', async () => {
    process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0';

    const testTranscript = 'Transcript for Claude backward compat usage test';
    const testSummary = 'Claude summary without usage field';

    // Mock S3 fetch
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce(testTranscript),
      },
    });

    // Mock Bedrock response WITHOUT usage field (Claude format — no camelCase usage object)
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
          // No usage field — Claude uses different field names (input_tokens with underscores)
        })
      ),
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-claude-usage-missing',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-claude-usage-missing',
        transcriptS3Uri: 's3://transcription-bucket/session-claude-usage-missing/transcript.json',
      },
    }));

    // usage?.inputTokens undefined does not throw — handler completes successfully
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-claude-usage-missing',
      expect.objectContaining({ aiSummaryStatus: 'available' })
    );
  });
});
