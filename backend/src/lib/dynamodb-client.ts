/**
 * DynamoDB client singleton
 * Lazy initialization pattern for Lambda execution optimization
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
    const client = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}
