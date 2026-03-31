/**
 * Reaction repository - sharded reaction persistence operations
 */

import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Reaction, EmojiType } from '../domain/reaction';
import { SHARD_COUNT } from '../domain/reaction';

const logger = new Logger({ serviceName: 'vnl-repository' });

/**
 * Store a reaction in DynamoDB with sharded writes
 * Distributes writes across 100 partitions to prevent hot partition throttling
 *
 * @param tableName DynamoDB table name
 * @param reaction Reaction object to persist
 */
export async function persistReaction(tableName: string, reaction: Reaction): Promise<void> {
  const docClient = getDocumentClient();

  // Build sharded partition key: REACTION#{sessionId}#{emojiType}#SHARD{N}
  const pk = `REACTION#${reaction.sessionId}#${reaction.emojiType}#SHARD${reaction.shardId}`;

  // Build sort key with zero-padded time for sorting: {sessionRelativeTime}#{reactionId}
  const sk = `${reaction.sessionRelativeTime.toString().padStart(15, '0')}#${reaction.reactionId}`;

  // Build GSI2 keys for time-range queries
  const gsi2pk = `REACTION#${reaction.sessionId}`;
  const gsi2sk = reaction.sessionRelativeTime.toString().padStart(15, '0');

  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: pk,
          SK: sk,
          entityType: 'REACTION',
          GSI2PK: gsi2pk,
          GSI2SK: gsi2sk,
          ...reaction,
        },
      })
    );
  } catch (error) {
    logger.error('Error persisting reaction', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Retrieve reactions for a session within a time range
 * Queries GSI2 for efficient time-based filtering
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param startTime Session-relative start time in milliseconds
 * @param endTime Session-relative end time in milliseconds
 * @param limit Maximum number of reactions (default 100)
 * @returns Array of Reaction objects within the time range
 */
export async function getReactionsInTimeRange(
  tableName: string,
  sessionId: string,
  startTime: number,
  endTime: number,
  limit: number = 100
): Promise<Reaction[]> {
  const docClient = getDocumentClient();

  // Zero-pad times to match GSI2SK format
  const startSK = startTime.toString().padStart(15, '0');
  const endSK = endTime.toString().padStart(15, '0');

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': `REACTION#${sessionId}`,
          ':start': startSK,
          ':end': endSK,
        },
        Limit: limit,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    // Strip DynamoDB metadata and return Reaction objects
    const reactions = result.Items.map((item) => {
      const { PK, SK, entityType, GSI2PK, GSI2SK, ...reaction } = item;
      return reaction as Reaction;
    });

    return reactions;
  } catch (error) {
    logger.error('Error getting reactions in time range', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/**
 * Get total count of reactions for a specific emoji type
 * Aggregates across all 100 shards to get accurate count
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param emojiType Emoji type to count
 * @returns Total count of reactions across all shards
 */
export async function getReactionCounts(
  tableName: string,
  sessionId: string,
  emojiType: EmojiType
): Promise<number> {
  const docClient = getDocumentClient();
  let totalCount = 0;

  try {
    // Query each shard and aggregate counts
    const queryPromises = [];

    for (let shardId = 1; shardId <= SHARD_COUNT; shardId++) {
      const pk = `REACTION#${sessionId}#${emojiType}#SHARD${shardId}`;

      queryPromises.push(
        docClient.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk',
            ExpressionAttributeValues: {
              ':pk': pk,
            },
            Select: 'COUNT',
          })
        )
      );
    }

    // Execute all queries in parallel
    const results = await Promise.all(queryPromises);

    // Sum up all counts
    for (const result of results) {
      totalCount += result.Count || 0;
    }

    return totalCount;
  } catch (error) {
    logger.error('Error getting reaction counts', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
