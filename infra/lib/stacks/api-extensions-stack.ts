/**
 * ApiExtensionsStack — sibling Stack that holds non-core API Gateway routes
 * (Phase 1-5 features PLUS admin / groups / moderation / surveys / invites /
 * lobby / vnl-ads passthroughs / appeals) so the parent ApiStack stays under
 * the 500-resource-per-stack CloudFormation limit.
 *
 * All routes declared here attach to the parent's existing `RestApi` via
 * `api.root.resourceForPath(...)`, which reuses existing path prefixes
 * (e.g. `/sessions/{sessionId}`, `/me`) when present and creates new resources
 * when not. CDK places API Gateway `Method`/`Resource` constructs in the stack
 * that CALLS `addResource`/`addMethod` — so resources added here land in THIS
 * stack's CFN template, not the parent's.
 */

import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiExtensionsStackProps extends StackProps {
  /**
   * RestApi ID + root resource ID from the parent ApiStack. We re-import the
   * RestApi via `fromRestApiAttributes` so CDK places the Methods we create
   * here INSIDE this stack's CFN template (not the parent's). This is how
   * we stay under the 500-resource-per-stack CloudFormation limit.
   */
  restApiId: string;
  restApiRootResourceId: string;
  /** Existing `/sessions` resource ID from ApiStack — import, don't re-create. */
  sessionsResourceId: string;
  /** Existing `/me` resource ID from ApiStack — import, don't re-create. */
  meResourceId: string;
  /** Existing `/sessions/{sessionId}` resource ID from ApiStack — import, don't re-create. */
  sessionIdResourceId: string;
  /** Existing `/sessions/{sessionId}/chat` resource ID from ApiStack — import, don't re-create. */
  sessionChatResourceId: string;
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  sessionsTable: dynamodb.ITable;
  recordingsBucket?: s3.IBucket;
  transcriptionBucket?: s3.IBucket;
  mediaConvertJobRoleArn?: string;
  /** Bucket name — for Phase 4a signed-download URLs. */
  transcriptionBucketName: string;
  /** Phase 4: image-moderation frames bucket (optional; routes degrade if absent). */
  moderationBucket?: s3.IBucket;
}

/**
 * Sibling Stack (not nested) that holds non-core API Gateway routes.
 */
export class ApiExtensionsStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiExtensionsStackProps) {
    super(scope, id, props);

    const {
      restApiId,
      restApiRootResourceId,
      sessionsResourceId,
      meResourceId,
      sessionIdResourceId,
      sessionChatResourceId,
      userPool,
      userPoolClient,
      sessionsTable,
      recordingsBucket,
      transcriptionBucket,
      mediaConvertJobRoleArn,
      transcriptionBucketName,
      moderationBucket,
    } = props;

