import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
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
  cloudfrontDomainName?: string;
  webhookQueueUrl?: string;
  webhookQueueArn?: string;
  // Phase 4: Image Moderation
  moderationBucket?: s3.IBucket;
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
    const transcriptionBucketName = 'vnl-transcription-vnl-session';
    const getTranscriptHandler = new NodejsFunction(this, 'GetTranscriptHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-transcript.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getTranscriptHandler);

    // Grant S3 read access to transcription bucket
    getTranscriptHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${transcriptionBucketName}/*`],
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
        TRANSCRIPTION_BUCKET: transcriptionBucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(getSpeakerSegmentsHandler);

    getSpeakerSegmentsHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${transcriptionBucketName}/*`],
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

    // POST /sessions/{sessionId}/appeal — submit appeal for a killed session
    const appealResource = sessionIdResource.addResource('appeal');
    const submitAppealHandler = new NodejsFunction(this, 'SubmitAppealHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/submit-appeal.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(submitAppealHandler);
    appealResource.addMethod('POST', new apigateway.LambdaIntegration(submitAppealHandler), {
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

    // POST /sessions/{sessionId}/moderation-frame (client-side hangout moderation)
    const moderationFrameResource = sessionIdResource.addResource('moderation-frame');
    const receiveModerationFrameHandler = new NodejsFunction(this, 'ReceiveModerationFrameHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/receive-moderation-frame.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(receiveModerationFrameHandler);
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectModerationLabels'],
      resources: ['*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:StopStream'],
      resources: ['*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['*'],
    }));
    moderationFrameResource.addMethod('POST', new apigateway.LambdaIntegration(receiveModerationFrameHandler), {
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

    // ============================================================
    // Context Events API Routes
    // ============================================================
    const contextResource = sessionIdResource.addResource('context');

    // POST /sessions/{sessionId}/context (push context event)
    const pushContextEventHandler = new NodejsFunction(this, 'PushContextEventHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/push-context-event.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(pushContextEventHandler);
    contextResource.addMethod('POST', new apigateway.LambdaIntegration(pushContextEventHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/context (get context events)
    const getContextEventsHandler = new NodejsFunction(this, 'GetContextEventsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-context-events.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getContextEventsHandler);
    contextResource.addMethod('GET', new apigateway.LambdaIntegration(getContextEventsHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Intent Flow API Routes
    // ============================================================
    const intentFlowResource = sessionIdResource.addResource('intent-flow');

    // POST /sessions/{sessionId}/intent-flow (create intent flow)
    const createIntentFlowHandler = new NodejsFunction(this, 'CreateIntentFlowHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-intent-flow.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(createIntentFlowHandler);
    intentFlowResource.addMethod('POST', new apigateway.LambdaIntegration(createIntentFlowHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/intent-flow (get intent flow + results)
    const getIntentFlowHandler = new NodejsFunction(this, 'GetIntentFlowHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-intent-flow.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getIntentFlowHandler);
    intentFlowResource.addMethod('GET', new apigateway.LambdaIntegration(getIntentFlowHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Timeline API Route
    // ============================================================
    const timelineResource = sessionIdResource.addResource('timeline');

    const getTimelineHandler = new NodejsFunction(this, 'GetTimelineHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-timeline.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getTimelineHandler);
    getTimelineHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${transcriptionBucketName}/*`],
      })
    );
    timelineResource.addMethod('GET', new apigateway.LambdaIntegration(getTimelineHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Agent Control API Routes
    // ============================================================
    const agentResource = sessionIdResource.addResource('agent');

    // POST /sessions/{sessionId}/agent/join
    const agentJoinResource = agentResource.addResource('join');
    const agentJoinSessionHandler = new NodejsFunction(this, 'AgentJoinSessionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/agent-join-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(agentJoinSessionHandler);
    agentJoinResource.addMethod('POST', new apigateway.LambdaIntegration(agentJoinSessionHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/agent/speak
    const agentSpeakResource = agentResource.addResource('speak');
    const agentSpeakHandler = new NodejsFunction(this, 'AgentSpeakHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/agent-speak.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(agentSpeakHandler);
    agentSpeakResource.addMethod('POST', new apigateway.LambdaIntegration(agentSpeakHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/agent/status
    const agentStatusResource = agentResource.addResource('status');
    const agentStatusHandler = new NodejsFunction(this, 'AgentStatusHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/agent-status.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(agentStatusHandler);
    agentStatusResource.addMethod('GET', new apigateway.LambdaIntegration(agentStatusHandler), {
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

    // ============================================================
    // Stories API Routes
    // ============================================================

    const stories = api.root.addResource('stories');

    // POST /stories — create a new story session
    const createStoryHandler = new NodejsFunction(this, 'CreateStoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-story-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(createStoryHandler);
    stories.addMethod('POST', new apigateway.LambdaIntegration(createStoryHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /stories — get stories feed
    const getStoriesFeedHandler = new NodejsFunction(this, 'GetStoriesFeedHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-stories-feed.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getStoriesFeedHandler);
    stories.addMethod('GET', new apigateway.LambdaIntegration(getStoriesFeedHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const storyIdResource = stories.addResource('{sessionId}');

    // POST /stories/{sessionId}/segments — add segment with presigned upload URL
    const storyBucketName = props.recordingsBucket?.bucketName ?? 'vnl-transcription-vnl-session';
    const addStorySegmentHandler = new NodejsFunction(this, 'AddStorySegmentHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/add-story-segment.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        STORY_BUCKET: storyBucketName,
        CLOUDFRONT_DOMAIN: props.cloudfrontDomainName ?? '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(addStorySegmentHandler);
    // S3 write access for presigned URLs
    if (props.recordingsBucket) {
      props.recordingsBucket.grantPut(addStorySegmentHandler, 'stories/*');
    } else {
      addStorySegmentHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`arn:aws:s3:::${storyBucketName}/stories/*`],
      }));
    }
    const segmentsResource = storyIdResource.addResource('segments');
    segmentsResource.addMethod('POST', new apigateway.LambdaIntegration(addStorySegmentHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /stories/{sessionId}/publish — publish story
    const publishStoryHandler = new NodejsFunction(this, 'PublishStoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/publish-story.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        CLOUDFRONT_DOMAIN: props.cloudfrontDomainName ?? '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(publishStoryHandler);
    const publishResource = storyIdResource.addResource('publish');
    publishResource.addMethod('POST', new apigateway.LambdaIntegration(publishStoryHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /stories/{sessionId}/view — mark story as viewed
    const viewStoryHandler = new NodejsFunction(this, 'ViewStoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/view-story.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(viewStoryHandler);
    const viewResource = storyIdResource.addResource('view');
    viewResource.addMethod('POST', new apigateway.LambdaIntegration(viewStoryHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /stories/{sessionId}/react — react to story
    const reactToStoryHandler = new NodejsFunction(this, 'ReactToStoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/react-to-story.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(reactToStoryHandler);
    const reactResource = storyIdResource.addResource('react');
    reactResource.addMethod('POST', new apigateway.LambdaIntegration(reactToStoryHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /stories/{sessionId}/reply — reply to story
    const replyToStoryHandler = new NodejsFunction(this, 'ReplyToStoryHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/reply-to-story.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(replyToStoryHandler);
    const replyResource = storyIdResource.addResource('reply');
    replyResource.addMethod('POST', new apigateway.LambdaIntegration(replyToStoryHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /stories/{sessionId}/viewers — get story viewers (owner only)
    const getStoryViewersHandler = new NodejsFunction(this, 'GetStoryViewersHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-story-viewers.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getStoryViewersHandler);
    const viewersResource = storyIdResource.addResource('viewers');
    viewersResource.addMethod('GET', new apigateway.LambdaIntegration(getStoryViewersHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /stories/{sessionId}/replies — get story replies (owner only)
    const getStoryRepliesHandler = new NodejsFunction(this, 'GetStoryRepliesHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-story-replies.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getStoryRepliesHandler);
    const repliesResource = storyIdResource.addResource('replies');
    repliesResource.addMethod('GET', new apigateway.LambdaIntegration(getStoryRepliesHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /stories/{sessionId}/reactions — get story reactions (owner only)
    const getStoryReactionsHandler = new NodejsFunction(this, 'GetStoryReactionsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-story-reactions.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getStoryReactionsHandler);
    const storyReactionsResource = storyIdResource.addResource('reactions');
    storyReactionsResource.addMethod('GET', new apigateway.LambdaIntegration(getStoryReactionsHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Admin API Routes
    // ============================================================

    const admin = api.root.addResource('admin');
    const adminSessions = admin.addResource('sessions');
    const adminSessionById = adminSessions.addResource('{sessionId}');
    const killResource = adminSessionById.addResource('kill');

    const adminKillSessionFn = new NodejsFunction(this, 'AdminKillSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-kill-session.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(adminKillSessionFn);

    adminKillSessionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:StopStream'],
        resources: ['*'],
      })
    );

    adminKillSessionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:DisconnectParticipant'],
        resources: ['*'],
      })
    );

    adminKillSessionFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent'],
        resources: ['*'],
      })
    );

    killResource.addMethod('POST', new apigateway.LambdaIntegration(adminKillSessionFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/sessions/{sessionId}/pin — pin or unpin a session
    const pinResource = adminSessionById.addResource('pin');

    const adminPinSessionFn = new NodejsFunction(this, 'AdminPinSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-pin-session.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(adminPinSessionFn);

    pinResource.addMethod('POST', new apigateway.LambdaIntegration(adminPinSessionFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sessions/{sessionId}/detail — comprehensive session data
    const detailResource = adminSessionById.addResource('detail');

    const adminGetSessionDetailFn = new NodejsFunction(this, 'AdminGetSessionDetail', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-session-detail.ts'),
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadData(adminGetSessionDetailFn);

    detailResource.addMethod('GET', new apigateway.LambdaIntegration(adminGetSessionDetailFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Session Events + Webhook API Routes
    // ============================================================

    // POST /sessions/{sessionId}/events — emit client event
    const eventsResource = sessionIdResource.addResource('events');
    const emitClientEventHandler = new NodejsFunction(this, 'EmitClientEventHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/emit-client-event.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        ...(props.webhookQueueUrl && { WEBHOOK_QUEUE_URL: props.webhookQueueUrl }),
        EVENT_BUS_NAME: 'default',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(emitClientEventHandler);
    if (props.webhookQueueArn) {
      emitClientEventHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [props.webhookQueueArn],
      }));
    }
    emitClientEventHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));
    eventsResource.addMethod('POST', new apigateway.LambdaIntegration(emitClientEventHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PATCH /sessions/{sessionId}/webhook — configure webhook
    const webhookResource = sessionIdResource.addResource('webhook');
    const configureWebhookHandler = new NodejsFunction(this, 'ConfigureWebhookHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/configure-webhook.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
        ...(props.webhookQueueUrl && { WEBHOOK_QUEUE_URL: props.webhookQueueUrl }),
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(configureWebhookHandler);
    if (props.webhookQueueArn) {
      configureWebhookHandler.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [props.webhookQueueArn],
      }));
    }
    webhookResource.addMethod('PATCH', new apigateway.LambdaIntegration(configureWebhookHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // Add webhook + EventBridge env vars to API Lambdas
    // ============================================================
    const apiLambdasForWebhook = [
      createSessionHandler,
      endSessionHandler,
      joinHangoutHandler,
      adminKillSessionFn,
      pushContextEventHandler,
      agentJoinSessionHandler,
    ];

    for (const fn of apiLambdasForWebhook) {
      if (props.webhookQueueUrl) {
        fn.addEnvironment('WEBHOOK_QUEUE_URL', props.webhookQueueUrl);
      }
      fn.addEnvironment('EVENT_BUS_NAME', 'default');
      if (props.webhookQueueArn) {
        fn.addToRolePolicy(new iam.PolicyStatement({
          actions: ['sqs:SendMessage'],
          resources: [props.webhookQueueArn],
        }));
      }
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
      }));
    }

    // POST /admin/moderation/{sessionId}/review — review moderation flag
    const adminModeration = admin.addResource('moderation');
    const adminModerationSession = adminModeration.addResource('{sessionId}');
    const reviewResource = adminModerationSession.addResource('review');

    const adminReviewModerationFn = new NodejsFunction(this, 'AdminReviewModeration', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-review-moderation.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });

    props.sessionsTable.grantReadWriteData(adminReviewModerationFn);

    adminReviewModerationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:StopStream'],
        resources: ['*'],
      })
    );

    adminReviewModerationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:DisconnectParticipant'],
        resources: ['*'],
      })
    );

    adminReviewModerationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent'],
        resources: ['*'],
      })
    );

    reviewResource.addMethod('POST', new apigateway.LambdaIntegration(adminReviewModerationFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sessions — list active sessions
    const adminListSessionsFn = new NodejsFunction(this, 'AdminListSessions', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-sessions.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminListSessionsFn);

    adminSessions.addMethod('GET', new apigateway.LambdaIntegration(adminListSessionsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/audit-log — recent moderation actions
    const adminAuditLog = admin.addResource('audit-log');
    const adminAuditLogFn = new NodejsFunction(this, 'AdminAuditLog', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-audit-log.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminAuditLogFn);

    adminAuditLog.addMethod('GET', new apigateway.LambdaIntegration(adminAuditLogFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/appeals/{sessionId}/review — review an appeal
    const adminAppeals = admin.addResource('appeals');
    const adminAppealSession = adminAppeals.addResource('{sessionId}');
    const appealReviewResource = adminAppealSession.addResource('review');

    const adminReviewAppealFn = new NodejsFunction(this, 'AdminReviewAppeal', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-review-appeal.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminReviewAppealFn);

    appealReviewResource.addMethod('POST', new apigateway.LambdaIntegration(adminReviewAppealFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/costs/summary — aggregate cost data
    const adminCosts = admin.addResource('costs');
    const adminCostsSummary = adminCosts.addResource('summary');
    const adminCostSummaryFn = new NodejsFunction(this, 'AdminCostSummary', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-cost-summary.ts'),
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminCostSummaryFn);

    adminCostsSummary.addMethod('GET', new apigateway.LambdaIntegration(adminCostSummaryFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/costs/session/{sessionId} — session cost detail
    const adminCostsSession = adminCosts.addResource('session');
    const adminCostsSessionById = adminCostsSession.addResource('{sessionId}');
    const adminGetSessionCostFn = new NodejsFunction(this, 'AdminGetSessionCost', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-session-cost.ts'),
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminGetSessionCostFn);
    adminCostsSessionById.addMethod('GET', new apigateway.LambdaIntegration(adminGetSessionCostFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/costs/user/{userId} — per-user cost detail
    const adminCostsUser = adminCosts.addResource('user');
    const adminCostsUserById = adminCostsUser.addResource('{userId}');
    const adminGetUserCostsFn = new NodejsFunction(this, 'AdminGetUserCosts', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-user-costs.ts'),
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminGetUserCostsFn);
    adminCostsUserById.addMethod('GET', new apigateway.LambdaIntegration(adminGetUserCostsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // === Phase 1: Groups ===
    // User-created groups + RBAC. All routes use the existing Cognito authorizer.
    const groupsResource = api.root.addResource('groups');
    const groupsMineResource = groupsResource.addResource('mine');
    const groupByIdResource = groupsResource.addResource('{groupId}');
    const groupMembersResource = groupByIdResource.addResource('members');
    const groupMemberByIdResource = groupMembersResource.addResource('{userId}');

    const phase1GroupsEnv = {
      TABLE_NAME: props.sessionsTable.tableName,
      USER_POOL_ID: props.userPool.userPoolId,
      USER_POOL_CLIENT_ID: props.userPoolClient.userPoolClientId,
    };

    const groupCreateFn = new NodejsFunction(this, 'GroupCreate', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-create.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupCreateFn);
    groupsResource.addMethod('POST', new apigateway.LambdaIntegration(groupCreateFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupListMineFn = new NodejsFunction(this, 'GroupListMine', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-list-mine.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(groupListMineFn);
    groupsMineResource.addMethod('GET', new apigateway.LambdaIntegration(groupListMineFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupGetFn = new NodejsFunction(this, 'GroupGet', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-get.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(groupGetFn);
    groupByIdResource.addMethod('GET', new apigateway.LambdaIntegration(groupGetFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupUpdateFn = new NodejsFunction(this, 'GroupUpdate', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-update.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupUpdateFn);
    groupByIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(groupUpdateFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupDeleteFn = new NodejsFunction(this, 'GroupDelete', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-delete.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupDeleteFn);
    groupByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(groupDeleteFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupAddMemberFn = new NodejsFunction(this, 'GroupAddMember', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-add-member.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupAddMemberFn);
    groupMembersResource.addMethod('POST', new apigateway.LambdaIntegration(groupAddMemberFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupRemoveMemberFn = new NodejsFunction(this, 'GroupRemoveMember', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-remove-member.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupRemoveMemberFn);
    groupMemberByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(groupRemoveMemberFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const groupPromoteMemberFn = new NodejsFunction(this, 'GroupPromoteMember', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-promote-member.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(groupPromoteMemberFn);
    groupMemberByIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(groupPromoteMemberFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // === Phase 3: Ban Management ===
    //
    // Global (cross-session) chat bans. The existing per-session BOUNCE
    // endpoints remain — these routes extend the system with admin-issued
    // bans that block token issuance on ALL sessions.
    const adminBans = admin.addResource('bans');
    const adminBanByUser = adminBans.addResource('{userId}');

    // POST /admin/bans — create a global ban
    const adminCreateGlobalBanFn = new NodejsFunction(this, 'AdminCreateGlobalBan', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-create-global-ban.ts'),
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminCreateGlobalBanFn);
    adminCreateGlobalBanFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent', 'ivschat:DisconnectUser'],
        resources: ['*'],
      }),
    );
    adminBans.addMethod('POST', new apigateway.LambdaIntegration(adminCreateGlobalBanFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/bans — list all active global bans
    const adminListGlobalBansFn = new NodejsFunction(this, 'AdminListGlobalBans', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-global-bans.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminListGlobalBansFn);
    adminBans.addMethod('GET', new apigateway.LambdaIntegration(adminListGlobalBansFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /admin/bans/{userId} — lift a user's global ban
    const adminLiftGlobalBanFn = new NodejsFunction(this, 'AdminLiftGlobalBan', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-lift-global-ban.ts'),
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: props.sessionsTable.tableName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminLiftGlobalBanFn);
    adminBanByUser.addMethod('DELETE', new apigateway.LambdaIntegration(adminLiftGlobalBanFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Phase 2: Lobbies ===
    // Host-approval flow for HANGOUT sessions with requireApproval=true.
    // ============================================================
    const lobbyResource = sessionIdResource.addResource('lobby');

    // GET /sessions/{sessionId}/lobby — list pending lobby requests (host only)
    const listLobbyRequestsFn = new NodejsFunction(this, 'ListLobbyRequestsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-lobby-requests.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(listLobbyRequestsFn);
    lobbyResource.addMethod('GET', new apigateway.LambdaIntegration(listLobbyRequestsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const lobbyUserResource = lobbyResource.addResource('{userId}');

    // POST /sessions/{sessionId}/lobby/{userId}/approve
    const approveLobbyFn = new NodejsFunction(this, 'ApproveLobbyRequestHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/approve-lobby-request.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(approveLobbyFn);
    approveLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:CreateParticipantToken'],
      resources: ['*'],
    }));
    approveLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    const approveResource = lobbyUserResource.addResource('approve');
    approveResource.addMethod('POST', new apigateway.LambdaIntegration(approveLobbyFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/lobby/{userId}/deny
    const denyLobbyFn = new NodejsFunction(this, 'DenyLobbyRequestHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/deny-lobby-request.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(denyLobbyFn);
    denyLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['*'],
    }));
    denyLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    const denyResource = lobbyUserResource.addResource('deny');
    denyResource.addMethod('POST', new apigateway.LambdaIntegration(denyLobbyFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Grant join-hangout handler the ability to emit chat events (lobby_update)
    joinHangoutHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));

    // ============================================================
    // === Phase 4: Image Moderation ===
    // Admin ruleset CRUD + participant presigned-upload endpoint.
    // ============================================================
    const adminRulesets = admin.addResource('rulesets');
    const adminRulesetByName = adminRulesets.addResource('{name}');
    const adminRulesetRollback = adminRulesetByName.addResource('rollback');
    const adminRulesetTest = adminRulesetByName.addResource('test');

    const defaultRulesetEnv: Record<string, string> = {
      TABLE_NAME: props.sessionsTable.tableName,
      NOVA_MODEL_ID: 'amazon.nova-lite-v1:0',
    };

    // GET /admin/rulesets
    const adminListRulesetsFn = new NodejsFunction(this, 'AdminListRulesets', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-rulesets.ts'),
      timeout: Duration.seconds(15),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminListRulesetsFn);
    adminRulesets.addMethod('GET', new apigateway.LambdaIntegration(adminListRulesetsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/rulesets/{name}
    const adminGetRulesetFn = new NodejsFunction(this, 'AdminGetRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminGetRulesetFn);
    adminRulesetByName.addMethod('GET', new apigateway.LambdaIntegration(adminGetRulesetFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/rulesets/{name}
    const adminUpsertRulesetFn = new NodejsFunction(this, 'AdminUpsertRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-upsert-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminUpsertRulesetFn);
    adminRulesetByName.addMethod('POST', new apigateway.LambdaIntegration(adminUpsertRulesetFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/rulesets/{name}/rollback
    const adminRollbackRulesetFn = new NodejsFunction(this, 'AdminRollbackRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-rollback-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(adminRollbackRulesetFn);
    adminRulesetRollback.addMethod('POST', new apigateway.LambdaIntegration(adminRollbackRulesetFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/rulesets/{name}/test
    const adminTestRulesetFn = new NodejsFunction(this, 'AdminTestRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-test-ruleset.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(adminTestRulesetFn);
    adminTestRulesetFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
        ],
      }),
    );
    adminRulesetTest.addMethod('POST', new apigateway.LambdaIntegration(adminTestRulesetFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/moderation-upload
    // (Only wired if a moderation bucket has been provisioned.)
    if (props.moderationBucket) {
      const moderationUploadPath = api.root
        .resourceForPath('sessions/{sessionId}/moderation-upload');

      const requestModerationUploadFn = new NodejsFunction(this, 'RequestModerationUpload', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(__dirname, '../../../backend/src/handlers/request-moderation-upload.ts'),
        timeout: Duration.seconds(10),
        environment: {
          TABLE_NAME: props.sessionsTable.tableName,
          MODERATION_BUCKET: props.moderationBucket.bucketName,
        },
        depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      });
      props.sessionsTable.grantReadData(requestModerationUploadFn);
      props.moderationBucket.grantPut(requestModerationUploadFn);

      moderationUploadPath.addMethod('POST', new apigateway.LambdaIntegration(requestModerationUploadFn), {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      });
    }

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}
