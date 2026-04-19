/**
 * Follow graph repository.
 *
 * Schema:
 *   PK: USER#<follower>    SK: FOLLOWS#<followee>   { followedAt }
 *     GSI1PK: FOLLOWED_BY#<followee>  GSI1SK: <followedAt>
 *
 * Queries:
 *   "who I follow"  — Query PK=USER#<me>, begins_with(SK, 'FOLLOWS#')
 *   "who follows me" — Query GSI1, PK=FOLLOWED_BY#<me>
 *
 * Counts are maintained in USER#<id>/STATS via profile-repository.incrementStat.
 */

import { DeleteCommand, PutCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { incrementStat } from './profile-repository';

export interface FollowEdge {
  follower: string;
  followee: string;
  followedAt: string;
}

export async function isFollowing(
  tableName: string,
  follower: string,
  followee: string,
): Promise<boolean> {
  const res = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: { PK: `USER#${follower}`, SK: `FOLLOWS#${followee}` },
  }));
  return !!res.Item;
}

/**
 * Idempotent follow. Returns true if this created a new edge, false if the
 * edge already existed. Only increments stat counters on a real new edge.
 */
export async function follow(
  tableName: string,
  follower: string,
  followee: string,
): Promise<boolean> {
  if (follower === followee) throw new Error('Cannot follow yourself');
  const now = new Date().toISOString();
  try {
    await getDocumentClient().send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: `USER#${follower}`,
        SK: `FOLLOWS#${followee}`,
        GSI1PK: `FOLLOWED_BY#${followee}`,
        GSI1SK: now,
        entityType: 'FOLLOW',
        follower,
        followee,
        followedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
  // Best-effort counter bumps.
  await Promise.allSettled([
    incrementStat(tableName, followee, 'followersCount', 1),
    incrementStat(tableName, follower, 'followingCount', 1),
  ]);
  return true;
}

/**
 * Idempotent unfollow. Returns true if an edge was removed, false if no edge existed.
 */
export async function unfollow(
  tableName: string,
  follower: string,
  followee: string,
): Promise<boolean> {
  try {
    await getDocumentClient().send(new DeleteCommand({
      TableName: tableName,
      Key: { PK: `USER#${follower}`, SK: `FOLLOWS#${followee}` },
      ConditionExpression: 'attribute_exists(PK)',
    }));
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
  await Promise.allSettled([
    incrementStat(tableName, followee, 'followersCount', -1),
    incrementStat(tableName, follower, 'followingCount', -1),
  ]);
  return true;
}

export async function listFollowing(
  tableName: string,
  userId: string,
  limit = 50,
): Promise<FollowEdge[]> {
  const res = await getDocumentClient().send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'FOLLOWS#' },
    Limit: limit,
  }));
  return (res.Items ?? []).map((i) => ({
    follower: i.follower,
    followee: i.followee,
    followedAt: i.followedAt,
  }));
}

export async function listFollowers(
  tableName: string,
  userId: string,
  limit = 50,
): Promise<FollowEdge[]> {
  const res = await getDocumentClient().send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `FOLLOWED_BY#${userId}` },
    ScanIndexForward: false,
    Limit: limit,
  }));
  return (res.Items ?? []).map((i) => ({
    follower: i.follower,
    followee: i.followee,
    followedAt: i.followedAt,
  }));
}
