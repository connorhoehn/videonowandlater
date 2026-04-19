import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ivs from 'aws-cdk-lib/aws-ivs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3Notifications from 'aws-cdk-lib/aws-s3-notifications';
import * as path from 'path';
import { Construct } from 'constructs';
import { IvsCleanupResource } from '../constructs/ivs-cleanup-resource';

interface SessionStackProps extends StackProps {
  recordingsBucket: s3.IBucket;
  transcriptionBucket: s3.IBucket;
  cloudfrontDomainName: string;
}

/**
 * SessionStack - DynamoDB table for session management and resource pool
 *
 * Single-table design with:
 * - PK/SK for primary access patterns
 * - GSI1 for status-based queries (e.g., finding AVAILABLE resources)
 *
 * Buckets and CloudFront live in StorageStack to survive failed deployments.
 */
export class SessionStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly recordingStartRule: events.Rule;
  public readonly recordingEndRule: events.Rule;
  public readonly recordingsBucket: s3.IBucket;
  public readonly transcriptionBucket: s3.IBucket;
  public readonly mediaConvertTopic!: sns.Topic;
  public readonly cloudfrontDomainName: string;
  public readonly webhookDeliveryQueue: sqs.Queue;
  public readonly moderationBucket!: s3.Bucket;
  /** IAM role MediaConvert jobs assume — re-used by the clips pipeline for CreateJob permissions. */
  public readonly mediaConvertJobRoleArn!: string;
  /** Transcription bucket where per-session recording.mp4 outputs live — clip source input. */
  public readonly transcriptionBucketRef!: s3.IBucket;

  constructor(scope: Construct, id: string, props: SessionStackProps) {
    super(scope, id, props);

    this.recordingsBucket = props.recordingsBucket;
    this.transcriptionBucket = props.transcriptionBucket;
    this.cloudfrontDomainName = props.cloudfrontDomainName;

    // Single table for sessions and resource pool items
    this.table = new dynamodb.Table(this, 'SessionTable', {
      tableName: 'vnl-sessions',
      partitionKey: {
        name: 'PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
    });

    // GSI1 for status-based queries
    // Example: Query all AVAILABLE resources by setting GSI1PK=STATUS#AVAILABLE
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: {
        name: 'GSI1PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI1SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 for reaction time-range queries
    // Example: Query reactions for session X between time Y and Z
    // GSI2PK = REACTION#{sessionId}, GSI2SK = zero-padded sessionRelativeTime
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: {
        name: 'GSI2PK',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'GSI2SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3 for channel ARN lookups (sparse — only broadcast sessions)
    // Replaces full-table scans in stream-started, stream-ended, recording-ended
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: {
        name: 'channelArn',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI4 for stage ARN lookups (sparse — only hangout sessions)
    // Replaces full-table scan in findSessionByStageArn
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: {
        name: 'stageArn',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI5: Time-range queries for cost records and moderation events
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI5',
      partitionKey: { name: 'GSI5PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI5SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI6: Per-user cost attribution queries
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI6',
      partitionKey: { name: 'GSI6PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI6SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new CfnOutput(this, 'SessionTableName', {
      value: this.table.tableName,
    });

    // ============================================================
    // Webhook Delivery Infrastructure
    // ============================================================
    const webhookDeliveryDlq = new sqs.Queue(this, 'WebhookDeliveryDlq', {
      queueName: 'vnl-webhook-delivery-dlq',
      retentionPeriod: Duration.days(14),
    });
    const webhookDeliveryQueue = new sqs.Queue(this, 'WebhookDeliveryQueue', {
      queueName: 'vnl-webhook-delivery',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: webhookDeliveryDlq, maxReceiveCount: 5 },
    });

    // Webhook delivery Lambda
    const deliverWebhookFn = new nodejs.NodejsFunction(this, 'DeliverWebhook', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/deliver-webhook.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    this.table.grantReadData(deliverWebhookFn);
    deliverWebhookFn.addEventSource(new SqsEventSource(webhookDeliveryQueue, { batchSize: 10 }));
    this.webhookDeliveryQueue = webhookDeliveryQueue;

    // ============================================================
    // Idempotency Table (Phase 38: Required for Powertools migration)
    // ============================================================

    // Create idempotency table for deduplicating concurrent Lambda executions
    // Powertools expects exact attribute names and will auto-manage TTL
    const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
      tableName: 'vnl-idempotency',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand for variable pipeline load
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'expiration', // Exact name — Powertools writes to this attribute
      removalPolicy: RemovalPolicy.DESTROY, // Dev environment; change to RETAIN for prod
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    new CfnOutput(this, 'IdempotencyTableName', {
      value: idempotencyTable.tableName,
    });

    // ============================================================
    // Recording Infrastructure
    // ============================================================

    // Buckets and CloudFront live in StorageStack (survives failed SessionStack deploys).
    const transcriptionBucket = this.transcriptionBucket;

    // IVS Cleanup Custom Resource
    // This ensures IVS channels are properly cleaned up before stack deletion
    const cleanupResource = new IvsCleanupResource(this, 'IvsCleanup');

    // IVS Recording Configuration (L1 constructs)
    const recordingConfiguration = new ivs.CfnRecordingConfiguration(this, 'RecordingConfiguration', {
      destinationConfiguration: {
        s3: {
          bucketName: this.recordingsBucket.bucketName,
        },
      },
      thumbnailConfiguration: {
        recordingMode: 'INTERVAL',
        targetIntervalSeconds: 10,
        resolution: 'HD',
      },
      renditionConfiguration: {
        renditions: ['HD', 'SD', 'LOWEST_RESOLUTION'],
      },
      name: 'vnl-recording-config',
    });

    // Ensure recording configuration depends on cleanup resource
    // This ensures cleanup runs BEFORE recording config deletion
    recordingConfiguration.node.addDependency(cleanupResource);

    // Export RecordingConfiguration ARN and CloudFront domain
    new CfnOutput(this, 'RecordingConfigArn', {
      value: recordingConfiguration.attrArn,
      exportName: 'vnl-recording-config-arn',
      description: 'ARN of IVS RecordingConfiguration',
    });

    // IVS RealTime StorageConfiguration — used for per-participant stage recording
    const storageConfiguration = new ivs.CfnStorageConfiguration(this, 'StageStorageConfiguration', {
      name: 'vnl-stage-storage-config',
      s3: {
        bucketName: this.recordingsBucket.bucketName,
      },
    });

    // RecordingsDomain output is now in StorageStack

    // EventBridge rules for recording lifecycle
    this.recordingStartRule = new events.Rule(this, 'RecordingStartRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          recording_status: ['Recording Start'],
        },
      },
      description: 'Capture recording start events from IVS',
    });

    this.recordingEndRule = new events.Rule(this, 'RecordingEndRuleV2', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          recording_status: ['Recording End'],
        },
      },
      description: 'Capture recording end events from IVS',
    });


    // Lambda function for pool replenishment
    const replenishPoolFn = new nodejs.NodejsFunction(this, 'ReplenishPool', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/replenish-pool.ts'),
      timeout: Duration.minutes(5), // Time to create multiple IVS resources
      environment: {
        TABLE_NAME: this.table.tableName,
        MIN_CHANNELS: '3',
        MIN_STAGES: '2',
        MIN_ROOMS: '5',
        MIN_PRIVATE_CHANNELS: '5', // Phase 22: Private channels for secure broadcasts
        RECORDING_CONFIGURATION_ARN: recordingConfiguration.attrArn,
        STORAGE_CONFIGURATION_ARN: storageConfiguration.attrArn,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB permissions
    this.table.grantReadWriteData(replenishPoolFn);

    // Grant IVS permissions
    // Note: IVS doesn't support resource-level permissions for Create* actions
    replenishPoolFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:CreateChannel', 'ivs:TagResource'],
        resources: ['*'],
      })
    );

    replenishPoolFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:CreateStage'],
        resources: ['*'],
      })
    );

    replenishPoolFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:CreateRoom', 'ivschat:TagResource'],
        resources: ['*'],
      })
    );

    // EventBridge schedule to trigger Lambda every 5 minutes
    new events.Rule(this, 'ReplenishPoolSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(replenishPoolFn)],
      description: 'Replenish IVS resource pool every 5 minutes',
    });

    // ============================================================
    // Stuck Session Recovery Cron (Phase 26)
    // Scans GSI1 for stalled pipeline sessions and re-fires recovery events
    // ============================================================
    const scanStuckSessionsFn = new nodejs.NodejsFunction(this, 'ScanStuckSessions', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/scan-stuck-sessions.ts'),
      timeout: Duration.minutes(5),
      environment: {
        TABLE_NAME: this.table.tableName,
        AWS_ACCOUNT_ID: this.account,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ScanStuckSessionsLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    this.table.grantReadWriteData(scanStuckSessionsFn);

    scanStuckSessionsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    new events.Rule(this, 'ScanStuckSessionsSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(15)),
      targets: [new targets.LambdaFunction(scanStuckSessionsFn)],
      description: 'Scan for stuck pipeline sessions and re-trigger recovery every 15 minutes',
    });

    // ============================================================
    // Auto-Kill + Auto-Finalize Cron
    // - LIVE sessions > 10 min → force-kill (stop stream/disconnect participants)
    // - ENDING sessions > 2 min → force-finalize to ENDED (+ release pool resources)
    // ============================================================
    const scanActiveSessionsFn = new nodejs.NodejsFunction(this, 'ScanActiveSessions', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/scan-active-sessions.ts'),
      timeout: Duration.minutes(2),
      environment: {
        TABLE_NAME: this.table.tableName,
        ACTIVE_SESSION_MAX_AGE_MIN: '10',
        ENDING_MAX_AGE_MIN: '2',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ScanActiveSessionsLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    this.table.grantReadWriteData(scanActiveSessionsFn);

    // IVS IAM actions all share the `ivs:` namespace (both Low-Latency and
    // Real-Time). Scope each by ARN shape so a mistake in one handler can't
    // e.g. stop unrelated channels.
    scanActiveSessionsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:StopStream'],
      resources: ['arn:aws:ivs:*:*:channel/*'],
    }));
    scanActiveSessionsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    scanActiveSessionsFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));

    new events.Rule(this, 'ScanActiveSessionsSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(scanActiveSessionsFn)],
      description: 'Auto-kill LIVE sessions > 10 min and auto-finalize stuck ENDING sessions > 2 min',
    });

    // Scheduled Lambda to expire old stories (runs hourly)
    const expireStoriesFn = new nodejs.NodejsFunction(this, 'ExpireStories', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/expire-stories.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ExpireStoriesLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    this.table.grantReadWriteData(expireStoriesFn);

    // Run every hour
    new events.Rule(this, 'ExpireStoriesSchedule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(expireStoriesFn)],
    });

    // ============================================================
    // Content Moderation Frame Sampler (Rekognition)
    // Samples thumbnails from live broadcasts every 60s and flags inappropriate content
    // ============================================================
    const moderationFrameSamplerFn = new nodejs.NodejsFunction(this, 'ModerationFrameSampler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/moderation-frame-sampler.ts'),
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ModerationFrameSamplerLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    this.table.grantReadWriteData(moderationFrameSamplerFn);

    moderationFrameSamplerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rekognition:DetectModerationLabels'],
        resources: ['*'],
      }),
    );

    moderationFrameSamplerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:StopStream'],
        resources: ['*'],
      }),
    );

    moderationFrameSamplerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent'],
        resources: ['*'],
      }),
    );

    new events.Rule(this, 'ModerationSamplerSchedule', {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(moderationFrameSamplerFn)],
      description: 'Sample frames from live sessions for content moderation',
    });

    // Lambda function for stream-started events
    const streamStartedFn = new nodejs.NodejsFunction(this, 'StreamStarted', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/stream-started.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB permissions
    this.table.grantReadWriteData(streamStartedFn);

    // EventBridge rule for IVS Stream Start events
    const streamStartRule = new events.Rule(this, 'StreamStartRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Stream State Change'],
        detail: {
          event_name: ['Stream Start'],
        },
      },
      targets: [new targets.LambdaFunction(streamStartedFn)],
      description: 'Transition session to LIVE when IVS stream starts',
    });
    streamStartedFn.addPermission('AllowEBStreamStartInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: streamStartRule.ruleArn,
    });

    // Lambda function for stream-ended events
    const streamEndedFn = new nodejs.NodejsFunction(this, 'StreamEnded', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/stream-ended.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    this.table.grantReadWriteData(streamEndedFn);

    // EventBridge rule for IVS Stream End events
    const streamEndRule = new events.Rule(this, 'StreamEndRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Stream State Change'],
        detail: {
          event_name: ['Stream End'],
        },
      },
      targets: [new targets.LambdaFunction(streamEndedFn)],
      description: 'Transition session to ENDING when IVS stream ends',
    });
    streamEndedFn.addPermission('AllowEBStreamEndInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: streamEndRule.ruleArn,
    });

    // Lambda function for recording-ended events
    const recordingEndedFn = new nodejs.NodejsFunction(this, 'RecordingEnded', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/recording-ended.ts'),
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        // Force Lambda update
        LAMBDA_VERSION: '2026-03-06-16:15',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'RecordingEndedLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant DynamoDB permissions
    this.table.grantReadWriteData(recordingEndedFn);

    // Lambda handler for Recording Start events
    const recordingStartedFn = new nodejs.NodejsFunction(this, 'RecordingStarted', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/recording-started.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB permissions
    this.table.grantReadWriteData(recordingStartedFn);

    // Dead-letter queue: captures events EventBridge failed to deliver after retries
    const recordingEventsDlq = new sqs.Queue(this, 'RecordingEventsDlq', {
      queueName: 'vnl-recording-events-dlq',
      retentionPeriod: Duration.days(14),
    });

    // ============================================================
    // Per-handler SQS Queue Pairs (Phase 31)
    // Each pipeline handler gets its own queue + DLQ for at-least-once delivery
    // Visibility timeout = 6× Lambda timeout per AWS recommendation
    // ============================================================

    // recording-ended queue (serves 3 rules: recordingEndRule, stageRecordingEndRule, recordingRecoveryRule)
    const recordingEndedDlq = new sqs.Queue(this, 'RecordingEndedDlq', {
      queueName: 'vnl-recording-ended-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const recordingEndedQueue = new sqs.Queue(this, 'RecordingEndedQueue', {
      queueName: 'vnl-recording-ended',
      visibilityTimeout: Duration.seconds(6 * 30), // 6× Lambda timeout (30s)
      deadLetterQueue: { queue: recordingEndedDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // transcode-completed queue
    const transcodeCompletedDlq = new sqs.Queue(this, 'TranscodeCompletedDlq', {
      queueName: 'vnl-transcode-completed-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const transcodeCompletedQueue = new sqs.Queue(this, 'TranscodeCompletedQueue', {
      queueName: 'vnl-transcode-completed',
      visibilityTimeout: Duration.seconds(6 * 30), // 6× Lambda timeout (30s)
      deadLetterQueue: { queue: transcodeCompletedDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // transcribe-completed queue
    const transcribeCompletedDlq = new sqs.Queue(this, 'TranscribeCompletedDlq', {
      queueName: 'vnl-transcribe-completed-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const transcribeCompletedQueue = new sqs.Queue(this, 'TranscribeCompletedQueue', {
      queueName: 'vnl-transcribe-completed',
      visibilityTimeout: Duration.seconds(6 * 30), // 6× Lambda timeout (30s)
      deadLetterQueue: { queue: transcribeCompletedDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // store-summary queue (60s Lambda timeout → 360s visibility)
    const storeSummaryDlq = new sqs.Queue(this, 'StoreSummaryDlq', {
      queueName: 'vnl-store-summary-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const storeSummaryQueue = new sqs.Queue(this, 'StoreSummaryQueue', {
      queueName: 'vnl-store-summary',
      visibilityTimeout: Duration.seconds(6 * 60), // 6× Lambda timeout (60s)
      deadLetterQueue: { queue: storeSummaryDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // start-transcribe queue
    const startTranscribeDlq = new sqs.Queue(this, 'StartTranscribeDlq', {
      queueName: 'vnl-start-transcribe-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const startTranscribeQueue = new sqs.Queue(this, 'StartTranscribeQueue', {
      queueName: 'vnl-start-transcribe',
      visibilityTimeout: Duration.seconds(6 * 30), // 6× Lambda timeout (30s)
      deadLetterQueue: { queue: startTranscribeDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Wire Lambda targets to EventBridge rules (DLQ catches delivery failures)
    this.recordingStartRule.addTarget(new targets.LambdaFunction(recordingStartedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));
    // recordingEndRule → SQS queue (migrated from direct Lambda invocation)
    this.recordingEndRule.addTarget(new targets.SqsQueue(recordingEndedQueue));

    // EventBridge rule for IVS RealTime Stage participant recording end events (hangouts)
    const stageRecordingEndRule = new events.Rule(this, 'StageRecordingEndRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Participant Recording State Change'],
        detail: {
          event_name: ['Recording End'],
        },
      },
      description: 'Capture IVS RealTime participant recording end events for hangout sessions',
    });
    // stageRecordingEndRule → SQS queue (migrated from direct Lambda invocation)
    stageRecordingEndRule.addTarget(new targets.SqsQueue(recordingEndedQueue));

    // Route synthetic recovery events (from scan-stuck-sessions) to recording-ended handler
    const recordingRecoveryRule = new events.Rule(this, 'RecordingRecoveryRule', {
      eventPattern: {
        source: ['custom.vnl'],
        detailType: ['Recording Recovery'],
      },
      description: 'Route recovery events from scan-stuck-sessions to recording-ended handler',
    });
    // recordingRecoveryRule → SQS queue (migrated from direct Lambda invocation)
    recordingRecoveryRule.addTarget(new targets.SqsQueue(recordingEndedQueue));

    recordingStartedFn.addPermission('AllowEBRecordingStartInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: this.recordingStartRule.ruleArn,
    });

    // DLQ resource policy will be updated after transcription pipeline setup

    // DLQ resource policy: only recordingStartRule still uses recordingEventsDlq
    // (the 4 migrated rules now use per-handler SQS queues with their own DLQs)
    recordingEventsDlq.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('events.amazonaws.com')],
      actions: ['sqs:SendMessage'],
      resources: [recordingEventsDlq.queueArn],
      conditions: {
        ArnLike: {
          'aws:SourceArn': [
            this.recordingStartRule.ruleArn,
            // Removed: recordingEndRule, stageRecordingEndRule, transcodeCompletedRule, transcribeCompletedRule
            // These handlers now use per-handler SQS queues
          ],
        },
      },
    }));

    // Update recording-ended function with CloudFront domain
    recordingEndedFn.addEnvironment('CLOUDFRONT_DOMAIN', this.cloudfrontDomainName);

    // Grant S3 read access to Lambda functions for recording metadata
    this.recordingsBucket.grantRead(streamStartedFn);
    this.recordingsBucket.grantRead(recordingEndedFn);
    this.recordingsBucket.grantRead(recordingStartedFn);

    // ============================================================
    // Transcription Pipeline Infrastructure (Phase 19)
    // MediaConvert for adaptive bitrate transcoding + Transcribe for automated transcription
    // ============================================================

    // Create MediaConvert IAM role for transcoding jobs
    const mediaConvertRole = new iam.Role(this, 'MediaConvertRole', {
      assumedBy: new iam.ServicePrincipal('mediaconvert.amazonaws.com'),
      description: 'Role for MediaConvert jobs to read IVS HLS and write transcription outputs',
    });

    // Grant MediaConvert job role S3 read access to recordings bucket (for HLS master.m3u8)
    this.recordingsBucket.grantRead(mediaConvertRole);

    // Grant MediaConvert job role S3 write access to recordings bucket (for HLS output)
    this.recordingsBucket.grantWrite(mediaConvertRole);

    // Grant MediaConvert job role S3 write access to transcription bucket (for MP4 output)
    transcriptionBucket.grantWrite(mediaConvertRole);

    // Grant MediaConvert permissions to recording-ended handler for job submission
    recordingEndedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['mediaconvert:CreateJob', 'mediaconvert:TagResource'],
      resources: ['*'],
    }));

    // Grant recording-ended handler S3 read access to recordings bucket (for HLS master.m3u8)
    this.recordingsBucket.grantRead(recordingEndedFn);

    // Grant recording-ended handler S3 write access to transcription bucket (MediaConvert outputs MP4 there)
    transcriptionBucket.grantWrite(recordingEndedFn);

    // Grant recording-ended handler CloudWatch PutMetricData permission
    recordingEndedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Grant recording-ended handler IAM pass-role permission for MediaConvert job
    recordingEndedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['arn:aws:iam::*:role/*'],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'mediaconvert.amazonaws.com',
        },
      },
    }));

    // Set environment variables on recording-ended handler for MediaConvert job submission
    recordingEndedFn.addEnvironment('MEDIACONVERT_ROLE_ARN', mediaConvertRole.roleArn);
    recordingEndedFn.addEnvironment('TRANSCRIPTION_BUCKET', transcriptionBucket.bucketName);
    recordingEndedFn.addEnvironment('AWS_ACCOUNT_ID', this.account);

    // EventBridge rule for MediaConvert job completion
    const transcodeCompletedRule = new events.Rule(this, 'TranscodeCompletedRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: {
          status: ['COMPLETE', 'ERROR', 'CANCELED'],
          userMetadata: {
            phase: ['19-transcription'],
          },
        },
      },
      description: 'Submit Transcribe job when MediaConvert completes',
    });

    // Create transcode-completed Lambda function
    const transcodeCompletedFn = new nodejs.NodejsFunction(this, 'TranscodeCompleted', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/transcode-completed.ts'),
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
        AWS_ACCOUNT_ID: this.account,
        // Force Lambda update by adding version timestamp
        LAMBDA_VERSION: '2026-03-06-19:10',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'TranscodeCompletedLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant DynamoDB access to transcode-completed handler
    this.table.grantReadWriteData(transcodeCompletedFn);

    // Grant Transcribe permissions to transcode-completed handler
    transcodeCompletedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob'],
      resources: ['*'],
    }));

    // Grant transcode-completed handler CloudWatch PutMetricData permission
    transcodeCompletedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Grant S3 read access to transcription bucket (for MP4 files from MediaConvert)
    transcriptionBucket.grantRead(transcodeCompletedFn);

    // Add EventBridge target — migrated to SQS queue
    transcodeCompletedRule.addTarget(new targets.SqsQueue(transcodeCompletedQueue));

    // EventBridge rule for Transcribe job completion
    const transcribeCompletedRule = new events.Rule(this, 'TranscribeCompletedRule', {
      eventPattern: {
        source: ['aws.transcribe'],
        detailType: ['Transcribe Job State Change'],
        detail: {
          TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
        },
      },
      description: 'Store transcript when Transcribe completes',
    });

    // Create transcribe-completed Lambda function
    const transcribeCompletedFn = new nodejs.NodejsFunction(this, 'TranscribeCompleted', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/transcribe-completed.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512, // Transcribe JSON can be large (word-level timing data)
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'TranscribeCompletedLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant DynamoDB access to transcribe-completed handler
    this.table.grantReadWriteData(transcribeCompletedFn);

    // Grant S3 read+write access to transcription bucket (reads transcript.json, writes speaker-segments.json)
    transcriptionBucket.grantReadWrite(transcribeCompletedFn);

    // Grant EventBridge PutEvents permission (publishes "Transcript Stored" event)
    transcribeCompletedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
        effect: iam.Effect.ALLOW,
      })
    );

    // Grant transcribe-completed handler CloudWatch PutMetricData permission
    transcribeCompletedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // Add EventBridge target — migrated to SQS queue
    transcribeCompletedRule.addTarget(new targets.SqsQueue(transcribeCompletedQueue));

    // recordingEventsDlq resource policy is set earlier (after recordingRecoveryRule)
    // covering only recordingStartRule — the 4 migrated rules now use per-handler SQS queues

    // ============================================================
    // AI Summary Pipeline (Phase 20)
    // Triggered when transcript is stored, invokes Bedrock Claude to generate summaries
    // ============================================================

    // Lambda function for store-summary (Bedrock invocation)
    const storeSummaryFn = new nodejs.NodejsFunction(this, 'StoreSummary', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/store-summary.ts'),
      timeout: Duration.seconds(90), // Bedrock latency 5-10s + VLM vision call + buffer
      memorySize: 512, // base64 image handling for visual analysis
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        BEDROCK_REGION: this.region,
        BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
        EVENT_BUS_NAME: 'default',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'StoreSummaryLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant DynamoDB permissions (read for getSession, write for updateSessionAiSummary)
    this.table.grantReadWriteData(storeSummaryFn);

    // Grant Bedrock InvokeModel permission for Nova Lite (default), Nova Pro, and Claude (backward compat via env var override)
    storeSummaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,  // default model
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,   // backward compat
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-*`,     // backward compat
        ],
        effect: iam.Effect.ALLOW,
      })
    );

    // Grant EventBridge PutEvents permission (publishes "Chapters Stored" event)
    storeSummaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
        effect: iam.Effect.ALLOW,
      })
    );

    // Grant store-summary handler CloudWatch PutMetricData permission
    storeSummaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // S3 read access for fetching transcripts
    transcriptionBucket.grantRead(storeSummaryFn);

    // EventBridge rule triggered on transcript storage completion (Phase 19)
    // Target migrated from LambdaFunction to SqsQueue (Phase 31)
    const transcriptStoreRule = new events.Rule(this, 'TranscriptStoreRule', {
      eventPattern: {
        source: ['custom.vnl'],
        detailType: ['Transcript Stored'],
      },
      description: 'Trigger AI summary generation when transcript is stored',
    });
    transcriptStoreRule.addTarget(new targets.SqsQueue(storeSummaryQueue));

    // ============================================================
    // Highlight Reel Pipeline
    // Triggered when chapters are stored, submits MediaConvert job to create
    // landscape + vertical highlight reel clips from best chapter moments
    // ============================================================

    // generate-highlight-reel queue (120s Lambda timeout → 720s visibility)
    const generateHighlightReelDlq = new sqs.Queue(this, 'GenerateHighlightReelDlq', {
      queueName: 'vnl-generate-highlight-reel-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const generateHighlightReelQueue = new sqs.Queue(this, 'GenerateHighlightReelQueue', {
      queueName: 'vnl-generate-highlight-reel',
      visibilityTimeout: Duration.seconds(720), // 6× Lambda timeout (120s)
      deadLetterQueue: { queue: generateHighlightReelDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // EventBridge rule for "Chapters Stored" events from store-summary handler
    const chaptersStoredRule = new events.Rule(this, 'ChaptersStoredRule', {
      eventPattern: {
        source: ['custom.vnl'],
        detailType: ['Chapters Stored'],
      },
      description: 'Trigger highlight reel generation when chapters are stored',
    });
    chaptersStoredRule.addTarget(new targets.SqsQueue(generateHighlightReelQueue));

    // Lambda function for generate-highlight-reel (MediaConvert job submission)
    const generateHighlightReelFn = new nodejs.NodejsFunction(this, 'GenerateHighlightReel', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/generate-highlight-reel.ts'),
      timeout: Duration.seconds(120),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        AWS_ACCOUNT_ID: this.account,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'GenerateHighlightReelLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant DynamoDB access
    this.table.grantReadWriteData(generateHighlightReelFn);

    // Grant S3 read access to transcription bucket (reads recording.mp4)
    transcriptionBucket.grantRead(generateHighlightReelFn);

    // Grant MediaConvert permissions
    generateHighlightReelFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'mediaconvert:CreateJob',
          'mediaconvert:DescribeEndpoints',
          'mediaconvert:TagResource',
        ],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    );

    // Grant IAM PassRole for MediaConvert
    generateHighlightReelFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [mediaConvertRole.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'mediaconvert.amazonaws.com',
          },
        },
        effect: iam.Effect.ALLOW,
      })
    );

    // Wire SQS event source
    generateHighlightReelFn.addEventSource(new SqsEventSource(generateHighlightReelQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    // ============================================================
    // Upload MediaConvert Pipeline (Phase 21)
    // SNS topic for upload completion notifications, Lambda for job submission,
    // EventBridge rule for job state changes
    // ============================================================

    // SNS topic for upload completion notifications
    this.mediaConvertTopic = new sns.Topic(this, 'MediaConvertTopic', {
      displayName: 'MediaConvert Job Submission Topic',
      topicName: 'vnl-mediaconvert-jobs',
    });

    // Lambda function for start-mediaconvert (SNS-triggered)
    const startMediaConvertFunction = new nodejs.NodejsFunction(this, 'StartMediaConvert', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/start-mediaconvert.ts'),
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: this.table.tableName,
        RECORDINGS_BUCKET: this.recordingsBucket.bucketName,
        MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
        AWS_ACCOUNT_ID: this.account,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB access to start-mediaconvert
    this.table.grantReadWriteData(startMediaConvertFunction);

    // Grant MediaConvert permissions to start-mediaconvert
    startMediaConvertFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['mediaconvert:CreateJob', 'mediaconvert:TagResource'],
      resources: ['*'],
    }));

    // Grant start-mediaconvert IAM pass-role permission for MediaConvert job
    startMediaConvertFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: ['arn:aws:iam::*:role/*'],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'mediaconvert.amazonaws.com',
        },
      },
    }));

    // Subscribe start-mediaconvert Lambda to SNS topic
    this.mediaConvertTopic.addSubscription(new sns_subscriptions.LambdaSubscription(startMediaConvertFunction));

    // Lambda function for on-mediaconvert-complete (EventBridge-triggered)
    const onMediaConvertCompleteFunction = new nodejs.NodejsFunction(this, 'OnMediaConvertComplete', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/on-mediaconvert-complete.ts'),
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
        RECORDINGS_BUCKET: this.recordingsBucket.bucketName,
        EVENT_BUS_NAME: 'default',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Set CloudFront domain for thumbnail/poster URL generation
    onMediaConvertCompleteFunction.addEnvironment('CLOUDFRONT_DOMAIN', this.cloudfrontDomainName);

    // Grant DynamoDB access to on-mediaconvert-complete
    this.table.grantReadWriteData(onMediaConvertCompleteFunction);

    // Grant EventBridge permissions to publish transcription trigger events (Phase 21 → Phase 19)
    onMediaConvertCompleteFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['arn:aws:events:*:*:event-bus/default'],
    }));

    // Grant on-mediaconvert-complete handler CloudWatch PutMetricData permission
    onMediaConvertCompleteFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // EventBridge rule for MediaConvert job state changes (Phase 21)
    const mediaConvertCompleteRule = new events.Rule(this, 'MediaConvertCompleteRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: {
          'status': ['COMPLETE', 'ERROR', 'CANCELED'],
          'userMetadata': {
            'phase': ['19-transcription']
          }
        },
      },
      description: 'Handle MediaConvert job completion for upload video encoding',
    });

    // SQS queue between EventBridge and Lambda (handler expects SQSEvent wrapping EventBridge events)
    const mediaConvertCompleteQueue = new sqs.Queue(this, 'MediaConvertCompleteQueue', {
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: {
        queue: recordingEventsDlq,
        maxReceiveCount: 3,
      },
    });

    mediaConvertCompleteRule.addTarget(new targets.SqsQueue(mediaConvertCompleteQueue, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

    onMediaConvertCompleteFunction.addEventSource(new SqsEventSource(mediaConvertCompleteQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    // Lambda function for start-transcribe (EventBridge-triggered from Upload Recording Available)
    const startTranscribeFn = new nodejs.NodejsFunction(this, 'StartTranscribe', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/start-transcribe.ts'),
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
      },
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: new logs.LogGroup(this, 'StartTranscribeLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // Grant necessary permissions to start-transcribe handler
    transcriptionBucket.grantReadWrite(startTranscribeFn);
    this.recordingsBucket.grantRead(startTranscribeFn);

    // Grant Transcribe permissions to start-transcribe handler
    startTranscribeFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob'],
      resources: ['*'],
    }));

    // Grant start-transcribe handler CloudWatch PutMetricData permission
    startTranscribeFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
      })
    );

    // EventBridge rule for Upload Recording Available events
    // Target migrated from LambdaFunction to SqsQueue (Phase 31)
    const uploadRecordingAvailableRule = new events.Rule(this, 'UploadRecordingAvailableRule', {
      eventPattern: {
        source: ['vnl.upload'],
        detailType: ['Upload Recording Available'],
      },
      description: 'Start Transcribe job when recording is available',
    });
    uploadRecordingAvailableRule.addTarget(new targets.SqsQueue(startTranscribeQueue));

    // SQS event source mappings — each Lambda polls its dedicated queue (batchSize: 1)
    recordingEndedFn.addEventSource(new SqsEventSource(recordingEndedQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    transcodeCompletedFn.addEventSource(new SqsEventSource(transcodeCompletedQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    transcribeCompletedFn.addEventSource(new SqsEventSource(transcribeCompletedQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    storeSummaryFn.addEventSource(new SqsEventSource(storeSummaryQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));
    startTranscribeFn.addEventSource(new SqsEventSource(startTranscribeQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    // Lifecycle rules are in StorageStack

    // Expose shared MediaConvert role + transcription bucket so ApiStack
    // can wire clip-creation Lambdas that reuse the same pipeline assets.
    (this as any).mediaConvertJobRoleArn = mediaConvertRole.roleArn;
    (this as any).transcriptionBucketRef = transcriptionBucket;

    // ============================================================
    // Clips Pipeline (viewer-initiated highlights)
    // EventBridge rule for MediaConvert clip-job state changes → SQS → on-clip-complete.
    // Filter: only events with UserMetadata.type == 'clip'.
    // ============================================================
    const onClipCompleteDlq = new sqs.Queue(this, 'OnClipCompleteDlq', {
      queueName: 'vnl-on-clip-complete-dlq',
      retentionPeriod: Duration.days(14),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const onClipCompleteQueue = new sqs.Queue(this, 'OnClipCompleteQueue', {
      queueName: 'vnl-on-clip-complete',
      visibilityTimeout: Duration.seconds(90),
      deadLetterQueue: { queue: onClipCompleteDlq, maxReceiveCount: 3 },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const onClipCompleteFn = new nodejs.NodejsFunction(this, 'OnClipComplete', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/on-clip-complete.ts'),
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'OnClipCompleteLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    this.table.grantReadWriteData(onClipCompleteFn);
    onClipCompleteFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }));

    const clipCompleteRule = new events.Rule(this, 'ClipCompleteRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: {
          status: ['COMPLETE', 'ERROR', 'CANCELED'],
          userMetadata: { type: ['clip'] },
        },
      },
      description: 'Handle MediaConvert clip-job completion',
    });
    clipCompleteRule.addTarget(new targets.SqsQueue(onClipCompleteQueue, {
      deadLetterQueue: onClipCompleteDlq,
      retryAttempts: 2,
    }));
    onClipCompleteFn.addEventSource(new SqsEventSource(onClipCompleteQueue, {
      batchSize: 1,
      reportBatchItemFailures: true,
    }));

    // ============================================================
    // Webhook + EventBridge env vars & permissions for pipeline Lambdas
    // ============================================================
    const webhookPipelineFns = [
      recordingEndedFn,
      onMediaConvertCompleteFunction,
      startTranscribeFn,
      transcribeCompletedFn,
      storeSummaryFn,
      streamStartedFn,
      streamEndedFn,
      recordingStartedFn,
      moderationFrameSamplerFn,
    ];

    const webhookEventPolicy = new iam.PolicyStatement({
      actions: ['sqs:SendMessage'],
      resources: [webhookDeliveryQueue.queueArn],
    });

    const eventBridgePutPolicy = new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    });

    for (const fn of webhookPipelineFns) {
      fn.addEnvironment('WEBHOOK_QUEUE_URL', webhookDeliveryQueue.queueUrl);
      fn.addEnvironment('EVENT_BUS_NAME', 'default');
      fn.addToRolePolicy(webhookEventPolicy);
      fn.addToRolePolicy(eventBridgePutPolicy);
    }

    // Export environment variables for API handlers
    new CfnOutput(this, 'MediaConvertTopicArn', {
      value: this.mediaConvertTopic.topicArn,
      description: 'SNS Topic ARN for MediaConvert job submissions',
    });

    // ============================================================
    // IVS Event Audit — catch-all for full pipeline observability
    // CloudWatch log group: /aws/lambda/VnlSessionStack-IvsEventAudit...
    // Logs every aws.ivs event: source, detailType, resources, full detail payload
    // ============================================================
    const ivsAuditDlq = new sqs.Queue(this, 'IvsEventAuditDlq', {
      queueName: 'vnl-ivs-event-audit-dlq',
      retentionPeriod: Duration.days(7),
    });

    const ivsEventAuditFn = new nodejs.NodejsFunction(this, 'IvsEventAudit', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/ivs-event-audit.ts'),
      timeout: Duration.seconds(10),
      logGroup: new logs.LogGroup(this, 'IvsEventAuditLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    const ivsEventAuditRule = new events.Rule(this, 'IvsEventAuditRule', {
      eventPattern: {
        source: ['aws.ivs'],
      },
      targets: [new targets.LambdaFunction(ivsEventAuditFn, {
        deadLetterQueue: ivsAuditDlq,
        retryAttempts: 1,
      })],
      description: 'Capture ALL IVS events for CloudWatch observability',
    });
    ivsEventAuditFn.addPermission('AllowEBIvsAuditInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: ivsEventAuditRule.ruleArn,
    });

    // ============================================================
    // Pipeline Alarms & Dashboard (Phase 33)
    // OBS-01: DLQ depth alarms (1-min period, any message = ALARM)
    // OBS-02: Lambda error rate alarms (5-min period, any error = ALARM)
    // OBS-03: SNS topic with optional alertEmail context subscription
    // OBS-04: VNL-Pipeline CloudWatch dashboard
    // ============================================================
    const pipelineAlarmTopic = new sns.Topic(this, 'PipelineAlarmTopic', {
      displayName: 'VNL Pipeline Alarms',
      topicName: 'vnl-pipeline-alarms',
    });

    const alertEmail = this.node.tryGetContext('alertEmail') as string | undefined;
    if (alertEmail) {
      pipelineAlarmTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(alertEmail)
      );
    }

    new CfnOutput(this, 'PipelineAlarmTopicArn', {
      value: pipelineAlarmTopic.topicArn,
      description: 'SNS Topic ARN for pipeline alarms — subscribe additional endpoints here',
    });

    const pipelineDashboard = new cloudwatch.Dashboard(this, 'PipelineDashboard', {
      dashboardName: 'VNL-Pipeline',
    });

    const pipelineHandlers: Array<{
      id: string;
      fn: nodejs.NodejsFunction;
      dlq: sqs.Queue;
      label: string;
    }> = [
      { id: 'RecordingEnded', fn: recordingEndedFn, dlq: recordingEndedDlq, label: 'recording-ended' },
      { id: 'TranscodeCompleted', fn: transcodeCompletedFn, dlq: transcodeCompletedDlq, label: 'transcode-completed' },
      { id: 'TranscribeCompleted', fn: transcribeCompletedFn, dlq: transcribeCompletedDlq, label: 'transcribe-completed' },
      { id: 'StoreSummary', fn: storeSummaryFn, dlq: storeSummaryDlq, label: 'store-summary' },
      { id: 'StartTranscribe', fn: startTranscribeFn, dlq: startTranscribeDlq, label: 'start-transcribe' },
      { id: 'GenerateHighlightReel', fn: generateHighlightReelFn, dlq: generateHighlightReelDlq, label: 'generate-highlight-reel' },
    ];

    for (const { id, fn, dlq, label } of pipelineHandlers) {
      // OBS-01: DLQ depth alarm — 1-minute period, fires as soon as any message lands
      const dlqAlarm = new cloudwatch.Alarm(this, `${id}DlqAlarm`, {
        alarmName: `vnl-pipeline-${label}-dlq`,
        metric: dlq.metricApproximateNumberOfMessagesVisible({
          statistic: 'Sum',
          period: Duration.minutes(1),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} DLQ has messages — pipeline stage is failing`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      dlqAlarm.addAlarmAction(new actions.SnsAction(pipelineAlarmTopic));

      // OBS-02: Lambda error alarm — 5-minute period, fires on any error in the window
      const errorAlarm = new cloudwatch.Alarm(this, `${id}ErrorAlarm`, {
        alarmName: `vnl-pipeline-${label}-errors`,
        metric: fn.metricErrors({
          statistic: 'Sum',
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} Lambda has errors in a 5-minute window`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      errorAlarm.addAlarmAction(new actions.SnsAction(pipelineAlarmTopic));

      // OBS-04: One dashboard row per handler — Invocations, Errors, DLQ Depth (3 × 8 = 24 units)
      pipelineDashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${label} — Invocations`,
          left: [fn.metricInvocations({ statistic: 'Sum', period: Duration.minutes(5) })],
          width: 8,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `${label} — Errors`,
          left: [fn.metricErrors({ statistic: 'Sum', period: Duration.minutes(5) })],
          width: 8,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `${label} — DLQ Depth`,
          left: [dlq.metricApproximateNumberOfMessagesVisible({ statistic: 'Sum', period: Duration.minutes(1) })],
          width: 8,
          height: 6,
        }),
      );
    }

    // ============================================================
    // Budget Alert System (Phase 5: Cost Refinement)
    // Hourly check of monthly spend against configurable thresholds
    // ============================================================

    const budgetAlertTopic = new sns.Topic(this, 'BudgetAlertTopic', {
      displayName: 'VNL Budget Alerts',
      topicName: 'vnl-budget-alerts',
    });

    const budgetAlertEmail = this.node.tryGetContext('budgetAlertEmail') as string | undefined;
    if (budgetAlertEmail) {
      budgetAlertTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(budgetAlertEmail)
      );
    }

    new CfnOutput(this, 'BudgetAlertTopicArn', {
      value: budgetAlertTopic.topicArn,
      description: 'SNS Topic ARN for budget alerts — subscribe additional endpoints here',
    });

    const checkBudgetFn = new nodejs.NodejsFunction(this, 'CheckBudget', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/check-budget.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
        SNS_TOPIC_ARN: budgetAlertTopic.topicArn,
        BUDGET_THRESHOLDS: '[50,75,90,100]',
        MONTHLY_BUDGET: '100',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'CheckBudgetLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    this.table.grantReadWriteData(checkBudgetFn);
    budgetAlertTopic.grantPublish(checkBudgetFn);

    new events.Rule(this, 'CheckBudgetSchedule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(checkBudgetFn)],
      description: 'Check monthly spend against budget thresholds every hour',
    });

    // ============================================================
    // Auto-Unpin Sessions (hourly)
    // Removes pin from sessions pinned longer than 24 hours
    // ============================================================
    const autoUnpinSessionsFn = new nodejs.NodejsFunction(this, 'AutoUnpinSessions', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/auto-unpin-sessions.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'AutoUnpinSessionsLogGroup', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    this.table.grantReadWriteData(autoUnpinSessionsFn);

    new events.Rule(this, 'AutoUnpinSessionsSchedule', {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new targets.LambdaFunction(autoUnpinSessionsFn)],
      description: 'Auto-unpin sessions pinned longer than 24 hours',
    });

    // ============================================================
    // === Phase 4: Image Moderation ===
    // Client-side frame capture → presigned S3 PUT → S3 ObjectCreated → moderate-frame Lambda
    // Lambda invokes Nova Lite (amazon.nova-lite-v1:0) with the admin-configured ruleset.
    // ============================================================

    const moderationBucket = new s3.Bucket(this, 'ModerationFramesBucket', {
      bucketName: `vnl-moderation-frames-${this.account}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'expire-1-day',
          enabled: true,
          expiration: Duration.days(1),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    // Expose as public readonly via Object.defineProperty (TypeScript readonly is compile-time only)
    (this as any).moderationBucket = moderationBucket;

    const moderateFrameFn = new nodejs.NodejsFunction(this, 'ModerateFrame', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/moderate-frame.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: this.table.tableName,
        MODERATION_BUCKET: moderationBucket.bucketName,
        NOVA_MODEL_ID: 'amazon.nova-lite-v1:0',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'ModerateFrameLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // DynamoDB: read session/ruleset, write MOD rows + strike counter
    this.table.grantReadWriteData(moderateFrameFn);

    // S3: read and delete frames on the moderation bucket
    moderationBucket.grantRead(moderateFrameFn);
    moderationBucket.grantDelete(moderateFrameFn);

    // Bedrock InvokeModel for Nova Lite (and fallback models for future-proofing)
    moderateFrameFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
        ],
      }),
    );

    // IVS Chat: emit moderation_violation events + disconnect hangout users
    moderateFrameFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent', 'ivschat:DisconnectUser'],
        resources: ['*'],
      }),
    );

    // IVS: stop broadcast stream on 3rd strike
    moderateFrameFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:StopStream'],
        resources: ['*'],
      }),
    );

    // IVS Realtime: disconnect hangout participants on 3rd strike
    moderateFrameFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:DisconnectParticipant'],
        resources: ['*'],
      }),
    );

    // EventBridge PutEvents (emitSessionEvent)
    moderateFrameFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }),
    );

    // Wire S3 ObjectCreated → moderate-frame (only .jpg frames)
    moderationBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.LambdaDestination(moderateFrameFn),
      { suffix: '.jpg' },
    );

    new CfnOutput(this, 'ModerationBucketName', {
      value: moderationBucket.bucketName,
      description: 'S3 bucket for Phase 4 moderation frames',
    });

    // ============================================================
    // Go-Live Notifications (fan-out to followers)
    // Triggered by:
    //   - session.SESSION_CREATED     (covers BROADCAST where stream start is
    //                                  the moment of intent)
    //   - session.SESSION_STARTED     (covers HANGOUT — emitted only when the
    //                                  first participant joins, so we don't
    //                                  notify followers for empty shells)
    // ============================================================
    const onSessionCreatedFn = new nodejs.NodejsFunction(this, 'OnSessionCreated', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/on-session-created.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
        NOTIFICATION_EMAIL_ENABLED: 'false', // SES off by default
        // NOTIFICATION_EMAIL_FROM: set this to flip email on in the future
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      logGroup: new logs.LogGroup(this, 'OnSessionCreatedLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    // BatchWrite + read followers + read profile → read/write on the sessions table
    this.table.grantReadWriteData(onSessionCreatedFn);

    // Best-effort email (stubbed today — the SDK isn't wired in). Permission
    // is scoped to SendEmail so the future implementation can drop it in.
    onSessionCreatedFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    const goLiveNotificationsRule = new events.Rule(this, 'GoLiveNotificationsRule', {
      eventPattern: {
        source: ['custom.vnl'],
        // emit-session-event formats DetailType as `session.${eventType}`
        detailType: ['session.SESSION_CREATED', 'session.SESSION_STARTED'],
      },
      description: 'Fan out go-live notifications to followers when a creator starts a session',
      targets: [new targets.LambdaFunction(onSessionCreatedFn)],
    });
    onSessionCreatedFn.addPermission('AllowEBGoLiveInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: goLiveNotificationsRule.ruleArn,
    });
  }
}
