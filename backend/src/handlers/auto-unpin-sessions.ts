/**
 * Scheduled Lambda (hourly) to auto-unpin sessions pinned longer than 24 hours.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'auto-unpin-sessions' } });

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function handler(): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME not set');
    return;
  }

  const docClient = getDocumentClient();

  const now = Date.now();
  let totalScanned = 0;
  let unpinnedCount = 0;
  let lastKey: Record<string, any> | undefined;

  do {
    // 1. Scan for pinned sessions (paginated)
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'isPinned = :true AND attribute_exists(pinnedAt) AND begins_with(PK, :session) AND SK = :metadata',
        ExpressionAttributeValues: {
          ':true': true,
          ':session': 'SESSION#',
          ':metadata': 'METADATA',
        },
        ProjectionExpression: 'PK, SK, pinnedAt, pinnedBy',
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      }),
    );

    const items = result.Items ?? [];
    totalScanned += items.length;

    // 2. Check each pinned session for expiry
    for (const item of items) {
      const pinnedAt = item.pinnedAt as string;
      const pinnedTime = new Date(pinnedAt).getTime();

      if (now - pinnedTime > TWENTY_FOUR_HOURS_MS) {
        // 3. Unpin expired session
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: 'REMOVE isPinned, pinnedAt, pinnedBy',
          }),
        );

        const sessionId = (item.PK as string).replace('SESSION#', '');
        logger.info('Auto-unpinned expired session', { sessionId, pinnedAt, pinnedBy: item.pinnedBy });
        unpinnedCount++;
      }
    }

    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  logger.info('Auto-unpin complete', { total: totalScanned, unpinned: unpinnedCount });
}
