/**
 * dlq-health command
 * Report approximate message count for all 5 pipeline DLQs
 */

import {
  SQSClient,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const DLQ_NAMES = [
  'vnl-recording-ended-dlq',
  'vnl-transcode-completed-dlq',
  'vnl-transcribe-completed-dlq',
  'vnl-store-summary-dlq',
  'vnl-start-transcribe-dlq',
];

/**
 * Report approximate message counts for all 5 pipeline DLQs.
 * Continues with remaining queues if one fails.
 */
export async function dlqHealth(): Promise<void> {
  const client = new SQSClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  console.log('\nDLQ Health Report');
  console.log('---');

  for (const name of DLQ_NAMES) {
    try {
      const urlResponse = await client.send(
        new GetQueueUrlCommand({ QueueName: name })
      );

      const attrResponse = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: urlResponse.QueueUrl,
          AttributeNames: ['ApproximateNumberOfMessages'],
        })
      );

      const count = parseInt(
        attrResponse.Attributes?.ApproximateNumberOfMessages || '0',
        10
      );

      const indicator = count > 0 ? ' !!!' : '';
      console.log(`  ${name}: ${count} messages${indicator}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  ${name}: ERROR - ${message}`);
    }
  }

  console.log('');
}
