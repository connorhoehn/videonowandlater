/**
 * POST /admin/ads — create a new story-inline Ad creative.
 *
 * Body:
 *   { source: 'recording' | 'polly', mediaUrl, thumbnailUrl?, durationSec,
 *     contentHash?, label, activate?: boolean }
 *
 * Idempotent on `contentHash` (when present): if an Ad with the same hash
 * already exists, returns that row instead of creating a duplicate. This
 * protects against admin double-clicks on Publish after a Polly synth.
 *
 * If `activate === true`, this Ad becomes the single active story-inline ad
 * (any previously-active ad is deactivated). Otherwise it lands inactive and
 * admin can activate later via POST /admin/ads/:id/activate.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { putAd, getAdByContentHash, activate as activateAd } from '../repositories/ad-repository';
import type { Ad, AdSource } from '../domain/ad';
import { AD_LABEL_MAX_CHARS } from '../domain/ad';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

interface CreateAdBody {
  source?: AdSource;
  mediaUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  contentHash?: string;
  label?: string;
  activate?: boolean;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });
  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });

  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  let body: CreateAdBody;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  const { source, mediaUrl, thumbnailUrl, durationSec, contentHash, label, activate } = body;
  if (source !== 'recording' && source !== 'polly') {
    return resp(400, { error: "source must be 'recording' or 'polly'" });
  }
  if (typeof mediaUrl !== 'string' || !/^https:\/\//.test(mediaUrl)) {
    return resp(400, { error: 'mediaUrl must be an https URL' });
  }
  if (typeof durationSec !== 'number' || durationSec <= 0 || durationSec > 300) {
    return resp(400, { error: 'durationSec must be a positive number ≤ 300' });
  }
  if (typeof label !== 'string' || !label.trim() || label.length > AD_LABEL_MAX_CHARS) {
    return resp(400, { error: `label must be 1-${AD_LABEL_MAX_CHARS} chars` });
  }

  // Idempotency: if an Ad with the same contentHash already exists, short-circuit.
  if (contentHash) {
    const existing = await getAdByContentHash(tableName, contentHash);
    if (existing) {
      if (activate === true && !existing.active) {
        await activateAd(tableName, existing.id);
        return resp(200, { ad: { ...existing, active: true } });
      }
      return resp(200, { ad: existing });
    }
  }

  const ad: Ad = {
    id: uuidv4(),
    source,
    mediaUrl,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    durationSec,
    ...(contentHash ? { contentHash } : {}),
    label: label.trim(),
    placement: 'story-inline',
    active: false,
    createdAt: new Date().toISOString(),
    createdBy: adminUserId,
  };

  await putAd(tableName, ad);
  if (activate === true) {
    await activateAd(tableName, ad.id);
    ad.active = true;
  }

  return resp(201, { ad });
}
