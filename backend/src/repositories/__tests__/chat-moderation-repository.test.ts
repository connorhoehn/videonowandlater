/**
 * Tests for chat-moderation-repository — writeFlag / listPendingFlags / resolveFlag.
 */

import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import * as dynamodbClient from '../../lib/dynamodb-client';
import {
  writeFlag,
  listPendingFlags,
  resolveFlag,
  CHATFLAG_QUEUE_GSI5PK,
} from '../chat-moderation-repository';

jest.mock('../../lib/dynamodb-client');
jest.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

const mockGetDocumentClient =
  dynamodbClient.getDocumentClient as jest.MockedFunction<typeof dynamodbClient.getDocumentClient>;

const TABLE = 'test-table';

describe('chat-moderation-repository', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  describe('writeFlag', () => {
    it('writes a pending flag with expected PK/SK + GSI5 projection', async () => {
      mockSend.mockResolvedValueOnce({});

      const created = await writeFlag(TABLE, {
        sessionId: 'sess-1',
        userId: 'user-1',
        messageId: 'msg-1',
        text: 'bad text',
        categories: ['harassment'],
        confidence: 0.92,
        reasoning: 'contains slurs',
        createdAt: '2026-04-18T12:00:00.000Z',
      });

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(PutCommand);
      expect(call.input.TableName).toBe(TABLE);
      const item = call.input.Item;
      expect(item.PK).toBe('SESSION#sess-1');
      expect(item.SK).toBe('CHATFLAG#2026-04-18T12:00:00.000Z#test-uuid-1234');
      expect(item.entityType).toBe('CHAT_FLAG');
      expect(item.status).toBe('pending');
      expect(item.GSI5PK).toBe(CHATFLAG_QUEUE_GSI5PK);
      expect(item.GSI5SK).toBe('2026-04-18T12:00:00.000Z');
      expect(item.categories).toEqual(['harassment']);
      expect(item.confidence).toBe(0.92);

      expect(created.PK).toBe('SESSION#sess-1');
      expect(created.SK).toBe('CHATFLAG#2026-04-18T12:00:00.000Z#test-uuid-1234');
      expect(created.status).toBe('pending');
    });

    it('generates a createdAt when none is supplied', async () => {
      mockSend.mockResolvedValueOnce({});
      const created = await writeFlag(TABLE, {
        sessionId: 's',
        userId: 'u',
        messageId: 'm',
        text: 't',
        categories: [],
        confidence: 0.1,
        reasoning: '',
      });
      expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('propagates DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('ddb boom'));
      await expect(
        writeFlag(TABLE, {
          sessionId: 's',
          userId: 'u',
          messageId: 'm',
          text: 't',
          categories: [],
          confidence: 0,
          reasoning: '',
        }),
      ).rejects.toThrow('ddb boom');
    });
  });

  describe('listPendingFlags', () => {
    it('queries GSI5 with status=pending filter and maps results', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'SESSION#s1',
            SK: 'CHATFLAG#2026-04-18T12:00:00.000Z#a',
            sessionId: 's1',
            userId: 'u1',
            messageId: 'm1',
            text: 'bad',
            categories: ['hate'],
            confidence: 0.9,
            reasoning: 'r',
            createdAt: '2026-04-18T12:00:00.000Z',
            status: 'pending',
          },
          {
            PK: 'SESSION#s2',
            SK: 'CHATFLAG#2026-04-18T11:00:00.000Z#b',
            sessionId: 's2',
            userId: 'u2',
            messageId: 'm2',
            text: 'also bad',
            categories: [],
            confidence: 0.8,
            reasoning: '',
            createdAt: '2026-04-18T11:00:00.000Z',
            status: 'pending',
          },
        ],
      });

      const flags = await listPendingFlags(TABLE, { limit: 25 });
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':pk': CHATFLAG_QUEUE_GSI5PK,
          ':status': 'pending',
        },
        ScanIndexForward: false,
        Limit: 25,
      });
      expect(flags).toHaveLength(2);
      expect(flags[0].sessionId).toBe('s1');
      expect(flags[0].categories).toEqual(['hate']);
      expect(flags[1].status).toBe('pending');
    });

    it('returns [] when no flags', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await expect(listPendingFlags(TABLE)).resolves.toEqual([]);
    });

    it('defaults limit to 50 when not provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await listPendingFlags(TABLE);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Limit).toBe(50);
    });
  });

  describe('resolveFlag', () => {
    it('issues an UpdateCommand setting status/action/resolvedBy/resolvedAt', async () => {
      mockSend.mockResolvedValueOnce({});
      await resolveFlag(TABLE, 'sess-1', 'CHATFLAG#ts#id', 'approve', 'admin-1');

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(UpdateCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        Key: { PK: 'SESSION#sess-1', SK: 'CHATFLAG#ts#id' },
        UpdateExpression:
          'SET #status = :resolved, #action = :action, resolvedBy = :by, resolvedAt = :at',
        ExpressionAttributeValues: {
          ':resolved': 'resolved',
          ':action': 'approve',
          ':by': 'admin-1',
        },
      });
      expect(call.input.ExpressionAttributeValues[':at']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('accepts reject action', async () => {
      mockSend.mockResolvedValueOnce({});
      await resolveFlag(TABLE, 'sess-1', 'CHATFLAG#ts#id', 'reject', 'admin-1');
      const call = mockSend.mock.calls[0][0];
      expect(call.input.ExpressionAttributeValues[':action']).toBe('reject');
    });

    it('propagates DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('ddb boom'));
      await expect(
        resolveFlag(TABLE, 'sess-1', 'CHATFLAG#ts#id', 'approve', 'admin-1'),
      ).rejects.toThrow('ddb boom');
    });
  });
});
