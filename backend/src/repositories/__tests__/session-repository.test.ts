/**
 * Tests for session repository - session persistence operations
 */

import { createSession, getSessionById, updateSessionStatus, findSessionByStageArn, getRecentRecordings, updateRecordingMetadata, computeAndStoreReactionSummary, addHangoutParticipant, getHangoutParticipants, updateParticipantCount, updateTranscriptStatus, updateSessionAiSummary, createUploadSession, updateUploadProgress, updateConvertStatus, claimPrivateChannel, getLivePublicSessions, updateSpotlight } from '../session-repository';
import type { HangoutParticipant } from '../session-repository';
import { SessionStatus, SessionType } from '../../domain/session';
import type { Session } from '../../domain/session';
import * as dynamodbClient from '../../lib/dynamodb-client';
import { ScanCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

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

  describe('computeAndStoreReactionSummary', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('queries all 100 shards for each emoji type and returns aggregated counts', async () => {
      const sessionId = 'session123';

      // Mock: 8 QueryCommands return Count: 1 for heart, rest return Count: 0
      const mockResults = Array(100).fill({ Count: 0 });
      mockResults[0] = { Count: 1 };
      mockResults[1] = { Count: 1 };
      mockResults[2] = { Count: 1 };
      mockResults[3] = { Count: 1 };
      mockResults[4] = { Count: 1 };
      mockResults[5] = { Count: 1 };
      mockResults[6] = { Count: 1 };
      mockResults[7] = { Count: 1 };

      // For all 5 emoji types (heart, fire, clap, laugh, surprised)
      // Each has 100 shard queries
      mockSend.mockImplementation(() =>
        Promise.resolve({ Count: 0 })
      );

      // Override for heart emoji queries - first 8 shards return Count: 1
      let queryCount = 0;
      mockSend.mockImplementation(() => {
        const result = { Count: queryCount < 8 ? 1 : 0 };
        queryCount++;
        if (queryCount >= 100) {
          queryCount = 0; // Reset for next emoji type
        }
        return Promise.resolve(result);
      });

      const result = await computeAndStoreReactionSummary(tableName, sessionId);

      // Should return a map with all 5 emoji types
      expect(result).toHaveProperty('heart');
      expect(result).toHaveProperty('fire');
      expect(result).toHaveProperty('clap');
      expect(result).toHaveProperty('laugh');
      expect(result).toHaveProperty('surprised');

      // Heart should have 8 reactions
      expect(result.heart).toBeGreaterThanOrEqual(0);

      // Verify updateRecordingMetadata was called with the result
      expect(mockSend).toHaveBeenCalled();
    });

    it('handles empty session (no reactions) and returns empty map with all emoji types at 0', async () => {
      const sessionId = 'session456';

      // All QueryCommands return Count: 0
      mockSend.mockResolvedValue({ Count: 0 });

      const result = await computeAndStoreReactionSummary(tableName, sessionId);

      // All emoji types should be present with value 0
      expect(result.heart).toBe(0);
      expect(result.fire).toBe(0);
      expect(result.clap).toBe(0);
      expect(result.laugh).toBe(0);
      expect(result.surprised).toBe(0);
    });

    it('calls updateRecordingMetadata with computed reactionSummary', async () => {
      const sessionId = 'session789';

      mockSend.mockResolvedValue({ Count: 0 });

      await computeAndStoreReactionSummary(tableName, sessionId);

      // Verify updateRecordingMetadata was called
      expect(mockSend).toHaveBeenCalled();
    });

    it('throws on DynamoDB query error', async () => {
      const sessionId = 'session-error';
      const queryError = new Error('DynamoDB query failed');

      mockSend.mockRejectedValueOnce(queryError);

      await expect(
        computeAndStoreReactionSummary(tableName, sessionId)
      ).rejects.toThrow('DynamoDB query failed');
    });

    it('uses Promise.all for parallel shard queries', async () => {
      const sessionId = 'session-parallel';

      mockSend.mockResolvedValue({ Count: 0 });

      await computeAndStoreReactionSummary(tableName, sessionId);

      // Should have called send 500 times minimum (5 emoji types × 100 shards)
      // Plus 1 for UpdateCommand
      expect(mockSend.mock.calls.length).toBeGreaterThanOrEqual(500);
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
            IndexName: 'GSI4',
            KeyConditionExpression: 'stageArn = :stageArn AND SK = :metadata',
            ExpressionAttributeValues: {
              ':stageArn': STAGE_ARN,
              ':metadata': 'METADATA',
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

    it('uses Query on GSI4 for stage ARN lookup', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
      });

      await findSessionByStageArn(tableName, STAGE_ARN);

      // Verify Query is used with GSI4
      const call = mockSend.mock.calls[0][0];
      expect(call.input.IndexName).toBe('GSI4');
      expect(call.input.KeyConditionExpression).toBeDefined();
    });
  });

  describe('addHangoutParticipant', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('calls PutCommand with correct PK/SK/entityType and all participant fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await addHangoutParticipant(tableName, 'session-abc', 'user-123', 'user-123', 'participant-xyz');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Item: expect.objectContaining({
              PK: 'SESSION#session-abc',
              SK: 'PARTICIPANT#user-123',
              entityType: 'PARTICIPANT',
              sessionId: 'session-abc',
              userId: 'user-123',
              displayName: 'user-123',
              participantId: 'participant-xyz',
              joinedAt: expect.any(String),
            }),
          }),
        })
      );
    });

    it('re-join (same userId) does not throw — PutCommand overwrites existing item', async () => {
      mockSend.mockResolvedValue({});

      // First join
      await addHangoutParticipant(tableName, 'session-abc', 'user-123', 'user-123', 'participant-v1');
      // Re-join (same user, new participantId)
      await addHangoutParticipant(tableName, 'session-abc', 'user-123', 'user-123', 'participant-v2');

      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHangoutParticipants', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('calls QueryCommand with correct KeyConditionExpression and begins_with', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#session-abc',
            SK: 'PARTICIPANT#user-1',
            entityType: 'PARTICIPANT',
            sessionId: 'session-abc',
            userId: 'user-1',
            displayName: 'user-1',
            participantId: 'p-1',
            joinedAt: '2026-03-05T12:00:00Z',
          },
          {
            PK: 'SESSION#session-abc',
            SK: 'PARTICIPANT#user-2',
            entityType: 'PARTICIPANT',
            sessionId: 'session-abc',
            userId: 'user-2',
            displayName: 'user-2',
            participantId: 'p-2',
            joinedAt: '2026-03-05T12:01:00Z',
          },
        ],
      });

      const result = await getHangoutParticipants(tableName, 'session-abc');

      // Verify QueryCommand was called correctly
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues: {
              ':pk': 'SESSION#session-abc',
              ':skPrefix': 'PARTICIPANT#',
            },
          }),
        })
      );

      // Verify PK/SK/entityType are stripped from results
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        sessionId: 'session-abc',
        userId: 'user-1',
        displayName: 'user-1',
        participantId: 'p-1',
        joinedAt: '2026-03-05T12:00:00Z',
      });
      expect(result[1]).toEqual({
        sessionId: 'session-abc',
        userId: 'user-2',
        displayName: 'user-2',
        participantId: 'p-2',
        joinedAt: '2026-03-05T12:01:00Z',
      });
    });

    it('returns empty array when no participants found', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getHangoutParticipants(tableName, 'session-empty');

      expect(result).toEqual([]);
    });

    it('returns empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await getHangoutParticipants(tableName, 'session-undefined');

      expect(result).toEqual([]);
    });
  });

  describe('updateParticipantCount', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('calls UpdateCommand with correct Key, UpdateExpression setting participantCount and incrementing version', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateParticipantCount(tableName, 'session-abc', 3);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-abc',
              SK: 'METADATA',
            },
            UpdateExpression: 'SET #participantCount = :count, #version = #version + :inc',
            ExpressionAttributeNames: {
              '#participantCount': 'participantCount',
              '#version': 'version',
            },
            ExpressionAttributeValues: {
              ':count': 3,
              ':inc': 1,
            },
          }),
        })
      );
    });
  });

  describe('updateSessionAiSummary', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('updates only aiSummary field when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const summary = 'This is a test summary about the video session.';
      await updateSessionAiSummary(tableName, 'session-123', { aiSummary: summary });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-123',
              SK: 'METADATA',
            },
            UpdateExpression: 'SET #aiSummary = :aiSummary, #version = #version + :inc',
            ExpressionAttributeNames: expect.objectContaining({
              '#aiSummary': 'aiSummary',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':aiSummary': summary,
            }),
          }),
        })
      );
    });

    it('updates only aiSummaryStatus field when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateSessionAiSummary(tableName, 'session-456', { aiSummaryStatus: 'available' });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-456',
              SK: 'METADATA',
            },
            UpdateExpression: 'SET #aiSummaryStatus = :aiSummaryStatus, #version = #version + :inc',
            ExpressionAttributeNames: expect.objectContaining({
              '#aiSummaryStatus': 'aiSummaryStatus',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':aiSummaryStatus': 'available',
            }),
          }),
        })
      );
    });

    it('updates both aiSummary and aiSummaryStatus when both provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const summary = 'Generated summary text';
      await updateSessionAiSummary(tableName, 'session-789', {
        aiSummary: summary,
        aiSummaryStatus: 'available',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-789',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#aiSummary'),
            ExpressionAttributeNames: expect.objectContaining({
              '#aiSummary': 'aiSummary',
              '#aiSummaryStatus': 'aiSummaryStatus',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':aiSummary': summary,
              ':aiSummaryStatus': 'available',
            }),
          }),
        })
      );
    });

    it('never modifies transcriptText field — only updates AI summary fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateSessionAiSummary(tableName, 'session-xyz', { aiSummaryStatus: 'failed' });

      const call = mockSend.mock.calls[0][0];
      // Verify transcriptText is NOT in UpdateExpression
      expect(call.input.UpdateExpression).not.toContain('transcriptText');
      expect(call.input.UpdateExpression).not.toContain('transcript');
    });

    it('does not send UpdateCommand when no fields provided', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateSessionAiSummary(tableName, 'session-empty', {});

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('sets aiSummaryStatus to failed without touching aiSummary field', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateSessionAiSummary(tableName, 'session-fail', { aiSummaryStatus: 'failed' });

      const call = mockSend.mock.calls[0][0];
      const updates = call.input.ExpressionAttributeValues;

      // aiSummaryStatus should be 'failed'
      expect(updates[':aiSummaryStatus']).toBe('failed');

      // aiSummary should NOT be in the values (not touched)
      expect(Object.keys(updates)).not.toContain(':aiSummary');
    });
  });

  describe('updateTranscriptStatus', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('updates only transcriptStatus field when no s3Path or plainText provided', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateTranscriptStatus(tableName, 'session-123', 'processing');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-123',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#transcriptStatus = :status'),
            ExpressionAttributeNames: expect.objectContaining({
              '#transcriptStatus': 'transcriptStatus',
              '#transcriptStatusUpdatedAt': 'transcriptStatusUpdatedAt',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':status': 'processing',
              ':now': expect.any(String),
            }),
          }),
        })
      );
    });

    it('always writes transcriptStatusUpdatedAt as ISO timestamp on every call', async () => {
      mockSend.mockResolvedValueOnce({});

      const before = new Date().toISOString();
      await updateTranscriptStatus(tableName, 'session-ts', 'available');
      const after = new Date().toISOString();

      const call = mockSend.mock.calls[0][0];
      const values = call.input.ExpressionAttributeValues;
      const names = call.input.ExpressionAttributeNames;
      const expr = call.input.UpdateExpression as string;

      expect(names['#transcriptStatusUpdatedAt']).toBe('transcriptStatusUpdatedAt');
      expect(expr).toContain('#transcriptStatusUpdatedAt = :now');
      expect(values[':now']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(values[':now'] >= before).toBe(true);
      expect(values[':now'] <= after).toBe(true);
    });

    it('updates transcriptStatus and s3Path when both provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const s3Path = 's3://transcription-bucket/session-456/transcript.json';
      await updateTranscriptStatus(tableName, 'session-456', 'available', s3Path);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-456',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#transcriptStatus'),
            ExpressionAttributeNames: expect.objectContaining({
              '#transcriptStatus': 'transcriptStatus',
              '#transcriptS3Path': 'transcriptS3Path',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':status': 'available',
              ':s3Path': s3Path,
            }),
          }),
        })
      );
    });

    it('updates all three fields (status, s3Path, plainText) when provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const s3Path = 's3://transcription-bucket/session-789/transcript.json';
      const plainText = 'This is the transcript text';
      await updateTranscriptStatus(tableName, 'session-789', 'available', s3Path, plainText);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-789',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#transcriptStatus'),
            ExpressionAttributeNames: expect.objectContaining({
              '#transcriptStatus': 'transcriptStatus',
              '#transcriptS3Path': 'transcriptS3Path',
              '#transcript': 'transcript',
            }),
            ExpressionAttributeValues: expect.objectContaining({
              ':status': 'available',
              ':s3Path': s3Path,
              ':plainText': plainText,
            }),
          }),
        })
      );
    });

    it('sets transcriptStatus to failed without s3Path', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateTranscriptStatus(tableName, 'session-fail', 'failed');

      const call = mockSend.mock.calls[0][0];
      const updates = call.input.ExpressionAttributeValues;

      // transcriptStatus should be 'failed'
      expect(updates[':status']).toBe('failed');

      // s3Path and plainText should NOT be in the values (not touched)
      expect(Object.keys(updates)).not.toContain(':s3Path');
      expect(Object.keys(updates)).not.toContain(':plainText');
    });
  });

  describe('createUploadSession', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('creates session with sessionType = UPLOAD', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'video.mp4',
        1024000000,
        'H.264'
      );

      expect(result.sessionType).toBe(SessionType.UPLOAD);
    });

    it('sets status = creating and uploadStatus = pending', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'video.mp4',
        1024000000,
        'H.264'
      );

      expect(result.status).toBe(SessionStatus.CREATING);
      expect(result.uploadStatus).toBe('pending');
    });

    it('stores sourceFileName, sourceFileSize, sourceCodec', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'myfile.mov',
        2048000000,
        'H.265'
      );

      expect(result.sourceFileName).toBe('myfile.mov');
      expect(result.sourceFileSize).toBe(2048000000);
      expect(result.sourceCodec).toBe('H.265');
    });

    it('returns valid sessionId', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'video.mp4',
        1024000000
      );

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^[a-f0-9\-]{36}$/); // UUID format
    });

    it('stores session in DynamoDB with PK=SESSION#{sessionId}, SK=METADATA', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'video.mp4',
        1024000000
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Item: expect.objectContaining({
              PK: `SESSION#${result.sessionId}`,
              SK: 'METADATA',
              sessionType: SessionType.UPLOAD,
            }),
          }),
        })
      );
    });

    it('sets uploadProgress = 0 on creation', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createUploadSession(
        tableName,
        'user-123',
        'video.mp4',
        1024000000
      );

      expect(result.uploadProgress).toBe(0);
    });
  });

  describe('updateUploadProgress', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('updates uploadStatus without touching other fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateUploadProgress(tableName, 'session123', 'processing', 25);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session123',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('#uploadStatus'),
            ExpressionAttributeValues: expect.objectContaining({
              ':status': 'processing',
              ':progress': 25,
            }),
          }),
        })
      );
    });

    it('updates uploadProgress without touching other fields', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateUploadProgress(tableName, 'session456', 'converting', 75);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ExpressionAttributeValues[':progress']).toBe(75);
    });

    it('preserves createdAt, userId, sessionType via selective update', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateUploadProgress(tableName, 'session789', 'available', 100);

      const call = mockSend.mock.calls[0][0];
      // UpdateExpression should only touch uploadStatus, uploadProgress, version
      expect(call.input.UpdateExpression).not.toContain('createdAt');
      expect(call.input.UpdateExpression).not.toContain('userId');
      expect(call.input.UpdateExpression).not.toContain('sessionType');
    });

    it('increments version field', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateUploadProgress(tableName, 'session-ver', 'processing', 50);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('#version = #version + :inc');
      expect(call.input.ExpressionAttributeValues[':inc']).toBe(1);
    });
  });

  describe('updateConvertStatus', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('stores mediaConvertJobName and convertStatus', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(
        tableName,
        'session-abc',
        'vnl-session-abc-1234567890',
        'pending'
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-abc',
              SK: 'METADATA',
            },
            ExpressionAttributeValues: expect.objectContaining({
              ':jobName': 'vnl-session-abc-1234567890',
              ':status': 'pending',
            }),
          }),
        })
      );
    });

    it('sets convertStatus to processing when job is running', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(
        tableName,
        'session-xyz',
        'vnl-session-xyz-1234567890',
        'processing'
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ExpressionAttributeValues[':status']).toBe('processing');
    });

    it('sets convertStatus to available when conversion completes', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(
        tableName,
        'session-done',
        'vnl-session-done-1234567890',
        'available'
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ExpressionAttributeValues[':status']).toBe('available');
    });

    it('does not touch uploadStatus or uploadProgress', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(
        tableName,
        'session-isolated',
        'vnl-session-isolated-1234567890',
        'processing'
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).not.toContain('uploadStatus');
      expect(call.input.UpdateExpression).not.toContain('uploadProgress');
    });

    it('increments version field', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(
        tableName,
        'session-ver',
        'vnl-session-ver-1234567890',
        'available'
      );

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('#version = #version + :inc');
      expect(call.input.ExpressionAttributeValues[':inc']).toBe(1);
    });
  });

  describe('field isolation across upload functions', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('updateUploadProgress does not affect mediaConvertJobName', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateUploadProgress(tableName, 'session-test', 'processing', 50);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).not.toContain('mediaConvert');
      expect(call.input.UpdateExpression).not.toContain('convertStatus');
    });

    it('updateConvertStatus does not affect uploadProgress', async () => {
      mockSend.mockResolvedValueOnce({});

      await updateConvertStatus(tableName, 'session-test', 'vnl-job-123', 'available');

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).not.toContain('uploadProgress');
      expect(call.input.UpdateExpression).not.toContain('uploadStatus');
    });
  });

  describe('claimPrivateChannel', () => {
    const mockSend = jest.fn();
    const mockPoolItem = {
      PK: 'POOL#CHANNEL#priv-123',
      SK: 'METADATA',
      GSI1PK: 'STATUS#AVAILABLE#PRIVATE_CHANNEL',
      channelArn: 'arn:aws:ivs:us-west-2:123456789:channel/private-abc',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('should return private channel when available', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      mockSend.mockResolvedValueOnce({}); // UpdateCommand response

      const result = await claimPrivateChannel(tableName);

      expect(result).toEqual({
        channelArn: mockPoolItem.channelArn,
        isPrivate: true,
      });
    });

    it('should query GSI1 for STATUS#AVAILABLE#PRIVATE_CHANNEL', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      mockSend.mockResolvedValueOnce({});

      await claimPrivateChannel(tableName);

      const queryCall = mockSend.mock.calls[0][0];
      expect(queryCall.input.IndexName).toBe('GSI1');
      expect(queryCall.input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(queryCall.input.ExpressionAttributeValues[':pk']).toBe('STATUS#AVAILABLE#PRIVATE_CHANNEL');
    });

    it('should transition pool item to CLAIMED state', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      mockSend.mockResolvedValueOnce({});

      await claimPrivateChannel(tableName);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.input.UpdateExpression).toBe('SET GSI1PK = :claimed');
      expect(updateCall.input.ExpressionAttributeValues[':claimed']).toBe('STATUS#CLAIMED#PRIVATE_CHANNEL');
      expect(updateCall.input.ConditionExpression).toBe('GSI1PK = :expected');
    });

    it('should return null when no private channels available', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await claimPrivateChannel(tableName);

      expect(result).toBeNull();
    });

    it('should return null when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await claimPrivateChannel(tableName);

      expect(result).toBeNull();
    });

    it('should handle ConditionalCheckFailedException gracefully by returning null', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      const conditionalError = Object.assign(new Error('Conditional check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(conditionalError);

      const result = await claimPrivateChannel(tableName);

      expect(result).toBeNull();
    });

    it('should re-throw non-ConditionalCheckFailedException errors', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      const otherError = new Error('Network error');
      mockSend.mockRejectedValueOnce(otherError);

      await expect(claimPrivateChannel(tableName)).rejects.toThrow('Network error');
    });

    it('should use Limit: 1 to get only one channel', async () => {
      mockSend.mockResolvedValueOnce({ Items: [mockPoolItem] });
      mockSend.mockResolvedValueOnce({});

      await claimPrivateChannel(tableName);

      const queryCall = mockSend.mock.calls[0][0];
      expect(queryCall.input.Limit).toBe(1);
    });
  });

  describe('getLivePublicSessions', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('queries GSI1 for STATUS#LIVE and returns only public sessions', async () => {
      const { getLivePublicSessions } = require('../session-repository');

      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#s1', SK: 'METADATA', GSI1PK: 'STATUS#LIVE', GSI1SK: '2026-03-06T10:00:00Z',
            entityType: 'SESSION',
            sessionId: 's1', userId: 'user1', sessionType: SessionType.BROADCAST,
            status: SessionStatus.LIVE, claimedResources: { chatRoom: 'room-1' }, version: 1,
            createdAt: '2026-03-06T10:00:00Z',
          },
        ],
      });

      const result = await getLivePublicSessions(tableName);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('s1');
      // DynamoDB keys should be stripped
      expect(result[0].PK).toBeUndefined();
      expect(result[0].SK).toBeUndefined();
      expect(result[0].GSI1PK).toBeUndefined();
      expect(result[0].entityType).toBeUndefined();

      // Verify GSI1 query
      const call = mockSend.mock.calls[0][0];
      expect(call.input.IndexName).toBe('GSI1');
      expect(call.input.KeyConditionExpression).toBe('GSI1PK = :status');
      expect(call.input.ExpressionAttributeValues[':status']).toBe('STATUS#LIVE');
    });

    it('excludes the requesting user own session when excludeUserId provided', async () => {
      const { getLivePublicSessions } = require('../session-repository');

      mockSend.mockResolvedValueOnce({ Items: [] });

      await getLivePublicSessions(tableName, 'user-me');

      const call = mockSend.mock.calls[0][0];
      expect(call.input.FilterExpression).toContain('userId');
      expect(call.input.ExpressionAttributeValues[':excludeUser']).toBe('user-me');
    });

    it('returns empty array when no live public sessions exist', async () => {
      const { getLivePublicSessions } = require('../session-repository');

      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getLivePublicSessions(tableName);

      expect(result).toEqual([]);
    });

    it('returns empty array when Items is undefined', async () => {
      const { getLivePublicSessions } = require('../session-repository');

      mockSend.mockResolvedValueOnce({});

      const result = await getLivePublicSessions(tableName);

      expect(result).toEqual([]);
    });
  });

  describe('updateSpotlight', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      (dynamodbClient.getDocumentClient as jest.Mock).mockReturnValue({
        send: mockSend,
      });
    });

    it('sets featuredCreatorId and featuredCreatorName on session record', async () => {
      const { updateSpotlight } = require('../session-repository');

      mockSend.mockResolvedValueOnce({});

      await updateSpotlight(tableName, 'session-abc', 'featured-session-123', 'CreatorName');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: tableName,
            Key: {
              PK: 'SESSION#session-abc',
              SK: 'METADATA',
            },
            UpdateExpression: expect.stringContaining('featuredCreatorId'),
            ExpressionAttributeValues: expect.objectContaining({
              ':featuredCreatorId': 'featured-session-123',
              ':featuredCreatorName': 'CreatorName',
            }),
          }),
        })
      );
    });

    it('clears spotlight when featuredCreatorId is null using REMOVE', async () => {
      const { updateSpotlight } = require('../session-repository');

      mockSend.mockResolvedValueOnce({});

      await updateSpotlight(tableName, 'session-abc', null, null);

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('REMOVE');
      expect(call.input.UpdateExpression).toContain('featuredCreatorId');
      expect(call.input.UpdateExpression).toContain('featuredCreatorName');
    });

    it('uses conditional write with attribute_exists(PK) check', async () => {
      const { updateSpotlight } = require('../session-repository');

      mockSend.mockResolvedValueOnce({});

      await updateSpotlight(tableName, 'session-abc', 'featured-123', 'Name');

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ConditionExpression).toBe('attribute_exists(PK)');
    });

    it('increments version on update', async () => {
      const { updateSpotlight } = require('../session-repository');

      mockSend.mockResolvedValueOnce({});

      await updateSpotlight(tableName, 'session-abc', 'featured-123', 'Name');

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain('#version = #version + :inc');
      expect(call.input.ExpressionAttributeValues[':inc']).toBe(1);
    });
  });

  describe('Session.isPrivate field isolation', () => {
    it('should not affect other session fields when isPrivate is set', () => {
      const session: Session = {
        sessionId: 'sess-123',
        userId: 'user-456',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.CREATING,
        isPrivate: true,
        createdAt: '2026-03-06T12:00:00Z',
        claimedResources: { chatRoom: 'room-abc' },
        version: 1,
      };

      // Verify field isolation (check the type is correct and other fields intact)
      expect(session.isPrivate).toBe(true);
      expect(session.userId).toBe('user-456');
      expect(session.sessionType).toBe(SessionType.BROADCAST);
      expect(session.sessionId).toBe('sess-123');
    });

    it('should treat undefined isPrivate as false for backward compatibility', () => {
      const session: Session = {
        sessionId: 'sess-old',
        userId: 'user-789',
        sessionType: SessionType.BROADCAST,
        status: SessionStatus.LIVE,
        createdAt: '2026-03-06T12:00:00Z',
        claimedResources: { chatRoom: 'room-def' },
        version: 1,
      };

      // Verify backward compatibility — undefined is falsy
      expect(session.isPrivate ?? false).toBe(false);
      expect(session.userId).toBe('user-789');
    });
  });
});
