/**
 * Ruleset repository — CRUD for admin-configured image moderation rulesets
 *
 * Storage pattern:
 *   PK: RULESET#<name>    SK: V#<version>     — one row per version (immutable history)
 *   PK: RULESET#<name>    SK: CURRENT         — pointer to active version
 */

import {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { Ruleset } from '../domain/ruleset';
import {
  DEFAULT_RULESETS,
  DEFAULT_FRAME_INTERVAL_SEC,
  DEFAULT_AUTO_BOUNCE_THRESHOLD,
  clampFrameInterval,
  clampAutoBounceThreshold,
} from '../domain/ruleset';

const logger = new Logger({ serviceName: 'vnl-repository' });

const SYSTEM_ACTOR = 'SYSTEM';

function versionSk(version: number): string {
  // Zero-padded so V# rows sort correctly lexicographically (up to 9999 versions)
  return `V#${String(version).padStart(4, '0')}`;
}

function parseVersion(sk: string): number {
  const match = /^V#(\d+)$/.exec(sk);
  return match ? parseInt(match[1], 10) : NaN;
}

/**
 * Read the CURRENT pointer for a ruleset. Returns null if the ruleset does not exist.
 */
export async function getCurrentVersion(tableName: string, name: string): Promise<number | null> {
  const docClient = getDocumentClient();
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `RULESET#${name}`, SK: 'CURRENT' },
    }),
  );
  if (!result.Item) return null;
  const v = result.Item.activeVersion;
  return typeof v === 'number' ? v : null;
}

/**
 * Fetch a specific ruleset version row. If version omitted, reads CURRENT pointer first.
 */
export async function getRuleset(
  tableName: string,
  name: string,
  version?: number,
): Promise<Ruleset | null> {
  const docClient = getDocumentClient();

  let effectiveVersion = version;
  if (effectiveVersion === undefined) {
    const current = await getCurrentVersion(tableName, name);
    if (current === null) return null;
    effectiveVersion = current;
  }

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { PK: `RULESET#${name}`, SK: versionSk(effectiveVersion) },
    }),
  );
  if (!result.Item) return null;

  const { PK, SK, entityType, ...data } = result.Item;
  return data as Ruleset;
}

/**
 * List every version row for a ruleset (ascending by version).
 */
export async function listRulesetVersions(
  tableName: string,
  name: string,
): Promise<Ruleset[]> {
  const docClient = getDocumentClient();
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `RULESET#${name}`,
        ':prefix': 'V#',
      },
      ScanIndexForward: true,
    }),
  );

  return (result.Items ?? []).map((item) => {
    const { PK, SK, entityType, ...data } = item;
    return data as Ruleset;
  });
}

/**
 * Create a new immutable version row and flip CURRENT to it.
 * Returns the newly created version number.
 */
export async function createRulesetVersion(
  tableName: string,
  input: {
    name: string;
    description: string;
    disallowedItems: string[];
    severity: Ruleset['severity'];
    createdBy: string;
    frameIntervalSec?: number;
    autoBounceThreshold?: number;
  },
): Promise<Ruleset> {
  const docClient = getDocumentClient();

  const existing = await getCurrentVersion(tableName, input.name);
  const nextVersion = (existing ?? 0) + 1;
  const now = new Date().toISOString();

  const row: Ruleset = {
    name: input.name,
    version: nextVersion,
    description: input.description,
    disallowedItems: input.disallowedItems,
    severity: input.severity,
    createdBy: input.createdBy,
    createdAt: now,
    active: true,
    frameIntervalSec: clampFrameInterval(input.frameIntervalSec),
    autoBounceThreshold: clampAutoBounceThreshold(input.autoBounceThreshold),
  };

  // Write version row
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `RULESET#${input.name}`,
        SK: versionSk(nextVersion),
        entityType: 'RULESET_VERSION',
        ...row,
      },
    }),
  );

  // Flip CURRENT pointer
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: `RULESET#${input.name}`,
        SK: 'CURRENT',
        entityType: 'RULESET_CURRENT',
        name: input.name,
        activeVersion: nextVersion,
        updatedAt: now,
      },
    }),
  );

  logger.info('Created ruleset version', { name: input.name, version: nextVersion });
  return row;
}

/**
 * Set CURRENT pointer to an existing version (used for rollback).
 */
export async function setCurrentVersion(
  tableName: string,
  name: string,
  version: number,
): Promise<void> {
  const docClient = getDocumentClient();

  // Verify the version row exists before flipping
  const existing = await getRuleset(tableName, name, version);
  if (!existing) {
    throw new Error(`Ruleset ${name} has no version ${version}`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: `RULESET#${name}`, SK: 'CURRENT' },
      UpdateExpression: 'SET activeVersion = :v, updatedAt = :now, entityType = :et, #name = :n',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':v': version,
        ':now': new Date().toISOString(),
        ':et': 'RULESET_CURRENT',
        ':n': name,
      },
    }),
  );
  logger.info('Set current ruleset version', { name, version });
}

/**
 * List all rulesets by scanning CURRENT pointers and loading the active version row.
 * For a small number of rulesets (<50) a scan is acceptable — admin-only call.
 */
export async function listRulesets(tableName: string): Promise<Ruleset[]> {
  const docClient = getDocumentClient();

  // We scan with a filter for CURRENT pointers. This is admin-only and typically <50 rows.
  const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
  const result = await docClient.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': 'RULESET#',
        ':sk': 'CURRENT',
      },
    }),
  );

  const pointers = (result.Items ?? []).filter((i) => typeof i.activeVersion === 'number');
  if (pointers.length === 0) return [];

  // Load each active version
  const rulesets = await Promise.all(
    pointers.map(async (p) => {
      const row = await getRuleset(tableName, p.name, p.activeVersion);
      return row;
    }),
  );

  return rulesets.filter((r): r is Ruleset => r !== null);
}

/**
 * Seed defaults idempotently — only creates rulesets that don't exist yet.
 * Safe to call on every admin-list-rulesets request.
 */
export async function seedDefaultRulesets(tableName: string): Promise<void> {
  for (const seed of DEFAULT_RULESETS) {
    const existing = await getCurrentVersion(tableName, seed.name);
    if (existing !== null) continue;

    await createRulesetVersion(tableName, {
      name: seed.name,
      description: seed.description,
      disallowedItems: seed.disallowedItems,
      severity: seed.severity,
      createdBy: SYSTEM_ACTOR,
    });
    logger.info('Seeded default ruleset', { name: seed.name });
  }
}

export { parseVersion };
