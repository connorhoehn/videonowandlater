/**
 * Pool replenishment Lambda handler
 * Scheduled via EventBridge to maintain minimum pool sizes
 *
 * Pattern 3: Scheduled Pool Replenishment
 * - Counts AVAILABLE resources via GSI1 query
 * - Creates new IVS resources when below threshold
 * - Stores pool items in DynamoDB with status AVAILABLE
 */

import type { Handler } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CreateChannelCommand } from '@aws-sdk/client-ivs';
import { CreateStageCommand } from '@aws-sdk/client-ivs-realtime';
import { CreateRoomCommand } from '@aws-sdk/client-ivschat';
import { v4 as uuidv4 } from 'uuid';

import { getIVSClient, getIVSRealTimeClient, getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';
import { ResourceType, Status } from '../domain/types';

interface ReplenishResult {
  channelsCreated: number;
  stagesCreated: number;
  roomsCreated: number;
}

/**
 * Lambda handler triggered by EventBridge schedule (every 5 minutes)
 */
export const handler: Handler = async (_event): Promise<ReplenishResult> => {
  const tableName = process.env.TABLE_NAME;
  const recordingConfigArn = process.env.RECORDING_CONFIGURATION_ARN;

  if (!tableName) {
    throw new Error('TABLE_NAME environment variable is required');
  }

  if (!recordingConfigArn) {
    throw new Error('RECORDING_CONFIGURATION_ARN environment variable is required');
  }

  const minChannels = parseInt(process.env.MIN_CHANNELS || '3', 10);
  const minStages = parseInt(process.env.MIN_STAGES || '2', 10);
  const minRooms = parseInt(process.env.MIN_ROOMS || '5', 10);
  const minPrivateChannels = parseInt(process.env.MIN_PRIVATE_CHANNELS || '5', 10); // Phase 22

  console.log('Starting pool replenishment check', { minChannels, minStages, minRooms, minPrivateChannels });

  // Count available resources by type
  const availableChannels = await countAvailableResources(tableName, ResourceType.CHANNEL);
  const availableStages = await countAvailableResources(tableName, ResourceType.STAGE);
  const availableRooms = await countAvailableResources(tableName, ResourceType.ROOM);
  const availablePrivateChannels = await countAvailablePrivateChannels(tableName); // Phase 22

  console.log('Current pool status', { availableChannels, availableStages, availableRooms, availablePrivateChannels });

  // Calculate how many resources to create
  const channelsToCreate = Math.max(0, minChannels - availableChannels);
  const stagesToCreate = Math.max(0, minStages - availableStages);
  const roomsToCreate = Math.max(0, minRooms - availableRooms);
  const privateChannelsToCreate = Math.max(0, minPrivateChannels - availablePrivateChannels); // Phase 22

  if (channelsToCreate === 0 && stagesToCreate === 0 && roomsToCreate === 0 && privateChannelsToCreate === 0) {
    console.log('Pool is healthy, no resources needed');
    return { channelsCreated: 0, stagesCreated: 0, roomsCreated: 0 };
  }

  console.log('Creating resources', { channelsToCreate, stagesToCreate, roomsToCreate, privateChannelsToCreate });

  // Create resources in parallel
  await Promise.all([
    ...Array.from({ length: channelsToCreate }, () => createChannel(tableName, recordingConfigArn)),
    ...Array.from({ length: stagesToCreate }, () => createStage(tableName, recordingConfigArn)),
    ...Array.from({ length: roomsToCreate }, () => createRoom(tableName)),
    ...Array.from({ length: privateChannelsToCreate }, () => createPrivateChannel(tableName, recordingConfigArn)), // Phase 22
  ]);

  console.log('Pool replenishment complete', { channelsCreated: channelsToCreate, stagesCreated: stagesToCreate, roomsCreated: roomsToCreate, privateChannelsCreated: privateChannelsToCreate });

  return {
    channelsCreated: channelsToCreate,
    stagesCreated: stagesToCreate,
    roomsCreated: roomsToCreate,
  };
};

/**
 * Count AVAILABLE resources of a specific type using GSI1
 */
async function countAvailableResources(tableName: string, resourceType: ResourceType): Promise<number> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :status',
        ExpressionAttributeValues: {
          ':status': `STATUS#AVAILABLE#${resourceType}`,
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  } catch (error) {
    console.error('Error counting available resources', { resourceType, error });
    return 0;
  }
}

/**
 * Count AVAILABLE private channels using GSI1 (Phase 22)
 */
async function countAvailablePrivateChannels(tableName: string): Promise<number> {
  const docClient = getDocumentClient();

  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :status',
        ExpressionAttributeValues: {
          ':status': 'STATUS#AVAILABLE#PRIVATE_CHANNEL', // Private channel pool marker
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  } catch (error) {
    console.error('Error counting available private channels', error);
    return 0;
  }
}

/**
 * Create a new IVS Low-Latency channel and store in pool
 */
