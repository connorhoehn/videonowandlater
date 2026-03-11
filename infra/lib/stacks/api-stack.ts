import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  sessionsTable: dynamodb.ITable;
  recordingsBucket?: s3.IBucket;
  mediaConvertTopic?: sns.ITopic;
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

    // Phase 24: Creator Spotlight — list live public sessions
    // IMPORTANT: 'live' must be added BEFORE '{sessionId}' to prevent API Gateway
    // from treating /sessions/live as /sessions/{sessionId} where sessionId="live"
    const liveResource = sessions.addResource('live');
    const listLiveSessionsHandler = new NodejsFunction(this, 'ListLiveSessionsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-live-sessions.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(listLiveSessionsHandler);
    liveResource.addMethod('GET', new apigateway.LambdaIntegration(listLiveSessionsHandler), {
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

    props.sessionsTable.grantReadWriteData(startBroadcastHandler);

    sessionStartResource.addMethod('POST', new apigateway.LambdaIntegration(startBroadcastHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/end
    const sessionEndResource = sessionIdResource.addResource('end');
    const endSessionHandler = new NodejsFunction(this, 'EndSessionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/end-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(endSessionHandler);
    sessionEndResource.addMethod('POST', new apigateway.LambdaIntegration(endSessionHandler), {
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
      new iam.PolicyStatement({
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

    // POST /sessions/{sessionId}/playback-token (generate playback token)
    const playbackTokenResource = sessionIdResource.addResource('playback-token');

    const generatePlaybackTokenHandler = new NodejsFunction(this, 'GeneratePlaybackTokenHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/generate-playback-token.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        IVS_PLAYBACK_PRIVATE_KEY: process.env.IVS_PLAYBACK_PRIVATE_KEY || '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(generatePlaybackTokenHandler);

    playbackTokenResource.addMethod('POST', new apigateway.LambdaIntegration(generatePlaybackTokenHandler), {
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

    // Transcript endpoint
    const sessionTranscriptResource = sessionIdResource.addResource('transcript');

    // GET /sessions/{sessionId}/transcript (get transcript)
    const getTranscriptHandler = new NodejsFunction(this, 'GetTranscriptHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-transcript.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        TRANSCRIPTION_BUCKET: 'vnl-transcription-vnl-session',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getTranscriptHandler);

    // Grant S3 read access to transcription bucket
    getTranscriptHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: ['arn:aws:s3:::vnl-transcription-vnl-session/*'],
      })
    );

    sessionTranscriptResource.addMethod('GET', new apigateway.LambdaIntegration(getTranscriptHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Speaker segments endpoint
    const sessionSpeakerSegmentsResource = sessionIdResource.addResource('speaker-segments');

    // GET /sessions/{sessionId}/speaker-segments (get diarized speaker segments)
    const getSpeakerSegmentsHandler = new NodejsFunction(this, 'GetSpeakerSegmentsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-speaker-segments.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        TRANSCRIPTION_BUCKET: 'vnl-transcription-vnl-session',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getSpeakerSegmentsHandler);

    getSpeakerSegmentsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: ['arn:aws:s3:::vnl-transcription-vnl-session/*'],
      })
    );

    sessionSpeakerSegmentsResource.addMethod('GET', new apigateway.LambdaIntegration(getSpeakerSegmentsHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Phase 28: Chat Moderation — bounce and report endpoints

    // POST /sessions/{sessionId}/bounce (disconnect user from chat + record BOUNCE)
    const bounceResource = sessionIdResource.addResource('bounce');
    const bounceUserHandler = new NodejsFunction(this, 'BounceUserHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/bounce-user.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(bounceUserHandler);
    bounceUserHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:DisconnectUser'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    bounceResource.addMethod('POST', new apigateway.LambdaIntegration(bounceUserHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/report (record a message report for any authenticated user)
    const reportResource = sessionIdResource.addResource('report');
    const reportMessageHandler = new NodejsFunction(this, 'ReportMessageHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/report-message.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(reportMessageHandler);
    reportResource.addMethod('POST', new apigateway.LambdaIntegration(reportMessageHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Reaction endpoints
    const sessionReactionsResource = sessionIdResource.addResource('reactions');

    // POST /sessions/{sessionId}/reactions (create reaction)
    const createReactionHandler = new NodejsFunction(this, 'CreateReactionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-reaction.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(createReactionHandler);

    // Grant IVS Chat SendEvent permission for live reaction broadcasting
    createReactionHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent'],
        resources: ['arn:aws:ivschat:*:*:room/*'],
      })
    );

    sessionReactionsResource.addMethod('POST', new apigateway.LambdaIntegration(createReactionHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/reactions (get reactions)
    const getReactionsHandler = new NodejsFunction(this, 'GetReactionsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-reactions.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getReactionsHandler);

    sessionReactionsResource.addMethod('GET', new apigateway.LambdaIntegration(getReactionsHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Phase 30: Upload Video Player Social — comment endpoints
    const commentsResource = sessionIdResource.addResource('comments');

    const createCommentHandler = new NodejsFunction(this, 'CreateCommentHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-comment.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(createCommentHandler);
    commentsResource.addMethod('POST', new apigateway.LambdaIntegration(createCommentHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const getCommentsHandler = new NodejsFunction(this, 'GetCommentsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-comments.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getCommentsHandler);
    commentsResource.addMethod('GET', new apigateway.LambdaIntegration(getCommentsHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/join (join hangout - generate participant token)
    const joinHangoutResource = sessionIdResource.addResource('join');

    const joinHangoutHandler = new NodejsFunction(this, 'JoinHangoutHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/join-hangout.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(joinHangoutHandler);

    // Grant IVS RealTime CreateParticipantToken permission
    joinHangoutHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:CreateParticipantToken'],
        resources: ['*'], // IVS doesn't support resource-level permissions for CreateParticipantToken
      })
    );

    joinHangoutResource.addMethod('POST', new apigateway.LambdaIntegration(joinHangoutHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Phase 24: Creator Spotlight — set/clear featured creator
    const spotlightResource = sessionIdResource.addResource('spotlight');
    const updateSpotlightHandler = new NodejsFunction(this, 'UpdateSpotlightHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/update-spotlight.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(updateSpotlightHandler);
    spotlightResource.addMethod('PUT', new apigateway.LambdaIntegration(updateSpotlightHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /recordings (list recently recorded sessions) - public endpoint
    const recordings = api.root.addResource('recordings');

    const listRecordingsHandler = new NodejsFunction(this, 'ListRecordingsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-recordings.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(listRecordingsHandler);

    // No authorizer - public endpoint for discovery
    recordings.addMethod('GET', new apigateway.LambdaIntegration(listRecordingsHandler));

    // GET /activity (list recent activity - broadcasts and hangouts) - public endpoint
    const activity = api.root.addResource('activity');

    const listActivityHandler = new NodejsFunction(this, 'ListActivityHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-activity.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(listActivityHandler);

    // No authorizer - public endpoint for activity feed discovery
    activity.addMethod('GET', new apigateway.LambdaIntegration(listActivityHandler));

    // Phase 21: Upload handlers - wire upload endpoints
    const uploadResource = api.root.addResource('upload', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // POST /upload/init
    const initUploadFunction = new NodejsFunction(this, 'InitUploadFunction', {
      entry: path.join(__dirname, '../../../backend/src/handlers/init-upload.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        RECORDINGS_BUCKET: props.recordingsBucket?.bucketName || '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    if (props.recordingsBucket) {
      props.recordingsBucket.grantReadWrite(initUploadFunction);
    }
    props.sessionsTable.grantReadWriteData(initUploadFunction);

    const uploadInitResource = uploadResource.addResource('init', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    uploadInitResource.addMethod('POST', new apigateway.LambdaIntegration(initUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /upload/part-url
    const getPartPresignedUrlFunction = new NodejsFunction(this, 'GetPartPresignedUrlFunction', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-part-presigned-url.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        RECORDINGS_BUCKET: props.recordingsBucket?.bucketName || '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    if (props.recordingsBucket) {
      props.recordingsBucket.grantReadWrite(getPartPresignedUrlFunction);
    }
    props.sessionsTable.grantReadWriteData(getPartPresignedUrlFunction);

    const uploadPartUrlResource = uploadResource.addResource('part-url', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    uploadPartUrlResource.addMethod('POST', new apigateway.LambdaIntegration(getPartPresignedUrlFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /upload/complete
    const completeUploadFunction = new NodejsFunction(this, 'CompleteUploadFunction', {
      entry: path.join(__dirname, '../../../backend/src/handlers/complete-upload.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        RECORDINGS_BUCKET: props.recordingsBucket?.bucketName || '',
        MEDIACONVERT_TOPIC_ARN: props.mediaConvertTopic?.topicArn || '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    if (props.recordingsBucket) {
      props.recordingsBucket.grantReadWrite(completeUploadFunction);
    }
    props.sessionsTable.grantReadWriteData(completeUploadFunction);

    if (props.mediaConvertTopic) {
      props.mediaConvertTopic.grantPublish(completeUploadFunction);
    }

    const uploadCompleteResource = uploadResource.addResource('complete', {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    uploadCompleteResource.addMethod('POST', new apigateway.LambdaIntegration(completeUploadFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Phase 21: Export upload endpoint URLs
    new CfnOutput(this, 'UploadInitUrl', {
      value: `${api.url}upload/init`,
      description: 'Upload initialization endpoint - POST to start multipart upload',
    });

    new CfnOutput(this, 'UploadPartUrlEndpoint', {
      value: `${api.url}upload/part-url`,
      description: 'Presigned URL request endpoint - GET presigned URLs for upload parts',
    });

    new CfnOutput(this, 'UploadCompleteUrl', {
      value: `${api.url}upload/complete`,
      description: 'Upload completion endpoint - POST to finalize upload and start MediaConvert',
    });

    // Phase 22: Wire IVS_PLAYBACK_PRIVATE_KEY to handlers that need it
    // This is read from environment variable during CDK synthesis
    const ivsPlaybackPrivateKey = process.env.IVS_PLAYBACK_PRIVATE_KEY || '';

    // Export private key availability status
    if (ivsPlaybackPrivateKey) {
      new CfnOutput(this, 'IvsPlaybackPrivateKeyConfigured', {
        value: 'true',
        description: 'IVS playback private key is configured for JWT token generation',
      });
    }

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}
