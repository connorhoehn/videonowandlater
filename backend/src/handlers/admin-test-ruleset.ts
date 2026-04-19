/**
 * POST /admin/rulesets/{name}/test
 * Body: { image: base64 string (JPEG), version?: number }
 * Returns the raw classification JSON for the given image.
 *
 * Rate-limited: 10 requests/min per admin userId (in-memory counter — fine for MVP).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { isAdmin, getAdminUserId } from '../lib/admin-auth';
import { getRuleset } from '../repositories/ruleset-repository';
import { classifyImage } from '../lib/nova-moderation';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'admin-test-ruleset' } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const MAX_IMAGE_BYTES = 1_500_000; // ~1.5MB raw — generous for a JPEG frame
const MAX_CALLS_PER_MINUTE = 10;
const RATE_WINDOW_SECONDS = 60;

/**
 * DynamoDB-backed rate limiter — coordinates across warm Lambda containers.
 * Uses the main table with a minute-aligned bucket key; TTL cleans up stale rows.
 *
 * Row shape:
 *   PK: RATE#admin-test-ruleset#<userId>
 *   SK: BUCKET#<minuteEpoch>
 *   count: <int>
 *   ttl: <unix seconds — minute end + slack>
 */
async function checkRateLimit(tableName: string, userId: string): Promise<boolean> {
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb');
  const nowSec = Math.floor(Date.now() / 1000);
  const minute = Math.floor(nowSec / RATE_WINDOW_SECONDS);
  const ttl = (minute + 2) * RATE_WINDOW_SECONDS; // bucket end + one minute slack

  try {
    const res = await getDocumentClient().send(new UpdateCommand({
      TableName: tableName,
      Key: {
        PK: `RATE#admin-test-ruleset#${userId}`,
        SK: `BUCKET#${minute}`,
      },
      UpdateExpression: 'ADD #count :inc SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':inc': 1, ':ttl': ttl },
      ReturnValues: 'ALL_NEW',
    }));
    const count = (res.Attributes?.count as number | undefined) ?? 1;
    return count <= MAX_CALLS_PER_MINUTE;
  } catch {
    // Fail open on DDB errors — better to occasionally over-serve than to
    // brick a real admin retry.
    return true;
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  const modelId = process.env.NOVA_MODEL_ID || 'amazon.nova-lite-v1:0';
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  if (!isAdmin(event)) return resp(403, { error: 'Forbidden: admin access required' });
  const adminUserId = getAdminUserId(event);
  if (!adminUserId) return resp(401, { error: 'Unauthorized' });

  if (!(await checkRateLimit(tableName, adminUserId))) {
    return resp(429, { error: 'Rate limit exceeded (10 req/min)' });
  }

  const name = event.pathParameters?.name;
  if (!name) return resp(400, { error: 'name is required' });

  let image: string | undefined;
  let version: number | undefined;
  try {
    const body = JSON.parse(event.body ?? '{}');
    image = body.image;
    if (typeof body.version === 'number') version = body.version;
  } catch {
    return resp(400, { error: 'Invalid JSON body' });
  }

  if (!image || typeof image !== 'string') {
    return resp(400, { error: 'image (base64 string) is required' });
  }

  let imageBytes: Uint8Array;
  try {
    imageBytes = Uint8Array.from(Buffer.from(image, 'base64'));
  } catch {
    return resp(400, { error: 'image must be valid base64' });
  }
  if (imageBytes.byteLength === 0) return resp(400, { error: 'empty image' });
  if (imageBytes.byteLength > MAX_IMAGE_BYTES) {
    return resp(400, { error: 'image exceeds max size' });
  }

  try {
    const ruleset = await getRuleset(tableName, name, version);
    if (!ruleset) return resp(404, { error: 'Ruleset not found' });

    const classification = await classifyImage(modelId, ruleset, imageBytes);
    logger.info('Ruleset test classification', {
      name,
      version: ruleset.version,
      flagged: classification.flagged,
      adminUserId,
    });
    return resp(200, { classification, rulesetVersion: ruleset.version });
  } catch (err: any) {
    logger.error('Error testing ruleset', { name, error: err instanceof Error ? err.message : String(err) });
    return resp(500, { error: err.message });
  }
}

// Exported for testing
export const __test = { checkRateLimit };
