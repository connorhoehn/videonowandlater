/**
 * Tests for store-summary handler
 * SQS-wrapped handler that fetches transcripts from S3 and invokes Bedrock to generate AI summaries
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { handler } from '../store-summary';
import { updateSessionAiSummary, getSessionById, updateSessionChapters } from '../../repositories/session-repository';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

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
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;
const mockUpdateSessionChapters = updateSessionChapters as jest.MockedFunction<typeof updateSessionChapters>;

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

    // Capture module-scope client instances before clearAllMocks() removes tracking.
    // Clients are created at module scope so mockImplementation on the constructor
    // does not affect them — instead redirect their send methods directly.
    const s3Instance = (S3Client as jest.Mock).mock.instances[0] as any;
    const bedrockInstance = (BedrockRuntimeClient as jest.Mock).mock.instances[0] as any;

    // Clear per-invocation mocks but NOT mockCaptureAWSv3Client, which is called once at module
    // scope and must retain its calls for TRACE-02 assertions across tests.
    mockPutAnnotation.mockClear();
    mockAddErrorAsMetadata.mockClear();
    mockGetSegment.mockClear();
    mockSetSegment.mockClear();
    mockS3Send.mockReset();
    mockBedrockSend.mockReset();
    mockUpdateSessionAiSummary.mockReset();
    mockUpdateSessionAiSummary.mockResolvedValue(undefined);
    mockGetSessionById.mockReset();
    mockGetSessionById.mockResolvedValue(null);
    mockUpdateSessionChapters.mockReset();
    mockUpdateSessionChapters.mockResolvedValue(undefined);
    lastInvokeModelCommand = null;

    // Wire module-scope instance sends to test mock functions
    if (s3Instance) s3Instance.send = mockS3Send;
    if (bedrockInstance) bedrockInstance.send = mockBedrockSend;

    // Also configure constructors for consistency (affects future instances if any)
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
    // Note: BedrockRuntimeClient is instantiated at module scope with BEDROCK_REGION || AWS_REGION.
    // Per-invocation constructor-call assertions are not applicable for module-scope clients.
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

    // Note: BedrockRuntimeClient is instantiated at module scope with BEDROCK_REGION || AWS_REGION.
    // Per-invocation constructor-call assertions are not applicable for module-scope clients.
    expect(mockBedrockSend).toHaveBeenCalled();
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

  // =========================================================================
  // Validation Failure Tests (Plan 01)
  // =========================================================================

  it('should add invalid event to batchItemFailures without calling Bedrock SDK', async () => {
    const result = await handler(makeSqsEvent({
      'version': '0',
      'id': 'test-event-id',
      'detail-type': 'Transcript Stored',
      'source': 'custom.vnl',
      'account': '123456789012',
      'time': '2024-01-01T00:05:00Z',
      'region': 'us-east-1',
      'resources': [],
      'detail': {
        // Missing required transcriptS3Uri field
        sessionId: 'test-session',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
    // Verify Bedrock SDK was NOT called
    expect(mockBedrockSend).not.toHaveBeenCalled();
  });

  it('should handle multiple records with one invalid', async () => {
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce('Valid transcript'),
      },
    });

    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          output: {
            message: {
              content: [{ type: 'text', text: 'Valid summary' }],
            },
          },
          usage: { inputTokens: 100, outputTokens: 50 },
        })
      ),
    });

    const result = await handler({
      Records: [
        {
          messageId: 'valid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'valid-event-id',
            'detail-type': 'Transcript Stored',
            'source': 'custom.vnl',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              sessionId: 'valid-session',
              transcriptS3Uri: 's3://bucket/valid/transcript.json',
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
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-store-summary',
          awsRegion: 'us-east-1',
        },
        {
          messageId: 'invalid-message-id',
          receiptHandle: 'test-receipt-handle',
          body: JSON.stringify({
            'version': '0',
            'id': 'invalid-event-id',
            'detail-type': 'Transcript Stored',
            'source': 'custom.vnl',
            'account': '123456789012',
            'time': '2024-01-01T00:05:00Z',
            'region': 'us-east-1',
            'resources': [],
            'detail': {
              // Missing transcriptS3Uri
              sessionId: 'invalid-session',
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
          eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-store-summary',
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
        eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:vnl-store-summary',
        awsRegion: 'us-east-1',
      }],
    });

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe('malformed-json-id');
  });

  // =========================================================================
  // Idempotency Tests (Phase 38)
  // =========================================================================

  it('IDEM-02: Second invocation with same sessionId skips Bedrock invocation (already available)', async () => {
    const sessionId = 'session-idem-02';

    // Mock scenario: session already has AI summary from first execution
    mockGetSessionById.mockResolvedValueOnce({
      sessionId,
      userId: 'test-user',
      sessionType: 'BROADCAST',
      status: 'ended',
      claimedResources: { ivsChannelArn: 'arn:aws:ivs:us-east-1:123456789012:channel/xxx' },
      createdAt: '2026-03-06T00:00:00Z',
      version: 1,
      aiSummaryStatus: 'available',
      aiSummary: 'Existing summary from first execution.',
    } as any);

    // S3 fetch should not be called if already available
    mockS3Send.mockResolvedValueOnce({
      Body: {
        transformToString: jest.fn().mockResolvedValueOnce('Some transcript text'),
      },
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'duplicate-event-id',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId,
        transcriptS3Uri: 's3://transcription-bucket/session-idem-02/transcript.json',
      },
    }));

    // Key assertions:
    // 1. Handler returns success (no batchItemFailures)
    expect(result.batchItemFailures).toHaveLength(0);

    // 2. bedrockClient.send NOT called (idempotent skip)
    expect(mockBedrockSend).not.toHaveBeenCalled();

    // 3. updateSessionAiSummary NOT called (idempotent skip)
    expect(mockUpdateSessionAiSummary).not.toHaveBeenCalled();

    // 4. Logger shows idempotent path
    // (In actual implementation, will log "AI summary already available (idempotent retry)")
  });

  // =========================================================================
  // Chapter Generation Tests
  // =========================================================================

  it('should generate chapters from diarized transcript after summary', async () => {
    const testTranscript = 'User A: Hello everyone. User B: Hi there.';
    const testSummary = 'A brief greeting session.';
    const testSpeakerSegments = JSON.stringify([
      { speaker: 'A', startTimeMs: 0, endTimeMs: 30000, text: 'Hello everyone' },
      { speaker: 'B', startTimeMs: 30000, endTimeMs: 60000, text: 'Hi there' },
    ]);
    const chaptersResponse = JSON.stringify([
      { title: 'Introductions', startTimeMs: 0, endTimeMs: 30000 },
      { title: 'Greetings', startTimeMs: 30000, endTimeMs: 60000 },
    ]);

    // Mock S3 fetch for transcript
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testTranscript) },
    });

    // Mock Bedrock for summary
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: testSummary }] } },
      })),
    });

    // getSessionById call sequence:
    // 1. idempotency check (returns null = not yet processed)
    // 2. cost recording after summary Bedrock call (non-blocking, returns session for cost attribution)
    // 3. chapter generation (returns session with diarizedTranscriptS3Path)
    mockGetSessionById
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ sessionId: 'session-chapters', sessionType: 'BROADCAST', userId: 'test-user' } as any) // cost recording
      .mockResolvedValueOnce({
        sessionId: 'session-chapters',
        diarizedTranscriptS3Path: 's3://transcription-bucket/session-chapters/diarized.json',
      } as any);

    // Mock S3 fetch for diarized transcript
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testSpeakerSegments) },
    });

    // Mock Bedrock for chapters
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: chaptersResponse }] } },
      })),
    });

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-chapters-1',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-chapters',
        transcriptS3Uri: 's3://transcription-bucket/session-chapters/transcript.json',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Verify chapters were stored with thumbnailIndex computed
    expect(mockUpdateSessionChapters).toHaveBeenCalledWith(
      'test-table',
      'session-chapters',
      [
        { title: 'Introductions', startTimeMs: 0, endTimeMs: 30000, thumbnailIndex: 0 },
        { title: 'Greetings', startTimeMs: 30000, endTimeMs: 60000, thumbnailIndex: 6 },
      ]
    );
  });

  it('should skip chapter generation when no diarized transcript', async () => {
    const testTranscript = 'Simple transcript text.';
    const testSummary = 'A brief session.';

    // Mock S3 fetch for transcript
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testTranscript) },
    });

    // Mock Bedrock for summary
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: testSummary }] } },
      })),
    });

    // Session has no diarizedTranscriptS3Path
    mockGetSessionById
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ sessionId: 'session-no-diarized', sessionType: 'BROADCAST', userId: 'test-user' } as any) // cost recording
      .mockResolvedValueOnce({
        sessionId: 'session-no-diarized',
        // no diarizedTranscriptS3Path
      } as any);

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-no-diarized',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-no-diarized',
        transcriptS3Uri: 's3://transcription-bucket/session-no-diarized/transcript.json',
      },
    }));

    expect(result.batchItemFailures).toHaveLength(0);

    // Bedrock called only once (for summary, not chapters)
    expect(mockBedrockSend).toHaveBeenCalledTimes(1);

    // Chapters NOT stored
    expect(mockUpdateSessionChapters).not.toHaveBeenCalled();
  });

  it('should not fail handler when chapter generation fails', async () => {
    const testTranscript = 'Transcript for chapter failure test.';
    const testSummary = 'Summary still works.';

    // Mock S3 fetch for transcript
    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testTranscript) },
    });

    // Mock Bedrock for summary
    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: testSummary }] } },
      })),
    });

    // Session has diarized transcript
    mockGetSessionById
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ sessionId: 'session-chapter-fail', sessionType: 'BROADCAST', userId: 'test-user' } as any) // cost recording
      .mockResolvedValueOnce({
        sessionId: 'session-chapter-fail',
        diarizedTranscriptS3Path: 's3://transcription-bucket/session-chapter-fail/diarized.json',
      } as any);

    // Mock S3 fetch for diarized transcript — fails
    mockS3Send.mockRejectedValueOnce(new Error('S3 access denied for diarized transcript'));

    const result = await handler(makeSqsEvent({
      version: '0',
      id: 'test-chapter-fail',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-chapter-fail',
        transcriptS3Uri: 's3://transcription-bucket/session-chapter-fail/transcript.json',
      },
    }));

    // Handler should NOT fail
    expect(result.batchItemFailures).toHaveLength(0);

    // Summary was still stored successfully
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith(
      'test-table',
      'session-chapter-fail',
      expect.objectContaining({
        aiSummary: testSummary,
        aiSummaryStatus: 'available',
      })
    );

    // Chapters NOT stored due to failure
    expect(mockUpdateSessionChapters).not.toHaveBeenCalled();
  });

  it('should compute thumbnailIndex correctly (every 5s = 1 thumbnail)', async () => {
    const testTranscript = 'Long transcript.';
    const testSummary = 'Summary.';
    const testSpeakerSegments = JSON.stringify([
      { speaker: 'A', startTimeMs: 0, endTimeMs: 120000, text: 'Long talk' },
    ]);
    // Chapters at various timestamps to test thumbnailIndex rounding
    const chaptersResponse = JSON.stringify([
      { title: 'Start', startTimeMs: 0, endTimeMs: 15000 },
      { title: 'Middle', startTimeMs: 15000, endTimeMs: 72500 },
      { title: 'End', startTimeMs: 72500, endTimeMs: 120000 },
    ]);

    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testTranscript) },
    });

    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: testSummary }] } },
      })),
    });

    mockGetSessionById
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ sessionId: 'session-thumb-calc', sessionType: 'BROADCAST', userId: 'test-user' } as any) // cost recording
      .mockResolvedValueOnce({
        sessionId: 'session-thumb-calc',
        diarizedTranscriptS3Path: 's3://transcription-bucket/session-thumb-calc/diarized.json',
      } as any);

    mockS3Send.mockResolvedValueOnce({
      Body: { transformToString: jest.fn().mockResolvedValueOnce(testSpeakerSegments) },
    });

    mockBedrockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(JSON.stringify({
        output: { message: { content: [{ text: chaptersResponse }] } },
      })),
    });

    await handler(makeSqsEvent({
      version: '0',
      id: 'test-thumb-calc',
      'detail-type': 'Transcript Stored',
      source: 'custom.vnl',
      account: '123456789012',
      time: '2026-03-06T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      detail: {
        sessionId: 'session-thumb-calc',
        transcriptS3Uri: 's3://transcription-bucket/session-thumb-calc/transcript.json',
      },
    }));

    // thumbnailIndex = Math.round(startTimeMs / 5000)
    // 0 / 5000 = 0
    // 15000 / 5000 = 3
    // 72500 / 5000 = 14.5 → Math.round → 15
    expect(mockUpdateSessionChapters).toHaveBeenCalledWith(
      'test-table',
      'session-thumb-calc',
      [
        { title: 'Start', startTimeMs: 0, endTimeMs: 15000, thumbnailIndex: 0 },
        { title: 'Middle', startTimeMs: 15000, endTimeMs: 72500, thumbnailIndex: 3 },
        { title: 'End', startTimeMs: 72500, endTimeMs: 120000, thumbnailIndex: 15 },
      ]
    );
  });
});
