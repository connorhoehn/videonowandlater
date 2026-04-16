import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { getSessionById } from '../repositories/session-repository';
import { getDocumentClient } from '../lib/dynamodb-client';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'configure-webhook' } });

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

  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });

  const userId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!userId) return resp(401, { error: 'Unauthorized' });

  try {
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });
    if (session.userId !== userId) return resp(403, { error: 'Forbidden' });

    const body = event.body ? JSON.parse(event.body) : {};
    const webhookUrl = body.webhookUrl;

    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return resp(400, { error: 'webhookUrl is required' });
    }

    // Validate URL
    try {
      new URL(webhookUrl);
    } catch {
      return resp(400, { error: 'Invalid webhookUrl' });
    }

    // Generate secret
    const webhookSecret = randomUUID();

    const docClient = getDocumentClient();
    await docClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
      UpdateExpression: 'SET webhookUrl = :url, webhookSecret = :secret',
      ExpressionAttributeValues: { ':url': webhookUrl, ':secret': webhookSecret },
    }));

    logger.info('Webhook configured', { sessionId, webhookUrl });

    // Return secret once — it won't be returned again
    return resp(200, { message: 'Webhook configured', webhookUrl, webhookSecret });
  } catch (err: any) {
    logger.error('Failed to configure webhook', { error: err.message });
    return resp(500, { error: err.message });
  }
}
