/**
 * Resource pool repository - atomic pool claim operations
 */

import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { ResourceType, Status } from '../domain/types';

interface ClaimResult {
  resourceArn: string;
  poolItemPK: string;
  resourceDetails: Record<string, any>;  // ingestEndpoint, playbackUrl, streamKey, etc.
}

/**
 * Atomically claim the next available resource from the pool
 * Uses DynamoDB conditional write to prevent race conditions
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session ID claiming the resource
 * @param resourceType Type of resource to claim (CHANNEL, STAGE, or ROOM)
 * @returns ClaimResult if successful, null if pool exhausted or concurrent claim conflict
 */
export async function claimNextAvailableResource(
  tableName: string,
  sessionId: string,
  resourceType: ResourceType
): Promise<ClaimResult | null> {
  const docClient = getDocumentClient();

  // Step 1: Query GSI to find AVAILABLE resources of specified type
  const queryResult = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    FilterExpression: 'resourceType = :type',
    ExpressionAttributeValues: {
      ':status': 'STATUS#AVAILABLE',
      ':type': resourceType,
    },
    Limit: 1,
    ScanIndexForward: true,  // FIFO: oldest first (GSI1SK = createdAt)
  }));

  if (!queryResult.Items || queryResult.Items.length === 0) {
    return null;  // Pool exhausted
  }

  const item = queryResult.Items[0];
  const currentVersion = item.version;

  // Step 2: Conditional write to claim (atomic)
  try {
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
      UpdateExpression: 'SET #status = :claimed, #claimedBy = :sessionId, #claimedAt = :now, #version = :newVersion, GSI1PK = :newGSI',
      ConditionExpression: '#status = :available AND #version = :currentVersion',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#claimedBy': 'claimedBy',
        '#claimedAt': 'claimedAt',
        '#version': 'version',
      },
      ExpressionAttributeValues: {
        ':available': Status.AVAILABLE,
        ':claimed': Status.CLAIMED,
        ':sessionId': sessionId,
        ':now': new Date().toISOString(),
        ':currentVersion': currentVersion,
        ':newVersion': currentVersion + 1,
        ':newGSI': 'STATUS#CLAIMED',
      },
    }));

    return {
      resourceArn: item.resourceArn,
      poolItemPK: item.PK,
      resourceDetails: {
        ingestEndpoint: item.ingestEndpoint,
        playbackUrl: item.playbackUrl,
        streamKey: item.streamKey,
        endpoints: item.endpoints,
      },
    };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Another request claimed this resource; caller should retry
      return null;
    }
    throw error;
  }
}

/**
 * Release a pool resource back to AVAILABLE status
 * Clears claimedBy and claimedAt fields
 *
 * @param tableName DynamoDB table name
 * @param resourceArn ARN of resource to release
 */
export async function releasePoolResource(
  tableName: string,
  resourceArn: string
): Promise<void> {
  const docClient = getDocumentClient();

  // Extract resourceId and resourceType from ARN
  // ARN format: arn:aws:ivs:region:account:channel/resourceId
  // or: arn:aws:ivschat:region:account:room/resourceId
  const parts = resourceArn.split('/');
  const resourceId = parts[parts.length - 1];

  let resourceType: ResourceType;
  if (resourceArn.includes(':channel/')) {
    resourceType = ResourceType.CHANNEL;
  } else if (resourceArn.includes(':stage/')) {
    resourceType = ResourceType.STAGE;
  } else {
    resourceType = ResourceType.ROOM;
  }

  // Update pool item: CLAIMED -> AVAILABLE, clear claimedBy/claimedAt
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `POOL#${resourceType}#${resourceId}`,
      SK: 'METADATA',
    },
    UpdateExpression: 'SET #status = :available, GSI1PK = :gsi, #claimedBy = :null, #claimedAt = :null, #version = #version + :inc',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#claimedBy': 'claimedBy',
      '#claimedAt': 'claimedAt',
      '#version': 'version',
    },
    ExpressionAttributeValues: {
      ':available': Status.AVAILABLE,
      ':gsi': 'STATUS#AVAILABLE',
      ':null': null,
      ':inc': 1,
    },
  }));
}
