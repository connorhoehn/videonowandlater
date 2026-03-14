/**
 * Tests for dlq-purge command
 * DLQ-03: Delete a specific DLQ message by receipt handle
 */

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { dlqPurge } from '../commands/dlq-purge';

describe('dlq-purge command', () => {
  const queueUrl = 'https://sqs.us-west-2.amazonaws.com/123456789/vnl-recording-ended-dlq';
  const receiptHandle = 'AQEBwJnKyrHigUMZj6rYigCgxlaS3SLy0a...';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should delete message with correct QueueUrl and ReceiptHandle', async () => {
    mockSend.mockResolvedValueOnce({});

    await dlqPurge(queueUrl, receiptHandle);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.input.QueueUrl).toBe(queueUrl);
    expect(call.input.ReceiptHandle).toBe(receiptHandle);

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain('deleted');
  });

  it('should throw error for invalid ReceiptHandle', async () => {
    mockSend.mockRejectedValueOnce(new Error('The input receipt handle is invalid'));

    await expect(dlqPurge(queueUrl, 'invalid-handle')).rejects.toThrow(/receipt handle/i);
  });
});
