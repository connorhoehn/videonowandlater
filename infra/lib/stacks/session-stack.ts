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

    new CfnOutput(this, 'SessionTableName', {
      value: this.table.tableName,
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
    new events.Rule(this, 'StreamStartRule', {
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

    // EventBridge rule for IVS Recording End events
    new events.Rule(this, 'RecordingEndRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          recording_status: ['Recording End'],
        },
      },
      targets: [new targets.LambdaFunction(recordingEndedFn)],
      description: 'Transition session to ENDED and release pool resources when recording ends',
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

    // CloudFront Origin Access Control for S3
    const oac = new cloudfront.CfnOriginAccessControl(this, 'RecordingsOAC', {
      originAccessControlConfig: {
        name: 'vnl-recordings-oac',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    // CloudFront distribution for secure recording playback
    const distribution = new cloudfront.Distribution(this, 'RecordingsDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(recordingsBucket, {
          originAccessControlId: oac.attrId,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
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

    // EventBridge rules for recording lifecycle (targets will be added in Plan 05-02)
    this.recordingStartRule = new events.Rule(this, 'RecordingStartRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          event_name: ['Recording Start'],
        },
      },
      description: 'Capture recording start events from IVS',
    });

    this.recordingEndRule = new events.Rule(this, 'RecordingEndRuleV2', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          event_name: ['Recording End'],
        },
      },
      description: 'Capture recording end events from IVS',
    });

    // Grant S3 read access to existing Lambda functions for recording metadata
    recordingsBucket.grantRead(streamStartedFn);
    recordingsBucket.grantRead(recordingEndedFn);
  }
}
