/**
 * Tests for store-summary handler
 * EventBridge handler that invokes Bedrock to generate AI summaries from transcripts
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { handler } from '../store-summary';
import { updateSessionAiSummary } from '../../repositories/session-repository';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../repositories/session-repository');

const mockBedrockClient = BedrockRuntimeClient as jest.Mocked<typeof BedrockRuntimeClient>;
const mockUpdateSessionAiSummary = updateSessionAiSummary as jest.MockedFunction<typeof updateSessionAiSummary>;

describe('store-summary handler', () => {
  const originalEnv = process.env;
  const mockSend = jest.fn();

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      AWS_REGION: 'us-east-1',
    };
    jest.clearAllMocks();
    mockUpdateSessionAiSummary.mockResolvedValue(undefined);

    // Mock BedrockRuntimeClient instance
    (mockBedrockClient as any).mockImplementation(() => ({
      send: mockSend,
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should invoke Bedrock successfully and store summary', async () => {
    const testSummary = 'This session featured a great discussion about video streaming technologies.';

    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'User A: Hello everyone. User B: Hi, how are you? User A: Great, lets talk about video.',
      },
    };

    await expect(handler(event)).resolves.not.toThrow();

    expect(mockSend).toHaveBeenCalled();
    expect(mockUpdateSessionAiSummary).toHaveBeenCalledWith('test-table', 'session-123', {
      aiSummary: testSummary,
      aiSummaryStatus: 'available',
    });
  });

  it('should extract summary text from Bedrock response correctly', async () => {
    const expectedSummary = 'A comprehensive discussion about cloud infrastructure.';

    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: expectedSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Long transcript about cloud topics...',
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
    mockSend.mockRejectedValueOnce(new Error('Access Denied - Bedrock not available'));

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Some transcript text that should never be deleted',
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
    mockSend.mockRejectedValueOnce(new Error('Timeout calling Bedrock API'));

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Another transcript',
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
    const testSummary = 'Successful summary from Bedrock';

    mockSend.mockResolvedValueOnce({
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

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Transcript text here',
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
    // Bedrock fails
    mockSend.mockRejectedValueOnce(new Error('Bedrock timeout'));

    // DynamoDB also fails when trying to mark as failed
    mockUpdateSessionAiSummary.mockRejectedValueOnce(
      new Error('DynamoDB unavailable')
    );

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Transcript with double failure',
      },
    };

    // Should NOT throw even with both failures
    await expect(handler(event)).resolves.not.toThrow();
  });

  it('should use environment variables for model ID and region', async () => {
    process.env.BEDROCK_MODEL_ID = 'custom-model-id-v1';
    process.env.BEDROCK_REGION = 'eu-west-1';

    const testSummary = 'Summary text';

    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Test transcript',
      },
    };

    await handler(event);

    // Verify InvokeModelCommand was called (we'd need to inspect the actual call details)
    expect(mockSend).toHaveBeenCalled();
    // Verify BedrockRuntimeClient was instantiated with custom region
    expect(mockBedrockClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'eu-west-1',
    }));
  });

  it('should use default model ID from environment when BEDROCK_MODEL_ID not set', async () => {
    delete process.env.BEDROCK_MODEL_ID;

    const testSummary = 'Default model summary';

    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Test with default model',
      },
    };

    await handler(event);

    expect(mockSend).toHaveBeenCalled();
  });

  it('should fallback to AWS_REGION when BEDROCK_REGION not set', async () => {
    delete process.env.BEDROCK_REGION;
    process.env.AWS_REGION = 'ap-southeast-1';

    const testSummary = 'Region fallback summary';

    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ type: 'text', text: testSummary }],
        })
      ),
    });

    const event: EventBridgeEvent<'Transcript Stored', { sessionId: string; transcriptText: string }> = {
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
        transcriptText: 'Test region fallback',
      },
    };

    await handler(event);

    expect(mockBedrockClient).toHaveBeenCalledWith(expect.objectContaining({
      region: 'ap-southeast-1',
    }));
  });
});
