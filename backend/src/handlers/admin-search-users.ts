/**
 * GET /admin/users?q=<prefix>
 * Search the Cognito user pool by username prefix (default: list all, capped).
 * Admin-only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { isAdmin } from '../lib/admin-auth';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-admin', persistentKeys: { handler: 'admin-search-users' } });
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

  const q = event.queryStringParameters?.q?.trim();
  const userPoolId = process.env.USER_POOL_ID!;

  try {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: q ? `username ^= "${q.replace(/"/g, '')}"` : undefined,
      Limit: 30,
    }));

    const users = (result.Users ?? []).map((u) => ({
      username: u.Username,
      email: u.Attributes?.find((a) => a.Name === 'email')?.Value,
      status: u.UserStatus,
      enabled: u.Enabled,
      createdAt: u.UserCreateDate?.toISOString(),
    }));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ users }) };
  } catch (err: any) {
    logger.error('ListUsers failed', { q, errorMessage: err.message });
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to search users' }) };
  }
};
