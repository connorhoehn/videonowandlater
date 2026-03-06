/**
 * EventBridge handler for IVS Stream End events
 * Transitions session from LIVE to ENDING when the broadcast stream stops.
 * Recording processing continues asynchronously; recording-ended.ts handles ENDING → ENDED.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { updateSessionStatus } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';

interface StreamEndDetail {
  event_name: 'Stream End';
  channel_name: string;
  channel_arn: string;
  stream_id: string;
}

export const handler = async (
  event: EventBridgeEvent<'IVS Stream State Change', StreamEndDetail>
): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  // IVS Stream State Change: channel ARN is in event.resources[0]
  // detail.channel_arn does not exist for stream state change events
  const channelArn = event.resources?.[0];
  console.log('Raw event:', JSON.stringify({ resources: event.resources, detail: event.detail }));

  console.log('Stream End event received for channel:', channelArn);

  const docClient = getDocumentClient();

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

  console.log('Found session:', sessionId, 'transitioning LIVE → ENDING');

  try {
    await updateSessionStatus(tableName, sessionId, SessionStatus.ENDING, 'endedAt');
    console.log('Session transitioned to ENDING:', sessionId);
  } catch (error: any) {
    console.error('Failed to update session status:', error.message);
  }
};
