/**
 * POST /admin/moderation/{sessionId}/review
 * Admin-only endpoint to review a moderation flag — dismiss or confirm kill.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, getHangoutParticipants, updateSessionStatus } from '../repositories/session-repository';
import { releasePoolResource } from '../repositories/resource-pool-repository';
import { SessionStatus, SessionType } from '../domain/session';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';
import { IvsClient, StopStreamCommand } from '@aws-sdk/client-ivs';
import { IVSRealTimeClient, DisconnectParticipantCommand } from '@aws-sdk/client-ivs-realtime';
import { IvschatClient, SendEventCommand } from '@aws-sdk/client-ivschat';
import { getDocumentClient } from '../lib/dynamodb-client';
import { QueryCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-review-moderation' } });

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

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  // 1. Check admin auth
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  // 2. Parse sessionId
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  // 3. Parse body
  if (!event.body) return resp(400, { error: 'Request body is required' });

  let action: 'dismiss' | 'confirm_kill';
  let notes: string | undefined;
  try {
    const body = JSON.parse(event.body);
    if (body.action !== 'dismiss' && body.action !== 'confirm_kill') {
      return resp(400, { error: 'action must be "dismiss" or "confirm_kill"' });
    }
    action = body.action;
    notes = body.notes;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  try {
    const docClient = getDocumentClient();

    // 4. Query the most recent MOD# record for this session
    const modQuery = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `SESSION#${sessionId}`,
          ':skPrefix': 'MOD#',
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );

    // 5. If no MOD# record found, return 404
    if (!modQuery.Items || modQuery.Items.length === 0) {
      return resp(404, { error: 'No moderation record found for this session' });
    }

    const modRecord = modQuery.Items[0];

    // 6. Update the MOD# record with review metadata
    const reviewedAt = new Date().toISOString();
    const reviewStatus = action === 'dismiss' ? 'dismissed' : 'confirmed';

    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: {
          PK: modRecord.PK,
          SK: modRecord.SK,
        },
        UpdateExpression: 'SET reviewStatus = :status, reviewedBy = :reviewer, reviewedAt = :at, reviewNotes = :notes',
        ExpressionAttributeValues: {
          ':status': reviewStatus,
          ':reviewer': adminUserId,
          ':at': reviewedAt,
          ':notes': notes || '',
        },
      }),
    );

    // 7. If confirm_kill, attempt to kill the session
    if (action === 'confirm_kill') {
      const session = await getSessionById(tableName, sessionId);

      if (session && session.status === SessionStatus.LIVE) {
        // Stop broadcast stream
        if (session.sessionType === SessionType.BROADCAST && session.channelArn) {
          try {
            await ivsClient.send(new StopStreamCommand({ channelArn: session.channelArn }));
            logger.info('Stopped broadcast stream', { sessionId, channelArn: session.channelArn });
          } catch (err) {
            logger.warn('StopStream failed (stream may already be stopped)', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Disconnect hangout participants
        if (session.sessionType === SessionType.HANGOUT && session.stageArn) {
          const participants = await getHangoutParticipants(tableName, sessionId);
          for (const p of participants) {
            try {
              await ivsRealtimeClient.send(
                new DisconnectParticipantCommand({
                  stageArn: session.stageArn,
                  participantId: p.participantId,
                  reason: 'Session terminated by admin (moderation review)',
                }),
              );
              logger.info('Disconnected participant', { sessionId, participantId: p.participantId });
            } catch (err) {
              logger.warn('DisconnectParticipant failed', {
                participantId: p.participantId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        // Send chat kill notification
        if (session.claimedResources?.chatRoom) {
          try {
            await ivsChatClient.send(
              new SendEventCommand({
                roomIdentifier: session.claimedResources.chatRoom,
                eventName: 'session_killed',
                attributes: {
                  reason: `Moderation review: ${action}${notes ? ` — ${notes}` : ''}`,
                  killedBy: adminUserId,
                },
              }),
            );
            logger.info('Sent chat kill notification', { sessionId });
          } catch (err) {
            logger.warn('SendEvent (chat kill notification) failed', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Transition to ENDING
        await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
        logger.info('Moderation review killed session — transitioned to ENDING', { sessionId, adminUserId });

        // Release pool resources (best-effort)
        try {
          if (session.claimedResources?.channel) {
            await releasePoolResource(tableName, session.claimedResources.channel);
          }
          if (session.claimedResources?.stage) {
            await releasePoolResource(tableName, session.claimedResources.stage);
          }
          if (session.claimedResources?.chatRoom) {
            await releasePoolResource(tableName, session.claimedResources.chatRoom);
          }
        } catch (releaseErr) {
          logger.warn('Resource release failed', {
            error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
          });
        }
      } else {
        logger.info('Session not LIVE — skipping kill, only updating MOD record', {
          sessionId,
          status: session?.status,
        });
      }
    }

    // 8. Write audit record
    const createdAt = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `SESSION#${sessionId}`,
          SK: `MOD#${createdAt}#${uuidv4()}`,
          entityType: 'MODERATION',
          actionType: 'ADMIN_REVIEW',
          actorId: adminUserId,
          reason: `${action}${notes ? `: ${notes}` : ''}`,
          reviewAction: action,
          sessionId,
          createdAt,
          GSI5PK: 'MODERATION',
          GSI5SK: createdAt,
        },
      }),
    );

    // 9. Return success
    return resp(200, { message: 'Review recorded', action, sessionId });
  } catch (err: any) {
    logger.error('Error reviewing moderation', { error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}
