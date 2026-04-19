/**
 * ApiExtensionsStack — NestedStack that holds Phase 1-5 API Gateway routes.
 *
 * Background: the parent ApiStack hit the 500-resource CloudFormation limit
 * after adding ~50 new routes across phases 1-5 (profiles / follow / discovery /
 * playback / clips / scheduled sessions). A NestedStack is the cleanest split:
 * CDK tracks it as a single CfnStack resource in the parent, and the nested
 * stack has its own independent 500-resource budget.
 *
 * All routes declared here attach to the parent's existing `RestApi` via
 * `api.root.resourceForPath(...)`, which reuses existing path prefixes
 * (e.g. `/sessions/{sessionId}`) when present and creates new resources when
 * not. This keeps URL structure identical to if the routes were declared in
 * the parent.
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
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  sessionsTable: dynamodb.ITable;
  recordingsBucket?: s3.IBucket;
  transcriptionBucket?: s3.IBucket;
  mediaConvertJobRoleArn?: string;
  /** Bucket name — for Phase 4a signed-download URLs. */
  transcriptionBucketName: string;
}

/**
 * Sibling Stack (not nested) that holds Phase 1-5 API Gateway routes.
 *
 * CDK places API Gateway `Method` and `Resource` constructs in the stack that
 * CALLS `addResource` / `addMethod`, even when the RestApi itself lives in a
 * different stack. That's how we split the 500-resource CFN limit: ApiStack
 * keeps the RestApi + legacy routes; this stack holds Phase 1-5 additions.
 */
export class ApiExtensionsStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiExtensionsStackProps) {
    super(scope, id, props);

    const {
      restApiId,
      restApiRootResourceId,
      userPool,
      sessionsTable,
      recordingsBucket,
      transcriptionBucket,
      mediaConvertJobRoleArn,
      transcriptionBucketName,
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

    // Re-acquire resource paths. resourceForPath() on an imported root lazily
    // creates child resources in THIS stack when accessed for the first time,
    // but for paths that already exist on the parent (e.g. 'sessions/{sessionId}'
    // or 'me') we need to manually re-acquire them as children of the imported root.
    // `Resource.root.addResource` is idempotent on name — but across stacks, it
    // will create a NEW resource in this stack's CFN template with the same URL
    // path, and API Gateway resolves by path name, so we simply re-declare.
    //
    // NOTE: paths that ARE defined in the parent ApiStack (sessions/{sessionId},
    // me, admin) — CFN will let us add children to those via resourceForPath.
    // Duplicate resources with the same name in different stacks will collide
    // at deploy time. For this migration, we assume these path segments are
    // only declared in ONE place (the ext stack owns them now that we moved
    // the phase 1-5 routes out of ApiStack).
    const sessionIdResource = api.root.resourceForPath('sessions/{sessionId}');
    const meResource = api.root.resourceForPath('me');
    const admin = api.root.resourceForPath('admin');

    // ============================================================
    // === Phase 1: Profiles, Follow, Notifications ===
    // ============================================================
    const profileEnv = { TABLE_NAME: sessionsTable.tableName };

    const meProfile = meResource.addResource('profile');
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

    const creatorsResource = api.root.addResource('creators');
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

    const usersResource = api.root.addResource('users');
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

    const meNotifsResource = meResource.addResource('notifications');
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
    const sessionChaptersResource = sessionIdResource.addResource('chapters');
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

    const sessionRecordingResource = sessionIdResource.addResource('recording');
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
    const searchResource = api.root.addResource('search');
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

    const feedResource = api.root.addResource('feed');
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

    const sessionClipsResource = sessionIdResource.addResource('clips');
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

    const clipsResource = api.root.addResource('clips');
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
    const goLiveResource = sessionIdResource.addResource('go-live');
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

    const rsvpResource = sessionIdResource.addResource('rsvp');
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

    const rsvpsResource = sessionIdResource.addResource('rsvps');
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

    const icsResource = sessionIdResource.addResource('ics');
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

    const meRsvpsResource = meResource.addResource('rsvps');
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

    // Suppress unused-param lint on admin (reserved for future use if we add
    // admin routes that migrate over).
    void admin;
  }
}
