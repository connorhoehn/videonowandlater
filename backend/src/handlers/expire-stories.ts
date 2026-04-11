/**
 * Scheduled handler - expire old stories (triggered by EventBridge rule, rate: 1 hour)
 */

import type { ScheduledEvent } from 'aws-lambda';
import { expireOldStories } from '../repositories/story-repository';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'expire-stories' } });

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;

  logger.info('Starting story expiration run', { eventTime: event.time });

  try {
    const expiredCount = await expireOldStories(tableName);

    logger.info('Story expiration complete', { expiredCount });
  } catch (error: any) {
    logger.error('Error expiring stories', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
};
