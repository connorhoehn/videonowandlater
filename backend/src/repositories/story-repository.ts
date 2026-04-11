/**
 * Story repository - story persistence operations
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, UpdateCommand, QueryCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { Session } from '../domain/session';
import { SessionStatus, SessionType } from '../domain/session';
import type { StorySegment, StoryView, StoryReply } from '../domain/story';

const logger = new Logger({ serviceName: 'vnl-story-repository' });

// === Story Session Management ===

/**
 * Create a story session (simpler than broadcast — no IVS resources needed)
 *
 * @param tableName DynamoDB table name
 * @param userId Owner user ID
 * @returns Created session
 */
export async function createStorySession(
  tableName: string,
  userId: string,
): Promise<Session> {
  const docClient = getDocumentClient();
  const sessionId = uuidv4();
  const now = new Date();
  const createdAt = now.toISOString();
  const storyExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const session: Session = {
    sessionId,
    userId,
    sessionType: SessionType.STORY,
    status: SessionStatus.CREATING,
    claimedResources: { chatRoom: '' },
    createdAt,
    version: 1,
    storyExpiresAt,
    storySegments: [],
    storyViewCount: 0,
    storyReplyCount: 0,
  };

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
      GSI1PK: `STATUS#${SessionStatus.CREATING.toUpperCase()}`,
      GSI1SK: createdAt,
      entityType: 'SESSION',
      ...session,
    },
  }));

  logger.info('Created story session', { sessionId, userId });
  return session;
}

/**
 * Add a segment to a story
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to add segment to
 * @param segment Story segment to append
 */
export async function addStorySegment(
  tableName: string,
  sessionId: string,
  segment: StorySegment,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET storySegments = list_append(storySegments, :segment), #version = #version + :inc',
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    ExpressionAttributeNames: { '#version': 'version' },
    ExpressionAttributeValues: {
      ':segment': [segment],
      ':inc': 1,
    },
  }));

  logger.info('Added story segment', { sessionId, segmentId: segment.segmentId });
}

/**
 * Publish story (set status to LIVE)
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to publish
 */
export async function publishStory(
  tableName: string,
  sessionId: string,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #status = :newStatus, GSI1PK = :gsi, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':newStatus': SessionStatus.LIVE,
      ':gsi': `STATUS#${SessionStatus.LIVE.toUpperCase()}`,
      ':inc': 1,
    },
  }));

  logger.info('Published story', { sessionId });
}

/**
 * Update story segments with resolved URLs
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param segments Segments with populated url fields
 */
export async function updateStorySegmentsWithUrls(
  tableName: string,
  sessionId: string,
  segments: StorySegment[],
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET storySegments = :segments, #version = #version + :inc',
    ExpressionAttributeNames: { '#version': 'version' },
    ExpressionAttributeValues: {
      ':segments': segments,
      ':inc': 1,
    },
  }));

  logger.info('Updated story segments with URLs', { sessionId, segmentCount: segments.length });
}

// === Story Views ===

/**
 * Record a story view (idempotent — PK+SK is unique per user)
 * Uses ConditionExpression to prevent double-counting
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID viewed
 * @param userId User who viewed
 */
export async function recordStoryView(
  tableName: string,
  sessionId: string,
  userId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  const viewedAt = new Date().toISOString();

  try {
    // Atomic transaction: insert view record + increment count in one operation
    // Prevents race condition where two requests could both insert and double-count
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: {
              PK: `STORY_VIEW#${sessionId}`,
              SK: `#${userId}`,
              entityType: 'STORY_VIEW',
              sessionId,
              userId,
              viewedAt,
            },
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: {
              PK: `SESSION#${sessionId}`,
              SK: 'METADATA',
            },
            UpdateExpression: 'ADD storyViewCount :inc',
            ExpressionAttributeValues: {
              ':inc': 1,
            },
          },
        },
      ],
    }));

    logger.info('Recorded story view', { sessionId, userId });
  } catch (error: any) {
    if (error.name === 'TransactionCanceledException') {
      logger.info('Story already viewed by user', { sessionId, userId });
      return;
    }
    throw error;
  }
}

/**
 * Get story viewers list
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to get viewers for
 * @returns Array of story views
 */
export async function getStoryViewers(
  tableName: string,
  sessionId: string,
): Promise<StoryView[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `STORY_VIEW#${sessionId}`,
    },
    Limit: 100,
  }));

  return (result.Items || []).map((item) => ({
    sessionId: item.sessionId,
    userId: item.userId,
    viewedAt: item.viewedAt,
  }));
}

