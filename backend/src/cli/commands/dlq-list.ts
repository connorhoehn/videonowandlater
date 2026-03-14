/**
 * dlq-list command
 * List messages in a pipeline DLQ with decoded session context
 */

import {
  SQSClient,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';

/**
 * List messages from a DLQ without consuming them.
 * Uses VisibilityTimeout=0 so messages remain available.
 *
 * @param queueUrl The full SQS queue URL of the DLQ
 */
export async function dlqList(queueUrl: string): Promise<void> {
  const client = new SQSClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      MessageAttributeNames: ['All'],
      AttributeNames: ['All'],
      VisibilityTimeout: 0, // Peek without consuming
    })
  );

  const messages = response.Messages || [];

  if (messages.length === 0) {
    console.log('No messages in DLQ');
    return;
  }

  console.log(`\nFound ${messages.length} message(s) in DLQ:\n`);

  for (const msg of messages) {
    let sessionId = 'N/A';
    let eventType = 'N/A';
    let source = 'N/A';

    try {
      const body = JSON.parse(msg.Body || '{}');
      sessionId = body?.detail?.sessionId || 'N/A';
      eventType = body?.['detail-type'] || 'N/A';
      source = body?.source || 'N/A';
    } catch {
      // Malformed JSON — leave defaults as N/A
    }

    const receiveCount = msg.Attributes?.ApproximateReceiveCount || '?';

    console.log(`  MessageId:      ${msg.MessageId}`);
    console.log(`  ReceiptHandle:  ${msg.ReceiptHandle}`);
    console.log(`  SessionId:      ${sessionId}`);
    console.log(`  EventType:      ${eventType}`);
    console.log(`  Source:          ${source}`);
    console.log(`  ReceiveCount:   ${receiveCount}`);
    console.log('  ---');
  }
}
