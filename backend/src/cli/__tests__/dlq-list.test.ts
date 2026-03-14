/**
 * Tests for dlq-list command
 * DLQ-01: List messages from a pipeline DLQ with decoded session context
 */

import {
  SQSClient,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';

jest.mock('@aws-sdk/client-sqs');

const mockSend = jest.fn();
(SQSClient as jest.MockedClass<typeof SQSClient>).mockImplementation(
  () => ({ send: mockSend } as unknown as SQSClient)
);

import { dlqList } from '../commands/dlq-list';

describe('dlq-list command', () => {
  const queueUrl = 'https://sqs.us-west-2.amazonaws.com/123456789/vnl-recording-ended-dlq';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'table').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should decode sessionId from SQS message body', async () => {
    mockSend.mockResolvedValueOnce({
      Messages: [
        {
          MessageId: 'msg-1',
          ReceiptHandle: 'handle-1',
          Body: JSON.stringify({
            source: 'aws.ivs',
            'detail-type': 'Recording End',
            detail: { sessionId: 'session-abc-123' },
          }),
          Attributes: { ApproximateReceiveCount: '3' },
        },
        {
          MessageId: 'msg-2',
          ReceiptHandle: 'handle-2',
          Body: JSON.stringify({
            source: 'aws.mediaconvert',
            'detail-type': 'MediaConvert Job State Change',
            detail: { sessionId: 'session-def-456' },
          }),
          Attributes: { ApproximateReceiveCount: '1' },
        },
        {
          MessageId: 'msg-3',
          ReceiptHandle: 'handle-3',
          Body: JSON.stringify({
            source: 'custom.vnl',
            'detail-type': 'Transcription Complete',
            detail: { sessionId: 'session-ghi-789' },
          }),
          Attributes: { ApproximateReceiveCount: '2' },
        },
      ],
    });

    await dlqList(queueUrl);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call).toBeInstanceOf(ReceiveMessageCommand);
    expect(call.input.QueueUrl).toBe(queueUrl);
    expect(call.input.MaxNumberOfMessages).toBe(10);

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain('session-abc-123');
    expect(logCalls).toContain('session-def-456');
    expect(logCalls).toContain('session-ghi-789');
    expect(logCalls).toContain('handle-1');
  });

  it('should retrieve batch with MaxNumberOfMessages=10', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [] });

    await dlqList(queueUrl);

    const call = mockSend.mock.calls[0][0];
    expect(call.input.MaxNumberOfMessages).toBe(10);
    expect(call.input.MessageAttributeNames).toEqual(['All']);
    expect(call.input.AttributeNames).toEqual(['All']);
  });

  it('should handle empty DLQ (no messages)', async () => {
    mockSend.mockResolvedValueOnce({ Messages: [] });

    await dlqList(queueUrl);

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain('No messages');
  });

  it('should handle malformed JSON body gracefully', async () => {
    mockSend.mockResolvedValueOnce({
      Messages: [
        {
          MessageId: 'msg-bad',
          ReceiptHandle: 'handle-bad',
          Body: 'not valid json {{{',
          Attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    });

    await dlqList(queueUrl);

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain('N/A');
    expect(logCalls).toContain('handle-bad');
  });
});
