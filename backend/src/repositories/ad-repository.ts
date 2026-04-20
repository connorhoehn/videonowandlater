/**
 * Ad repository — persistence for platform-owned story-inline ads.
 *
 * See backend/src/domain/ad.ts for the rowout. Activation is a single PutItem
 * on the AD#ACTIVE sentinel row; deactivation is a DeleteItem. The `active`
 * boolean on the Ad object is computed at read time by comparing the row's
 * id to the pointer row's adId.
 */

import {
  PutCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import type { Ad } from '../domain/ad';

const ACTIVE_PK = 'AD#ACTIVE';
const ACTIVE_SK = 'METADATA';

function adKey(id: string) {
  return { PK: `AD#${id}`, SK: 'METADATA' };
}

function stripKeys<T extends Record<string, unknown>>(item: T): Partial<Ad> {
  const { PK, SK, entityType, ...rest } = item as Record<string, unknown>;
  void PK; void SK; void entityType;
  return rest as Partial<Ad>;
}

export async function putAd(tableName: string, ad: Ad): Promise<void> {
  await getDocumentClient().send(new PutCommand({
    TableName: tableName,
    Item: {
      ...adKey(ad.id),
      entityType: 'AD',
      ...ad,
      // Don't persist `active` — it's computed from the pointer row.
      active: undefined,
    },
  }));
}

export async function getAdById(tableName: string, id: string): Promise<Ad | null> {
  const res = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: adKey(id),
  }));
  if (!res.Item) return null;
  const activeId = await getActiveAdId(tableName);
  return hydrate(res.Item, activeId);
}

export async function getAdByContentHash(
  tableName: string,
  contentHash: string,
): Promise<Ad | null> {
  const res = await getDocumentClient().send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'entityType = :et AND contentHash = :ch',
    ExpressionAttributeValues: { ':et': 'AD', ':ch': contentHash },
    Limit: 1,
  }));
  const item = res.Items?.[0];
  if (!item) return null;
  const activeId = await getActiveAdId(tableName);
  return hydrate(item, activeId);
}

export async function listAds(tableName: string): Promise<Ad[]> {
  const res = await getDocumentClient().send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'entityType = :et',
    ExpressionAttributeValues: { ':et': 'AD' },
  }));
  const items = res.Items ?? [];
  const activeId = await getActiveAdId(tableName);
  return items
    .map((item) => hydrate(item, activeId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteAd(tableName: string, id: string): Promise<void> {
  // If this was the active ad, clear the pointer first so we don't dangle it.
  const activeId = await getActiveAdId(tableName);
  if (activeId === id) {
    await deactivate(tableName);
  }
  await getDocumentClient().send(new DeleteCommand({
    TableName: tableName,
    Key: adKey(id),
  }));
}

export async function activate(tableName: string, id: string): Promise<void> {
  await getDocumentClient().send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: ACTIVE_PK,
      SK: ACTIVE_SK,
      entityType: 'AD_ACTIVE',
      adId: id,
      updatedAt: new Date().toISOString(),
    },
  }));
}

export async function deactivate(tableName: string): Promise<void> {
  await getDocumentClient().send(new DeleteCommand({
    TableName: tableName,
    Key: { PK: ACTIVE_PK, SK: ACTIVE_SK },
  }));
}

export async function getActiveAd(tableName: string): Promise<Ad | null> {
  const activeId = await getActiveAdId(tableName);
  if (!activeId) return null;
  return getAdById(tableName, activeId);
}

async function getActiveAdId(tableName: string): Promise<string | null> {
  const res = await getDocumentClient().send(new GetCommand({
    TableName: tableName,
    Key: { PK: ACTIVE_PK, SK: ACTIVE_SK },
  }));
  const adId = res.Item?.adId;
  return typeof adId === 'string' ? adId : null;
}

function hydrate(item: Record<string, unknown>, activeId: string | null): Ad {
  const stripped = stripKeys(item) as Ad;
  return { ...stripped, active: stripped.id === activeId };
}

// Suppress unused import warning from QueryCommand (kept available for future
// GSI-based filters without changing the import surface).
void QueryCommand;
