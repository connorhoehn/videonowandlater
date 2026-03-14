/**
 * Tests for dlq-redrive command
 * DLQ-02: Re-drive all messages from a DLQ back to source queue
 */

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

import { dlqRedrive } from '../commands/dlq-redrive';

describe('dlq-redrive command', () => {
  const dlqArn = 'arn:aws:sqs:us-west-2:123456789:vnl-recording-ended-dlq';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should check ListMessageMoveTasks before starting redrive', async () => {
    mockSend
      .mockResolvedValueOnce({ Results: [] }) // ListMessageMoveTasks
      .mockResolvedValueOnce({ TaskHandle: 'task-handle-abc' }); // StartMessageMoveTask

    await dlqRedrive(dlqArn);

    expect(mockSend).toHaveBeenCalledTimes(2);
    const listCall = mockSend.mock.calls[0][0];
    expect(listCall.input.SourceArn).toBe(dlqArn);
  });

  it('should start message move task and return TaskHandle', async () => {
    mockSend
      .mockResolvedValueOnce({ Results: [] })
      .mockResolvedValueOnce({ TaskHandle: 'task-handle-xyz' });

    await dlqRedrive(dlqArn);

    const startCall = mockSend.mock.calls[1][0];
    expect(startCall.input.SourceArn).toBe(dlqArn);

    const logCalls = (console.log as jest.Mock).mock.calls.flat().join('\n');
    expect(logCalls).toContain('task-handle-xyz');
  });

  it('should throw error if active task already running', async () => {
    mockSend.mockResolvedValueOnce({
      Results: [
        { TaskHandle: 'existing-task-123', Status: 'RUNNING' },
      ],
    });

    await expect(dlqRedrive(dlqArn)).rejects.toThrow(/already running/i);
    expect(mockSend).toHaveBeenCalledTimes(1); // Only ListMessageMoveTasks called
  });
});
