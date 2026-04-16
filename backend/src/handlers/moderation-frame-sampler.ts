/**
 * Scheduled Lambda (EventBridge every 60s)
 * Samples frames from live sessions and runs Rekognition content moderation.
 * Flags or auto-kills sessions with inappropriate content.
 */

import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { DEFAULT_MODERATION_CONFIG, getRandomSamplingInterval } from '../domain/moderation';
import { SessionType } from '../domain/session';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'moderation-frame-sampler' } });

const rekognitionClient = new RekognitionClient({});
const ivsClient = new IvsClient({});
const ivsChatClient = new IvschatClient({});

const MAX_SESSIONS_PER_ROUND = 10;
const LAMBDA_TIMEOUT_MS = 55_000; // 55s budget (Lambda has 60s timeout, leave 5s buffer)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handler(): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    logger.error('TABLE_NAME environment variable not set');
    return;
  }

  const docClient = getDocumentClient();
  const startTime = Date.now();
  let totalSamples = 0;

  // Loop with randomized 3-6 second intervals until Lambda timeout budget is exhausted
  while (Date.now() - startTime < LAMBDA_TIMEOUT_MS) {
    // 1. Query GSI1 for STATUS#LIVE sessions each round (sessions may start/end)
    let liveSessions: any[] = [];
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :status',
          ExpressionAttributeValues: {
            ':status': 'STATUS#LIVE',
          },
        }),
      );
      liveSessions = result.Items ?? [];
    } catch (err) {
      logger.error('Failed to query live sessions', {
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }

    // 2. Filter to BROADCAST sessions with thumbnailUrl
    const eligibleSessions = liveSessions
      .filter(
        (s) =>
          s.sessionType === SessionType.BROADCAST &&
          s.thumbnailUrl,
      )
      .slice(0, MAX_SESSIONS_PER_ROUND);

    if (eligibleSessions.length === 0) {
      // No live sessions to monitor — sleep and check again
      const interval = getRandomSamplingInterval() * 1000;
      await sleep(interval);
      continue;
    }

    // 3. Sample one random session per round (distribute load)
    const session = eligibleSessions[Math.floor(Math.random() * eligibleSessions.length)];
    const sessionId = session.sessionId;

    try {

      // 3b. Fetch thumbnail from CloudFront
      let imageBytes: Uint8Array;
      try {
        const response = await fetch(session.thumbnailUrl);
        if (!response.ok) {
          logger.warn('Failed to fetch thumbnail', {
            sessionId,
            thumbnailUrl: session.thumbnailUrl,
            status: response.status,
          });
          continue;
        }
        imageBytes = new Uint8Array(await response.arrayBuffer());
      } catch (fetchErr) {
        logger.warn('Error fetching thumbnail', {
          sessionId,
          error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        });
        continue;
      }

      // 3c. Send to Rekognition
      const rekResult = await rekognitionClient.send(
        new DetectModerationLabelsCommand({
          Image: { Bytes: imageBytes },
          MinConfidence: DEFAULT_MODERATION_CONFIG.flagThreshold,
        }),
      );

      const moderationLabels = rekResult.ModerationLabels ?? [];
      logger.info('Rekognition moderation result', {
        sessionId,
        labelCount: moderationLabels.length,
        labels: moderationLabels.map((l) => ({ name: l.Name, confidence: l.Confidence })),
      });

      if (moderationLabels.length === 0) {
        continue; // No concerning content
      }

      // 3d. Determine max confidence and action type
      const maxConfidence = Math.max(...moderationLabels.map((l) => l.Confidence ?? 0));
      const actionType =
        maxConfidence >= DEFAULT_MODERATION_CONFIG.autoKillThreshold ? 'ML_AUTO_KILL' : 'ML_FLAG';

      const labels = moderationLabels.map((l) => ({
        name: l.Name ?? 'Unknown',
        confidence: l.Confidence ?? 0,
        parentName: l.ParentName,
      }));

      const reason = labels.map((l) => l.name).join(', ');
      const createdAt = new Date().toISOString();

      // 3e. Write moderation record to DynamoDB
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            PK: `SESSION#${sessionId}`,
            SK: `MOD#${createdAt}#${uuidv4()}`,
            entityType: 'MODERATION',
            actionType,
            actorId: 'SYSTEM',
            reason,
            labels,
            sessionId,
            createdAt,
            sessionType: session.sessionType,
            previousStatus: session.status ?? 'live',
            GSI5PK: 'MODERATION',
            GSI5SK: createdAt,
          },
        }),
      );

      logger.info('Wrote moderation record', { sessionId, actionType, reason, maxConfidence });

      // 3f. If auto-kill threshold exceeded, stop the stream
      if (actionType === 'ML_AUTO_KILL') {
        logger.warn('Auto-killing session due to high-confidence moderation flag', {
          sessionId,
          maxConfidence,
        });

        // Stop the IVS broadcast stream
        if (session.channelArn) {
          try {
            await ivsClient.send(new StopStreamCommand({ channelArn: session.channelArn }));
            logger.info('Stopped broadcast stream', { sessionId, channelArn: session.channelArn });
          } catch (stopErr) {
            logger.warn('StopStream failed (stream may already be stopped)', {
              sessionId,
              error: stopErr instanceof Error ? stopErr.message : String(stopErr),
            });
          }
        }

        // Send chat notification
        if (session.claimedResources?.chatRoom) {
          try {
            await ivsChatClient.send(
              new SendEventCommand({
                roomIdentifier: session.claimedResources.chatRoom,
                eventName: 'session_killed',
                attributes: {
                  reason: 'Content moderation: inappropriate content detected',
                  killedBy: 'SYSTEM',
                },
              }),
            );
            logger.info('Sent chat kill notification', { sessionId });
          } catch (chatErr) {
            logger.warn('SendEvent (chat kill notification) failed', {
              sessionId,
              error: chatErr instanceof Error ? chatErr.message : String(chatErr),
            });
          }
        }

        // Update session status to ENDING
        try {
          await docClient.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                ...session,
                GSI1PK: 'STATUS#ENDING',
                GSI1SK: createdAt,
                status: 'ending',
                endedAt: createdAt,
              },
            }),
          );
          logger.info('Updated session status to ENDING', { sessionId });
        } catch (updateErr) {
          logger.warn('Failed to update session status', {
            sessionId,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        }
      }
    } catch (err) {
      logger.error('Error processing session for moderation', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    totalSamples++;

    // Wait a random 3-6 seconds before next sample
    const interval = getRandomSamplingInterval() * 1000;
    await sleep(interval);
  }

  logger.info('Moderation frame sampler completed', { totalSamples, durationMs: Date.now() - startTime });
}
