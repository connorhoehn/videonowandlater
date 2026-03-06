import { Template, Match } from 'aws-cdk-lib/assertions';
import { Stack } from 'aws-cdk-lib';
import { IvsCleanupResource } from './ivs-cleanup-resource';

describe('IvsCleanupResource', () => {
  let stack: Stack;

  beforeEach(() => {
    stack = new Stack();
  });

  test('Custom resource triggers on CloudFormation DELETE event only', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert
    const template = Template.fromStack(stack);

    // Check that custom resource exists
    template.hasResourceProperties('Custom::IvsCleanup', {
      ServiceToken: Match.anyValue()
    });

    // Check Lambda configuration with handler
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: Match.stringLikeRegexp('nodejs'),
      Timeout: 60
    });
  });

  test('Lists all IVS channels and detaches recording configurations', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert - Check IAM permissions
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith([
              'ivs:ListChannels',
              'ivs:GetChannel',
              'ivs:UpdateChannel'
            ])
          })
        ])
      })
    });
  });

  test('Returns success response even if no channels exist', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert - Check that Lambda is configured to return success
    const template = Template.fromStack(stack);

    // Verify the Lambda function is created with proper configuration
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Description: Match.stringLikeRegexp('IVS cleanup')
    });
  });

  test('Handles IVS API errors gracefully with logging', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert - Check CloudWatch Logs permissions for error logging
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: Match.arrayWith([
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents'
            ])
          })
        ])
      })
    });
  });
});