import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'vnl-pipeline' });
const cloudwatchClient = new CloudWatchClient({});

const NAMESPACE = 'VNL/Costs';

export async function emitCostMetric(
  service: string,
  costUsd: number,
  sessionType: string,
  sessionId: string,
): Promise<void> {
  try {
    await cloudwatchClient.send(new PutMetricDataCommand({
      Namespace: NAMESPACE,
      MetricData: [
        {
          MetricName: 'SessionCost',
          Value: costUsd,
          Unit: 'None',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'Service', Value: service },
            { Name: 'SessionType', Value: sessionType },
          ],
        },
      ],
    }));
  } catch (err: any) {
    logger.warn('Failed to emit CloudWatch cost metric (non-blocking)', { error: err.message });
  }
}
