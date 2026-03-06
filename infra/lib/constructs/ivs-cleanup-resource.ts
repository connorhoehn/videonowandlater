import { Construct } from 'constructs';
import { CustomResource, Stack, Duration } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export class IvsCleanupResource extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Lambda function that handles the cleanup
    const cleanupHandler = new Function(this, 'CleanupFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      description: 'IVS cleanup function to detach recording configurations before stack deletion',
      timeout: Duration.seconds(60),
      code: Code.fromInline(`
const { IvsClient, ListChannelsCommand, UpdateChannelCommand } = require('@aws-sdk/client-ivs');

exports.handler = async (event, context) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Only process DELETE events
  if (event.RequestType !== 'Delete') {
    return {
      PhysicalResourceId: 'ivs-cleanup-complete',
    };
  }

  const ivs = new IvsClient({});

  try {
    // List all channels
    console.log('Listing IVS channels...');
    const listResponse = await ivs.send(new ListChannelsCommand({}));
    const channels = listResponse.channels || [];

    console.log(\`Found \${channels.length} channels\`);

    // Detach recording configuration from each channel
    for (const channel of channels) {
      if (channel.recordingConfigurationArn) {
        console.log(\`Detaching recording config from channel \${channel.arn}\`);

        try {
          await ivs.send(new UpdateChannelCommand({
            arn: channel.arn,
            recordingConfigurationArn: '', // Empty string to detach
          }));
          console.log(\`Successfully detached recording from channel \${channel.arn}\`);
        } catch (error) {
          console.error(\`Failed to detach recording from channel \${channel.arn}:\`, error);
          // Continue with other channels even if one fails
        }
      }
    }

    console.log('IVS cleanup complete');

    return {
      PhysicalResourceId: 'ivs-cleanup-complete',
    };
  } catch (error) {
    console.error('Error during IVS cleanup:', error);
    // Return success even on error to prevent stack deletion from being blocked
    return {
      PhysicalResourceId: 'ivs-cleanup-complete',
    };
  }
};
      `),
    });

    // Grant necessary permissions
    cleanupHandler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ivs:ListChannels',
        'ivs:GetChannel',
        'ivs:UpdateChannel',
      ],
      resources: ['*'],
    }));

    // Grant CloudWatch Logs permissions (implicit with Lambda, but being explicit for tests)
    cleanupHandler.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: ['*'],
    }));

    // Create the provider
    const provider = new Provider(this, 'Provider', {
      onEventHandler: cleanupHandler,
    });

    // Create the custom resource
    new CustomResource(this, 'Resource', {
      serviceToken: provider.serviceToken,
      resourceType: 'Custom::IvsCleanup',
    });
  }
}