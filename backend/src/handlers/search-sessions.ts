/**
 * GET /search?q=...&filter=live|upcoming|ended&limit=25
 *
 * Public discovery search over public sessions.
 *
 * Strategy: query GSI1 STATUS#{LIVE,ENDING,ENDED} partitions in parallel
 * (limit 50 per status), then client-side filter by:
 *   - visibility === 'public'
 *   - `q` (optional) matches title / description / tags /
 *     session owner's handle or displayName (case-insensitive contains)
 *   - `filter` (optional) narrows to one status
 *
 * Creator fields (handle, displayName) are denormalized onto each item by
 * fetching the profile once per unique userId (handler-scoped cache).
 *
 * Auth is optional. Unauthenticated requests work and always see only public
 * sessions — the result is identical either way; auth exists so future
 * ranking can factor the caller in without another deploy.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getProfile, type UserProfile } from '../repositories/profile-repository';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const STATUS_PARTITIONS = ['STATUS#LIVE', 'STATUS#ENDING', 'STATUS#ENDED'] as const;
const PER_STATUS_LIMIT = 50;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export interface DiscoveryItem {
  sessionId: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  userId: string;
  creatorHandle?: string;
  creatorDisplayName?: string;
  createdAt: string;
  status: string;
  participantCount: number;
  tags?: string[];
  sessionType?: string;
}

function matchesQuery(
  item: Record<string, any>,
  profile: UserProfile | null,
  q: string,
): boolean {
  const needle = q.toLowerCase();
  const fields: Array<string | undefined> = [
    item.title,
    item.description,
    profile?.handle,
    profile?.displayName,
  ];
  for (const f of fields) {
    if (typeof f === 'string' && f.toLowerCase().includes(needle)) return true;
  }
  const tags = item.tags;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t === 'string' && t.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const qs = event.queryStringParameters ?? {};
  const q = (qs.q ?? '').trim();
  const rawFilter = (qs.filter ?? '').toLowerCase();
  const filter = rawFilter === 'live' || rawFilter === 'upcoming' || rawFilter === 'ended'
    ? rawFilter
    : undefined;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(qs.limit) || DEFAULT_LIMIT));

  // Upcoming = scheduled; Phase 5 will create this state. For now return [].
  if (filter === 'upcoming') return resp(200, { items: [] });

  const docClient = getDocumentClient();
  try {
    const queries = STATUS_PARTITIONS.map((pk) =>
      docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: false,
        Limit: PER_STATUS_LIMIT,
      })),
    );
    const results = await Promise.all(queries);
    const rawItems = results.flatMap((r) => r.Items ?? []);

    // Denormalize creator profile once per unique userId.
    const profileCache = new Map<string, UserProfile | null>();
    const uniqueUserIds = Array.from(new Set(
      rawItems.map((i) => i.userId).filter((u): u is string => typeof u === 'string'),
    ));
    await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        profileCache.set(uid, await getProfile(tableName, uid));
      } catch {
        profileCache.set(uid, null);
      }
    }));

    const filtered = rawItems.filter((item) => {
      if (item.visibility !== 'public') return false;
      const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
      if (filter === 'live' && status !== 'live') return false;
      if (filter === 'ended' && status !== 'ended' && status !== 'ending') return false;
      if (q) {
        const profile = item.userId ? profileCache.get(item.userId) ?? null : null;
        if (!matchesQuery(item, profile, q)) return false;
      }
      return true;
    });

    // Sort: live first, then by createdAt desc.
    filtered.sort((a, b) => {
      const aLive = (a.status ?? '').toString().toLowerCase() === 'live' ? 1 : 0;
      const bLive = (b.status ?? '').toString().toLowerCase() === 'live' ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      return (b.createdAt ?? '').toString().localeCompare((a.createdAt ?? '').toString());
    });

    const items: DiscoveryItem[] = filtered.slice(0, limit).map((item) => {
      const profile = item.userId ? profileCache.get(item.userId) ?? null : null;
      return {
        sessionId: item.sessionId,
        title: item.title,
        description: item.description,
        thumbnailUrl: item.thumbnailUrl ?? item.posterFrameUrl,
        userId: item.userId,
        creatorHandle: profile?.handle,
        creatorDisplayName: profile?.displayName,
        createdAt: item.createdAt,
        status: item.status,
        participantCount: item.participantCount ?? 0,
        tags: item.tags,
        sessionType: item.sessionType,
      };
    });

    return resp(200, { items });
  } catch (err: any) {
    return resp(500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
