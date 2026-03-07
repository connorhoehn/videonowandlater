/**
 * PUT /sessions/{sessionId}/spotlight
 * Sets or clears the featured creator on a broadcast session.
 * Only the session owner can update spotlight.
 * Both the caller's session and the featured session must be public.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById, updateSpotlight } from '../repositories/session-repository';

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
    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const { featuredCreatorId, featuredCreatorName } = body;

    // Validate: Get session and verify ownership
    const session = await getSessionById(tableName, sessionId);
    if (!session) return resp(404, { error: 'Session not found' });

    if (session.userId !== userId) return resp(403, { error: 'Forbidden' });

    // Validate: Session must not be private
    if (session.isPrivate === true) {
      return resp(403, { error: 'Private broadcasts cannot feature creators' });
    }

    // If setting (not clearing) spotlight, validate the featured session
    if (featuredCreatorId !== null && featuredCreatorId !== undefined) {
      const featuredSession = await getSessionById(tableName, featuredCreatorId);
      if (!featuredSession) {
        return resp(400, { error: 'Featured session not found' });
      }
      if (featuredSession.isPrivate === true) {
        return resp(400, { error: 'Cannot feature a private broadcast' });
      }
    }

    // Update spotlight
    await updateSpotlight(
      tableName,
      sessionId,
      featuredCreatorId ?? null,
      featuredCreatorName ?? null
    );

    console.log(`[update-spotlight] ${sessionId} spotlight set to ${featuredCreatorId} by ${userId}`);

    return resp(200, {
      message: 'Spotlight updated',
      featuredCreatorId: featuredCreatorId ?? null,
      featuredCreatorName: featuredCreatorName ?? null,
    });
  } catch (err: any) {
    console.error('[update-spotlight] error:', err);
    return resp(500, { error: err.message });
  }
}
