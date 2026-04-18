/**
 * GET /admin/roles/{roleName}/members
 * List users in a Cognito group (e.g. "admin"). Returns username + attributes + addedAt.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-admin', persistentKeys: { handler: 'admin-list-role-members' } });
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

  const userPoolId = process.env.USER_POOL_ID!;

  try {
    const result = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: userPoolId,
      GroupName: roleName,
      Limit: 60,
    }));

    const members = (result.Users ?? []).map((u) => ({
      username: u.Username,
      email: u.Attributes?.find((a) => a.Name === 'email')?.Value,
      status: u.UserStatus,
      enabled: u.Enabled,
      createdAt: u.UserCreateDate?.toISOString(),
    }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ roleName, members }) };
  } catch (err: any) {
    logger.error('ListUsersInGroup failed', { roleName, errorMessage: err.message });
    if (err.name === 'ResourceNotFoundException') {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: `Role not found: ${roleName}` }) };
    }
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to list role members' }) };
  }
};
