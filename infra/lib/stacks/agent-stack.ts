import { Stack, StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

interface AgentStackProps extends StackProps {
  table: dynamodb.ITable;
}

export class AgentStack extends Stack {
  constructor(scope: Construct, id: string, props: AgentStackProps) {
    super(scope, id, props);

    // SQS queue for agent task triggers
    const agentTaskDlq = new sqs.Queue(this, 'AgentTaskDlq', {
      queueName: 'vnl-agent-task-dlq',
      retentionPeriod: Duration.days(14),
    });

    const agentTaskQueue = new sqs.Queue(this, 'AgentTaskQueue', {
      queueName: 'vnl-agent-task',
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: agentTaskDlq, maxReceiveCount: 2 },
    });

    // VPC — public subnet only, no NAT gateway (saves ~$32/mo)
    const vpc = new ec2.Vpc(this, 'AgentVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
      ],
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'AgentCluster', {
      clusterName: 'vnl-agent-cluster',
      vpc,
    });

    // ECR Repository
    const agentRepo = new ecr.Repository(this, 'AgentRepo', {
      repositoryName: 'vnl-ai-agent',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'AgentTaskDef', {
      cpu: 256,           // 0.25 vCPU
      memoryLimitMiB: 512, // 0.5 GB
      family: 'vnl-ai-agent',
    });

    taskDef.addContainer('ai-agent', {
      image: ecs.ContainerImage.fromEcrRepository(agentRepo),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'ai-agent',
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      essential: true,
    });

    // Task Role permissions
    props.table.grantReadWriteData(taskDef.taskRole);

    taskDef.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'ivs:CreateParticipantToken',
        'ivschat:SendEvent',
        'polly:SynthesizeSpeech',
        'transcribe:StartStreamTranscription',
        'bedrock:InvokeModel',
      ],
      resources: ['*'],
    }));

    // Lambda: task launcher (SQS → ECS RunTask)
    const launcherFn = new nodejs.NodejsFunction(this, 'AgentTaskLauncher', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/agent-task-launcher.ts'),
      timeout: Duration.seconds(30),
      environment: {
        ECS_CLUSTER_ARN: cluster.clusterArn,
        AGENT_TASK_DEF_ARN: taskDef.taskDefinitionArn,
        SUBNET_IDS: vpc.publicSubnets.map(s => s.subnetId).join(','),
        TABLE_NAME: props.table.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    launcherFn.addEventSource(new SqsEventSource(agentTaskQueue));

    props.table.grantReadWriteData(launcherFn);

    launcherFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecs:RunTask'],
      resources: [taskDef.taskDefinitionArn],
    }));

    launcherFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [
        taskDef.taskRole.roleArn,
        taskDef.executionRole!.roleArn,
      ],
    }));
  }
}
