import { Stack, StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ivs from 'aws-cdk-lib/aws-ivs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { Construct } from 'constructs';

/**
 * SessionStack - DynamoDB table for session management and resource pool
 *
 * Single-table design with:
 * - PK/SK for primary access patterns
 * - GSI1 for status-based queries (e.g., finding AVAILABLE resources)
 */
export class SessionStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly recordingStartRule: events.Rule;
  public readonly recordingEndRule: events.Rule;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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
      pointInTimeRecovery: false,
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

    new CfnOutput(this, 'SessionTableName', {
      value: this.table.tableName,
    });

    // ============================================================
    // Recording Infrastructure
    // ============================================================

    // S3 bucket for session recordings
    const recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      bucketName: `vnl-recordings-${this.stackName.toLowerCase()}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // CloudFront CORS policy for HLS playback
    const recordingsCorsPolicy = new cloudfront.ResponseHeadersPolicy(this, 'RecordingsCorsPolicy', {
      corsBehavior: {
        accessControlAllowOrigins: ['*'],
        accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
        accessControlAllowHeaders: ['*'],
        accessControlExposeHeaders: ['*'],
        accessControlAllowCredentials: false,
        originOverride: true,
      },
      comment: 'CORS headers for IVS Player HLS requests',
    });

    // CloudFront distribution for secure recording playback
    const distribution = new cloudfront.Distribution(this, 'RecordingsDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(recordingsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: recordingsCorsPolicy,
      },
      comment: 'CloudFront distribution for VNL session recordings',
    });

    // Grant CloudFront access to S3 bucket
    recordingsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${recordingsBucket.bucketArn}/*`],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    // IVS Recording Configuration (L1 constructs)
    const recordingConfiguration = new ivs.CfnRecordingConfiguration(this, 'RecordingConfiguration', {
      destinationConfiguration: {
        s3: {
          bucketName: recordingsBucket.bucketName,
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

    // Export RecordingConfiguration ARN and CloudFront domain
    new CfnOutput(this, 'RecordingConfigArn', {
      value: recordingConfiguration.attrArn,
      exportName: 'vnl-recording-config-arn',
      description: 'ARN of IVS RecordingConfiguration',
    });

    new CfnOutput(this, 'RecordingsDomain', {
      value: distribution.distributionDomainName,
      exportName: 'vnl-recordings-domain',
      description: 'CloudFront domain for session recordings',
    });

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
        RECORDING_CONFIGURATION_ARN: recordingConfiguration.attrArn,
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
      environment: {
        TABLE_NAME: this.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
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

    // Wire Lambda targets to EventBridge rules (DLQ catches delivery failures)
    this.recordingStartRule.addTarget(new targets.LambdaFunction(recordingStartedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));
    this.recordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

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
    stageRecordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

    // Explicit EventBridge → Lambda invoke permissions (belt-and-suspenders over CDK auto-grant)
    // Guards against CloudFormation state drift from the RecordingEndRule → RecordingEndRuleV2 rename.
    recordingEndedFn.addPermission('AllowEBRecordingEndInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: this.recordingEndRule.ruleArn,
    });
    recordingEndedFn.addPermission('AllowEBStageRecordingEndInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: stageRecordingEndRule.ruleArn,
    });
    recordingStartedFn.addPermission('AllowEBRecordingStartInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: this.recordingStartRule.ruleArn,
    });

    // Explicit SQS SendMessage grant so EventBridge can write delivery failures to the DLQ.
    // CDK's targets.LambdaFunction does not auto-grant this when deadLetterQueue is set on the target.
    recordingEventsDlq.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('events.amazonaws.com')],
      actions: ['sqs:SendMessage'],
      resources: [recordingEventsDlq.queueArn],
      conditions: {
        ArnLike: {
          'aws:SourceArn': [
            this.recordingStartRule.ruleArn,
            this.recordingEndRule.ruleArn,
            stageRecordingEndRule.ruleArn,
          ],
        },
      },
    }));

    // Update recording-ended function with CloudFront domain
    recordingEndedFn.addEnvironment('CLOUDFRONT_DOMAIN', distribution.distributionDomainName);

    // Grant S3 read access to Lambda functions for recording metadata
    recordingsBucket.grantRead(streamStartedFn);
    recordingsBucket.grantRead(recordingEndedFn);
    recordingsBucket.grantRead(recordingStartedFn);

    // ============================================================
    // AI Summary Pipeline (Phase 20)
    // Triggered when transcript is stored, invokes Bedrock Claude to generate summaries
    // ============================================================

    // Lambda function for store-summary (Bedrock invocation)
    const storeSummaryFn = new nodejs.NodejsFunction(this, 'StoreSummary', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/store-summary.ts'),
      timeout: Duration.seconds(60), // Critical: Bedrock latency 5-10s + buffer
      environment: {
        TABLE_NAME: this.table.tableName,
        BEDROCK_REGION: this.region,
        BEDROCK_MODEL_ID: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB permissions (read for getSession, write for updateSessionAiSummary)
    this.table.grantReadWriteData(storeSummaryFn);

    // Grant Bedrock InvokeModel permission
    storeSummaryFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
        ],
        effect: iam.Effect.ALLOW,
      })
    );

    // EventBridge rule triggered on transcript storage completion (Phase 19)
    const transcriptStoreRule = new events.Rule(this, 'TranscriptStoreRule', {
      eventPattern: {
        source: ['custom.vnl'],
        detailType: ['Transcript Stored'],
      },
      targets: [new targets.LambdaFunction(storeSummaryFn)],
      description: 'Trigger AI summary generation when transcript is stored',
    });

    // Grant EventBridge permission to invoke Lambda
    storeSummaryFn.addPermission('AllowEBTranscriptStoreInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: transcriptStoreRule.ruleArn,
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
  }
}
