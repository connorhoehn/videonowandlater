import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Auto-confirm Lambda: confirms users on signup (no email verification required)
    const autoConfirmFn = new nodejs.NodejsFunction(this, 'AutoConfirmUser', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambdas/auto-confirm-user.ts'),
      timeout: Duration.seconds(10),
    });

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'vnl-user-pool',
      selfSignUpEnabled: true,
      signInAliases: { username: true },
      signInCaseSensitive: false,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      lambdaTriggers: {
        preSignUp: autoConfirmFn,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // Admin group for platform administrators
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'admin',
      description: 'Platform administrators with moderation rights',
      precedence: 1,
    });

    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'VNL-UserPoolId',
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      exportName: 'VNL-UserPoolClientId',
    });

    new CfnOutput(this, 'CognitoRegion', {
      value: this.region,
      exportName: 'VNL-CognitoRegion',
    });
  }
}
