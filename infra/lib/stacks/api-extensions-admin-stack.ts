/**
 * ApiExtensionsAdminStack — third sibling Stack that holds all `/admin/*`
 * API Gateway routes. Carved out of ApiExtensionsStack to keep both under
 * the 500-resource-per-stack CloudFormation limit.
 *
 * All routes here attach to the parent ApiStack's `RestApi` via
 * `fromRestApiAttributes`. The `/admin` root resource is OWNED by this stack
 * (addResource on the imported root); no other stack may declare it.
 */

import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiExtensionsAdminStackProps extends StackProps {
  restApiId: string;
  restApiRootResourceId: string;
  userPool: cognito.UserPool;
  sessionsTable: dynamodb.ITable;
  /** Webhook delivery queue for admin-kill-session's durable event emission. */
  webhookQueueUrl?: string;
  webhookQueueArn?: string;
}

export class ApiExtensionsAdminStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiExtensionsAdminStackProps) {
    super(scope, id, props);

    const {
      restApiId,
      restApiRootResourceId,
      userPool,
      sessionsTable,
      webhookQueueUrl,
      webhookQueueArn,
    } = props;

    const api = apigateway.RestApi.fromRestApiAttributes(this, 'ImportedApi', {
      restApiId,
      rootResourceId: restApiRootResourceId,
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });

