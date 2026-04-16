import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { Logger } from '@aws-lambda-powertools/logger';
import { updateAgentStatus } from '../repositories/agent-repository';

const logger = new Logger({ serviceName: 'vnl-api', persistentKeys: { handler: 'agent-task-launcher' } });
const ecsClient = new ECSClient({});

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const tableName = process.env.TABLE_NAME!;
  const clusterArn = process.env.ECS_CLUSTER_ARN!;
  const taskDefArn = process.env.AGENT_TASK_DEF_ARN!;
  const subnetIds = (process.env.SUBNET_IDS || '').split(',').filter(Boolean);

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      const { sessionId, stageArn, chatRoomArn, intentFlowId } = message;

      logger.info('Launching agent task', { sessionId, intentFlowId });

      const result = await ecsClient.send(new RunTaskCommand({
        cluster: clusterArn,
        taskDefinition: taskDefArn,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: subnetIds,
            assignPublicIp: 'ENABLED',
          },
        },
        overrides: {
          containerOverrides: [{
            name: 'ai-agent',
            environment: [
              { name: 'SESSION_ID', value: sessionId },
              { name: 'STAGE_ARN', value: stageArn || '' },
              { name: 'CHAT_ROOM_ARN', value: chatRoomArn || '' },
              { name: 'INTENT_FLOW_ID', value: intentFlowId || '' },
              { name: 'TABLE_NAME', value: tableName },
            ],
          }],
        },
      }));

      const taskArn = result.tasks?.[0]?.taskArn;
      if (taskArn) {
        await updateAgentStatus(tableName, sessionId, 'joining', undefined, taskArn);
        logger.info('Agent task launched', { sessionId, taskArn });
      } else {
        logger.error('No task ARN returned', { sessionId });
        failures.push({ itemIdentifier: record.messageId });
      }
    } catch (err: any) {
      logger.error('Failed to launch agent task', { error: err.message, messageId: record.messageId });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
