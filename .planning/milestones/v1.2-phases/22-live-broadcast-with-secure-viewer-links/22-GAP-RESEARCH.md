# Phase 22: API Gateway Wiring Gap Research

**Researched:** 2026-03-05
**Domain:** AWS CDK API Gateway + Lambda integration patterns
**Confidence:** HIGH
**Purpose:** Document exact wiring pattern needed to expose generate-playback-token handler via API Gateway

## Summary

The `generate-playback-token` handler is fully implemented (148 lines), tested (8 tests passing), and ready for deployment. However, it is not exposed via an API Gateway endpoint. The handler requires:

1. **Lambda function definition** in `infra/lib/stacks/api-stack.ts` using `NodejsFunction`
2. **API Gateway resource** at `sessions/{sessionId}/playback-token`
3. **POST method** with Cognito authorizer (authenticated endpoint)
4. **Environment variables**: `TABLE_NAME` and `IVS_PLAYBACK_PRIVATE_KEY`
5. **IAM permissions**: DynamoDB read-only access

This document provides the exact CDK patterns used by other handlers and specifies the required wiring.

**Primary recommendation:** Add Lambda function + API resource following the create-chat-token pattern (lines 200-223 in api-stack.ts). Handler is public and requires no additional AWS service permissions beyond DynamoDB.

---

## Current API Pattern Analysis

### Existing Patterns in api-stack.ts

The codebase uses consistent patterns for all handler wiring. This section documents the standard structure.

#### Pattern 1: Authenticated Endpoint with DynamoDB Access

**Example:** `POST /sessions/{sessionId}/chat/token` (create-chat-token handler)

**Location:** api-stack.ts lines 200-223

**Structure:**
```typescript
// 1. Create Lambda function with NodejsFunction
const createChatTokenHandler = new NodejsFunction(this, 'CreateChatTokenHandler', {
  entry: path.join(__dirname, '../../../backend/src/handlers/create-chat-token.ts'),
  handler: 'handler',
  runtime: Runtime.NODEJS_20_X,
  environment: {
    TABLE_NAME: props.sessionsTable.tableName,
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});

// 2. Grant DynamoDB permissions (read, write, or both as needed)
props.sessionsTable.grantReadData(createChatTokenHandler);  // read-only shown here

// 3. Create API Gateway resource (append to existing resource chain)
const chatTokenResource = sessionChatResource.addResource('token');

// 4. Add method with authorizer and integration
chatTokenResource.addMethod('POST', new apigateway.LambdaIntegration(createChatTokenHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

**Key observations:**
- Environment variables passed via `environment: {}` object
- `NodejsFunction` (not raw `Function`) automatically transpiles TypeScript → JavaScript
- DynamoDB permissions via `.grantReadData()` or `.grantReadWriteData()`
- Cognito authorizer applied via method options: `{ authorizer, authorizationType }`
- Resources chained via `.addResource()`: `sessions → {sessionId} → chat → token`

#### Pattern 2: Authenticated Endpoint with AWS Service Permissions

**Example:** `POST /sessions/{sessionId}/chat/token` also calls `ivschat:CreateChatToken`

**Location:** api-stack.ts lines 213-218

**Structure:**
```typescript
// Grant AWS service permissions (beyond DynamoDB)
handler.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['ivschat:CreateChatToken'],
    resources: ['arn:aws:ivschat:*:*:room/*'],
  })
);
```

**Key observations:**
- `addToRolePolicy()` adds to the Lambda execution role
- Specific AWS service actions listed in `actions` array
- Resource ARNs specified for fine-grained permissions (when supported by service)
- Wildcards used when service doesn't support resource-level restrictions

#### Pattern 3: Public Endpoint (No Authorizer)

**Example:** `GET /sessions/{sessionId}/playback` (get-playback handler)

**Location:** api-stack.ts lines 150-166

**Structure:**
```typescript
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

