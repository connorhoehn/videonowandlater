/**
 * Unit tests for scan-stuck-sessions handler
 * Covers all skip criteria and the happy-path recovery flow.
 */

import { handler } from '../scan-stuck-sessions';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

// Mock the DynamoDB document client factory
jest.mock('../../lib/dynamodb-client');
// Mock the DynamoDB lib-dynamodb commands (QueryCommand, UpdateCommand constructors)
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    QueryCommand: jest.fn().mockImplementation((params) => ({ ...params, __type: 'QueryCommand' })),
    UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params, __type: 'UpdateCommand' })),
  };
});
// Mock EventBridgeClient
jest.mock('@aws-sdk/client-eventbridge', () => {
  return {
    EventBridgeClient: jest.fn(),
    PutEventsCommand: jest.fn().mockImplementation((params) => ({ ...params, __type: 'PutEventsCommand' })),
  };
});

import { getDocumentClient } from '../../lib/dynamodb-client';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

const mockGetDocumentClient = getDocumentClient as jest.MockedFunction<typeof getDocumentClient>;
const MockEventBridgeClient = EventBridgeClient as jest.MockedClass<typeof EventBridgeClient>;

describe('scan-stuck-sessions handler', () => {
  const originalEnv = process.env;
  let mockDdbSend: jest.Mock;
  let mockEbSend: jest.Mock;

  // A session that is clearly stuck: ended 2 hours ago, transcriptStatus null
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const stuckSession = {
    PK: 'SESSION#sess-001',
    SK: 'METADATA',
    sessionId: 'sess-001',
    status: 'ended',
    endedAt: twoHoursAgo,
    transcriptStatus: null,
    recoveryAttemptCount: 0,
    recordingHlsUrl: 'https://cdn.example.com/sess-001/master.m3u8',
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TABLE_NAME: 'test-table',
      AWS_REGION: 'us-east-1',
    };
    jest.clearAllMocks();

    mockDdbSend = jest.fn();
    mockEbSend = jest.fn();

    // Wire up mocked DDB document client
    mockGetDocumentClient.mockReturnValue({
      send: mockDdbSend,
    } as unknown as DynamoDBDocumentClient);

    // Wire up mocked EventBridgeClient
    MockEventBridgeClient.mockImplementation(() => ({
      send: mockEbSend,
    }) as any);

    // Default: UpdateCommand and PutEventsCommand succeed
    mockEbSend.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Helper: configure mockDdbSend to return one session item from both GSI1 queries
   * (ENDING returns empty, ENDED returns the session — or vice versa; doesn't matter for filtering tests)
   */
  function mockQueryWithSession(session: Record<string, any>) {
    // First call: STATUS#ENDING returns empty; second call: STATUS#ENDED returns session
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })          // ENDING partition
      .mockResolvedValueOnce({ Items: [session] })   // ENDED partition
      .mockResolvedValue({});                        // UpdateCommand
  }

  function mockEmptyQuery() {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });
  }

  // -------------------------------------------------------------------------
  // Skip criteria
  // -------------------------------------------------------------------------

  it('should skip sessions with transcriptStatus = processing', async () => {
    mockQueryWithSession({ ...stuckSession, transcriptStatus: 'processing' });

    await handler({} as any, {} as any, jest.fn());

    expect(mockDdbSend).toHaveBeenCalledTimes(2); // Only the two QueryCommands
    expect(UpdateCommand).not.toHaveBeenCalled();
    expect(PutEventsCommand).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  it('should skip sessions with transcriptStatus = available', async () => {
    mockQueryWithSession({ ...stuckSession, transcriptStatus: 'available' });

    await handler({} as any, {} as any, jest.fn());

    expect(UpdateCommand).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  it('should skip sessions with recoveryAttemptCount >= 3', async () => {
    mockQueryWithSession({
      ...stuckSession,
      transcriptStatus: 'pending',
      recoveryAttemptCount: 3,
    });

    await handler({} as any, {} as any, jest.fn());

    expect(UpdateCommand).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  it('should skip sessions where endedAt is within 45 minutes', async () => {
    mockQueryWithSession({ ...stuckSession, endedAt: tenMinutesAgo });

    await handler({} as any, {} as any, jest.fn());

    expect(UpdateCommand).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('should fire recovery event and increment counter for eligible stuck session', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })            // ENDING query
      .mockResolvedValueOnce({ Items: [stuckSession] }) // ENDED query
      .mockResolvedValueOnce({});                       // UpdateCommand succeeds

    mockEbSend.mockResolvedValueOnce({});

    await handler({} as any, {} as any, jest.fn());

    // UpdateCommand should have been called with correct expression
    expect(UpdateCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-table',
        Key: { PK: 'SESSION#sess-001', SK: 'METADATA' },
        UpdateExpression: expect.stringContaining('if_not_exists(recoveryAttemptCount'),
        ConditionExpression: expect.stringContaining('recoveryAttemptCount < :cap'),
      }),
    );

    // PutEventsCommand should have been called with correct source and detail-type
    expect(PutEventsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Entries: expect.arrayContaining([
          expect.objectContaining({
            Source: 'custom.vnl',
            DetailType: 'Recording Recovery',
          }),
        ]),
      }),
    );

    // EventBridge send was called
    expect(mockEbSend).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // ConditionalCheckFailedException — concurrent cron race
  // -------------------------------------------------------------------------

  it('should handle ConditionalCheckFailedException gracefully', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [stuckSession] });

    // UpdateCommand throws ConditionalCheckFailedException
    const conditionalError = new Error('ConditionalCheckFailedException');
    conditionalError.name = 'ConditionalCheckFailedException';
    mockDdbSend.mockRejectedValueOnce(conditionalError);

    // Handler must not throw
    await expect(handler({} as any, {} as any, jest.fn())).resolves.toBeUndefined();

    // PutEventsCommand must NOT have been called (no event after failed increment)
    expect(PutEventsCommand).not.toHaveBeenCalled();
    expect(mockEbSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Dual-partition query
  // -------------------------------------------------------------------------

  it('should query both STATUS#ENDING and STATUS#ENDED partitions', async () => {
    // Return no sessions — we only care about query call args
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [] });

    await handler({} as any, {} as any, jest.fn());

    // Verify QueryCommand was constructed twice with correct partition keys
    expect(QueryCommand).toHaveBeenCalledTimes(2);
    expect(QueryCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'STATUS#ENDING' },
      }),
    );
    expect(QueryCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        ExpressionAttributeValues: { ':status': 'STATUS#ENDED' },
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Non-blocking PutEvents failure
  // -------------------------------------------------------------------------

  it('should not throw when PutEvents fails', async () => {
    mockDdbSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [stuckSession] })
      .mockResolvedValueOnce({}); // UpdateCommand succeeds

    // PutEventsCommand throws
    mockEbSend.mockRejectedValueOnce(new Error('EventBridge unavailable'));

    // Handler must resolve without error
    await expect(handler({} as any, {} as any, jest.fn())).resolves.toBeUndefined();
  });
});
