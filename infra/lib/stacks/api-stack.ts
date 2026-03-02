import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  sessionsTable: dynamodb.ITable;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
    });

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'vnl-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Health check endpoint (no auth required)
    const health = api.root.addResource('health');
    health.addMethod(
      'GET',
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: {
              'application/json': '{"status":"ok"}',
            },
          },
        ],
        requestTemplates: {
          'application/json': '{"statusCode": 200}',
        },
      }),
      {
        methodResponses: [{ statusCode: '200' }],
      }
    );

    // Protected /me endpoint with Cognito authorizer
    const me = api.root.addResource('me');
    const meHandler = new NodejsFunction(this, 'MeHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/me.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    me.addMethod('GET', new apigateway.LambdaIntegration(meHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Sessions resource
    const sessions = api.root.addResource('sessions');

    // POST /sessions (create session)
    const createSessionHandler = new NodejsFunction(this, 'CreateSessionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(createSessionHandler);

    sessions.addMethod('POST', new apigateway.LambdaIntegration(createSessionHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}
    const sessionIdResource = sessions.addResource('{sessionId}');

    const getSessionHandler = new NodejsFunction(this, 'GetSessionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getSessionHandler);

    sessionIdResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/start (start broadcast)
    const sessionStartResource = sessionIdResource.addResource('start');

    const startBroadcastHandler = new NodejsFunction(this, 'StartBroadcastHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/start-broadcast.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(startBroadcastHandler);

    sessionStartResource.addMethod('POST', new apigateway.LambdaIntegration(startBroadcastHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/playback (get playback URL) - public endpoint
    const sessionPlaybackResource = sessionIdResource.addResource('playback');

    const getPlaybackHandler = new NodejsFunction(this, 'GetPlaybackHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-playback.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getPlaybackHandler);

    // No authorizer - public endpoint for viewers
    sessionPlaybackResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaybackHandler));

    // GET /sessions/{sessionId}/viewers (get viewer count) - public endpoint
    const sessionViewersResource = sessionIdResource.addResource('viewers');

    const getViewerCountHandler = new NodejsFunction(this, 'GetViewerCountHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-viewer-count.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getViewerCountHandler);

    // Grant IVS GetStream permission
    getViewerCountHandler.addToRolePolicy(
      new apigateway.aws_iam.PolicyStatement({
        actions: ['ivs:GetStream'],
        resources: ['*'],
      })
    );

    // No authorizer - public endpoint
    sessionViewersResource.addMethod('GET', new apigateway.LambdaIntegration(getViewerCountHandler));

    // Chat endpoints
    const sessionChatResource = sessionIdResource.addResource('chat');

    // POST /sessions/{sessionId}/chat/token (generate chat token)
    const chatTokenResource = sessionChatResource.addResource('token');

    const createChatTokenHandler = new NodejsFunction(this, 'CreateChatTokenHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-chat-token.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(createChatTokenHandler);

    // Grant IVS Chat CreateChatToken permission
    createChatTokenHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:CreateChatToken'],
        resources: ['arn:aws:ivschat:*:*:room/*'],
      })
    );

    chatTokenResource.addMethod('POST', new apigateway.LambdaIntegration(createChatTokenHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/chat/messages (send message)
    const chatMessagesResource = sessionChatResource.addResource('messages');

    const sendMessageHandler = new NodejsFunction(this, 'SendMessageHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/send-message.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(sendMessageHandler);

    chatMessagesResource.addMethod('POST', new apigateway.LambdaIntegration(sendMessageHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/chat/messages (get chat history)
    const getChatHistoryHandler = new NodejsFunction(this, 'GetChatHistoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-chat-history.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getChatHistoryHandler);

    chatMessagesResource.addMethod('GET', new apigateway.LambdaIntegration(getChatHistoryHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}
