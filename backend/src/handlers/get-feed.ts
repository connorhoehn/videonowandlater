/**
 * GET /feed?tab=live|upcoming|recent|following&limit=25
 *
 * Discovery feed. Each tab returns the shared DiscoveryItem shape
 * (same as /search and /creators/{handle}/sessions).
 *
 *  - live:      public LIVE sessions, ordered by participantCount desc,
 *               tie-break createdAt desc
 *  - upcoming:  Phase 5 (SCHEDULED state) — for now always []
 *  - recent:    public ENDED sessions, last 7 days, ordered by endedAt desc
 *  - following: LIVE sessions owned by anyone the caller follows
 *               (auth required; 401 if not signed in)
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getProfile, type UserProfile } from '../repositories/profile-repository';
import { listFollowing } from '../repositories/follow-repository';
import type { DiscoveryItem } from './search-sessions';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const PER_STATUS_LIMIT = 50;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Tab = 'live' | 'upcoming' | 'recent' | 'following';

async function hydrateProfiles(
  tableName: string,
  items: Record<string, any>[],
): Promise<Map<string, UserProfile | null>> {
  const cache = new Map<string, UserProfile | null>();
  const uniqueUserIds = Array.from(new Set(
    items.map((i) => i.userId).filter((u): u is string => typeof u === 'string'),
  ));
  await Promise.all(uniqueUserIds.map(async (uid) => {
    try { cache.set(uid, await getProfile(tableName, uid)); } catch { cache.set(uid, null); }
  }));
  return cache;
}

function toItem(item: Record<string, any>, profile: UserProfile | null): DiscoveryItem {
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
}

async function queryStatus(tableName: string, statusPk: string): Promise<Record<string, any>[]> {
  const docClient = getDocumentClient();
  const res = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': statusPk },
    ScanIndexForward: false,
    Limit: PER_STATUS_LIMIT,
  }));
  return res.Items ?? [];
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const qs = event.queryStringParameters ?? {};
  const tabRaw = (qs.tab ?? 'live').toLowerCase();
  const tab: Tab = (tabRaw === 'live' || tabRaw === 'upcoming' || tabRaw === 'recent' || tabRaw === 'following')
    ? tabRaw as Tab
    : 'live';
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(qs.limit) || DEFAULT_LIMIT));

  const callerId = event.requestContext?.authorizer?.claims?.['cognito:username'];

  try {
    if (tab === 'upcoming') {
      return resp(200, { items: [] });
    }

    if (tab === 'following') {
      if (!callerId) return resp(401, { error: 'Unauthorized' });
      const edges = await listFollowing(tableName, callerId, 200);
      if (edges.length === 0) return resp(200, { items: [] });
      const followeeIds = new Set(edges.map((e) => e.followee));
      const live = await queryStatus(tableName, 'STATUS#LIVE');
      const filtered = live.filter((i) => (
        followeeIds.has(i.userId) && i.visibility === 'public'
      ));
      filtered.sort((a, b) => (b.createdAt ?? '').toString().localeCompare((a.createdAt ?? '').toString()));
      const profileCache = await hydrateProfiles(tableName, filtered);
      const items = filtered.slice(0, limit).map((i) => toItem(i, profileCache.get(i.userId) ?? null));
      return resp(200, { items });
    }

    if (tab === 'live') {
      const live = await queryStatus(tableName, 'STATUS#LIVE');
      const filtered = live.filter((i) => i.visibility === 'public');
      filtered.sort((a, b) => {
        const aCount = (a.participantCount ?? 0) as number;
        const bCount = (b.participantCount ?? 0) as number;
        if (aCount !== bCount) return bCount - aCount;
        return (b.createdAt ?? '').toString().localeCompare((a.createdAt ?? '').toString());
      });
      const profileCache = await hydrateProfiles(tableName, filtered);
      const items = filtered.slice(0, limit).map((i) => toItem(i, profileCache.get(i.userId) ?? null));
      return resp(200, { items });
    }

    // recent
    const ended = await queryStatus(tableName, 'STATUS#ENDED');
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const filtered = ended.filter((i) => {
      if (i.visibility !== 'public') return false;
      const ts = i.endedAt ? Date.parse(i.endedAt) : NaN;
      return Number.isFinite(ts) && ts >= cutoff;
    });
    filtered.sort((a, b) => (b.endedAt ?? '').toString().localeCompare((a.endedAt ?? '').toString()));
    const profileCache = await hydrateProfiles(tableName, filtered);
    const items = filtered.slice(0, limit).map((i) => toItem(i, profileCache.get(i.userId) ?? null));
    return resp(200, { items });
  } catch (err: any) {
    return resp(500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
