/**
 * Cron Lambda handler for stuck session detection and recovery.
 * Queries DynamoDB GSI1 for sessions in STATUS#ENDING and STATUS#ENDED partitions,
 * filters for stalled transcriptStatus, atomically increments recoveryAttemptCount,
 * and publishes "Recording Recovery" events to EventBridge.
 *
 * PIPE-05: Detect stuck sessions (endedAt > 45 min, transcriptStatus null/pending)
 * PIPE-06: Prevent double-submission (skip transcriptStatus = 'processing')
 * PIPE-07: Cap retries at 3 via recoveryAttemptCount
 * PIPE-08: Atomic counter increment with conditional write before PutEvents
 */

import type { Handler } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'scan-stuck-sessions' },
});

const STUCK_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes
const PROCESSING_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_MAX_RECOVERY_PER_RUN = 25;
const RECOVERY_ATTEMPT_CAP = 3;

type RecoverSessionResult = 'recovered' | 'skipped';

/**
 * Query DynamoDB GSI1 for all sessions in STATUS#ENDING and STATUS#ENDED partitions.
 * Returns merged Items array. Errors per-partition are non-blocking (returns []).
 */
async function queryEndingSessions(tableName: string): Promise<Record<string, any>[]> {
  const docClient = getDocumentClient();
  const partitions = ['STATUS#ENDING', 'STATUS#ENDED'];
  const allItems: Record<string, any>[] = [];

  for (const partition of partitions) {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :status',
        ExpressionAttributeValues: { ':status': partition },
      }));
      if (result.Items) {
        allItems.push(...result.Items);
      }
    } catch (err: any) {
      logger.error(`Failed to query partition ${partition} (non-blocking):`, {
        partition,
        errorMessage: err.message,
      });
    }
  }

  return allItems;
}

/**
 * Attempt recovery for a single eligible session:
 * 1. Atomically increment recoveryAttemptCount (conditional, cap at 3)
 * 2. Publish "Recording Recovery" event to EventBridge
 */
async function recoverSession(
  item: Record<string, any>,
  tableName: string,
  awsRegion: string,
): Promise<RecoverSessionResult> {
  const sessionId: string = item.sessionId;
  logger.appendPersistentKeys({ sessionId });

  const currentCount: number = item.recoveryAttemptCount ?? 0;
  const newCount = currentCount + 1;

  // Atomically increment recoveryAttemptCount with cap guard
  try {
    await getDocumentClient().send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET recoveryAttemptCount = if_not_exists(recoveryAttemptCount, :zero) + :inc',
      ConditionExpression:
        'attribute_not_exists(recoveryAttemptCount) OR recoveryAttemptCount < :cap',
      ExpressionAttributeValues: {
        ':inc': 1,
        ':zero': 0,
        ':cap': RECOVERY_ATTEMPT_CAP,
      },
    }));
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      logger.warn('Concurrent cron race or cap already reached — skipping session', {
        sessionId,
        recoveryAttemptCount: currentCount,
      });
      return 'skipped';
    }
    logger.error('Failed to increment recoveryAttemptCount (non-blocking):', {
      sessionId,
      errorMessage: err.message,
    });
    return 'skipped';
  }

  // Publish recovery event to EventBridge default bus
  try {
    const ebClient = new EventBridgeClient({ region: awsRegion });
    await ebClient.send(new PutEventsCommand({
      Entries: [
        {
          Source: 'custom.vnl',
          DetailType: 'Recording Recovery',
          Detail: JSON.stringify({
            sessionId,
            recoveryAttempt: true,
            recoveryAttemptCount: newCount,
            recordingHlsUrl: item.recordingHlsUrl,
            recordingS3Path: item.recordingS3Path,
          }),
        },
      ],
    }));

    logger.info('Recovery event published', {
      sessionId,
      recoveryAttemptCount: newCount,
    });
  } catch (err: any) {
    logger.error('Failed to publish recovery event (non-blocking):', {
      sessionId,
      errorMessage: err.message,
    });
    // PutEvents failure is non-blocking — don't count as recovered
    return 'skipped';
  }

  return 'recovered';
}

export const handler: Handler = async (): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const awsRegion = process.env.AWS_REGION ?? 'us-east-1';
  const maxRecoveryPerRun = parseInt(
    process.env.MAX_RECOVERY_PER_RUN ?? String(DEFAULT_MAX_RECOVERY_PER_RUN),
    10,
  );

  const startMs = Date.now();
  logger.info('Pipeline stage entered');

  // Query both GSI1 partitions
  const allItems = await queryEndingSessions(tableName);

  // Compute 45-minute cutoff and 2-hour stale-processing cutoff
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
  const staleProcessingCutoff = new Date(Date.now() - PROCESSING_STALE_THRESHOLD_MS).toISOString();

  // In-Lambda filter: endedAt threshold, transcriptStatus gate, count cap
  const eligibleSessions = allItems.filter((item) => {
    if (!item.endedAt || item.endedAt >= cutoff) {
      return false; // Not old enough or no endedAt
    }

    const ts = item.transcriptStatus;
    if (ts === 'available' || ts === 'failed') {
      return false; // Terminal states — no recovery needed
    }

    if (ts === 'processing') {
      const statusUpdatedAt = item.transcriptStatusUpdatedAt as string | undefined;
      // No timestamp: unknown when it entered processing — skip conservatively
      if (!statusUpdatedAt) return false;
      // Updated recently: job may still be running — skip
      if (statusUpdatedAt >= staleProcessingCutoff) return false;
      // Falls through: processing AND updatedAt > 2h → eligible for recovery
    }

    const count: number = item.recoveryAttemptCount ?? 0;
    if (count >= RECOVERY_ATTEMPT_CAP) {
      return false; // Permanently excluded
    }
    return true;
  });

  // Warn if systemic issue detected
  if (eligibleSessions.length > maxRecoveryPerRun) {
    logger.warn(
      `Systemic pipeline issue: more than MAX_RECOVERY_PER_RUN stuck sessions found`,
      {
        eligibleCount: eligibleSessions.length,
        maxRecoveryPerRun,
      },
    );
  }

  // Cap to max per run
  const sessionsToProcess = eligibleSessions.slice(0, maxRecoveryPerRun);

  // Process eligible sessions in parallel
  const results = await Promise.all(
    sessionsToProcess.map((item) => recoverSession(item, tableName, awsRegion)),
  );

  const sessionsRecovered = results.filter((r) => r === 'recovered').length;
  const sessionsSkipped = results.filter((r) => r === 'skipped').length;

  logger.info('Pipeline stage completed', {
    durationMs: Date.now() - startMs,
    sessionsRecovered,
    sessionsSkipped,
  });
};
