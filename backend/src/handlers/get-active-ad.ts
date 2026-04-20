/**
 * GET /ads/active — public endpoint returning the currently-active
 * story-inline ad, or null if none. Used by the stories strip on the
 * homepage to inject a sponsored slot.
 *
 * Cache-Control: short TTL so admin edits propagate within seconds but
 * CloudFront absorbs most load.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getActiveAd } from '../repositories/ad-repository';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=30',
};

export async function handler(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'TABLE_NAME not set' }) };
  }

  const ad = await getActiveAd(tableName);
  if (!ad) {
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ad: null }) };
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      ad: {
        id: ad.id,
        mediaUrl: ad.mediaUrl,
        thumbnailUrl: ad.thumbnailUrl,
        durationSec: ad.durationSec,
        label: ad.label,
      },
    }),
  };
}