    // Import the RestApi so CDK knows we're extending an existing gateway.
    // Methods added here land in THIS stack's CFN template, not the parent's.
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'ImportedApi', {
      restApiId,
      rootResourceId: restApiRootResourceId,
    });

    // Authorizer must be re-created in this stack (Cognito authorizer isn't
    // importable across stacks) but uses the same UserPool.
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });

    // CORS preflight propagates DOWN through `addResource()` calls when set as
    // `defaultCorsPreflightOptions` on a parent. The RestApi's own default is
    // NOT inherited by resources we attach here because we imported the API
    // via `fromRestApiAttributes`. So every top-level resource created below
    // (and every direct child of an imported parent like `meResource`,
    // `sessionIdResource`, `sessionChatResource`, `sessionsResource`) must be
    // created with this `defaultCors` options bag — children then inherit.
    const defaultCors: apigateway.ResourceOptions = {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
    };

    // Re-import existing API Gateway resources by ID. `resourceForPath` on an
    // imported RestApi always creates NEW resources — which fails with
    // "AlreadyExists" when the path already exists on the parent stack.
    // So we use `Resource.fromResourceAttributes` to bind to the real resource
    // and call `addResource`/`addMethod` to attach this stack's children.
    const sessionsResource = apigateway.Resource.fromResourceAttributes(this, 'ImportedSessionsResource', {
      resourceId: sessionsResourceId,
      path: '/sessions',
      restApi: api,
    });
    const sessionIdResource = apigateway.Resource.fromResourceAttributes(this, 'ImportedSessionIdResource', {
      resourceId: sessionIdResourceId,
      path: '/sessions/{sessionId}',
      restApi: api,
    });
    const sessionChatResource = apigateway.Resource.fromResourceAttributes(this, 'ImportedSessionChatResource', {
      resourceId: sessionChatResourceId,
      path: '/sessions/{sessionId}/chat',
      restApi: api,
    });
    const meResource = apigateway.Resource.fromResourceAttributes(this, 'ImportedMeResource', {
      resourceId: meResourceId,
      path: '/me',
      restApi: api,
    });

    // `/groups`, `/invites` are OWNED by this stack (removed from api-stack).
    // `/admin` is OWNED by `ApiExtensionsAdminStack` (separate sibling).

    // ============================================================
    // === Phase 1: Profiles, Follow, Notifications ===
    // ============================================================
    const profileEnv = { TABLE_NAME: sessionsTable.tableName };

    const meProfile = meResource.addResource('profile', defaultCors);
    const getMyProfileFn = new NodejsFunction(this, 'GetMyProfile', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-my-profile.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(getMyProfileFn);
    meProfile.addMethod('GET', new apigateway.LambdaIntegration(getMyProfileFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const updateMyProfileFn = new NodejsFunction(this, 'UpdateMyProfile', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/update-my-profile.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(updateMyProfileFn);
    meProfile.addMethod('PATCH', new apigateway.LambdaIntegration(updateMyProfileFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const creatorsResource = api.root.addResource('creators', defaultCors);
    const creatorByHandle = creatorsResource.addResource('{handle}');
    const getPublicProfileFn = new NodejsFunction(this, 'GetPublicProfile', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-public-profile.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getPublicProfileFn);
    creatorByHandle.addMethod('GET', new apigateway.LambdaIntegration(getPublicProfileFn));

    const usersResource = api.root.addResource('users', defaultCors);
    const userById = usersResource.addResource('{userId}');
    const followResource = userById.addResource('follow');
    const followUserFn = new NodejsFunction(this, 'FollowUser', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/follow-user.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(followUserFn);
    followResource.addMethod('POST', new apigateway.LambdaIntegration(followUserFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    followResource.addMethod('DELETE', new apigateway.LambdaIntegration(followUserFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const meNotifsResource = meResource.addResource('notifications', defaultCors);
    const listNotificationsFn = new NodejsFunction(this, 'ListNotifications', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/list-notifications.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listNotificationsFn);
    meNotifsResource.addMethod('GET', new apigateway.LambdaIntegration(listNotificationsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const notifById = meNotifsResource.addResource('{notificationId}');
    const notifReadResource = notifById.addResource('read');
    const markNotifReadFn = new NodejsFunction(this, 'MarkNotificationRead', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/mark-notification-read.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(markNotifReadFn);
    notifReadResource.addMethod('POST', new apigateway.LambdaIntegration(markNotifReadFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Phase 4a: Playback Polish ===
    // ============================================================
    const sessionChaptersResource = sessionIdResource.addResource('chapters', defaultCors);
    const getSessionChaptersFn = new NodejsFunction(this, 'GetSessionChaptersHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-session-chapters.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getSessionChaptersFn);
    sessionChaptersResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionChaptersFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const sessionRecordingResource = sessionIdResource.addResource('recording', defaultCors);
    const sessionRecordingDownloadResource = sessionRecordingResource.addResource('download');
    const getRecordingDownloadUrlFn = new NodejsFunction(this, 'GetRecordingDownloadUrlHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-recording-download-url.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: {
        TABLE_NAME: sessionsTable.tableName,
        TRANSCRIPTION_BUCKET: transcriptionBucketName,
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getRecordingDownloadUrlFn);
    getRecordingDownloadUrlFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`arn:aws:s3:::${transcriptionBucketName}/*`],
    }));
    sessionRecordingDownloadResource.addMethod('GET', new apigateway.LambdaIntegration(getRecordingDownloadUrlFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Phase 2: Discovery ===
    // ============================================================
    const searchResource = api.root.addResource('search', defaultCors);
    const searchSessionsFn = new NodejsFunction(this, 'SearchSessions', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/search-sessions.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(searchSessionsFn);
    searchResource.addMethod('GET', new apigateway.LambdaIntegration(searchSessionsFn));

    const feedResource = api.root.addResource('feed', defaultCors);
    const getFeedFn = new NodejsFunction(this, 'GetFeed', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-feed.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getFeedFn);
    feedResource.addMethod('GET', new apigateway.LambdaIntegration(getFeedFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const creatorSessionsResource = creatorByHandle.addResource('sessions');
    const getCreatorSessionsFn = new NodejsFunction(this, 'GetCreatorSessions', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-creator-sessions.ts'),
      timeout: Duration.seconds(10),
      environment: profileEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getCreatorSessionsFn);
    creatorSessionsResource.addMethod('GET', new apigateway.LambdaIntegration(getCreatorSessionsFn));

    // ============================================================
    // === Phase 4b: Clips ===
    // ============================================================
    const clipsEnv: Record<string, string> = {
      TABLE_NAME: sessionsTable.tableName,
      RECORDINGS_BUCKET: recordingsBucket?.bucketName ?? '',
      MEDIACONVERT_ROLE_ARN: mediaConvertJobRoleArn ?? '',
      TRANSCRIPTION_BUCKET: transcriptionBucket?.bucketName ?? '',
      AWS_ACCOUNT_ID: this.account,
    };

    const createClipFn = new NodejsFunction(this, 'CreateClipHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-clip.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: clipsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(createClipFn);
    if (recordingsBucket) recordingsBucket.grantWrite(createClipFn);
    if (transcriptionBucket) transcriptionBucket.grantRead(createClipFn);
    createClipFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['mediaconvert:CreateJob', 'mediaconvert:TagResource', 'mediaconvert:DescribeEndpoints'],
      resources: ['*'],
    }));
    if (mediaConvertJobRoleArn) {
      createClipFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [mediaConvertJobRoleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'mediaconvert.amazonaws.com' } },
      }));
    }

    const sessionClipsResource = sessionIdResource.addResource('clips', defaultCors);
    sessionClipsResource.addMethod('POST', new apigateway.LambdaIntegration(createClipFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const listSessionClipsFn = new NodejsFunction(this, 'ListSessionClipsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-session-clips.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listSessionClipsFn);
    sessionClipsResource.addMethod('GET', new apigateway.LambdaIntegration(listSessionClipsFn));

    const clipsResource = api.root.addResource('clips', defaultCors);
    const clipByIdResource = clipsResource.addResource('{clipId}');

    const getClipFn = new NodejsFunction(this, 'GetClipHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-clip.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: {
        TABLE_NAME: sessionsTable.tableName,
        RECORDINGS_BUCKET: recordingsBucket?.bucketName ?? '',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getClipFn);
    if (recordingsBucket) recordingsBucket.grantRead(getClipFn);
    clipByIdResource.addMethod('GET', new apigateway.LambdaIntegration(getClipFn));

    const deleteClipFn = new NodejsFunction(this, 'DeleteClipHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/delete-clip.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(deleteClipFn);
    clipByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteClipFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Phase 5: Scheduled sessions ===
    // ============================================================
    const goLiveResource = sessionIdResource.addResource('go-live', defaultCors);
    const goLiveFn = new NodejsFunction(this, 'GoLive', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/go-live.ts'),
      timeout: Duration.seconds(15),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(goLiveFn);
    goLiveFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));
    goLiveResource.addMethod('POST', new apigateway.LambdaIntegration(goLiveFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const rsvpResource = sessionIdResource.addResource('rsvp', defaultCors);
    const rsvpFn = new NodejsFunction(this, 'RsvpSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/rsvp-session.ts'),
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(rsvpFn);
    rsvpFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));
    rsvpResource.addMethod('POST', new apigateway.LambdaIntegration(rsvpFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    rsvpResource.addMethod('DELETE', new apigateway.LambdaIntegration(rsvpFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const rsvpsResource = sessionIdResource.addResource('rsvps', defaultCors);
    const listSessionRsvpsFn = new NodejsFunction(this, 'ListSessionRsvps', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/list-session-rsvps.ts'),
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listSessionRsvpsFn);
    rsvpsResource.addMethod('GET', new apigateway.LambdaIntegration(listSessionRsvpsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const icsResource = sessionIdResource.addResource('ics', defaultCors);
    const downloadEventIcsFn = new NodejsFunction(this, 'DownloadEventIcs', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/download-event-ics.ts'),
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(downloadEventIcsFn);
    icsResource.addMethod('GET', new apigateway.LambdaIntegration(downloadEventIcsFn));

    const meRsvpsResource = meResource.addResource('rsvps', defaultCors);
    const listMyRsvpsFn = new NodejsFunction(this, 'ListMyRsvps', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/list-my-rsvps.ts'),
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listMyRsvpsFn);
    meRsvpsResource.addMethod('GET', new apigateway.LambdaIntegration(listMyRsvpsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Session detail (GET /sessions/{sessionId}) ===
    // ============================================================
    const getSessionHandler = new NodejsFunction(this, 'GetSessionHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-session.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getSessionHandler);
    sessionIdResource.addMethod('GET', new apigateway.LambdaIntegration(getSessionHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Chat token (POST /sessions/{sessionId}/chat/token) ===
    // Note: /sessions/{sessionId}/chat exists in api-stack (send-message,
    // get-chat-history live there). We imported it above by resource ID.
    // ============================================================
    const chatTokenResource = sessionChatResource.addResource('token', defaultCors);
    const createChatTokenHandler = new NodejsFunction(this, 'CreateChatTokenHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/create-chat-token.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(createChatTokenHandler);
    createChatTokenHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:CreateChatToken'],
        resources: ['arn:aws:ivschat:*:*:room/*'],
      })
    );
    chatTokenResource.addMethod('POST', new apigateway.LambdaIntegration(createChatTokenHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Chat moderation classifier ===
    // POST /sessions/{sessionId}/chat/classify
    // ============================================================
    const chatClassifyResource = sessionChatResource.addResource('classify', defaultCors);
    const classifyChatMessageHandler = new NodejsFunction(this, 'ClassifyChatMessageHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/classify-chat-message.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: sessionsTable.tableName,
        NOVA_MODEL_ID: 'amazon.nova-lite-v1:0',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(classifyChatMessageHandler);
    classifyChatMessageHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
      ],
    }));
    classifyChatMessageHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent', 'ivschat:DisconnectUser'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    chatClassifyResource.addMethod('POST', new apigateway.LambdaIntegration(classifyChatMessageHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Bounce user (POST /sessions/{sessionId}/bounce) ===
    // ============================================================
    const bounceResource = sessionIdResource.addResource('bounce', defaultCors);
    const bounceUserHandler = new NodejsFunction(this, 'BounceUserHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/bounce-user.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(bounceUserHandler);
    bounceUserHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:DisconnectUser'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    bounceResource.addMethod('POST', new apigateway.LambdaIntegration(bounceUserHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Submit appeal (POST /sessions/{sessionId}/appeal) ===
    // ============================================================
    const appealResource = sessionIdResource.addResource('appeal', defaultCors);
    const submitAppealHandler = new NodejsFunction(this, 'SubmitAppealHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/submit-appeal.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(submitAppealHandler);
    appealResource.addMethod('POST', new apigateway.LambdaIntegration(submitAppealHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Receive moderation frame ===
    // POST /sessions/{sessionId}/moderation-frame
    // ============================================================
    const moderationFrameResource = sessionIdResource.addResource('moderation-frame', defaultCors);
    const receiveModerationFrameHandler = new NodejsFunction(this, 'ReceiveModerationFrameHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/receive-moderation-frame.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(receiveModerationFrameHandler);
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectModerationLabels'],
      resources: ['*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:StopStream'],
      resources: ['arn:aws:ivs:*:*:channel/*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    receiveModerationFrameHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    moderationFrameResource.addMethod('POST', new apigateway.LambdaIntegration(receiveModerationFrameHandler), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Moderation upload (conditional) ===
    // POST /sessions/{sessionId}/moderation-upload — only wired if a
    // moderation bucket has been provisioned.
    // ============================================================
    if (moderationBucket) {
      const moderationUploadPath = sessionIdResource.addResource('moderation-upload', defaultCors);
      const requestModerationUploadFn = new NodejsFunction(this, 'RequestModerationUpload', {
        runtime: Runtime.NODEJS_20_X,
        handler: 'handler',
        entry: path.join(__dirname, '../../../backend/src/handlers/request-moderation-upload.ts'),
        timeout: Duration.seconds(10),
        environment: {
          TABLE_NAME: sessionsTable.tableName,
          MODERATION_BUCKET: moderationBucket.bucketName,
        },
        depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
      });
      sessionsTable.grantReadData(requestModerationUploadFn);
      moderationBucket.grantPut(requestModerationUploadFn);
      moderationUploadPath.addMethod('POST', new apigateway.LambdaIntegration(requestModerationUploadFn), {
        authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
      });
    }

    // ============================================================
    // === Migrated: Groups (Phase 1) ===
    // /groups, /groups/mine, /groups/{groupId}, /groups/{groupId}/members/{userId}
    // ============================================================
    const groupsResource = api.root.addResource('groups', defaultCors);
    const groupsMineResource = groupsResource.addResource('mine');
    const groupByIdResource = groupsResource.addResource('{groupId}');
    const groupMembersResource = groupByIdResource.addResource('members');
    const groupMemberByIdResource = groupMembersResource.addResource('{userId}');

    const phase1GroupsEnv = {
      TABLE_NAME: sessionsTable.tableName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    };

    const groupCreateFn = new NodejsFunction(this, 'GroupCreate', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/group-create.ts'),
      environment: phase1GroupsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(groupCreateFn);
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
    sessionsTable.grantReadData(groupListMineFn);
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
    sessionsTable.grantReadData(groupGetFn);
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
    sessionsTable.grantReadWriteData(groupUpdateFn);
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
    sessionsTable.grantReadWriteData(groupDeleteFn);
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
    sessionsTable.grantReadWriteData(groupAddMemberFn);
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
    sessionsTable.grantReadWriteData(groupRemoveMemberFn);
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
    sessionsTable.grantReadWriteData(groupPromoteMemberFn);
    groupMemberByIdResource.addMethod('PATCH', new apigateway.LambdaIntegration(groupPromoteMemberFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Lobbies (Phase 2) ===
    // /sessions/{sessionId}/lobby/[{userId}/approve|deny]
    // ============================================================
    const lobbyResource = sessionIdResource.addResource('lobby', defaultCors);

    const listLobbyRequestsFn = new NodejsFunction(this, 'ListLobbyRequestsHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/list-lobby-requests.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listLobbyRequestsFn);
    lobbyResource.addMethod('GET', new apigateway.LambdaIntegration(listLobbyRequestsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const lobbyUserResource = lobbyResource.addResource('{userId}');

    const approveLobbyFn = new NodejsFunction(this, 'ApproveLobbyRequestHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/approve-lobby-request.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(approveLobbyFn);
    approveLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:CreateParticipantToken'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    approveLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    const approveResource = lobbyUserResource.addResource('approve');
    approveResource.addMethod('POST', new apigateway.LambdaIntegration(approveLobbyFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const denyLobbyFn = new NodejsFunction(this, 'DenyLobbyRequestHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/deny-lobby-request.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(denyLobbyFn);
    denyLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    denyLobbyFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    const denyResource = lobbyUserResource.addResource('deny');
    denyResource.addMethod('POST', new apigateway.LambdaIntegration(denyLobbyFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Invitations ===
    // /sessions/{sessionId}/invite-group
    // /invites/mine, /invites/{sessionId}/respond
    // ============================================================
    const invitationsEnv = {
      TABLE_NAME: sessionsTable.tableName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    };

    const inviteGroupResource = sessionIdResource.addResource('invite-group', defaultCors);
    const inviteGroupFn = new NodejsFunction(this, 'InviteGroupToSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/invite-group-to-session.ts'),
      environment: invitationsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(inviteGroupFn);
    inviteGroupFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    inviteGroupResource.addMethod('POST', new apigateway.LambdaIntegration(inviteGroupFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const invitesResource = api.root.addResource('invites', defaultCors);
    const invitesMineResource = invitesResource.addResource('mine');
    const invitesBySessionResource = invitesResource.addResource('{sessionId}');
    const invitesRespondResource = invitesBySessionResource.addResource('respond');

    const listMyInvitesFn = new NodejsFunction(this, 'ListMyInvites', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/list-my-invites.ts'),
      environment: invitationsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listMyInvitesFn);
    invitesMineResource.addMethod('GET', new apigateway.LambdaIntegration(listMyInvitesFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const respondToInviteFn = new NodejsFunction(this, 'RespondToInvite', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/respond-to-invite.ts'),
      environment: invitationsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(respondToInviteFn);
    invitesRespondResource.addMethod('POST', new apigateway.LambdaIntegration(respondToInviteFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: Surveys ===
    // /sessions/{sessionId}/survey, /sessions/{sessionId}/survey/mine
    // ============================================================
    const surveyEnv = { TABLE_NAME: sessionsTable.tableName };

    const surveyResource = sessionIdResource.addResource('survey', defaultCors);
    const surveyMineResource = surveyResource.addResource('mine');

    const submitSurveyFn = new NodejsFunction(this, 'SubmitSurvey', {
      entry: path.join(__dirname, '../../../backend/src/handlers/submit-survey.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: surveyEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(submitSurveyFn);
    surveyResource.addMethod('POST', new apigateway.LambdaIntegration(submitSurveyFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const getMySurveyFn = new NodejsFunction(this, 'GetMySurvey', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-my-survey.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: surveyEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getMySurveyFn);
    surveyMineResource.addMethod('GET', new apigateway.LambdaIntegration(getMySurveyFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: /sessions/mine — owner-scoped session list ===
    // ============================================================
    const sessionsMineResource = sessionsResource.addResource('mine', defaultCors);
    const listMySessionsFn = new NodejsFunction(this, 'ListMySessions', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/list-my-sessions.ts'),
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: sessionsTable.tableName },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(listMySessionsFn);
    sessionsMineResource.addMethod('GET', new apigateway.LambdaIntegration(listMySessionsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // === Migrated: vnl-ads passthroughs ===
    // /sessions/{sessionId}/promo/[drawer|trigger|click]
    // /me/[earnings|impression-series|training-due|training-claim]
    // ============================================================
    const vnlAdsBaseUrl = (this.node.tryGetContext('vnlAdsBaseUrl') as string | undefined) ?? '';
    const vnlAdsJwtSecret = (this.node.tryGetContext('vnlAdsJwtSecret') as string | undefined) ?? '';
    const vnlAdsJwtIssuer = (this.node.tryGetContext('vnlAdsJwtIssuer') as string | undefined) ?? 'vnl';
    const vnlAdsJwtAudience = (this.node.tryGetContext('vnlAdsJwtAudience') as string | undefined) ?? 'vnl-ads';
    const vnlAdsTimeoutMs = (this.node.tryGetContext('vnlAdsTimeoutMs') as string | undefined) ?? '2000';
    const vnlAdsFeatureEnabled = (this.node.tryGetContext('vnlAdsFeatureEnabled') as string | undefined) ?? 'false';
    const adsEnv: Record<string, string> = {
      TABLE_NAME: sessionsTable.tableName,
      VNL_ADS_BASE_URL: vnlAdsBaseUrl,
      VNL_ADS_JWT_SECRET: vnlAdsJwtSecret,
      VNL_ADS_JWT_ISSUER: vnlAdsJwtIssuer,
      VNL_ADS_JWT_AUDIENCE: vnlAdsJwtAudience,
      VNL_ADS_TIMEOUT_MS: vnlAdsTimeoutMs,
      VNL_ADS_FEATURE_ENABLED: vnlAdsFeatureEnabled,
    };

    const promoResource = sessionIdResource.addResource('promo', defaultCors);
    const promoDrawerResource = promoResource.addResource('drawer');
    const getPromoDrawerFn = new NodejsFunction(this, 'GetPromoDrawerHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/get-promo-drawer.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(getPromoDrawerFn);
    promoDrawerResource.addMethod('GET', new apigateway.LambdaIntegration(getPromoDrawerFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const promoTriggerResource = promoResource.addResource('trigger');
    const triggerPromoFn = new NodejsFunction(this, 'TriggerPromoHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/trigger-promo.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(triggerPromoFn);
    triggerPromoFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivs:PutMetadata'],
        resources: ['arn:aws:ivs:*:*:channel/*'],
      }),
    );
    triggerPromoFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ivschat:SendEvent'],
        resources: ['arn:aws:ivschat:*:*:room/*'],
      }),
    );
    promoTriggerResource.addMethod('POST', new apigateway.LambdaIntegration(triggerPromoFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const promoClickResource = promoResource.addResource('click');
    const trackAdClickFn = new NodejsFunction(this, 'TrackAdClickHandler', {
      entry: path.join(__dirname, '../../../backend/src/handlers/track-ad-click.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    promoClickResource.addMethod('POST', new apigateway.LambdaIntegration(trackAdClickFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const meEarningsResource = meResource.addResource('earnings', defaultCors);
    const getMyEarningsFn = new NodejsFunction(this, 'GetMyEarnings', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-my-earnings.ts'),
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    meEarningsResource.addMethod('GET', new apigateway.LambdaIntegration(getMyEarningsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const meImpressionSeriesResource = meResource.addResource('impression-series', defaultCors);
    const getMyImpressionSeriesFn = new NodejsFunction(this, 'GetMyImpressionSeries', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-my-impression-series.ts'),
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    meImpressionSeriesResource.addMethod('GET', new apigateway.LambdaIntegration(getMyImpressionSeriesFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const meTrainingDueResource = meResource.addResource('training-due', defaultCors);
    const getMyTrainingDueFn = new NodejsFunction(this, 'GetMyTrainingDue', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/get-my-training-due.ts'),
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    meTrainingDueResource.addMethod('GET', new apigateway.LambdaIntegration(getMyTrainingDueFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const meTrainingClaimResource = meResource.addResource('training-claim', defaultCors);
    const claimMyTrainingFn = new NodejsFunction(this, 'ClaimMyTraining', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/claim-my-training.ts'),
      timeout: Duration.seconds(10),
      environment: adsEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    meTrainingClaimResource.addMethod('POST', new apigateway.LambdaIntegration(claimMyTrainingFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
  }
}
