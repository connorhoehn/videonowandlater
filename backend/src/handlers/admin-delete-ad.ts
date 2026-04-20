/**
 * DELETE /admin/ads/:id — hard-delete an Ad. If the ad was active, its pointer
 * is cleared first so the stories strip stops serving it immediately.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { getAdById, deleteAd } from '../repositories/ad-repository';

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

  const id = event.pathParameters?.id;
  if (!id) return resp(400, { error: 'id is required' });

  const ad = await getAdById(tableName, id);
  if (!ad) return resp(404, { error: 'Ad not found' });

  await deleteAd(tableName, id);
  return resp(200, { ok: true });
}
