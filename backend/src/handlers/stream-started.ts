/**
 * EventBridge handler for IVS Stream Start events
 * Transitions session from CREATING to LIVE when stream starts
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { updateSessionStatus } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';

interface StreamStartDetail {
  event_name: 'Stream Start';
  channel_name: string;
  channel_arn: string;
  stream_id: string;
}

export const handler = async (
  event: EventBridgeEvent<'IVS Stream State Change', StreamStartDetail>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const channelArn = event.detail.channel_name; // IVS uses channel_name for ARN

  console.log('Stream Start event received for channel:', channelArn);

  const docClient = getDocumentClient();

  // Find session by channel ARN
  // Using scan for v1 (inefficient but works; can optimize with GSI in v2)
  const scanResult = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'begins_with(PK, :session) AND claimedResources.#channel = :channelArn',
    ExpressionAttributeNames: {
      '#channel': 'channel',
    },
    ExpressionAttributeValues: {
      ':session': 'SESSION#',
      ':channelArn': channelArn,
    },
  }));

  if (!scanResult.Items || scanResult.Items.length === 0) {
    console.warn('No session found for channel:', channelArn);
    return;
  }

  const session = scanResult.Items[0];
  const sessionId = session.sessionId;

  console.log('Found session:', sessionId, 'transitioning to LIVE');

  try {
    await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
    console.log('Session transitioned to LIVE:', sessionId);
  } catch (error: any) {
    console.error('Failed to update session status:', error.message);
    // Don't throw - EventBridge will retry on error
  }
};
