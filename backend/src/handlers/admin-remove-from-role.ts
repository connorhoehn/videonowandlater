/**
 * DELETE /admin/roles/{roleName}/members/{username}
 * Remove a user from a Cognito group. Admin-only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminRemoveUserFromGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-admin', persistentKeys: { handler: 'admin-remove-from-role' } });
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
  const username = event.pathParameters?.username;
  if (!roleName || !username) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'roleName and username required' }) };
  }

  const actorId = getAdminUserId(event);

  // Guard: prevent admin from removing themselves from 'admin' role (avoids lockout)
  if (roleName === 'admin' && username === actorId) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Cannot remove yourself from the admin role' }) };
  }

  const userPoolId = process.env.USER_POOL_ID!;

  try {
    await cognito.send(new AdminRemoveUserFromGroupCommand({
      UserPoolId: userPoolId,
      Username: username,
      GroupName: roleName,
    }));

    logger.info('Removed user from role', { roleName, username, actorId });
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ roleName, username }) };
  } catch (err: any) {
    logger.error('AdminRemoveUserFromGroup failed', { roleName, username, errorMessage: err.message });
    if (err.name === 'UserNotFoundException' || err.name === 'ResourceNotFoundException') {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'User or role not found' }) };
    }
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to remove user from role' }) };
  }
};
