/**
 * GET /stories handler - retrieve stories feed grouped by user
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import type { Session } from '../domain/session';
import { getActiveStories, hasUserViewedStory } from '../repositories/story-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'get-stories-feed' } });

interface StoryUserGroup {
  userId: string;
  stories: Session[];
  hasUnseenStories: boolean;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  if (!userId) {
    return {
      statusCode: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  try {
    const activeStories = await getActiveStories(tableName);

    // Group stories by userId
    const userStoriesMap = new Map<string, Session[]>();
    for (const story of activeStories) {
      const stories = userStoriesMap.get(story.userId) || [];
      stories.push(story);
      userStoriesMap.set(story.userId, stories);
    }

    // Build user groups with unseen status
    const storyUsers: StoryUserGroup[] = [];
    for (const [storyUserId, stories] of userStoriesMap) {
      // Sort stories by createdAt (newest first)
      stories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Check if the latest story has been viewed by the requesting user
      const latestStory = stories[0];
      const hasViewed = await hasUserViewedStory(tableName, latestStory.sessionId, userId);

      storyUsers.push({
        userId: storyUserId,
        stories,
        hasUnseenStories: !hasViewed,
      });
    }

    // Sort: unseen users first, then by most recent story createdAt
    storyUsers.sort((a, b) => {
      if (a.hasUnseenStories !== b.hasUnseenStories) {
        return a.hasUnseenStories ? -1 : 1;
      }
      const aLatest = new Date(a.stories[0].createdAt).getTime();
      const bLatest = new Date(b.stories[0].createdAt).getTime();
      return bLatest - aLatest;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ storyUsers }),
    };
  } catch (error) {
    logger.error('Error fetching stories feed', { error: error instanceof Error ? error.message : String(error) });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to fetch stories feed' }),
    };
  }
};
