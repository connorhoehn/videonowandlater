import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import { writeSessionEvent } from '../repositories/event-repository';
import { getDocumentClient } from './dynamodb-client';
import type { SessionEvent, SessionEventType } from '../domain/session-event';

const logger = new Logger({ serviceName: 'vnl-events' });
const eventBridgeClient = new EventBridgeClient({});
const sqsClient = new SQSClient({});

interface EmitOptions {
  webhookQueueUrl?: string;
  eventBusName?: string;
  skipDdb?: boolean;  // For high-frequency events (reactions, chat)
}

export async function emitSessionEvent(
  tableName: string,
  event: SessionEvent,
  options?: EmitOptions,
): Promise<void> {
  // 1. Write to DynamoDB with retry (unless skipDdb for high-frequency events)
  if (!options?.skipDdb) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeSessionEvent(tableName, event);
        break;
      } catch (err: any) {
        if (attempt === 0) {
          logger.warn('Event write failed, retrying', { error: err.message, eventType: event.eventType });
        } else {
          logger.error('Event write failed after retry — event lost', { error: err.message, eventType: event.eventType, sessionId: event.sessionId });
        }
      }
    }
  }

  // 2. Publish to EventBridge
  try {
    const busName = options?.eventBusName || process.env.EVENT_BUS_NAME || 'default';
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'custom.vnl',
        DetailType: `session.${event.eventType}`,
        Detail: JSON.stringify(event),
        EventBusName: busName,
      }],
    }));
  } catch (err: any) {
    logger.warn('Failed to publish session event to EventBridge (non-blocking)', { error: err.message, eventType: event.eventType });
  }

  // 3. Queue webhook delivery if configured
  const webhookQueueUrl = options?.webhookQueueUrl || process.env.WEBHOOK_QUEUE_URL;
  if (webhookQueueUrl) {
    try {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: webhookQueueUrl,
        MessageBody: JSON.stringify(event),
      }));
    } catch (err: any) {
      logger.warn('Failed to queue webhook delivery (non-blocking)', { error: err.message, eventType: event.eventType });
    }
  }
}

/** Factory to create a pre-configured emitter for a handler */
export function createEventEmitter(tableName: string) {
  return (
    sessionId: string,
    eventType: SessionEventType,
    actorId?: string,
    actorType?: SessionEvent['actorType'],
    details?: Record<string, any>,
  ) => {
    return emitSessionEvent(tableName, {
      eventId: uuidv4(),
      sessionId,
      eventType,
      timestamp: new Date().toISOString(),
      actorId,
      actorType,
      details,
    });
  };
}

/**
 * Atomic state change + event write in a single DynamoDB transaction.
 * Use for critical lifecycle events where the audit trail MUST be durable.
 * EventBridge + webhook still fire best-effort after the transaction.
 */
export async function emitSessionEventAtomic(
  tableName: string,
  stateUpdate: {
    key: Record<string, any>;
    updateExpression: string;
    expressionAttributeValues: Record<string, any>;
    expressionAttributeNames?: Record<string, string>;
  },
  event: SessionEvent,
): Promise<void> {
  const docClient = getDocumentClient();

  // Atomic: state change + event record in single transaction
  await docClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Update: {
          TableName: tableName,
          Key: stateUpdate.key,
          UpdateExpression: stateUpdate.updateExpression,
          ExpressionAttributeValues: stateUpdate.expressionAttributeValues,
          ...(stateUpdate.expressionAttributeNames && {
            ExpressionAttributeNames: stateUpdate.expressionAttributeNames,
          }),
        },
      },
      {
        Put: {
          TableName: tableName,
          Item: {
            PK: `SESSION#${event.sessionId}`,
            SK: `EVENT#${event.timestamp}#${event.eventId}`,
            entityType: 'SESSION_EVENT',
            ...event,
          },
        },
      },
    ],
  }));

  // Best-effort: EventBridge + webhook (non-blocking, after transaction committed)
  try {
    const busName = process.env.EVENT_BUS_NAME || 'default';
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'custom.vnl',
        DetailType: `session.${event.eventType}`,
        Detail: JSON.stringify(event),
        EventBusName: busName,
      }],
    }));
  } catch (err: any) {
    logger.warn('EventBridge publish failed after atomic write (non-blocking)', { error: err.message });
  }

  const webhookQueueUrl = process.env.WEBHOOK_QUEUE_URL;
  if (webhookQueueUrl) {
    try {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: webhookQueueUrl,
        MessageBody: JSON.stringify(event),
      }));
    } catch (err: any) {
      logger.warn('Webhook queue failed after atomic write (non-blocking)', { error: err.message });
    }
  }
}
