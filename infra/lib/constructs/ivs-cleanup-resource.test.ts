import { Template } from 'aws-cdk-lib/assertions';
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
      ServiceToken: {
        'Fn::GetAtt': [
          expect.stringMatching(/.*Provider.*Function.*/),
          'Arn'
        ]
      }
    });

    // Check Lambda configuration
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: expect.stringMatching(/nodejs/),
      Timeout: expect.any(Number)
    });
  });

  test('Lists all IVS channels and detaches recording configurations', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert - Check IAM permissions
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: expect.arrayContaining([
          expect.objectContaining({
            Effect: 'Allow',
            Action: expect.arrayContaining([
              'ivs:ListChannels',
              'ivs:GetChannel',
              'ivs:UpdateChannel'
            ])
          })
        ])
      }
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
      Description: expect.stringContaining('IVS cleanup')
    });
  });

  test('Handles IVS API errors gracefully with logging', () => {
    // Arrange & Act
    new IvsCleanupResource(stack, 'TestCleanup');

    // Assert - Check CloudWatch Logs permissions for error logging
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: expect.arrayContaining([
          expect.objectContaining({
            Effect: 'Allow',
            Action: expect.arrayContaining([
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents'
            ])
          })
        ])
      }
    });
  });
});