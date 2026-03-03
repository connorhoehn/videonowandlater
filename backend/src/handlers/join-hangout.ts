/**
 * Join Hangout Lambda handler
 * Generates IVS RealTime participant tokens for authenticated users
 *
 * POST /sessions/{sessionId}/join
 * - Validates session exists and is a HANGOUT type
 * - Generates participant token with PUBLISH+SUBSCRIBE capabilities
 * - Returns token, participantId, and expirationTime
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';
import { getIVSRealTimeClient } from '../lib/ivs-clients';
import { getSessionById } from '../repositories/session-repository';
import { SessionType } from '../domain/session';

/**
 * Lambda handler for participant token generation
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;

  if (!tableName) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'TABLE_NAME environment variable not set' }),
    };
  }

  try {
    // Extract sessionId from path parameters
    const sessionId = event.pathParameters?.sessionId;
    if (!sessionId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'sessionId is required' }),
      };
    }

    // Extract userId from Cognito authorizer claims
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'userId not found in authentication context' }),
      };
    }

    // Get username from Cognito claims (fallback to 'Anonymous')
    const username = event.requestContext?.authorizer?.claims?.['cognito:username'] || 'Anonymous';

    // Fetch session from DynamoDB
    const session = await getSessionById(tableName, sessionId);

    // Validate session exists and is a HANGOUT
    if (!session || session.sessionType !== SessionType.HANGOUT) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Session not found or not a HANGOUT session' }),
      };
    }

    // Extract Stage ARN from session
    const stageArn = session.claimedResources.stage;
    if (!stageArn) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Stage ARN not found in session resources' }),
      };
    }

    // Generate participant token with IVS RealTime
    const ivsRealTimeClient = getIVSRealTimeClient();
    const command = new CreateParticipantTokenCommand({
      stageArn,
      userId,
      duration: 43200, // 12 hours in seconds
      capabilities: ['PUBLISH', 'SUBSCRIBE'],
      attributes: {
        username,
      },
    });

    const response = await ivsRealTimeClient.send(command);

    if (!response.participantToken) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to generate participant token' }),
      };
    }

    // Return token structure
    return {
      statusCode: 200,
      body: JSON.stringify({
        token: response.participantToken.token,
        participantId: response.participantToken.participantId,
        expirationTime: response.participantToken.expirationTime?.toISOString(),
      }),
    };
  } catch (error) {
    console.error('Error generating participant token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate participant token'
      }),
    };
  }
}
