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
import { ApiExtensionsStack } from './api-extensions-stack';

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
  // Clips feature — reuses MediaConvert role + transcription bucket (recording source)
  mediaConvertJobRoleArn?: string;
  transcriptionBucket?: s3.IBucket;
}

export class ApiStack extends Stack {
  /** RestApi exposed so sibling stacks (e.g. ApiExtensionsStack) can attach routes. */
  public readonly api: apigateway.RestApi;
  /** Cognito authorizer exposed so sibling stacks can reuse it. */
  public readonly authorizer: apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [props.userPool],
    });
    this.authorizer = authorizer;

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'vnl-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });
    this.api = api;

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

    // GET /sessions/{sessionId} — migrated to ApiExtensionsStack
    const sessionIdResource = sessions.addResource('{sessionId}');

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
    // NOTE: POST /sessions/{sessionId}/chat/token was migrated to ApiExtensionsStack.
    const sessionChatResource = sessionIdResource.addResource('chat');

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

    // Phase 28: Chat Moderation
    // POST /sessions/{sessionId}/bounce — migrated to ApiExtensionsStack

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

    // POST /sessions/{sessionId}/appeal — migrated to ApiExtensionsStack

    // Live Captions endpoints (opt-in per-session; host-toggleable)
    // /sessions/{sessionId}/captions           POST  — post a caption segment (rebroadcast + persist)
    // /sessions/{sessionId}/captions/toggle    POST  — toggle captionsEnabled at runtime
    // /sessions/{sessionId}/captions/credentials GET — mint short-lived Transcribe creds
    const captionsResource = sessionIdResource.addResource('captions');

    // Environment: IDENTITY_POOL_ID is optional — if unset, the credentials
    // handler degrades gracefully with a `captions_not_configured` response.
    const captionsEnv: Record<string, string> = {
      TABLE_NAME: props.sessionsTable.tableName,
    };
    if (process.env.CAPTIONS_IDENTITY_POOL_ID) {
      captionsEnv.IDENTITY_POOL_ID = process.env.CAPTIONS_IDENTITY_POOL_ID;
    }

    // POST /sessions/{sessionId}/captions — broadcast + persist caption segment
    const postCaptionSegmentHandler = new NodejsFunction(this, 'PostCaptionSegmentHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/post-caption-segment.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(postCaptionSegmentHandler);
    postCaptionSegmentHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    captionsResource.addMethod('POST', new apigateway.LambdaIntegration(postCaptionSegmentHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/captions/toggle — enable/disable live captions
    const captionsToggleResource = captionsResource.addResource('toggle');
    const toggleCaptionsHandler = new NodejsFunction(this, 'ToggleCaptionsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/toggle-captions.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: props.sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadWriteData(toggleCaptionsHandler);
    toggleCaptionsHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    captionsToggleResource.addMethod('POST', new apigateway.LambdaIntegration(toggleCaptionsHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /sessions/{sessionId}/captions/credentials — mint Transcribe STS creds
    const captionsCredentialsResource = captionsResource.addResource('credentials');
    const getCaptionCredentialsHandler = new NodejsFunction(this, 'GetCaptionCredentialsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-caption-credentials.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: captionsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    props.sessionsTable.grantReadData(getCaptionCredentialsHandler);
    captionsCredentialsResource.addMethod('GET', new apigateway.LambdaIntegration(getCaptionCredentialsHandler), {
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
        resources: ['arn:aws:ivs:*:*:stage/*'], // IVS doesn't support resource-level permissions for CreateParticipantToken
      })
    );

    joinHangoutResource.addMethod('POST', new apigateway.LambdaIntegration(joinHangoutHandler), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /sessions/{sessionId}/moderation-frame — migrated to ApiExtensionsStack

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
    // All /admin/* routes now live in ApiExtensionsStack.

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
    // Note: adminKillSessionFn was moved to ApiExtensionsStack — its webhook/
    // EventBridge env + policy are set up there.
    const apiLambdasForWebhook = [
      createSessionHandler,
      endSessionHandler,
      joinHangoutHandler,
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

    // All remaining /admin/* routes (moderation review, sessions list, audit-log,
    // appeals, costs) were migrated to ApiExtensionsStack.

    // === Phase 3: Ban Management === (migrated to ApiExtensionsStack)

    // ============================================================
    // === Phase 2: Lobbies === (migrated to ApiExtensionsStack)
    // ============================================================

    // Grant join-hangout handler the ability to emit chat events (lobby_update)
    // — this stays here because joinHangoutHandler stays in the core stack.
    joinHangoutHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));

    // ============================================================
    // === Phase 4: Image Moderation === (migrated to ApiExtensionsStack)
    // Ruleset admin CRUD + participant presigned-upload endpoint all moved.
    // ============================================================

    // ============================================================
    // The following route groups were migrated to ApiExtensionsStack:
    //   - Phase 1b: Admin Roles (Cognito group management)
    //   - Chat Moderation (classify + admin chat-flags review queue)
    //   - Invitations (/sessions/{id}/invite-group, /invites/*)
    //   - vnl-ads integration (/sessions/{id}/promo/*, /me/earnings, etc.)
    //   - /sessions/mine
    //   - Surveys (/sessions/{id}/survey/*, /admin/surveys, /admin/sessions/{id}/surveys)
    //   - vnl-ads admin mint-token (/admin/ads/mint-token)
    //   - /me/earnings, /me/impression-series, /me/training-due, /me/training-claim
    // All non-core API Gateway routes live in VNL-Api-Ext now. ApiStack keeps
    // the RestApi + core/high-traffic handlers only.
    // ============================================================

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
    });
  }
}
