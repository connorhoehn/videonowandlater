import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/stacks/auth-stack';
import { MonitoringStack } from '../lib/stacks/monitoring-stack';

const app = new App();

const env = { region: 'us-east-1' };

const authStack = new AuthStack(app, 'VNL-Auth', { env });
new MonitoringStack(app, 'VNL-Monitoring', { env });

// Export authStack for later use when ApiStack is added in Plan 02
export { authStack };
