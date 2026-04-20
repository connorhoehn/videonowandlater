import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Poll, PollOption } from '../domain/poll';

const pollPK = (sessionId: string) => `POLL#${sessionId}`;
const pollSK = (createdAt: string, pollId: string) => `${createdAt}#${pollId}`;
const votePK = (sessionId: string, pollId: string) => `POLLVOTE#${sessionId}#${pollId}`;

export async function createPoll(
  tableName: string,
  sessionId: string,
  createdBy: string,
  question: string,
  optionTexts: string[],
): Promise<Poll> {
  const pollId = uuidv4();
  const createdAt = new Date().toISOString();
  const options: PollOption[] = optionTexts.map((text) => ({ id: uuidv4(), text }));
  const voteCounts: Record<string, number> = Object.fromEntries(options.map((o) => [o.id, 0]));

  const poll: Poll = {
    pollId,
    sessionId,
    createdBy,
    question,
    options,
    voteCounts,
    totalVotes: 0,
    status: 'open',
    createdAt,
  };

  await getDocumentClient().send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: pollPK(sessionId),
      SK: pollSK(createdAt, pollId),
      entityType: 'POLL',
      ...poll,
    },
  }));

  return poll;
}

export async function getPoll(
  tableName: string,
  sessionId: string,
  pollId: string,
): Promise<Poll | null> {
  // We don't store pollId→createdAt mapping, so scan the session's poll
  // partition. Polls per session will be small (dozens max), so a Query is
  // cheap. We filter client-side on pollId.
  const res = await getDocumentClient().send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pollPK(sessionId) },
  }));
  const item = (res.Items ?? []).find((i) => i.pollId === pollId);
  if (!item) return null;
  const { PK, SK, entityType, ...poll } = item;
  return poll as Poll;
}

export async function listPolls(tableName: string, sessionId: string): Promise<Poll[]> {
  const res = await getDocumentClient().send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pollPK(sessionId) },
    ScanIndexForward: false,
  }));
  return (res.Items ?? []).map((i) => {
    const { PK, SK, entityType, ...poll } = i;
    return poll as Poll;
  });
}

/**
 * Casts a vote. Uses a per-user vote record (PK=POLLVOTE#..., SK=userId) with
 * attribute_not_exists to enforce one-vote-per-user atomically, then
 * increments the count on the poll record.
 *
 * Returns the updated poll (with fresh tallies) so the caller can broadcast.
 * Throws { code: 'ALREADY_VOTED' } if this user already voted.
 */
export async function castVote(
  tableName: string,
  sessionId: string,
  pollId: string,
  userId: string,
  optionId: string,
): Promise<Poll> {
  const poll = await getPoll(tableName, sessionId, pollId);
  if (!poll) throw new Error('POLL_NOT_FOUND');
  if (poll.status !== 'open') throw new Error('POLL_CLOSED');
  if (!poll.options.some((o) => o.id === optionId)) throw new Error('INVALID_OPTION');

  const client = getDocumentClient();

  try {
    await client.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: votePK(sessionId, pollId),
        SK: userId,
        entityType: 'POLL_VOTE',
        pollId,
        sessionId,
        userId,
        optionId,
        votedAt: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      const e = new Error('ALREADY_VOTED');
      (e as any).code = 'ALREADY_VOTED';
      throw e;
    }
    throw err;
  }

  const updated = await client.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: pollPK(sessionId),
      SK: pollSK(poll.createdAt, poll.pollId),
    },
    UpdateExpression: 'ADD voteCounts.#opt :one, totalVotes :one',
    ExpressionAttributeNames: { '#opt': optionId },
    ExpressionAttributeValues: { ':one': 1 },
    ReturnValues: 'ALL_NEW',
  }));

  const { PK, SK, entityType, ...fresh } = updated.Attributes ?? {};
  return fresh as Poll;
}

export async function closePoll(
  tableName: string,
  sessionId: string,
  pollId: string,
): Promise<Poll | null> {
  const poll = await getPoll(tableName, sessionId, pollId);
  if (!poll) return null;
  const closedAt = new Date().toISOString();
  const res = await getDocumentClient().send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: pollPK(sessionId),
      SK: pollSK(poll.createdAt, poll.pollId),
    },
    UpdateExpression: 'SET #s = :closed, closedAt = :at',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':closed': 'closed', ':at': closedAt },
    ReturnValues: 'ALL_NEW',
  }));
  const { PK, SK, entityType, ...fresh } = res.Attributes ?? {};
  return fresh as Poll;
}
