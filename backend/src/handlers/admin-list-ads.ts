/**
 * GET /admin/ads — list all story-inline Ads (active flag computed from the
 * AD#ACTIVE pointer row). Sorted by createdAt desc.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { listAds } from '../repositories/ad-repository';

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
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const ads = await listAds(tableName);
  return resp(200, { ads });
}
