/**
 * Broadcast service - viewer count with caching
 * Caches GetStream API responses to avoid rate limits (5 TPS)
 */

import { IvsClient, GetStreamCommand } from '@aws-sdk/client-ivs';
import { getIVSClient } from '../lib/ivs-clients';

interface ViewerCountCache {
  [channelArn: string]: { count: number; timestamp: number };
}

const cache: ViewerCountCache = {};
const CACHE_TTL_MS = 15000; // 15 seconds (matches IVS update frequency)

/**
 * Get current viewer count for a channel with caching
 * Caches results for 15 seconds to avoid IVS GetStream rate limits
 *
 * @param channelArn IVS channel ARN
 * @returns Current viewer count (0 if stream offline)
 */
export async function getViewerCount(channelArn: string): Promise<number> {
  const now = Date.now();
  const cached = cache[channelArn];

  // Return cached value if within TTL
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const ivs = getIVSClient();
    const response = await ivs.send(new GetStreamCommand({ channelArn }));
    const count = response.stream?.viewerCount ?? 0;

    cache[channelArn] = { count, timestamp: now };
    return count;
  } catch (error: any) {
    // Stream is offline or channel not broadcasting
    if (error.name === 'ResourceNotFoundException' || error.name === 'ChannelNotBroadcasting') {
      cache[channelArn] = { count: 0, timestamp: now };
      return 0;
    }
    throw error;
  }
}