    // CORS defaults propagate down through addResource, so setting this on
    // `/admin` covers every /admin/* route declared below. The imported
    // RestApi's default preflight isn't inherited across stack boundaries.
    const defaultCors: apigateway.ResourceOptions = {
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['*'],
      },
    };

    // This stack OWNS /admin.
    const admin = api.root.addResource('admin', defaultCors);

    const tableEnv = { TABLE_NAME: sessionsTable.tableName };

    // ============================================================
    // /admin/sessions and /admin/sessions/{sessionId}/*
    // ============================================================
    const adminSessions = admin.addResource('sessions');
    const adminSessionById = adminSessions.addResource('{sessionId}');

    // POST /admin/sessions/{sessionId}/kill
    const killResource = adminSessionById.addResource('kill');
    const adminKillSessionFn = new NodejsFunction(this, 'AdminKillSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-kill-session.ts'),
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: sessionsTable.tableName,
        ...(webhookQueueUrl && { WEBHOOK_QUEUE_URL: webhookQueueUrl }),
        EVENT_BUS_NAME: 'default',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminKillSessionFn);
    adminKillSessionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:StopStream'],
      resources: ['arn:aws:ivs:*:*:channel/*'],
    }));
    adminKillSessionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    adminKillSessionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    if (webhookQueueArn) {
      adminKillSessionFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [webhookQueueArn],
      }));
    }
    adminKillSessionFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/default`],
    }));
    killResource.addMethod('POST', new apigateway.LambdaIntegration(adminKillSessionFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /admin/sessions/{sessionId}/pin
    const pinResource = adminSessionById.addResource('pin');
    const adminPinSessionFn = new NodejsFunction(this, 'AdminPinSession', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-pin-session.ts'),
      timeout: Duration.seconds(30),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminPinSessionFn);
    pinResource.addMethod('POST', new apigateway.LambdaIntegration(adminPinSessionFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sessions/{sessionId}/detail
    const detailResource = adminSessionById.addResource('detail');
    const adminGetSessionDetailFn = new NodejsFunction(this, 'AdminGetSessionDetail', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-session-detail.ts'),
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminGetSessionDetailFn);
    detailResource.addMethod('GET', new apigateway.LambdaIntegration(adminGetSessionDetailFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sessions — list active sessions
    const adminListSessionsFn = new NodejsFunction(this, 'AdminListSessions', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-sessions.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminListSessionsFn);
    adminSessions.addMethod('GET', new apigateway.LambdaIntegration(adminListSessionsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // GET /admin/sessions/{sessionId}/surveys
    const adminSessionSurveys = adminSessionById.addResource('surveys');
    const adminGetSessionSurveysFn = new NodejsFunction(this, 'AdminGetSessionSurveys', {
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-session-surveys.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminGetSessionSurveysFn);
    adminSessionSurveys.addMethod('GET', new apigateway.LambdaIntegration(adminGetSessionSurveysFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/moderation/{sessionId}/review
    // ============================================================
    const adminModeration = admin.addResource('moderation');
    const adminModerationSession = adminModeration.addResource('{sessionId}');
    const reviewResource = adminModerationSession.addResource('review');
    const adminReviewModerationFn = new NodejsFunction(this, 'AdminReviewModeration', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-review-moderation.ts'),
      timeout: Duration.seconds(30),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminReviewModerationFn);
    adminReviewModerationFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:StopStream'],
      resources: ['arn:aws:ivs:*:*:channel/*'],
    }));
    adminReviewModerationFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivs:DisconnectParticipant'],
      resources: ['arn:aws:ivs:*:*:stage/*'],
    }));
    adminReviewModerationFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    reviewResource.addMethod('POST', new apigateway.LambdaIntegration(adminReviewModerationFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/audit-log
    // ============================================================
    const adminAuditLog = admin.addResource('audit-log');
    const adminAuditLogFn = new NodejsFunction(this, 'AdminAuditLog', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-audit-log.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminAuditLogFn);
    adminAuditLog.addMethod('GET', new apigateway.LambdaIntegration(adminAuditLogFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/appeals/{sessionId}/review
    // ============================================================
    const adminAppeals = admin.addResource('appeals');
    const adminAppealSession = adminAppeals.addResource('{sessionId}');
    const appealReviewResource = adminAppealSession.addResource('review');
    const adminReviewAppealFn = new NodejsFunction(this, 'AdminReviewAppeal', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-review-appeal.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminReviewAppealFn);
    appealReviewResource.addMethod('POST', new apigateway.LambdaIntegration(adminReviewAppealFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/costs/*
    // ============================================================
    const adminCosts = admin.addResource('costs');
    const adminCostsSummary = adminCosts.addResource('summary');
    const adminCostSummaryFn = new NodejsFunction(this, 'AdminCostSummary', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-cost-summary.ts'),
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminCostSummaryFn);
    adminCostsSummary.addMethod('GET', new apigateway.LambdaIntegration(adminCostSummaryFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminCostsSession = adminCosts.addResource('session');
    const adminCostsSessionById = adminCostsSession.addResource('{sessionId}');
    const adminGetSessionCostFn = new NodejsFunction(this, 'AdminGetSessionCost', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-session-cost.ts'),
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminGetSessionCostFn);
    adminCostsSessionById.addMethod('GET', new apigateway.LambdaIntegration(adminGetSessionCostFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminCostsUser = adminCosts.addResource('user');
    const adminCostsUserById = adminCostsUser.addResource('{userId}');
    const adminGetUserCostsFn = new NodejsFunction(this, 'AdminGetUserCosts', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-user-costs.ts'),
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminGetUserCostsFn);
    adminCostsUserById.addMethod('GET', new apigateway.LambdaIntegration(adminGetUserCostsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/bans/* — Phase 3 global ban management
    // ============================================================
    const adminBans = admin.addResource('bans');
    const adminBanByUser = adminBans.addResource('{userId}');

    const adminCreateGlobalBanFn = new NodejsFunction(this, 'AdminCreateGlobalBan', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-create-global-ban.ts'),
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminCreateGlobalBanFn);
    adminCreateGlobalBanFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent', 'ivschat:DisconnectUser'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    adminBans.addMethod('POST', new apigateway.LambdaIntegration(adminCreateGlobalBanFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminListGlobalBansFn = new NodejsFunction(this, 'AdminListGlobalBans', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-global-bans.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminListGlobalBansFn);
    adminBans.addMethod('GET', new apigateway.LambdaIntegration(adminListGlobalBansFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminLiftGlobalBanFn = new NodejsFunction(this, 'AdminLiftGlobalBan', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-lift-global-ban.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminLiftGlobalBanFn);
    adminBanByUser.addMethod('DELETE', new apigateway.LambdaIntegration(adminLiftGlobalBanFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/rulesets/* — Phase 4 image moderation rulesets
    // ============================================================
    const adminRulesets = admin.addResource('rulesets');
    const adminRulesetByName = adminRulesets.addResource('{name}');
    const adminRulesetRollback = adminRulesetByName.addResource('rollback');
    const adminRulesetTest = adminRulesetByName.addResource('test');

    const defaultRulesetEnv: Record<string, string> = {
      TABLE_NAME: sessionsTable.tableName,
      NOVA_MODEL_ID: 'amazon.nova-lite-v1:0',
    };

    const adminListRulesetsFn = new NodejsFunction(this, 'AdminListRulesets', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-rulesets.ts'),
      timeout: Duration.seconds(15),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminListRulesetsFn);
    adminRulesets.addMethod('GET', new apigateway.LambdaIntegration(adminListRulesetsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminGetRulesetFn = new NodejsFunction(this, 'AdminGetRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-get-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminGetRulesetFn);
    adminRulesetByName.addMethod('GET', new apigateway.LambdaIntegration(adminGetRulesetFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminUpsertRulesetFn = new NodejsFunction(this, 'AdminUpsertRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-upsert-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminUpsertRulesetFn);
    adminRulesetByName.addMethod('POST', new apigateway.LambdaIntegration(adminUpsertRulesetFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminRollbackRulesetFn = new NodejsFunction(this, 'AdminRollbackRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-rollback-ruleset.ts'),
      timeout: Duration.seconds(10),
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminRollbackRulesetFn);
    adminRulesetRollback.addMethod('POST', new apigateway.LambdaIntegration(adminRollbackRulesetFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminTestRulesetFn = new NodejsFunction(this, 'AdminTestRuleset', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-test-ruleset.ts'),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: defaultRulesetEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminTestRulesetFn);
    adminTestRulesetFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-pro-v1:0`,
      ],
    }));
    adminRulesetTest.addMethod('POST', new apigateway.LambdaIntegration(adminTestRulesetFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/roles/*, /admin/users — Phase 1b Cognito group management
    // ============================================================
    const adminRoles = admin.addResource('roles');
    const adminRoleByName = adminRoles.addResource('{roleName}');
    const adminRoleMembers = adminRoleByName.addResource('members');
    const adminRoleMemberByUsername = adminRoleMembers.addResource('{username}');
    const adminUsers = admin.addResource('users');

    const roleEnv = { USER_POOL_ID: userPool.userPoolId };

    const cognitoAdminActions = [
      'cognito-idp:ListUsersInGroup',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:ListUsers',
    ];

    const adminListRoleMembersFn = new NodejsFunction(this, 'AdminListRoleMembers', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-role-members.ts'),
      timeout: Duration.seconds(10),
      environment: roleEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminListRoleMembersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: cognitoAdminActions,
      resources: [userPool.userPoolArn],
    }));
    adminRoleMembers.addMethod('GET', new apigateway.LambdaIntegration(adminListRoleMembersFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminAddToRoleFn = new NodejsFunction(this, 'AdminAddToRole', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-add-to-role.ts'),
      timeout: Duration.seconds(10),
      environment: roleEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminAddToRoleFn.addToRolePolicy(new iam.PolicyStatement({
      actions: cognitoAdminActions,
      resources: [userPool.userPoolArn],
    }));
    adminRoleMembers.addMethod('POST', new apigateway.LambdaIntegration(adminAddToRoleFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminRemoveFromRoleFn = new NodejsFunction(this, 'AdminRemoveFromRole', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-remove-from-role.ts'),
      timeout: Duration.seconds(10),
      environment: roleEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminRemoveFromRoleFn.addToRolePolicy(new iam.PolicyStatement({
      actions: cognitoAdminActions,
      resources: [userPool.userPoolArn],
    }));
    adminRoleMemberByUsername.addMethod('DELETE', new apigateway.LambdaIntegration(adminRemoveFromRoleFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminSearchUsersFn = new NodejsFunction(this, 'AdminSearchUsers', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-search-users.ts'),
      timeout: Duration.seconds(10),
      environment: roleEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminSearchUsersFn.addToRolePolicy(new iam.PolicyStatement({
      actions: cognitoAdminActions,
      resources: [userPool.userPoolArn],
    }));
    adminUsers.addMethod('GET', new apigateway.LambdaIntegration(adminSearchUsersFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/chat-flags, /admin/chat-flags/{sessionId}/{sk}/resolve
    // ============================================================
    const adminChatFlags = admin.addResource('chat-flags');
    const adminListChatFlagsFn = new NodejsFunction(this, 'AdminListChatFlags', {
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-chat-flags.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminListChatFlagsFn);
    adminChatFlags.addMethod('GET', new apigateway.LambdaIntegration(adminListChatFlagsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminChatFlagSession = adminChatFlags.addResource('{sessionId}');
    const adminChatFlagSk = adminChatFlagSession.addResource('{sk}');
    const adminChatFlagResolve = adminChatFlagSk.addResource('resolve');
    const adminResolveChatFlagFn = new NodejsFunction(this, 'AdminResolveChatFlag', {
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-resolve-chat-flag.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminResolveChatFlagFn);
    adminResolveChatFlagFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ivschat:SendEvent', 'ivschat:DisconnectUser'],
      resources: ['arn:aws:ivschat:*:*:room/*'],
    }));
    adminChatFlagResolve.addMethod('POST', new apigateway.LambdaIntegration(adminResolveChatFlagFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/surveys — cross-session aggregate
    // ============================================================
    const adminSurveysResource = admin.addResource('surveys');
    const adminListSurveysFn = new NodejsFunction(this, 'AdminListSurveys', {
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-surveys.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminListSurveysFn);
    adminSurveysResource.addMethod('GET', new apigateway.LambdaIntegration(adminListSurveysFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/ads/mint-token — vnl-ads admin UI JWT
    // ============================================================
    const adminAds = admin.addResource('ads');
    const adminAdsMint = adminAds.addResource('mint-token');
    const mintTokenParamName = (this.node.tryGetContext('vnlAdsServiceJwtParamName') as string | undefined) ?? '/vnl/ads-service-jwt';
    const adminMintAdsTokenFn = new NodejsFunction(this, 'AdminMintAdsToken', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-mint-ads-token.ts'),
      timeout: Duration.seconds(5),
      environment: {
        // Secret sourced from SSM at cold start — handler reads via
        // resolveSharedSecret. No raw value in the CFN template.
        VNL_ADS_JWT_SECRET_PARAM: mintTokenParamName,
        VNL_ADS_JWT_ISSUER: (this.node.tryGetContext('vnlAdsJwtIssuer') as string | undefined) ?? 'vnl',
        VNL_ADS_ADMIN_JWT_AUDIENCE: (this.node.tryGetContext('vnlAdsAdminJwtAudience') as string | undefined) ?? 'vnl-ads-admin',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminMintAdsTokenFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${mintTokenParamName}`],
    }));
    adminAdsMint.addMethod('POST', new apigateway.LambdaIntegration(adminMintAdsTokenFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ============================================================
    // /admin/ads — story-inline ad creative CRUD
    //   POST  /admin/ads                → AdminCreateAd (idempotent on contentHash)
    //   GET   /admin/ads                → AdminListAds
    //   POST  /admin/ads/synth          → AdminAdsSynth (proxy to vnl-ads)
    //   GET   /admin/ads/synth/{id}     → AdminAdsSynth (poll upstream)
    //   DELETE /admin/ads/{id}          → AdminDeleteAd
    //   POST  /admin/ads/{id}/activate  → AdminActivateAd
    //   POST  /admin/ads/{id}/deactivate→ AdminActivateAd (dispatched on path)
    // ============================================================

    const adminCreateAdFn = new NodejsFunction(this, 'AdminCreateAd', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-create-ad.ts'),
      timeout: Duration.seconds(5),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminCreateAdFn);
    adminAds.addMethod('POST', new apigateway.LambdaIntegration(adminCreateAdFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminListAdsFn = new NodejsFunction(this, 'AdminListAds', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-list-ads.ts'),
      timeout: Duration.seconds(10),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadData(adminListAdsFn);
    adminAds.addMethod('GET', new apigateway.LambdaIntegration(adminListAdsFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Synth proxy — mints forward-direction JWT from the SSM shared secret,
    // forwards to vnl-ads. Handler needs ssm:GetParameter on /vnl/ads-service-jwt.
    const adsServiceJwtParamName = (this.node.tryGetContext('vnlAdsServiceJwtParamName') as string | undefined) ?? '/vnl/ads-service-jwt';
    const vnlAdsBaseUrl = (this.node.tryGetContext('vnlAdsBaseUrl') as string | undefined) ?? '';

    const adminAdsSynthFn = new NodejsFunction(this, 'AdminAdsSynth', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-ads-synth.ts'),
      timeout: Duration.seconds(10),
      environment: {
        VNL_ADS_JWT_SECRET_PARAM: adsServiceJwtParamName,
        VNL_ADS_BASE_URL: vnlAdsBaseUrl,
        VNL_ADS_JWT_ISSUER: (this.node.tryGetContext('vnlAdsJwtIssuer') as string | undefined) ?? 'vnl',
        VNL_ADS_JWT_AUDIENCE: (this.node.tryGetContext('vnlAdsJwtAudience') as string | undefined) ?? 'vnl-ads',
      },
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    adminAdsSynthFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${Stack.of(this).region}:${Stack.of(this).account}:parameter${adsServiceJwtParamName}`],
    }));

    const adminAdsSynth = adminAds.addResource('synth');
    adminAdsSynth.addMethod('POST', new apigateway.LambdaIntegration(adminAdsSynthFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    const adminAdsSynthById = adminAdsSynth.addResource('{synthesisId}');
    adminAdsSynthById.addMethod('GET', new apigateway.LambdaIntegration(adminAdsSynthFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // /admin/ads/{id} — activate / deactivate / delete
    const adminAdById = adminAds.addResource('{id}');

    const adminDeleteAdFn = new NodejsFunction(this, 'AdminDeleteAd', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-delete-ad.ts'),
      timeout: Duration.seconds(5),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminDeleteAdFn);
    adminAdById.addMethod('DELETE', new apigateway.LambdaIntegration(adminDeleteAdFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const adminActivateAdFn = new NodejsFunction(this, 'AdminActivateAd', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../backend/src/handlers/admin-activate-ad.ts'),
      timeout: Duration.seconds(5),
      environment: tableEnv,
      depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
    });
    sessionsTable.grantReadWriteData(adminActivateAdFn);
    const adminAdActivate = adminAdById.addResource('activate');
    adminAdActivate.addMethod('POST', new apigateway.LambdaIntegration(adminActivateAdFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    const adminAdDeactivate = adminAdById.addResource('deactivate');
    adminAdDeactivate.addMethod('POST', new apigateway.LambdaIntegration(adminActivateAdFn), {
      authorizer, authorizationType: apigateway.AuthorizationType.COGNITO,
    });
  }
}