// NO authorizer option passed
sessionPlaybackResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaybackHandler));
```

**Key observations:**
- Omitting `authorizer` and `authorizationType` creates public endpoint
- Same Lambda wiring, different method options

---

## generate-playback-token Handler Requirements

### Handler Analysis

**File:** `backend/src/handlers/generate-playback-token.ts`

**Method signature:**
```typescript
export const handler: APIGatewayProxyHandler = async (event) => { ... }
```

**Environment variables needed (from line 7-8):**
```typescript
const tableName = process.env.TABLE_NAME!;
const privateKey = process.env.IVS_PLAYBACK_PRIVATE_KEY!;
```

**AWS service permissions (implicit via SDK):**
- DynamoDB: `GetItem` on sessions table (for SESSION#{sessionId}#METADATA and POOL#CHANNEL#* queries)
- No other AWS services called directly from handler

**Path parameters used (line 9):**
```typescript
const sessionId = event.pathParameters?.sessionId;
```

**Authentication:**
- Handler expects authenticated user (though it doesn't explicitly extract userId from auth context for this operation)
- Should be protected via Cognito authorizer (broadcasters only generate tokens for their own sessions)

**Handler logic:**
1. Get session from DynamoDB (TABLE_NAME)
2. Verify session exists and is marked private (isPrivate: true)
3. Extract channel ARN from session.claimedResources.channel
4. Parse expiresIn from request body (optional, default 86400 seconds = 24 hours)
5. Sign JWT using private key (IVS_PLAYBACK_PRIVATE_KEY) with ES384 algorithm
6. Return token + playbackUrl + expiresAt

**Response structure (lines 134-138):**
```typescript
{
  statusCode: 200,
  body: JSON.stringify({
    token,
    expiresAt,
    playbackUrl: `${playbackUrl}?token=${token}`,
  }),
}
```

### Test Coverage

**File:** `backend/src/handlers/__tests__/generate-playback-token.test.ts`

**Tests verify:**
- ES384 JWT signing with correct payload
- Expiration time handling (default 24 hours)
- Rejection of public sessions (isPrivate: false)
- Missing session returns 404
- Missing private key returns 500
- Optional expiresIn parameter parsing
- Playback URL construction

**Status:** 8/8 tests passing

---

## Environment Variable Infrastructure

### IVS_PLAYBACK_PRIVATE_KEY Configuration

**Current status in api-stack.ts (lines 467-477):**

```typescript
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
```

**Pattern observed:**
- Private key read from CDK process environment (`process.env.IVS_PLAYBACK_PRIVATE_KEY`)
- Not currently passed to any Lambda function environment variables
- CfnOutput created for deployment visibility

**How to apply:**
When creating the generate-playback-token Lambda function, pass the key via environment object:

```typescript
const generatePlaybackTokenHandler = new NodejsFunction(this, 'GeneratePlaybackTokenHandler', {
  // ... other config ...
  environment: {
    TABLE_NAME: props.sessionsTable.tableName,
    IVS_PLAYBACK_PRIVATE_KEY: process.env.IVS_PLAYBACK_PRIVATE_KEY || '',
  },
  // ...
});
```

This allows the Lambda to access the key at runtime via `process.env.IVS_PLAYBACK_PRIVATE_KEY`.

---

## Session-Stack Infrastructure for Private Channels

### Private Channel Pool

**Replenish-pool handler (session-stack.ts, implicitly called):**

**Location:** `backend/src/handlers/replenish-pool.ts` lines 46, 127, 230

**How pool is created:**
```typescript
const minPrivateChannels = parseInt(process.env.MIN_PRIVATE_CHANNELS || '5', 10); // Phase 22

// Query for available private channels
':pk': 'STATUS#AVAILABLE#PRIVATE_CHANNEL', // GSI1PK value

// Create pool items with private marker
GSI1PK: `STATUS#AVAILABLE#PRIVATE_CHANNEL`,
isPrivate: true, // Mark as private channel
```

**Key structure:**
- **GSI1PK** = `STATUS#AVAILABLE#PRIVATE_CHANNEL` (enables pool queries)
- **isPrivate** = true (session metadata flag)
- MIN_PRIVATE_CHANNELS environment variable set in session-stack.ts (line 213)

**In session-stack.ts (line 213):**
```typescript
const replenishPoolFn = new nodejs.NodejsFunction(this, 'ReplenishPool', {
  // ...
  environment: {
    TABLE_NAME: this.table.tableName,
    MIN_CHANNELS: '3',
    MIN_STAGES: '2',
    MIN_ROOMS: '5',
    MIN_PRIVATE_CHANNELS: '5', // Phase 22: Private channels for secure broadcasts
    RECORDING_CONFIGURATION_ARN: recordingConfiguration.attrArn,
  },
  // ...
});
```

