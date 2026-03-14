/**
 * dlq-redrive command
 * Re-drive all messages from a DLQ back to its source queue
 */

import {
  SQSClient,
  ListMessageMoveTasksCommand,
  StartMessageMoveTaskCommand,
} from '@aws-sdk/client-sqs';

/**
 * Start an async message move task from a DLQ back to its source queue.
 * Checks for existing active tasks before starting.
 *
 * @param dlqArn The ARN of the DLQ to re-drive messages from
 */
export async function dlqRedrive(dlqArn: string): Promise<void> {
  const client = new SQSClient({
    region: process.env.AWS_REGION || 'us-west-2',
  });

  // Pre-check: ensure no active message move task
  const listResponse = await client.send(
    new ListMessageMoveTasksCommand({
      SourceArn: dlqArn,
    })
  );

  const activeTasks = (listResponse.Results || []).filter(
    (task) => task.Status === 'RUNNING'
  );

  if (activeTasks.length > 0) {
    const activeTask = activeTasks[0];
    throw new Error(
      `Task already running on ${dlqArn}: ${activeTask.TaskHandle}`
    );
  }

  // Start redrive
  const startResponse = await client.send(
    new StartMessageMoveTaskCommand({
      SourceArn: dlqArn,
    })
  );

  console.log(`Redrive task started: ${startResponse.TaskHandle}`);
  console.log('Monitor with: vnl-cli dlq-health');
}
