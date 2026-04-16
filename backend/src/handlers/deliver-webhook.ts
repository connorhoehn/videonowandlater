import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { createHmac } from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSessionById } from '../repositories/session-repository';
import type { SessionEvent } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-webhooks', persistentKeys: { handler: 'deliver-webhook' } });

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const tableName = process.env.TABLE_NAME!;

  for (const record of event.Records) {
    try {
      const sessionEvent: SessionEvent = JSON.parse(record.body);
      const session = await getSessionById(tableName, sessionEvent.sessionId);

      if (!session?.webhookUrl) {
        // No webhook configured — silently discard
        continue;
      }

      const body = JSON.stringify(sessionEvent);

      // Compute HMAC signature
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-VNL-Event-Type': sessionEvent.eventType,
        'X-VNL-Session-Id': sessionEvent.sessionId,
      };

      if (session.webhookSecret) {
        const signature = createHmac('sha256', session.webhookSecret).update(body).digest('hex');
        headers['X-VNL-Signature'] = `sha256=${signature}`;
      }

      // POST to webhook URL
      const response = await fetch(session.webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(8000), // 8s timeout
      });

      if (response.ok) {
        logger.info('Webhook delivered', { sessionId: sessionEvent.sessionId, eventType: sessionEvent.eventType, status: response.status });
      } else if (response.status === 429 || response.status >= 500) {
        // Retryable — throw to trigger SQS retry
        logger.warn('Webhook delivery failed (retryable)', { status: response.status, sessionId: sessionEvent.sessionId });
        failures.push({ itemIdentifier: record.messageId });
      } else {
        // 4xx (except 429) — permanent failure, log and discard
        logger.error('Webhook delivery failed (permanent)', { status: response.status, sessionId: sessionEvent.sessionId });
      }
    } catch (err: any) {
      logger.error('Webhook delivery error', { error: err.message, messageId: record.messageId });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