async function createChannel(tableName: string, recordingConfigArn: string): Promise<void> {
  const ivsClient = getIVSClient();
  const docClient = getDocumentClient();

  try {
    const response = await ivsClient.send(
      new CreateChannelCommand({
        name: `vnl-pool-${uuidv4()}`,
        latencyMode: 'LOW',
        type: 'STANDARD',
        recordingConfigurationArn: recordingConfigArn,
      })
    );

    if (!response.channel || !response.streamKey) {
      console.error('CreateChannel response missing channel or streamKey', response);
      return;
    }

    // Extract resource ID from ARN (format: arn:aws:ivs:region:account:channel/resourceId)
    const resourceId = response.channel.arn!.split('/').pop()!;

    // Store in DynamoDB pool
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `POOL#CHANNEL#${resourceId}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#AVAILABLE#${ResourceType.CHANNEL}`,
          GSI1SK: new Date().toISOString(),
          entityType: 'POOL_ITEM',
          resourceType: ResourceType.CHANNEL,
          resourceArn: response.channel.arn,
          resourceId,
          ingestEndpoint: response.channel.ingestEndpoint,
          playbackUrl: response.channel.playbackUrl,
          streamKey: response.streamKey.value, // CRITICAL: Store stream key (Pitfall 5)
          status: Status.AVAILABLE,
          version: 1,
          createdAt: new Date().toISOString(),
          claimedAt: null,
          claimedBy: null,
        },
      })
    );

    console.log('Created channel', { resourceId });
  } catch (error) {
    console.error('Error creating channel', error);
    // Don't throw - continue creating other resources
  }
}

/**
 * Create a new private IVS channel with JWT playback authorization and store in pool
 * Phase 22: Private channels for secure viewer link broadcasts
 */
async function createPrivateChannel(tableName: string, recordingConfigArn: string): Promise<void> {
  const ivsClient = getIVSClient();
  const docClient = getDocumentClient();

  try {
    const response = await ivsClient.send(
      new CreateChannelCommand({
        name: `vnl-pool-private-${uuidv4()}`,
        latencyMode: 'LOW',
        type: 'STANDARD',
        recordingConfigurationArn: recordingConfigArn,
      })
    );

    if (!response.channel || !response.streamKey) {
      console.error('CreateChannel response missing channel or streamKey', response);
      return;
    }

    // Extract resource ID from ARN (format: arn:aws:ivs:region:account:channel/resourceId)
    const resourceId = response.channel.arn!.split('/').pop()!;

    // Store in DynamoDB pool with isPrivate=true marker
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `POOL#CHANNEL#${resourceId}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#AVAILABLE#PRIVATE_CHANNEL`, // Private channel pool marker
          GSI1SK: new Date().toISOString(),
          entityType: 'POOL_ITEM',
          resourceType: ResourceType.CHANNEL,
          resourceArn: response.channel.arn,
          resourceId,
          ingestEndpoint: response.channel.ingestEndpoint,
          playbackUrl: response.channel.playbackUrl,
          streamKey: response.streamKey.value, // CRITICAL: Store stream key (Pitfall 5)
          status: Status.AVAILABLE,
          version: 1,
          isPrivate: true, // Mark as private channel
          createdAt: new Date().toISOString(),
          claimedAt: null,
          claimedBy: null,
        },
      })
    );

    console.log('Created private channel', { resourceId });
  } catch (error) {
    console.error('Error creating private channel', error);
    // Don't throw - continue creating other resources
  }
}

/**
 * Create a new IVS RealTime stage and store in pool
 */
async function createStage(tableName: string, recordingConfigArn: string): Promise<void> {
  const ivsRealTimeClient = getIVSRealTimeClient();
  const docClient = getDocumentClient();

  try {
    const response = await ivsRealTimeClient.send(
      new CreateStageCommand({
        name: `vnl-pool-${uuidv4()}`,
      })
    );

    if (!response.stage) {
      console.error('CreateStage response missing stage', response);
      return;
    }

    // Extract resource ID from ARN
    const resourceId = response.stage.arn!.split('/').pop()!;

    // Store in DynamoDB pool
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `POOL#STAGE#${resourceId}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#AVAILABLE#${ResourceType.STAGE}`,
          GSI1SK: new Date().toISOString(),
          entityType: 'POOL_ITEM',
          resourceType: ResourceType.STAGE,
          resourceArn: response.stage.arn,
          resourceId,
          endpoints: {
            playback: response.stage.endpoints!.events,
            ingest: response.stage.endpoints!.whip,
          },
          status: Status.AVAILABLE,
          version: 1,
          createdAt: new Date().toISOString(),
          claimedAt: null,
          claimedBy: null,
        },
      })
    );

    console.log('Created stage', { resourceId });
  } catch (error) {
    console.error('Error creating stage', error);
    // Don't throw - continue creating other resources
  }
}

/**
 * Create a new IVS Chat room and store in pool
 */
async function createRoom(tableName: string): Promise<void> {
  const ivsChatClient = getIVSChatClient();
  const docClient = getDocumentClient();

  try {
    const response = await ivsChatClient.send(
      new CreateRoomCommand({
        name: `vnl-pool-${uuidv4()}`,
      })
    );

    if (!response.arn) {
      console.error('CreateRoom response missing arn', response);
      return;
    }

    // Extract resource ID from ARN
    const resourceId = response.arn.split('/').pop()!;

    // Store in DynamoDB pool
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          PK: `POOL#ROOM#${resourceId}`,
          SK: 'METADATA',
          GSI1PK: `STATUS#AVAILABLE#${ResourceType.ROOM}`,
          GSI1SK: new Date().toISOString(),
          entityType: 'POOL_ITEM',
          resourceType: ResourceType.ROOM,
          resourceArn: response.arn,
          resourceId,
          status: Status.AVAILABLE,
          version: 1,
          createdAt: new Date().toISOString(),
          claimedAt: null,
          claimedBy: null,
        },
      })
    );

    console.log('Created room', { resourceId });
  } catch (error) {
    console.error('Error creating room', error);
    // Don't throw - continue creating other resources
  }
}
