import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/stacks/auth-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';
import { SessionStack } from '../lib/stacks/session-stack';

const app = new App();

const env = { region: 'us-east-1' };

const authStack = new AuthStack(app, 'VNL-Auth', { env });
new ApiStack(app, 'VNL-Api', {
  env,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});
new MonitoringStack(app, 'VNL-Monitoring', { env });
new SessionStack(app, 'VNL-Session', { env });
