/**
 * Tests for ban-repository — global ban CRUD + combined isUserBanned logic.
 */

import {
  GetCommand,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import * as dynamodbClient from '../../lib/dynamodb-client';
import {
  isUserGloballyBanned,
  isUserBannedInSession,
  isUserBanned,
  createGlobalBan,
  liftGlobalBan,
  listGlobalBans,
} from '../ban-repository';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient =
  dynamodbClient.getDocumentClient as jest.MockedFunction<typeof dynamodbClient.getDocumentClient>;

const TABLE = 'test-table';

describe('ban-repository', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  describe('isUserGloballyBanned', () => {
    it('returns false when no ban row exists', async () => {
      mockSend.mockResolvedValueOnce({}); // no Item
      await expect(isUserGloballyBanned(TABLE, 'user-1')).resolves.toBe(false);

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(GetCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        Key: { PK: 'USER#user-1', SK: 'GLOBAL_BAN' },
      });
    });

    it('returns true when a ban row exists with no expiresAt', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          PK: 'USER#user-1',
          SK: 'GLOBAL_BAN',
          userId: 'user-1',
          bannedBy: 'admin',
          reason: 'spam',
          bannedAt: '2026-04-01T00:00:00.000Z',
        },
      });
      await expect(isUserGloballyBanned(TABLE, 'user-1')).resolves.toBe(true);
    });

    it('returns true when expiresAt is in the future', async () => {
      const future = new Date(Date.now() + 86400 * 1000).toISOString();
      mockSend.mockResolvedValueOnce({
        Item: {
          userId: 'u',
          bannedBy: 'a',
          reason: 'r',
          bannedAt: '2026-04-01T00:00:00.000Z',
          expiresAt: future,
        },
      });
      await expect(isUserGloballyBanned(TABLE, 'u')).resolves.toBe(true);
    });

    it('returns false when expiresAt is in the past', async () => {
      const past = new Date(Date.now() - 86400 * 1000).toISOString();
      mockSend.mockResolvedValueOnce({
        Item: {
          userId: 'u',
          bannedBy: 'a',
          reason: 'r',
          bannedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: past,
        },
      });
      await expect(isUserGloballyBanned(TABLE, 'u')).resolves.toBe(false);
    });
  });

  describe('isUserBannedInSession', () => {
    it('returns false when Count is 0', async () => {
      mockSend.mockResolvedValueOnce({ Count: 0, Items: [] });
      await expect(
        isUserBannedInSession(TABLE, 'user-1', 'session-1'),
      ).resolves.toBe(false);
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'actionType = :actionType AND #userId = :userId',
        ExpressionAttributeValues: {
          ':pk': 'SESSION#session-1',
          ':skPrefix': 'MOD#',
          ':actionType': 'BOUNCE',
          ':userId': 'user-1',
        },
        Limit: 1,
      });
    });

    it('returns true when at least one BOUNCE row exists', async () => {
      mockSend.mockResolvedValueOnce({ Count: 1, Items: [{ actionType: 'BOUNCE' }] });
      await expect(
        isUserBannedInSession(TABLE, 'user-1', 'session-1'),
      ).resolves.toBe(true);
    });
  });

  describe('isUserBanned (combined)', () => {
    it('returns true on global ban without issuing session query', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          userId: 'u',
          bannedBy: 'a',
          reason: 'r',
          bannedAt: '2026-04-01T00:00:00.000Z',
        },
      });
      await expect(isUserBanned(TABLE, 'u', 's')).resolves.toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('falls through to session check when not globally banned', async () => {
      mockSend.mockResolvedValueOnce({}); // no global ban
      mockSend.mockResolvedValueOnce({ Count: 1, Items: [{ actionType: 'BOUNCE' }] });
      await expect(isUserBanned(TABLE, 'u', 's')).resolves.toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns false when neither global nor per-session ban exists', async () => {
      mockSend.mockResolvedValueOnce({}); // no global
      mockSend.mockResolvedValueOnce({ Count: 0, Items: [] }); // no bounce
      await expect(isUserBanned(TABLE, 'u', 's')).resolves.toBe(false);
    });
  });

  describe('createGlobalBan', () => {
    it('writes a ban row without expiresAt when ttlDays is omitted', async () => {
      mockSend.mockResolvedValueOnce({});
      const ban = await createGlobalBan(TABLE, 'user-1', 'admin-1', 'spam');

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(PutCommand);
      const item = call.input.Item;
      expect(item).toMatchObject({
        PK: 'USER#user-1',
        SK: 'GLOBAL_BAN',
        entityType: 'GLOBAL_BAN',
        userId: 'user-1',
        bannedBy: 'admin-1',
        reason: 'spam',
        GSI5PK: 'GLOBAL_BAN',
      });
      expect(item.expiresAt).toBeUndefined();
      expect(item.bannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(item.GSI5SK).toBe(item.bannedAt);

      expect(ban.userId).toBe('user-1');
      expect(ban.bannedBy).toBe('admin-1');
      expect(ban.reason).toBe('spam');
      expect(ban.expiresAt).toBeUndefined();
    });

    it('writes expiresAt when ttlDays is supplied', async () => {
      mockSend.mockResolvedValueOnce({});
      const ban = await createGlobalBan(TABLE, 'user-1', 'admin-1', 'spam', 7);

      const call = mockSend.mock.calls[0][0];
      const item = call.input.Item;
      expect(item.expiresAt).toBeDefined();
      expect(new Date(item.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400 * 1000);
      expect(ban.expiresAt).toBe(item.expiresAt);
    });

    it('does not include expiresAt when ttlDays is 0', async () => {
      mockSend.mockResolvedValueOnce({});
      const ban = await createGlobalBan(TABLE, 'user-1', 'admin-1', 'spam', 0);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.Item.expiresAt).toBeUndefined();
      expect(ban.expiresAt).toBeUndefined();
    });
  });

  describe('liftGlobalBan', () => {
    it('issues a DeleteCommand on the correct key', async () => {
      mockSend.mockResolvedValueOnce({});
      await liftGlobalBan(TABLE, 'user-1');
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(DeleteCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        Key: { PK: 'USER#user-1', SK: 'GLOBAL_BAN' },
      });
    });
  });

  describe('listGlobalBans', () => {
    it('queries GSI5 and maps results', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            userId: 'u1',
            bannedBy: 'a1',
            reason: 'r1',
            bannedAt: '2026-04-02T00:00:00.000Z',
            expiresAt: '2026-05-02T00:00:00.000Z',
          },
          {
            userId: 'u2',
            bannedBy: 'a2',
            reason: 'r2',
            bannedAt: '2026-04-01T00:00:00.000Z',
          },
        ],
      });

      const bans = await listGlobalBans(TABLE);
      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        ExpressionAttributeValues: { ':pk': 'GLOBAL_BAN' },
        ScanIndexForward: false,
      });
      expect(bans).toHaveLength(2);
      expect(bans[0]).toMatchObject({ userId: 'u1', expiresAt: '2026-05-02T00:00:00.000Z' });
      expect(bans[1].expiresAt).toBeUndefined();
    });

    it('returns [] when no bans', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await expect(listGlobalBans(TABLE)).resolves.toEqual([]);
    });
  });
});
