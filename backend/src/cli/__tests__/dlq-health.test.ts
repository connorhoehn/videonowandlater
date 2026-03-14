/**
 * Tests for dlq-health command
 * DLQ-04: Report approximate message count for all 5 pipeline DLQs
 */

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { dlqHealth } from '../commands/dlq-health';

const DLQ_NAMES = [
  'vnl-recording-ended-dlq',
  'vnl-transcode-completed-dlq',
  'vnl-transcribe-completed-dlq',
  'vnl-store-summary-dlq',
  'vnl-start-transcribe-dlq',
];

describe('dlq-health command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should call GetQueueUrl for each of 5 DLQ names', async () => {
    for (let i = 0; i < DLQ_NAMES.length; i++) {
      mockSend
        .mockResolvedValueOnce({
          QueueUrl: `https://sqs.us-west-2.amazonaws.com/123456789/${DLQ_NAMES[i]}`,
        })
        .mockResolvedValueOnce({
          Attributes: { ApproximateNumberOfMessages: String(i * 2) },
        });
    }

    await dlqHealth();

    // 5 GetQueueUrl + 5 GetQueueAttributes = 10 calls
    expect(mockSend).toHaveBeenCalledTimes(10);

    // Verify GetQueueUrl calls
    const getUrlCalls = mockSend.mock.calls.filter(
      (_call: unknown[], idx: number) => idx % 2 === 0
    );
    expect(getUrlCalls).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(getUrlCalls[i][0].input.QueueName).toBe(DLQ_NAMES[i]);
    }
  });

  it('should extract ApproximateNumberOfMessages from attributes', async () => {
    for (const name of DLQ_NAMES) {
      mockSend
        .mockResolvedValueOnce({
          QueueUrl: `https://sqs.us-west-2.amazonaws.com/123456789/${name}`,
        })
        .mockResolvedValueOnce({
          Attributes: { ApproximateNumberOfMessages: '5' },
        });
    }

    await dlqHealth();

    // Verify GetQueueAttributes calls request correct attributes
    const getAttrCalls = mockSend.mock.calls.filter(
      (_call: unknown[], idx: number) => idx % 2 === 1
    );
    for (const call of getAttrCalls) {
      expect(call[0].input.AttributeNames).toContain('ApproximateNumberOfMessages');
    }
  });

  it('should aggregate counts for all 5 DLQs in output', async () => {
    const counts = [0, 5, 0, 3, 1];
    for (let i = 0; i < DLQ_NAMES.length; i++) {
      mockSend
        .mockResolvedValueOnce({
          QueueUrl: `https://sqs.us-west-2.amazonaws.com/123456789/${DLQ_NAMES[i]}`,
        })
        .mockResolvedValueOnce({
          Attributes: { ApproximateNumberOfMessages: String(counts[i]) },
        });
    }

    await dlqHealth();

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    for (const name of DLQ_NAMES) {
      expect(logCalls).toContain(name);
    }
    expect(logCalls).toContain('5');
    expect(logCalls).toContain('3');
  });

  it('should handle queue errors gracefully and continue with others', async () => {
    // First queue errors, remaining succeed
    mockSend.mockRejectedValueOnce(new Error('Queue does not exist'));

    for (let i = 1; i < DLQ_NAMES.length; i++) {
      mockSend
        .mockResolvedValueOnce({
          QueueUrl: `https://sqs.us-west-2.amazonaws.com/123456789/${DLQ_NAMES[i]}`,
        })
        .mockResolvedValueOnce({
          Attributes: { ApproximateNumberOfMessages: '0' },
        });
    }

    await dlqHealth();

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain(DLQ_NAMES[0]);
    expect(logCalls).toContain(DLQ_NAMES[1]);
    expect(logCalls).toContain(DLQ_NAMES[4]);
  });
});
