import type { APIGatewayProxyHandler } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import jwt from 'jsonwebtoken';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'generate-playback-token' } });

export const handler: APIGatewayProxyHandler = async (event) => {
  const tableName = process.env.TABLE_NAME!;
  const privateKey = process.env.IVS_PLAYBACK_PRIVATE_KEY!;
  const sessionId = event.pathParameters?.sessionId;

  try {
    // Validate sessionId
    if (!sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing sessionId' }),
      };
    }

    // Validate private key is available
    if (!privateKey) {
      logger.error('IVS_PLAYBACK_PRIVATE_KEY not configured');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Token generation not configured' }),
      };
    }

    // Parse request body for expiresIn (default 24 hours)
    let expiresIn = 86400;
    if (event.body) {
      try {
        const body = JSON.parse(event.body);
        if (body.expiresIn !== undefined) {
          expiresIn = body.expiresIn;
          if (typeof expiresIn !== 'number' || expiresIn <= 0) {
            return {
              statusCode: 400,
              body: JSON.stringify({ error: 'expiresIn must be a positive number' }),
            };
          }
        }
      } catch {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid request body' }),
        };
      }
    }

    // Get session from DynamoDB
    const docClient = getDocumentClient();
    const sessionResult = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `SESSION#${sessionId}`,
          SK: 'METADATA',
        },
      })
    );

    const session = sessionResult.Item;

    // Verify session exists
    if (!session) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Session not found' }),
      };
    }

    // Verify session is private
    if (!session.isPrivate) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Session is public, no token required',
        }),
      };
    }

    // Extract channel ARN
    const channelArn = session.claimedResources?.channel;
    if (!channelArn) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Session has no channel' }),
      };
    }

    // Generate JWT
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      'aws:channel-arn': channelArn,
      'aws:access-control-allow-origin': '*', // Allow any origin; future: restrict per broadcaster
      exp: now + expiresIn,
    };

    const token = jwt.sign(payload, privateKey, { algorithm: 'ES384' });

    // Get playback URL from session (or reconstruct from pool if needed)
    // For now, assume pool metadata is available in session.claimedResources or separate query
    let playbackUrl = session.playbackUrl;

    if (!playbackUrl) {
      // Fallback: query pool for playback URL using channel ARN
      const resourceId = channelArn.split('/').pop();
      const poolResult = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: {
            PK: `POOL#CHANNEL#${resourceId}`,
            SK: 'METADATA',
          },
        })
      );

      playbackUrl = poolResult.Item?.playbackUrl;

      if (!playbackUrl) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Playback URL not found' }),
        };
      }
    }

    // Return token with playback URL
    const expiresAt = new Date((now + expiresIn) * 1000).toISOString();

    return {
      statusCode: 200,
      body: JSON.stringify({
        token,
        expiresAt,
        playbackUrl: `${playbackUrl}?token=${token}`,
      }),
    };
  } catch (error: any) {
    logger.error('Error generating playback token', { error: error.message });
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate token' }),
    };
  }
};
