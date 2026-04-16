import type { APIGatewayProxyEvent } from 'aws-lambda';

export function isAdmin(event: APIGatewayProxyEvent): boolean {
  const groups = event.requestContext?.authorizer?.claims?.['cognito:groups'];
  if (!groups) return false;
  // Cognito returns groups as comma-separated string or array
  if (Array.isArray(groups)) return groups.includes('admin');
  return typeof groups === 'string' && groups.includes('admin');
}

export function getAdminUserId(event: APIGatewayProxyEvent): string | undefined {
  return event.requestContext?.authorizer?.claims?.['cognito:username'];
}