**Implication for generate-playback-token:**
The handler doesn't interact with pool creation. It only reads from sessions table and generates tokens. Pool management is entirely in replenish-pool.ts.

---

## Complete Wiring Pattern

### CDK Code Pattern for generate-playback-token

**Location to add:** `infra/lib/stacks/api-stack.ts` after line 223 (after create-chat-token handler)

**Exact code pattern (based on analysis of existing handlers):**

```typescript
// POST /sessions/{sessionId}/playback-token (generate playback token for private broadcasts)
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
```

**Breaking down each line:**

| Line | Purpose | Why |
|------|---------|-----|
| `playbackTokenResource = sessionIdResource.addResource('playback-token')` | Create resource at `/sessions/{sessionId}/playback-token` | Follows existing pattern: base resource → id param → action resource |
| `new NodejsFunction(this, 'GeneratePlaybackTokenHandler', ...)` | Define Lambda function with unique CDK ID | ID must be unique within stack; handler name follows convention |
| `entry: path.join(...generate-playback-token.ts)` | Point to handler file | CDK will automatically transpile TypeScript at synthesis time |
| `handler: 'handler'` | Export name in file | Must match `export const handler` in generate-playback-token.ts |
| `runtime: Runtime.NODEJS_20_X` | Node.js version | Matches all other handlers in codebase |
| `environment: { TABLE_NAME, IVS_PLAYBACK_PRIVATE_KEY }` | Lambda env vars at runtime | Handler reads via `process.env.TABLE_NAME` etc. |
| `depsLockFilePath` | Lock file for dependency bundling | Required; points to project-level package-lock.json |
| `props.sessionsTable.grantReadData(handler)` | IAM permission for DynamoDB read | Handler only reads (GetItem), doesn't write |
| `addResource('playback-token')` | Add child resource | Creates `/.../{sessionId}/playback-token` |
| `addMethod('POST', ...)` | HTTP method routing | Matches handler signature (APIGatewayProxyHandler) |
| `authorizer, authorizationType: COGNITO` | Require authentication | Only authenticated users can request tokens |

### Resource Path Hierarchy

**Resulting API structure:**
```
POST /sessions/{sessionId}/playback-token
  ├─ Requires Cognito authentication
  ├─ Accepts: sessionId (path param), body (optional expiresIn)
  ├─ Returns: { token, expiresAt, playbackUrl }
  └─ Permissions: DynamoDB read-only
```

**How path parameter routing works:**
- API Gateway extracts `{sessionId}` and places in `event.pathParameters.sessionId`
- Handler reads via `event.pathParameters?.sessionId` (line 9 of handler)
- Same pattern for all path parameters throughout api-stack.ts

---

## Comparison with Similar Handlers

### Handler Similarity Matrix

| Handler | Auth | DynamoDB | AWS Services | Env Vars | Location in api-stack |
|---------|------|----------|--------------|----------|----------------------|
| `generate-playback-token` | ✓ Cognito | Read | None | TABLE_NAME, IVS_PLAYBACK_PRIVATE_KEY | **TO BE ADDED** |
| `create-chat-token` | ✓ Cognito | Read | ivschat:CreateChatToken | TABLE_NAME | Lines 200-223 |
| `join-hangout` | ✓ Cognito | Read/Write | ivs:CreateParticipantToken | TABLE_NAME | Lines 313-336 |
| `send-message` | ✓ Cognito | Read/Write | None | TABLE_NAME | Lines 228-243 |
| `create-reaction` | ✓ Cognito | Read/Write | ivschat:SendEvent | TABLE_NAME | Lines 267-290 |
| `start-broadcast` | ✓ Cognito | Read/Write | None | TABLE_NAME | Lines 118-133 |

**Observations:**
- `generate-playback-token` most similar to `send-message`: DynamoDB read-only, no additional AWS services
- Unlike `create-chat-token` (requires ivschat permission), no service permissions needed
- Unlike `join-hangout`, no DynamoDB writes (only reads)
- Follows standard auth + env pattern

### Why Existing Code Doesn't Call It

**Current state:**
- Handler exists in `backend/src/handlers/`
- Not referenced anywhere in api-stack.ts
- Tests in `backend/src/handlers/__tests__/generate-playback-token.test.ts` mock DynamoDB and verify JWT logic
- API endpoint simply doesn't exist in the deployed infrastructure

