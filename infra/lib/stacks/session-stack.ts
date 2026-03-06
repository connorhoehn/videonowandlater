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
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
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
  public readonly recordingsBucket!: s3.Bucket;
  public readonly mediaConvertTopic!: sns.Topic;

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
    this.recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      bucketName: `vnl-recordings-${this.stackName.toLowerCase()}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600, // 1 hour in seconds
        },
      ],
    });

    // S3 bucket for transcription pipeline (MediaConvert input/output and Transcribe outputs)
    const transcriptionBucket = new s3.Bucket(this, 'TranscriptionBucket', {
      bucketName: `vnl-transcription-${this.stackName.toLowerCase()}`,
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
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.recordingsBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: recordingsCorsPolicy,
      },
      comment: 'CloudFront distribution for VNL session recordings',
    });

    // Grant CloudFront access to S3 bucket
    this.recordingsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${this.recordingsBucket.bucketArn}/*`],
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
        MIN_PRIVATE_CHANNELS: '5', // Phase 22: Private channels for secure broadcasts
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

    // DLQ resource policy will be updated after transcription pipeline setup

    // Update recording-ended function with CloudFront domain
    recordingEndedFn.addEnvironment('CLOUDFRONT_DOMAIN', distribution.distributionDomainName);

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

    // Grant MediaConvert job role S3 write access to transcription bucket (for MP4 output)
    transcriptionBucket.grantWrite(mediaConvertRole);

    // Grant MediaConvert permissions to recording-ended handler for job submission
    recordingEndedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['mediaconvert:CreateJob'],
      resources: ['*'],
    }));

    // Grant recording-ended handler S3 read access to recordings bucket (for HLS master.m3u8)
    this.recordingsBucket.grantRead(recordingEndedFn);

    // Grant recording-ended handler S3 write access to transcription bucket (MediaConvert outputs MP4 there)
    transcriptionBucket.grantWrite(recordingEndedFn);

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
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
        AWS_ACCOUNT_ID: this.account,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB access to transcode-completed handler
    this.table.grantReadWriteData(transcodeCompletedFn);

    // Grant Transcribe permissions to transcode-completed handler
    transcodeCompletedFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['transcribe:StartTranscriptionJob'],
      resources: ['*'],
    }));

    // Grant S3 read access to transcription bucket (for MP4 files from MediaConvert)
    transcriptionBucket.grantRead(transcodeCompletedFn);

    // Add EventBridge target
    transcodeCompletedRule.addTarget(new targets.LambdaFunction(transcodeCompletedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

    // Add Lambda permission for EventBridge invocation
    transcodeCompletedFn.addPermission('AllowEBTranscodeCompletedInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: transcodeCompletedRule.ruleArn,
    });

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
      environment: {
        TABLE_NAME: this.table.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucket.bucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB access to transcribe-completed handler
    this.table.grantReadWriteData(transcribeCompletedFn);

    // Grant S3 read access to transcription bucket (for transcript.json fetch)
    transcriptionBucket.grantRead(transcribeCompletedFn);

    // Add EventBridge target
    transcribeCompletedRule.addTarget(new targets.LambdaFunction(transcribeCompletedFn, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

    // Add Lambda permission for EventBridge invocation
    transcribeCompletedFn.addPermission('AllowEBTranscribeCompletedInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: transcribeCompletedRule.ruleArn,
    });

    // Update DLQ resource policy to include transcription pipeline rules
    // Explicit SQS SendMessage grant so EventBridge can write delivery failures to the DLQ
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
            transcodeCompletedRule.ruleArn,
            transcribeCompletedRule.ruleArn,
          ],
        },
      },
    }));

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
      actions: ['mediaconvert:CreateJob'],
      resources: ['*'],
    }));

    // Subscribe start-mediaconvert Lambda to SNS topic
    this.mediaConvertTopic.addSubscription(new sns_subscriptions.LambdaSubscription(startMediaConvertFunction));

    // Lambda function for on-mediaconvert-complete (EventBridge-triggered)
    const onMediaConvertCompleteFunction = new nodejs.NodejsFunction(this, 'OnMediaConvertComplete', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/on-mediaconvert-complete.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: this.table.tableName,
        RECORDINGS_BUCKET: this.recordingsBucket.bucketName,
        EVENT_BUS_NAME: 'default',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    // Grant DynamoDB access to on-mediaconvert-complete
    this.table.grantReadWriteData(onMediaConvertCompleteFunction);

    // Grant EventBridge permissions to publish transcription trigger events (Phase 21 → Phase 19)
    onMediaConvertCompleteFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['arn:aws:events:*:*:event-bus/default'],
    }));

    // EventBridge rule for MediaConvert job state changes (Phase 21)
    const mediaConvertCompleteRule = new events.Rule(this, 'MediaConvertCompleteRule', {
      eventPattern: {
        source: ['aws.mediaconvert'],
        detailType: ['MediaConvert Job State Change'],
        detail: {
          'status': ['COMPLETE', 'ERROR', 'CANCELED'],
        },
      },
      description: 'Handle MediaConvert job completion for upload video encoding',
    });

    mediaConvertCompleteRule.addTarget(new targets.LambdaFunction(onMediaConvertCompleteFunction, {
      deadLetterQueue: recordingEventsDlq,
      retryAttempts: 2,
    }));

    // Grant EventBridge permission to invoke on-mediaconvert-complete
    onMediaConvertCompleteFunction.addPermission('AllowEBMediaConvertCompleteInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: mediaConvertCompleteRule.ruleArn,
    });

    // S3 lifecycle rule for orphaned multipart uploads (clean up after 24 hours)
    this.recordingsBucket.addLifecycleRule({
      id: 'AbortIncompleteMultipartUploads',
      abortIncompleteMultipartUploadAfter: Duration.days(1),
      prefix: 'uploads/',
    });

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
  }
}
