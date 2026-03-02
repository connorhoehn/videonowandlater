import { Stack, StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export class MonitoringStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const billingTopic = new sns.Topic(this, 'BillingAlarmTopic', {
      displayName: 'VNL Billing Alerts',
    });

    const thresholds = [10, 50, 100];

    for (const threshold of thresholds) {
      const metric = new cloudwatch.Metric({
        namespace: 'AWS/Billing',
        metricName: 'EstimatedCharges',
        statistic: 'Maximum',
        period: Duration.hours(6),
        dimensionsMap: { Currency: 'USD' },
      });

      const alarm = new cloudwatch.Alarm(this, `BillingAlarm${threshold}`, {
        metric,
        threshold,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `Alert when estimated charges exceed $${threshold}`,
        alarmName: `vnl-billing-${threshold}`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new actions.SnsAction(billingTopic));
    }

    new CfnOutput(this, 'BillingAlarmTopicArn', {
      value: billingTopic.topicArn,
    });
  }
}
