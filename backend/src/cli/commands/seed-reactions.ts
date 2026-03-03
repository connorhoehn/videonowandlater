/**
 * seed-reactions command
 * Seed sample reactions with sharding for testing timeline
 */

import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuid } from 'uuid';
import { getSessionById } from '../../repositories/session-repository';
import { EmojiType, calculateShardId, ReactionType } from '../../domain/reaction';

/**
 * Seed sample reactions for a session
 *
 * @param sessionId Session ID to seed reactions for
 * @param options Command options with count and replay flag
 */
export async function seedReactions(
  sessionId: string,
  options: { count: string; replay?: boolean }
): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('TABLE_NAME environment variable not set');
  }

  const count = parseInt(options.count, 10);
  if (isNaN(count) || count <= 0) {
    throw new Error('Count must be a positive number');
  }

  console.log(`Fetching session ${sessionId}...`);

  // Fetch session to get recording duration
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  if (!session.recordingDuration) {
    throw new Error(`Session ${sessionId} does not have a recording duration`);
  }

  const maxRelativeTime = session.recordingDuration * 1000; // Convert to milliseconds

  console.log(`Seeding ${count} ${options.replay ? 'replay' : 'live'} reactions...`);

  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  // Get all emoji types for random selection
  const emojiTypes = Object.values(EmojiType);

  // Generate all reactions
  const reactions = [];
  const shardDistribution = new Map<number, number>();

  for (let i = 0; i < count; i++) {
    const reactionId = uuid();
    const userId = `user-${Math.floor(Math.random() * 10)}`; // 10 random users
    const emojiType = emojiTypes[Math.floor(Math.random() * emojiTypes.length)];
    const sessionRelativeTime = Math.floor(Math.random() * maxRelativeTime);
    const shardId = calculateShardId(reactionId);

    // Track shard distribution
    shardDistribution.set(shardId, (shardDistribution.get(shardId) || 0) + 1);

    const shardKey = shardId.toString().padStart(2, '0');
    const timeKey = sessionRelativeTime.toString().padStart(10, '0');

    reactions.push({
      PK: `REACTION#${sessionId}#SHARD${shardKey}`,
      SK: `${timeKey}#${reactionId}`,
      GSI2PK: `REACTION#${sessionId}`,
      GSI2SK: `${timeKey}#${reactionId}`,
      entityType: 'REACTION',
      reactionId,
      sessionId,
      userId,
      emojiType,
      reactionType: options.replay ? ReactionType.REPLAY : ReactionType.LIVE,
      reactedAt: new Date().toISOString(),
      sessionRelativeTime,
      shardId,
    });
  }

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunkSize = 25;
  for (let i = 0; i < reactions.length; i += chunkSize) {
    const chunk = reactions.slice(i, i + chunkSize);

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map(reaction => ({
            PutRequest: {
              Item: reaction,
            },
          })),
        },
      })
    );

    console.log(`Wrote batch ${Math.floor(i / chunkSize) + 1} (${chunk.length} reactions)`);
  }

  console.log(`\nSeeded ${count} reactions successfully!`);
  console.log(`Shard distribution: ${shardDistribution.size} unique shards used`);
}
