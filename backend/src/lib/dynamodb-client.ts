/**
 * DynamoDB client singleton
 * Lazy initialization pattern for Lambda execution optimization
 *
 * In integration tests, a DynamoDB Local endpoint can be supplied via the
 * `DDB_ENDPOINT` env var. When present, the client is configured with that
 * endpoint and a dummy region/credentials so it can talk to the local server
 * spun up by `@shelf/jest-dynamodb` without requiring real AWS credentials.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let docClient: DynamoDBDocumentClient | null = null;

/**
 * Get singleton DynamoDB Document Client
 * Document client provides native JavaScript type marshalling
 */
export function getDocumentClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const endpoint = process.env.DDB_ENDPOINT;
    const client = endpoint
      ? new DynamoDBClient({
          endpoint,
          region: process.env.AWS_REGION ?? 'local',
          credentials: {
            accessKeyId: 'local',
            secretAccessKey: 'local',
          },
        })
      : new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}