/**
 * Check if user has viewed a story
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to check
 * @param userId User ID to check
 * @returns true if user has viewed the story
 */
export async function hasUserViewedStory(
  tableName: string,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `STORY_VIEW#${sessionId}`,
      SK: `#${userId}`,
    },
  }));

  return !!result.Item;
}

// === Story Reactions ===

/**
 * React to a story segment (upsert — one reaction per user per segment)
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param segmentId Segment ID within the story
 * @param userId Reacting user
 * @param emoji Emoji reaction string
 */
export async function reactToStory(
  tableName: string,
  sessionId: string,
  segmentId: string,
  userId: string,
  emoji: string,
): Promise<void> {
  const docClient = getDocumentClient();
  const createdAt = new Date().toISOString();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `STORY_REACTION#${sessionId}#${segmentId}`,
      SK: `#${userId}`,
      entityType: 'STORY_REACTION',
      sessionId,
      segmentId,
      userId,
      emoji,
      createdAt,
    },
  }));

  logger.info('Recorded story reaction', { sessionId, segmentId, userId, emoji });
}

// === Story Replies ===

/**
 * Reply to a story
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID
 * @param reply Story reply to create
 */
export async function createStoryReply(
  tableName: string,
  sessionId: string,
  reply: StoryReply,
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `STORY_REPLY#${sessionId}`,
      SK: `${reply.createdAt}#${reply.replyId}`,
      entityType: 'STORY_REPLY',
      ...reply,
    },
  }));

  // Atomic increment reply count on session
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET storyReplyCount = if_not_exists(storyReplyCount, :zero) + :inc',
    ExpressionAttributeValues: {
      ':zero': 0,
      ':inc': 1,
    },
  }));

  logger.info('Created story reply', { sessionId, replyId: reply.replyId });
}

/**
 * Get replies for a story
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID to get replies for
 * @returns Array of story replies sorted by creation time
 */
export async function getStoryReplies(
  tableName: string,
  sessionId: string,
): Promise<StoryReply[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `STORY_REPLY#${sessionId}`,
    },
    ScanIndexForward: true,
    Limit: 100,
  }));

  return (result.Items || []).map((item) => ({
    replyId: item.replyId,
    sessionId: item.sessionId,
    segmentId: item.segmentId,
    senderId: item.senderId,
    content: item.content,
    createdAt: item.createdAt,
  }));
}

// === Story Feed ===

/**
 * Get active stories (not expired), grouped by user
 * Note: This uses a Scan — consider adding a GSI for production scale
 *
 * @param tableName DynamoDB table name
 * @returns Array of active story sessions sorted by createdAt DESC
 */
export async function getActiveStories(
  tableName: string,
): Promise<Session[]> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression:
      'entityType = :entityType AND sessionType = :sessionType AND #status = :status AND storyExpiresAt > :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':entityType': 'SESSION',
      ':sessionType': SessionType.STORY,
      ':status': SessionStatus.LIVE,
      ':now': now,
    },
  }));

  const stories = (result.Items || []).map((item) => {
    const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
    return session as Session;
  });

  // Sort by createdAt DESC
  stories.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return stories;
}

/**
 * Expire old stories (set status to ENDED)
 *
 * @param tableName DynamoDB table name
 * @returns Count of expired stories
 */
export async function expireOldStories(
  tableName: string,
): Promise<number> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  // Find expired stories that are still live
  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression:
      'entityType = :entityType AND sessionType = :sessionType AND #status = :status AND storyExpiresAt < :now',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':entityType': 'SESSION',
      ':sessionType': SessionType.STORY,
      ':status': SessionStatus.LIVE,
      ':now': now,
    },
  }));

  const expiredItems = result.Items || [];
  let expiredCount = 0;

  // Update each expired story to ENDED
  for (const item of expiredItems) {
    try {
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: `SESSION#${item.sessionId}`,
          SK: 'METADATA',
        },
        UpdateExpression: 'SET #status = :newStatus, GSI1PK = :gsi, endedAt = :now',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':newStatus': SessionStatus.ENDED,
          ':gsi': `STATUS#${SessionStatus.ENDED.toUpperCase()}`,
          ':now': now,
        },
      }));
      expiredCount++;
    } catch (error) {
      logger.error('Failed to expire story', { sessionId: item.sessionId, error });
    }
  }

  logger.info('Expired old stories', { expiredCount, totalFound: expiredItems.length });
  return expiredCount;
}
