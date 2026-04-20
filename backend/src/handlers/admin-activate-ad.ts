/**
 * POST /admin/ads/:id/activate — make this Ad the single active story-inline ad.
 * POST /admin/ads/:id/deactivate — clear the active pointer.
 *
 * One handler, dispatched on path. The activation invariant (exactly one
 * active at a time) is enforced by the pointer-row pattern in ad-repository:
 * writing the AD#ACTIVE row overwrites any previous value atomically.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin } from '../lib/admin-auth';
import { getAdById, activate, deactivate } from '../repositories/ad-repository';

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

  // Dispatch on the last path segment: /admin/ads/{id}/activate | /deactivate
  const path = event.requestContext?.resourcePath ?? event.path ?? '';
  const isDeactivate = path.endsWith('/deactivate');

  if (isDeactivate) {
    await deactivate(tableName);
    return resp(200, { ok: true, active: false });
  }

  const ad = await getAdById(tableName, id);
  if (!ad) return resp(404, { error: 'Ad not found' });

  await activate(tableName, id);
  return resp(200, { ad: { ...ad, active: true } });
}
