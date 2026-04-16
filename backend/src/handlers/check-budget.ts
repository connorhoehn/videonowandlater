/**
 * Scheduled Lambda (EventBridge hourly)
 * Checks current month's estimated spend against budget thresholds
 * and publishes SNS alerts when new thresholds are crossed.
 */

import { QueryCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { getDocumentClient } from '../lib/dynamodb-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'check-budget' } });

const snsClient = new SNSClient({});

export async function handler(): Promise<void> {
  const tableName = process.env.TABLE_NAME;
  const snsTopicArn = process.env.SNS_TOPIC_ARN;
  const budgetThresholdsStr = process.env.BUDGET_THRESHOLDS || '[50,75,90,100]';
  const monthlyBudget = parseFloat(process.env.MONTHLY_BUDGET || '100');

  if (!tableName) {
    logger.error('TABLE_NAME environment variable not set');
    return;
  }
  if (!snsTopicArn) {
    logger.error('SNS_TOPIC_ARN environment variable not set');
    return;
  }

  let budgetThresholds: number[];
  try {
    budgetThresholds = JSON.parse(budgetThresholdsStr);
  } catch {
    logger.error('Invalid BUDGET_THRESHOLDS JSON', { budgetThresholdsStr });
    return;
  }

  const docClient = getDocumentClient();

  // Get current month date range
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getUTCMonth() + 1, 0).getUTCDate();

  // Generate all dates in the current month up to today
  const today = now.toISOString().split('T')[0];
  const dates: string[] = [];
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${year}-${month}-${String(day).padStart(2, '0')}`;
    if (dateStr > today) break;
    dates.push(dateStr);
  }

  // Query each day's costs via GSI5
  let totalSpend = 0;
  for (const date of dates) {
    try {
      const result = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI5',
        KeyConditionExpression: 'GSI5PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `COST#DAILY#${date}`,
        },
        ProjectionExpression: 'costUsd',
      }));

      for (const item of result.Items ?? []) {
        totalSpend += item.costUsd ?? 0;
      }
    } catch (err) {
      logger.warn('Failed to query costs for date', {
        date,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  totalSpend = Math.round(totalSpend * 1_000_000) / 1_000_000;
  logger.info('Current month spend calculated', { totalSpend, monthlyBudget, month: `${year}-${month}` });

  // Check which thresholds are exceeded
  const alertKey = `${year}-${month}`;
  const configPK = 'CONFIG#BUDGET_ALERTS';
  const configSK = alertKey;

  // Read existing alerted thresholds
  let alertedThresholds: number[] = [];
  try {
    const existing = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { PK: configPK, SK: configSK },
    }));
    alertedThresholds = existing.Item?.alertedThresholds ?? [];
  } catch (err) {
    logger.warn('Failed to read budget alert config', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const spendPercentage = (totalSpend / monthlyBudget) * 100;
  const newAlerts: number[] = [];

  for (const threshold of budgetThresholds) {
    if (spendPercentage >= threshold && !alertedThresholds.includes(threshold)) {
      newAlerts.push(threshold);
    }
  }

  if (newAlerts.length === 0) {
    logger.info('No new budget thresholds crossed', { spendPercentage, alertedThresholds });
    return;
  }

  // Publish SNS alerts for each new threshold
  for (const threshold of newAlerts) {
    const message = `VNL Budget Alert: Estimated monthly spend $${totalSpend.toFixed(2)} has exceeded ${threshold}% of $${monthlyBudget} budget`;
    try {
      await snsClient.send(new PublishCommand({
        TopicArn: snsTopicArn,
        Subject: `VNL Budget Alert: ${threshold}% threshold exceeded`,
        Message: message,
      }));
      logger.info('Budget alert published', { threshold, totalSpend, message });
    } catch (err) {
      logger.error('Failed to publish budget alert', {
        threshold,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update alerted thresholds record
  const updatedThresholds = [...alertedThresholds, ...newAlerts];
  try {
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        PK: configPK,
        SK: configSK,
        entityType: 'CONFIG',
        alertedThresholds: updatedThresholds,
        lastCheckedAt: now.toISOString(),
        totalSpend,
        monthlyBudget,
      },
    }));
    logger.info('Budget alert config updated', { alertedThresholds: updatedThresholds });
  } catch (err) {
    logger.error('Failed to update budget alert config', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
