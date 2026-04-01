/**
 * Catch-all EventBridge handler for ALL aws.ivs events.
 * Logs structured JSON to CloudWatch for debugging the IVS → EventBridge → Lambda pipeline.
 *
 * Log group: /aws/lambda/IvsEventAudit (or the function name CDK assigns)
 * Query in CloudWatch Insights:
 *   fields @timestamp, detailType, resources.0, detail.event_name
 *   | sort @timestamp desc
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-events', persistentKeys: { handler: 'ivs-event-audit' } });

export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => {
  logger.info('IVS event received', {
    audit: true,
    id: event.id,
    time: event.time,
    source: event.source,
    detailType: event['detail-type'],
    region: event.region,
    account: event.account,
    resources: event.resources,
    detail: event.detail,
  });
};
