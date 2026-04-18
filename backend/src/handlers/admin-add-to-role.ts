/**
 * POST /admin/roles/{roleName}/members
 * Body: { username: string }
 * Add a user to a Cognito group. Admin-only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-admin', persistentKeys: { handler: 'admin-add-to-role' } });
const cognito = new CognitoIdentityProviderClient({});

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  if (!isAdmin(event)) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  const roleName = event.pathParameters?.roleName;
  if (!roleName) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'roleName required' }) };
  }

  let body: { username?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!body.username) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'username required' }) };
  }

  const actorId = getAdminUserId(event);
  const userPoolId = process.env.USER_POOL_ID!;

  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId,
      Username: body.username,
      GroupName: roleName,
    }));

    logger.info('Added user to role', { roleName, username: body.username, actorId });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ roleName, username: body.username }) };
  } catch (err: any) {
    logger.error('AdminAddUserToGroup failed', { roleName, username: body.username, errorMessage: err.message });
    if (err.name === 'UserNotFoundException') {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'User not found' }) };
    }
    if (err.name === 'ResourceNotFoundException') {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: `Role not found: ${roleName}` }) };
    }
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to add user to role' }) };
  }
};