**Verification:**
```bash
# Search for "generate-playback-token" in api-stack.ts
grep -i "generate-playback-token" infra/lib/stacks/api-stack.ts
# Returns: no matches (except in this research document comment)
```

---

## Deployment Checklist

When implementing the wiring, verify:

- [ ] **Lambda function defined** in ApiStack constructor
  - [ ] Entry path correct: `../../../backend/src/handlers/generate-playback-token.ts`
  - [ ] Handler export name correct: `handler`
  - [ ] Runtime NODEJS_20_X matches other handlers

- [ ] **Environment variables set**
  - [ ] TABLE_NAME passed from props.sessionsTable.tableName
  - [ ] IVS_PLAYBACK_PRIVATE_KEY read from process.env

- [ ] **IAM permissions granted**
  - [ ] DynamoDB read access via grantReadData()
  - [ ] No additional AWS service permissions needed (handler only reads sessions table)

- [ ] **API Gateway resource created**
  - [ ] Resource name: 'playback-token'
  - [ ] Parent: sessionIdResource (so full path is /sessions/{sessionId}/playback-token)
  - [ ] Method: POST
  - [ ] Integration: LambdaIntegration(handler)
  - [ ] Authorizer: Cognito

- [ ] **Tests verify endpoint works**
  - [ ] Integration test can call POST endpoint
  - [ ] Returns 200 with token + playbackUrl
  - [ ] Authenticator required (401 if missing auth header)

---

## Known Constraints & Patterns

### Environment Variable Secrets

**Pattern observed:**
- `IVS_PLAYBACK_PRIVATE_KEY` is read from **CDK process environment** at synthesis time
- Passed to Lambda via environment variables
- NOT stored in Secrets Manager or Parameter Store
- Assumes operator sets `IVS_PLAYBACK_PRIVATE_KEY=<PEM-key>` before running `cdk deploy`

**Security note:**
- Private key transmitted via Lambda environment variable (visible in CloudFormation, Lambda console)
- For production, consider AWS Secrets Manager integration
- Current implementation suitable for development/testing

### Path Parameter Naming

All path parameters in the codebase use `{paramName}` convention:
- `{sessionId}` — universally used for session identification
- CDK automatically converts to pathParameters in event handler
- Handler extracts via `event.pathParameters?.sessionId`

### Authorizer Application

All protected endpoints use same Cognito authorizer:
```typescript
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
  cognitoUserPools: [props.userPool],
});
```

This is passed to all authenticated endpoints at lines 70-72, 110-112, etc.

---

## Sources

### PRIMARY (HIGH confidence)
- `infra/lib/stacks/api-stack.ts` (lines 200-223, 150-166, 313-336) — verified CDK patterns for handler wiring
- `backend/src/handlers/generate-playback-token.ts` (lines 1-147) — verified handler implementation and environment variable usage
- `backend/src/handlers/create-chat-token.ts` (lines 1-74) — verified authenticated handler pattern
- `.planning/phases/22-live-broadcast-with-secure-viewer-links/22-VERIFICATION.md` (lines 108-127) — verified gap identification and requirements

### SECONDARY (MEDIUM confidence)
- `backend/src/handlers/__tests__/generate-playback-token.test.ts` — verified handler behavior and requirements
- `infra/lib/stacks/session-stack.ts` (lines 203-250) — verified environment variable infrastructure

### Code Analysis
- Grepped entire handlers/ directory for environment variable patterns
- Verified path parameter usage across all handlers
- Confirmed no breaking changes in API Gateway CDK API (NodejsFunction, LambdaIntegration patterns are stable)

---

## Metadata

**Research date:** 2026-03-05
**Researcher confidence:** HIGH
- All primary sources directly inspected and cited
- Patterns verified across 6+ similar handlers
- No contradictions in analysis
- Clear implementation path documented with exact code examples

**Assumptions:**
- IVS_PLAYBACK_PRIVATE_KEY environment variable will be available in CDK synthesis context
- No breaking API Gateway changes in aws-cdk-lib v2
- Handler implementation is correct (verified by passing unit tests)

**Valid until:** 2026-03-12 (7 days — CDK patterns stable, AWS service permissions unlikely to change)
