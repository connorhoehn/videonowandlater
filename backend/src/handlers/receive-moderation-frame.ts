/**
 * POST /sessions/{sessionId}/moderation-frame
 * Receives a client-captured video frame and runs Rekognition content moderation.
 * Used for hangout sessions where server-side thumbnail sampling is not available.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient, DisconnectParticipantCommand } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { QueryCommand, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { DEFAULT_MODERATION_CONFIG } from '../domain/moderation';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'receive-moderation-frame' } });

const rekognitionClient = new RekognitionClient({});
const ivsClient = new IvsClient({});
const ivsRealtimeClient = new IVSRealTimeClient({});
const ivsChatClient = new IvschatClient({});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const MAX_FRAME_SIZE_BYTES = 500_000; // ~500KB base64

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // Parse body
  let frame: string;
  try {
    const body = JSON.parse(event.body || '{}');
    frame = body.frame;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  if (!frame || typeof frame !== 'string') {
    return resp(400, { error: 'frame (base64 string) is required' });
  }

  // Validate frame size
  if (frame.length > MAX_FRAME_SIZE_BYTES) {
    return resp(400, { error: 'Frame exceeds maximum size' });
  }

  const docClient = getDocumentClient();

  // Look up session
  let session: any;
  try {
    const result = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'META' },
    }));
    session = result.Item;
  } catch (err) {
    logger.error('Failed to fetch session', { sessionId, error: err instanceof Error ? err.message : String(err) });
    return resp(200, { ok: true }); // Don't reveal internals
  }

  if (!session) {
    return resp(200, { ok: true }); // Don't reveal that session doesn't exist
  }

  try {
    // Convert base64 to Uint8Array
    const imageBytes = Uint8Array.from(atob(frame), (c) => c.charCodeAt(0));

    // Send to Rekognition
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
      return resp(200, { ok: true }); // No concerning content
    }

    // Determine max confidence and action type
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

    // Write moderation record to DynamoDB
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

    // If auto-kill threshold exceeded, stop stream/disconnect participants
    if (actionType === 'ML_AUTO_KILL') {
      logger.warn('Auto-killing session due to high-confidence moderation flag', {
        sessionId,
        maxConfidence,
      });

      // Stop the IVS broadcast stream (if applicable)
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

      // Disconnect hangout participants (if applicable)
      if (session.stageArn) {
        try {
          // Query participants for this session
          const participantsResult = await docClient.send(
            new QueryCommand({
              TableName: tableName,
              KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
              ExpressionAttributeValues: {
                ':pk': `SESSION#${sessionId}`,
                ':skPrefix': 'PARTICIPANT#',
              },
            }),
          );

          for (const p of participantsResult.Items ?? []) {
            if (p.participantId) {
              try {
                await ivsRealtimeClient.send(
                  new DisconnectParticipantCommand({
                    stageArn: session.stageArn,
                    participantId: p.participantId,
                    reason: 'Content moderation: inappropriate content detected',
                  }),
                );
              } catch {
                // Best effort — participant may have already left
              }
            }
          }
          logger.info('Disconnected hangout participants', { sessionId });
        } catch (disconnectErr) {
          logger.warn('Failed to disconnect participants', {
            sessionId,
            error: disconnectErr instanceof Error ? disconnectErr.message : String(disconnectErr),
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
    logger.error('Error processing moderation frame', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Always return 200 — don't reveal moderation results to the client
  return resp(200, { ok: true });
}
