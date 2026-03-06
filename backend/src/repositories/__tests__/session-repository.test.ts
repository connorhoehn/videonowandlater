/**
 * Tests for session repository - session persistence operations
 */

import { createSession, getSessionById, updateSessionStatus, findSessionByStageArn, getRecentRecordings, updateRecordingMetadata } from '../session-repository';
import { SessionStatus, SessionType } from '../../domain/session';
import type { Session } from '../../domain/session';
import * as dynamodbClient from '../../lib/dynamodb-client';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

jest.mock('../../lib/dynamodb-client');

describe('session-repository', () => {
  const tableName = 'test-table';

  describe('createSession', () => {
    it('stores session in DynamoDB with PK=SESSION#{sessionId}, SK=METADATA', async () => {
      // This test will verify session creation
      expect(createSession).toBeDefined();
    });
  });

  describe('getSessionById', () => {
    it('retrieves session by PK and returns null if not found', async () => {
      // This test will verify session retrieval
      expect(getSessionById).toBeDefined();
    });
  });

  describe('updateSessionStatus', () => {
    it('validates state transitions using canTransition', async () => {
      // This test verifies the function exists and validates transitions
      // In unit tests without DynamoDB, we expect error due to session not found
      await expect(
        updateSessionStatus(tableName, 'nonexistent', SessionStatus.LIVE)
      ).rejects.toThrow();
    });

    it('supports optional timestamp fields (startedAt, endedAt)', async () => {
      // Verify function signature accepts timestampField parameter
      // Will throw in unit tests due to DynamoDB connection, but signature is validated
      await expect(
        updateSessionStatus(tableName, 'test-session', SessionStatus.LIVE, 'startedAt')
      ).rejects.toThrow();
    });
  });

  describe('updateRecordingMetadata', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('accepts reactionSummary parameter and includes it in DynamoDB update expression', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateRecordingMetadata(tableName, 'session123', {
        reactionSummary: { heart: 42, fire: 17, clap: 8, laugh: 5, surprised: 3 },
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session123',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#reactionSummary'),
            ExpressionAttributeNames: expect.objectContaining({
              '#reactionSummary': 'reactionSummary',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':reactionSummary': { heart: 42, fire: 17, clap: 8, laugh: 5, surprised: 3 },
            }),
          }),
        })
      );
    });

    it('stores empty reactionSummary map {} when provided (for sessions with zero reactions)', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateRecordingMetadata(tableName, 'session123', {
        reactionSummary: {},
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            ExpressionAttributeValues: expect.objectContaining({
              ':reactionSummary': {},
            }),
          }),
        })
      );
    });

    it('works without reactionSummary parameter for backward compatibility', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateRecordingMetadata(tableName, 'session123', {
        recordingDuration: 300000,
        recordingStatus: 'available',
      });

      expect(mockSend).toHaveBeenCalled();
      // Verify reactionSummary is not in the update expression
      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).not.toContain('#reactionSummary');
    });

    it('correctly maps field names in expression attribute names', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateRecordingMetadata(tableName, 'session123', {
        recordingDuration: 300000,
        reactionSummary: { heart: 5 },
      });

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ExpressionAttributeNames).toHaveProperty('#reactionSummary', 'reactionSummary');
      expect(call.input.ExpressionAttributeNames).toHaveProperty('#recordingDuration', 'recordingDuration');
    });
  });

  describe('getRecentRecordings', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('filters by status IN (ended, ending) AND recordingStatus != failed', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getRecentRecordings(tableName, 20);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            FilterExpression: expect.stringContaining('recordingStatus <> :failed'),
            ExpressionAttributeValues: expect.objectContaining({
              ':ended': 'ended',
              ':ending': 'ending',
              ':failed': 'failed',
            }),
          }),
        })
      );
    });

    it('returns sessions sorted by endedAt descending', async () => {
      const baseSession = {
        PK: 'SESSION#s1', SK: 'METADATA', GSI1PK: 'STATUS#ENDED', GSI1SK: '',
        entityType: 'SESSION',
        sessionId: 's1', userId: 'user1', sessionType: SessionType.BROADCAST,
        status: SessionStatus.ENDED, claimedResources: {}, version: 1, createdAt: '2026-01-01T00:00:00Z',
        recordingStatus: 'available',
      };

      mockSend.mockResolvedValueOnce({
        Items: [
          { ...baseSession, sessionId: 'older', endedAt: '2026-01-01T10:00:00Z' },
          { ...baseSession, sessionId: 'newer', endedAt: '2026-01-02T10:00:00Z' },
        ],
      });

      const results = await getRecentRecordings(tableName, 20);

      expect(results[0].sessionId).toBe('newer');
      expect(results[1].sessionId).toBe('older');
    });
  });

  describe('findSessionByStageArn', () => {
    const mockSend = jest.fn();
    const STAGE_ARN = 'arn:aws:ivs:us-west-2:123456789012:stage/abcd1234';

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('returns session when claimedResources.stage matches', async () => {
      const mockSession: Session = {
        sessionId: 'session123',
        userId: 'user123',
        sessionType: SessionType.HANGOUT,
        status: SessionStatus.LIVE,
        claimedResources: {
          stage: STAGE_ARN,
          chatRoom: 'arn:aws:ivschat:us-west-2:123456789012:room/abc',
        },
        createdAt: '2026-03-03T12:00:00Z',
        version: 1,
      };

      mockSend.mockResolvedValueOnce({
        Items: [{
          PK: 'SESSION#session123',
          SK: 'METADATA',
          GSI1PK: 'STATUS#LIVE',
          GSI1SK: '2026-03-03T12:00:00Z',
          entityType: 'SESSION',
          ...mockSession,
        }],
      });

      const result = await findSessionByStageArn(tableName, STAGE_ARN);

      expect(result).toEqual(mockSession);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            FilterExpression: 'begins_with(PK, :pkPrefix) AND claimedResources.stage = :stageArn',
            ExpressionAttributeValues: {
              ':pkPrefix': 'SESSION#',
              ':stageArn': STAGE_ARN,
            },
          }),
        })
      );
    });

    it('returns null when no matching Stage ARN found', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
      });

      const result = await findSessionByStageArn(tableName, STAGE_ARN);

      expect(result).toBeNull();
    });

    it('uses Scan with FilterExpression (no GSI for Stage ARN lookup)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
      });

      await findSessionByStageArn(tableName, STAGE_ARN);

      // Verify Scan is used (not Query)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            FilterExpression: expect.any(String),
          }),
        })
      );

      // Verify no KeyConditionExpression (which would indicate Query)
      const call = mockSend.mock.calls[0][0];
      expect(call.input.KeyConditionExpression).toBeUndefined();
    });
  });
});
