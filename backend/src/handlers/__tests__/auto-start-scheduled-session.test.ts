/**
 * Tests for auto-start-scheduled-session cron Lambda
 *
 * Behaviours:
 *  - Emits SESSION_READY_TO_START for sessions within the notification window
 *  - Auto-cancels sessions where host never went live (no-show)
 */

import { handler } from '../auto-start-scheduled-session';
import * as dynamodbClient from '../../lib/dynamodb-client';
import * as emitModule from '../../lib/emit-session-event';
import { SessionStatus } from '../../domain/session';
import { SessionEventType } from '../../domain/session-event';

jest.mock('../../lib/dynamodb-client');
jest.mock('../../lib/emit-session-event');

const mockGetDocumentClient = dynamodbClient.getDocumentClient as jest.MockedFunction<
  typeof dynamodbClient.getDocumentClient
>;
const mockEmit = emitModule.emitSessionEvent as jest.MockedFunction<
  typeof emitModule.emitSessionEvent
>;

describe('auto-start-scheduled-session handler', () => {
  const TABLE_NAME = 'test-table';
  const mockSend = jest.fn();

  beforeAll(() => {
    process.env.TABLE_NAME = TABLE_NAME;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
    mockEmit.mockResolvedValue(undefined);
  });

  test('emits SESSION_READY_TO_START for sessions in the notification window', async () => {
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockSend.mockResolvedValueOnce({
      Items: [
        { sessionId: 'soon-1', scheduledFor: fiveMinFromNow, userId: 'host-1' },
      ],
    });

    await handler({} as any, {} as any, (() => {}) as any);

    expect(mockEmit).toHaveBeenCalledWith(
      TABLE_NAME,
      expect.objectContaining({
        sessionId: 'soon-1',
        eventType: SessionEventType.SESSION_READY_TO_START,
      }),
    );
  });

  test('does not emit for sessions outside the notification window', async () => {
    const twoHoursFromNow = new Date(Date.now() + 120 * 60 * 1000).toISOString();
    mockSend.mockResolvedValueOnce({
      Items: [{ sessionId: 'far-future', scheduledFor: twoHoursFromNow, userId: 'host-1' }],
    });

    await handler({} as any, {} as any, (() => {}) as any);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('auto-cancels sessions whose host never went live (no-show)', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mockSend
      .mockResolvedValueOnce({
        Items: [{ sessionId: 'no-show', scheduledFor: twoHoursAgo, userId: 'host-2' }],
      })
      .mockResolvedValueOnce({}); // UpdateCommand

    await handler({} as any, {} as any, (() => {}) as any);

    // First call = Query, second = UpdateCommand for cancel
    const updateCall = mockSend.mock.calls[1][0];
    expect(updateCall.input.Key).toEqual({ PK: 'SESSION#no-show', SK: 'METADATA' });
    expect(updateCall.input.ExpressionAttributeValues[':canceled']).toBe(SessionStatus.CANCELED);

    // Emits SESSION_CANCELED with host_no_show reason
    expect(mockEmit).toHaveBeenCalledWith(
      TABLE_NAME,
      expect.objectContaining({
        sessionId: 'no-show',
        eventType: SessionEventType.SESSION_CANCELED,
        details: expect.objectContaining({ reason: 'host_no_show' }),
      }),
    );
  });

  test('handles conditional-check failures on cancel without throwing', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const condErr: any = new Error('cond check');
    condErr.name = 'ConditionalCheckFailedException';
    mockSend
      .mockResolvedValueOnce({
        Items: [{ sessionId: 'race', scheduledFor: twoHoursAgo, userId: 'host' }],
      })
      .mockRejectedValueOnce(condErr);

    await expect(handler({} as any, {} as any, (() => {}) as any)).resolves.not.toThrow();
  });

  test('gracefully returns when TABLE_NAME is not set', async () => {
    delete process.env.TABLE_NAME;
    await expect(handler({} as any, {} as any, (() => {}) as any)).resolves.not.toThrow();
    process.env.TABLE_NAME = TABLE_NAME; // restore
  });
});
