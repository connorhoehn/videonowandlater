/**
 * Tests for invitation-repository — session invitation CRUD with idempotent
 * create semantics.
 */

import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import * as dynamodbClient from '../../lib/dynamodb-client';
import {
  createInvitation,
  listInvitesForUser,
  listInvitesForSession,
  updateInviteStatus,
} from '../invitation-repository';

jest.mock('../../lib/dynamodb-client');

const mockGetDocumentClient =
  dynamodbClient.getDocumentClient as jest.MockedFunction<
    typeof dynamodbClient.getDocumentClient
  >;

const TABLE = 'test-table';

describe('invitation-repository', () => {
  const mockSend = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDocumentClient.mockReturnValue({ send: mockSend } as any);
  });

  describe('createInvitation', () => {
    it('writes a pending invite row with the expected keys and returns created=true', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createInvitation(TABLE, {
        sessionId: 'sess-1',
        userId: 'bob',
        inviterId: 'alice',
        source: 'group:g1',
      });

      expect(result.created).toBe(true);
      expect(result.invitation.status).toBe('pending');
      expect(result.invitation.source).toBe('group:g1');

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(PutCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        Item: expect.objectContaining({
          PK: 'INVITE#bob',
          SK: 'sess-1',
          GSI1PK: 'SESSION#sess-1',
          GSI1SK: 'INVITE#bob',
          entityType: 'INVITATION',
          status: 'pending',
          inviterId: 'alice',
          source: 'group:g1',
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      });
    });

    it('returns created=false when the invite already exists (idempotent)', async () => {
      const err = Object.assign(new Error('exists'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err);

      const result = await createInvitation(TABLE, {
        sessionId: 'sess-1',
        userId: 'bob',
        inviterId: 'alice',
        source: 'direct',
      });

      expect(result.created).toBe(false);
    });

    it('rethrows unknown DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('boom'));
      await expect(
        createInvitation(TABLE, {
          sessionId: 's',
          userId: 'u',
          inviterId: 'i',
          source: 'direct',
        }),
      ).rejects.toThrow('boom');
    });
  });

  describe('listInvitesForUser', () => {
    it('queries by INVITE#<userId> and strips dynamodb keys', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            PK: 'INVITE#bob',
            SK: 'sess-1',
            GSI1PK: 'SESSION#sess-1',
            GSI1SK: 'INVITE#bob',
            entityType: 'INVITATION',
            sessionId: 'sess-1',
            userId: 'bob',
            inviterId: 'alice',
            invitedAt: 't',
            source: 'direct',
            status: 'pending',
          },
        ],
      });

      const res = await listInvitesForUser(TABLE, 'bob');
      expect(res).toHaveLength(1);
      expect(res[0]).toEqual({
        sessionId: 'sess-1',
        userId: 'bob',
        inviterId: 'alice',
        invitedAt: 't',
        source: 'direct',
        status: 'pending',
      });

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': 'INVITE#bob' },
      });
    });

    it('applies optional status filter via FilterExpression', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await listInvitesForUser(TABLE, 'bob', { status: 'pending', limit: 10 });

      const call = mockSend.mock.calls[0][0];
      expect(call.input.FilterExpression).toBe('#s = :status');
      expect(call.input.ExpressionAttributeNames).toEqual({ '#s': 'status' });
      expect(call.input.ExpressionAttributeValues[':status']).toBe('pending');
      expect(call.input.Limit).toBe(10);
    });
  });

  describe('listInvitesForSession', () => {
    it('queries GSI1 for SESSION#<sessionId>', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      await listInvitesForSession(TABLE, 'sess-1');

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(QueryCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': 'SESSION#sess-1',
          ':sk': 'INVITE#',
        },
      });
    });
  });

  describe('updateInviteStatus', () => {
    it('updates status and returns the stripped attributes', async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          PK: 'INVITE#bob',
          SK: 'sess-1',
          GSI1PK: 'SESSION#sess-1',
          GSI1SK: 'INVITE#bob',
          entityType: 'INVITATION',
          sessionId: 'sess-1',
          userId: 'bob',
          inviterId: 'alice',
          invitedAt: 't',
          source: 'direct',
          status: 'accepted',
        },
      });

      const res = await updateInviteStatus(TABLE, 'bob', 'sess-1', 'accepted');
      expect(res?.status).toBe('accepted');

      const call = mockSend.mock.calls[0][0];
      expect(call).toBeInstanceOf(UpdateCommand);
      expect(call.input).toMatchObject({
        TableName: TABLE,
        Key: { PK: 'INVITE#bob', SK: 'sess-1' },
        UpdateExpression: 'SET #s = :status',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':status': 'accepted' },
        ConditionExpression: 'attribute_exists(PK)',
      });
    });

    it('returns null when the invite does not exist', async () => {
      const err = Object.assign(new Error('missing'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err);

      const res = await updateInviteStatus(TABLE, 'bob', 'sess-1', 'declined');
      expect(res).toBeNull();
    });
  });
});
