/**
 * dlq-purge command
 * Delete a specific DLQ message by receipt handle
 */

import {
  SQSClient,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';

/**
 * Delete a single message from a DLQ by its ReceiptHandle.
 *
 * @param queueUrl The full SQS queue URL of the DLQ
 * @param receiptHandle The ReceiptHandle from dlq-list output
 */
export async function dlqPurge(queueUrl: string, receiptHandle: string): Promise<void> {
  const client = new SQSClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      })
    );

    console.log(`Message deleted: ${receiptHandle}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('receipt handle')) {
      throw new Error(`Invalid receipt handle: ${message}`);
    }
    throw error;
  }
}
