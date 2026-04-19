/**
 * GET /creators/{handle}/sessions?status=live|ended&limit=25
 *
 * Public listing of a creator's public+unlisted sessions (excludes private).
 *
 * Strategy: resolve handle -> userId via getProfileByHandle, then query
 * GSI1 STATUS#LIVE and STATUS#ENDED partitions and client-side filter by
 * userId === profile.userId AND visibility !== 'private'.
 *
 * Auth is optional. No caller-specific data is returned.
 */
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getProfileByHandle, type UserProfile } from '../repositories/profile-repository';
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

function toItem(item: Record<string, any>, profile: UserProfile): DiscoveryItem {
  return {
    sessionId: item.sessionId,
    title: item.title,
    description: item.description,
    thumbnailUrl: item.thumbnailUrl ?? item.posterFrameUrl,
    userId: item.userId,
    creatorHandle: profile.handle,
    creatorDisplayName: profile.displayName,
    createdAt: item.createdAt,
    status: item.status,
    participantCount: item.participantCount ?? 0,
    tags: item.tags,
    sessionType: item.sessionType,
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });

  const rawHandle = event.pathParameters?.handle;
  if (!rawHandle) return resp(400, { error: 'handle is required' });
  const handle = rawHandle.replace(/^@/, '');

  const qs = event.queryStringParameters ?? {};
  const rawStatus = (qs.status ?? '').toLowerCase();
  const statusFilter = rawStatus === 'live' || rawStatus === 'ended' ? rawStatus : undefined;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(qs.limit) || DEFAULT_LIMIT));

  const profile = await getProfileByHandle(tableName, handle);
  if (!profile) return resp(404, { error: 'Creator not found' });

  const docClient = getDocumentClient();
  try {
    // Query both status partitions so a single request covers live + past.
    const partitions: string[] = [];
    if (!statusFilter || statusFilter === 'live') {
      partitions.push('STATUS#LIVE', 'STATUS#ENDING');
    }
    if (!statusFilter || statusFilter === 'ended') {
      partitions.push('STATUS#ENDED');
    }

    const queries = partitions.map((pk) =>
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

    const filtered = rawItems.filter((item) => {
      if (item.userId !== profile.userId) return false;
      if (item.visibility === 'private') return false;
      if (statusFilter === 'live') {
        return (item.status ?? '').toString().toLowerCase() === 'live';
      }
      if (statusFilter === 'ended') {
        const s = (item.status ?? '').toString().toLowerCase();
        return s === 'ended' || s === 'ending';
      }
      return true;
    });

    filtered.sort((a, b) => (b.createdAt ?? '').toString().localeCompare((a.createdAt ?? '').toString()));

    const items = filtered.slice(0, limit).map((i) => toItem(i, profile));
    return resp(200, { items });
  } catch (err: any) {
    return resp(500, { error: err instanceof Error ? err.message : 'Internal error' });
  }
}
