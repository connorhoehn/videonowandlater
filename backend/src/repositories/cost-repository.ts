/**
 * Cost repository - cost tracking persistence operations
 */

import { PutCommand, UpdateCommand, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';
import type { CostLineItem, CostSummary } from '../domain/cost';
import { CostService } from '../domain/cost';

const logger = new Logger({ serviceName: 'vnl-cost-repository' });

/**
 * Write a cost line item to DynamoDB
 * Stores with session-scoped PK, daily GSI for date-range queries, and user GSI for per-user queries
 *
 * @param tableName DynamoDB table name
 * @param item Cost line item to persist
 */
export async function writeCostLineItem(tableName: string, item: CostLineItem): Promise<void> {
  const docClient = getDocumentClient();
  const dateOnly = item.createdAt.split('T')[0];

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${item.sessionId}`,
      SK: `COST#${item.service}#${item.createdAt}`,
      GSI5PK: `COST#DAILY#${dateOnly}`,
      GSI5SK: `${item.sessionId}#${item.service}`,
      GSI6PK: `USER_COST#${item.userId}`,
      GSI6SK: item.createdAt,
      entityType: 'COST_LINE_ITEM',
      sessionId: item.sessionId,
      service: item.service,
      costUsd: item.costUsd,
      quantity: item.quantity,
      unit: item.unit,
      rateApplied: item.rateApplied,
      sessionType: item.sessionType,
      userId: item.userId,
      createdAt: item.createdAt,
    },
  }));

  logger.info('Cost line item written', {
    sessionId: item.sessionId,
    service: item.service,
    costUsd: item.costUsd,
  });
}

/**
 * Upsert (create or update) the cost summary for a session
 * Uses atomic ADD to safely accumulate costs from concurrent writes
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session identifier
 * @param service AWS service that incurred the cost
 * @param costUsd Cost in USD to add
 * @param sessionType Type of session (BROADCAST, HANGOUT, etc.)
 * @param userId Owner of the session
 */
export async function upsertCostSummary(
  tableName: string,
  sessionId: string,
  service: CostService,
  costUsd: number,
  sessionType: string,
  userId: string,
): Promise<void> {
  const docClient = getDocumentClient();
  const now = new Date().toISOString();

  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'COST_SUMMARY',
    },
    UpdateExpression:
      'SET totalCostUsd = if_not_exists(totalCostUsd, :zero) + :cost, ' +
      'breakdown.#svc = if_not_exists(breakdown.#svc, :zero) + :cost, ' +
      'lastUpdatedAt = :now, ' +
      'sessionType = :st, ' +
      'userId = :uid, ' +
      'sessionId = :sid, ' +
      'entityType = :et',
    ExpressionAttributeNames: {
      '#svc': service,
    },
    ExpressionAttributeValues: {
      ':zero': 0,
      ':cost': costUsd,
      ':now': now,
      ':st': sessionType,
      ':uid': userId,
      ':sid': sessionId,
      ':et': 'COST_SUMMARY',
    },
  }));

  logger.info('Cost summary upserted', { sessionId, service, costUsd });
}

/**
 * Get the cost summary for a session
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session identifier
 * @returns Cost summary or null if not found
 */
export async function getCostSummary(tableName: string, sessionId: string): Promise<CostSummary | null> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: {
      PK: `SESSION#${sessionId}`,
      SK: 'COST_SUMMARY',
    },
  }));

  if (!result.Item) {
    return null;
  }

  return {
    sessionId: result.Item.sessionId,
    totalCostUsd: result.Item.totalCostUsd,
    breakdown: result.Item.breakdown,
    sessionType: result.Item.sessionType,
    userId: result.Item.userId,
    lastUpdatedAt: result.Item.lastUpdatedAt,
  } as CostSummary;
}

/**
 * Get all cost line items for a session
 *
 * @param tableName DynamoDB table name
 * @param sessionId Session identifier
 * @returns Array of cost line items
 */
export async function getCostLineItems(tableName: string, sessionId: string): Promise<CostLineItem[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'COST#',
    },
  }));

  return (result.Items ?? []).map((item) => ({
    sessionId: item.sessionId,
    service: item.service as CostService,
    costUsd: item.costUsd,
    quantity: item.quantity,
    unit: item.unit,
    rateApplied: item.rateApplied,
    sessionType: item.sessionType,
    userId: item.userId,
    createdAt: item.createdAt,
  }));
}

/**
 * Query cost line items across sessions for a date range
 * Queries each date individually via GSI5 (daily cost index)
 *
 * @param tableName DynamoDB table name
 * @param startDate Start date in YYYY-MM-DD format (inclusive)
 * @param endDate End date in YYYY-MM-DD format (inclusive)
 * @returns Array of cost line items within the date range
 */
export async function queryCostsByDateRange(
  tableName: string,
  startDate: string,
  endDate: string,
): Promise<CostLineItem[]> {
  const docClient = getDocumentClient();
  const dates = generateDateRange(startDate, endDate);
  const allItems: CostLineItem[] = [];

  for (const date of dates) {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI5',
      KeyConditionExpression: 'GSI5PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `COST#DAILY#${date}`,
      },
    }));

    const items = (result.Items ?? []).map((item) => ({
      sessionId: item.sessionId,
      service: item.service as CostService,
      costUsd: item.costUsd,
      quantity: item.quantity,
      unit: item.unit,
      rateApplied: item.rateApplied,
      sessionType: item.sessionType,
      userId: item.userId,
      createdAt: item.createdAt,
    }));

    allItems.push(...items);
  }

  logger.info('Queried costs by date range', { startDate, endDate, itemCount: allItems.length });
  return allItems;
}

/**
 * Query all cost line items for a specific user
 *
 * @param tableName DynamoDB table name
 * @param userId User identifier
 * @returns Array of cost line items for the user
 */
export async function queryCostsByUser(tableName: string, userId: string): Promise<CostLineItem[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI6',
    KeyConditionExpression: 'GSI6PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `USER_COST#${userId}`,
    },
  }));

  const items = (result.Items ?? []).map((item) => ({
    sessionId: item.sessionId,
    service: item.service as CostService,
    costUsd: item.costUsd,
    quantity: item.quantity,
    unit: item.unit,
    rateApplied: item.rateApplied,
    sessionType: item.sessionType,
    userId: item.userId,
    createdAt: item.createdAt,
  }));

  logger.info('Queried costs by user', { userId, itemCount: items.length });
  return items;
}

/**
 * Generate an array of date strings (YYYY-MM-DD) between start and end (inclusive)
 */
function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}
