import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import { writeSessionEvent } from '../repositories/event-repository';
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
  // 1. Write to DynamoDB (unless skipDdb for high-frequency events)
  if (!options?.skipDdb) {
    try {
      await writeSessionEvent(tableName, event);
    } catch (err: any) {
      logger.warn('Failed to write session event to DDB (non-blocking)', { error: err.message, eventType: event.eventType });
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
