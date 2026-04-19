/**
 * GET /sessions/{sessionId}/captions/credentials handler
 *
 * Returns short-lived AWS credentials the host can use to call
 * AWS Transcribe Streaming directly from the browser. Credentials are minted
 * through a Cognito Identity Pool scoped to
 * `transcribe:StartStreamTranscription` only.
 *
 * MVP behavior: if no Identity Pool is configured (IDENTITY_POOL_ID env unset)
 * the endpoint responds with `{ error: 'captions_not_configured' }` and 200
 * status so the frontend can render a friendly "Captions unavailable" state
 * without breaking the UX. This lets us ship the feature UI before the
 * Identity Pool CDK work lands.
 *
 * Authz: session owner only.
 */

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getSessionById } from '../repositories/session-repository';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;

  // 1. Auth
  const actorId = event.requestContext.authorizer?.claims?.['cognito:username'];
  if (!actorId) {
    return resp(401, { error: 'Unauthorized' });
  }

  // 2. Path
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) {
    return resp(400, { error: 'sessionId required' });
  }

  // 3. Ownership check (avoids leaking identity-pool config to non-owners)
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return resp(404, { error: 'Session not found' });
  }
  if (actorId !== session.userId) {
    return resp(403, { error: 'Only the session owner can mint caption credentials' });
  }

  // 4. MVP soft-fail when Transcribe isn't wired up.
  //    The frontend treats `captions_not_configured` as "degrade gracefully".
  const identityPoolId = process.env.IDENTITY_POOL_ID;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!identityPoolId) {
    return resp(200, {
      error: 'captions_not_configured',
      message: 'Live captions are not configured for this deployment yet.',
    });
  }

  // 5. Return the identity pool metadata. Actual STS minting happens client-side
  //    via `@aws-sdk/credential-providers#fromCognitoIdentityPool` so we don't
  //    have to plumb `ivs-chat-messaging`-style token signing through the backend.
  //    This endpoint exists so the frontend can discover configuration without
  //    hardcoding infrastructure IDs.
  return resp(200, {
    identityPoolId,
    region,
    // Informational; clients can short-circuit on this flag.
    configured: true,
  });
};
