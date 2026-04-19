import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/stacks/auth-stack';
import { AgentStack } from '../lib/stacks/agent-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { ApiExtensionsStack } from '../lib/stacks/api-extensions-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { SessionStack } from '../lib/stacks/session-stack';
import { StorageStack } from '../lib/stacks/storage-stack';
import { WebStack } from '../lib/stacks/web-stack';

const app = new App();

const env = { region: 'us-east-1' };

const authStack = new AuthStack(app, 'VNL-Auth', { env });
const storageStack = new StorageStack(app, 'VNL-Storage', { env });
const sessionStack = new SessionStack(app, 'VNL-Session', {
  env,
  recordingsBucket: storageStack.recordingsBucket,
  transcriptionBucket: storageStack.transcriptionBucket,
  cloudfrontDomainName: storageStack.cloudfrontDomainName,
});
const apiStack = new ApiStack(app, 'VNL-Api', {
  env,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  sessionsTable: sessionStack.table,
  recordingsBucket: storageStack.recordingsBucket,
  mediaConvertTopic: sessionStack.mediaConvertTopic,
  cloudfrontDomainName: storageStack.cloudfrontDomainName,
  webhookQueueUrl: sessionStack.webhookDeliveryQueue.queueUrl,
  webhookQueueArn: sessionStack.webhookDeliveryQueue.queueArn,
  moderationBucket: sessionStack.moderationBucket,
  mediaConvertJobRoleArn: sessionStack.mediaConvertJobRoleArn,
  transcriptionBucket: storageStack.transcriptionBucket,
});

// Phase 1-5 routes live in a sibling stack to stay under the CFN 500-resource
// limit per stack (VNL-Api hit ~1000 after all phases landed).
new ApiExtensionsStack(app, 'VNL-Api-Ext', {
  env,
  restApiId: apiStack.api.restApiId,
  restApiRootResourceId: apiStack.api.restApiRootResourceId,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
  sessionsTable: sessionStack.table,
  recordingsBucket: storageStack.recordingsBucket,
  transcriptionBucket: storageStack.transcriptionBucket,
  mediaConvertJobRoleArn: sessionStack.mediaConvertJobRoleArn,
  transcriptionBucketName: storageStack.transcriptionBucket.bucketName,
});
new AgentStack(app, 'VNL-Agent', {
  env,
  table: sessionStack.table,
});
new MonitoringStack(app, 'VNL-Monitoring', { env });
new WebStack(app, 'VNL-Web', { env });
