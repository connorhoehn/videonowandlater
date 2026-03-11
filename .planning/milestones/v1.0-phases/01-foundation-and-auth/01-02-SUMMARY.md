---
phase: 01-foundation-and-auth
plan: 02
subsystem: infrastructure
tags: [cdk, api-gateway, cognito, deployment, developer-tools]
dependencies:
  requires: [01-01]
  provides: [api-gateway, deployment-automation, dev-cli]
  affects: [frontend-config]
tech-stack:
  added: [aws-apigateway, aws-lambda-nodejs, aws-cli-scripts]
  patterns: [rest-api, cognito-authorizer, cdk-outputs-transform]
key-files:
  created:
    - infra/lib/stacks/api-stack.ts
    - scripts/deploy.sh
    - scripts/destroy.sh
    - scripts/create-user.sh
    - scripts/list-users.sh
    - scripts/delete-user.sh
    - scripts/get-token.sh
  modified:
    - infra/bin/app.ts
decisions:
  - API Gateway REST API with Cognito authorizer for all protected endpoints
  - Mock integration for /health endpoint (no Lambda overhead for health checks)
  - NodejsFunction construct for automatic TypeScript bundling with esbuild
  - jq-based CDK outputs transform to generate frontend config
  - admin-set-user-password with --permanent flag to bypass FORCE_CHANGE_PASSWORD
  - ADMIN_USER_PASSWORD_AUTH flow for developer token generation
metrics:
  duration: 82s
  tasks_completed: 2
  files_created: 7
  files_modified: 1
  commits: 2
  completed_at: 2026-03-02T13:40:55Z
---

# Phase 1 Plan 2: API Gateway & Developer Tools Summary

**One-liner:** REST API with Cognito authorization, /health + /me endpoints, and complete deployment automation with developer CLI tools for user management and token generation.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Create API Gateway stack with Cognito authorizer | edaa6b9 | ✅ Complete |
| 2 | Create deploy/destroy scripts and developer CLI tools | 3c6d207 | ✅ Complete |

## Implementation Details

### Task 1: API Gateway Stack

**Created:** `infra/lib/stacks/api-stack.ts`

- **ApiStack** with custom props extending StackProps
  - Accepts `userPool` and `userPoolClient` from AuthStack
  - Creates `CognitoUserPoolsAuthorizer` for protected endpoints
- **REST API** named 'vnl-api'
  - CORS enabled: ALL_ORIGINS, ALL_METHODS, headers ['Content-Type', 'Authorization']
- **Endpoints:**
  - `GET /health` - MockIntegration returning `{"status":"ok"}` (no auth)
  - `GET /me` - Lambda + Cognito authorizer returning `{username}` from JWT claims
- **Lambda Handler:** NodejsFunction pointing to `backend/src/handlers/me.ts`
  - Runtime: NODEJS_20_X
  - Automatic TypeScript bundling via esbuild
  - Uses root package-lock.json for deps
- **Output:** ApiUrl exported to cdk-outputs.json

**Updated:** `infra/bin/app.ts` - Instantiated ApiStack with authStack references

**Verification:** `npx cdk synth` produces templates for all 3 stacks (VNL-Auth, VNL-Api, VNL-Monitoring)

### Task 2: Deployment Automation & Developer Tools

**Created 6 scripts in `scripts/` directory:**

1. **deploy.sh** - Full deployment automation
   - Runs `npx cdk deploy --all` with outputs to cdk-outputs.json
   - Transforms CDK outputs with jq into `web/public/aws-config.json`
   - Extracts: userPoolId, userPoolClientId, region, apiUrl

2. **destroy.sh** - Complete teardown
   - Runs `npx cdk destroy --all --force`
   - Removes cdk-outputs.json and aws-config.json

3. **create-user.sh** - Create Cognito test user
   - Usage: `./scripts/create-user.sh <username> <password>`
   - Calls `admin-create-user` with SUPPRESS message
   - Calls `admin-set-user-password --permanent` to bypass FORCE_CHANGE_PASSWORD
   - Reads USER_POOL_ID from cdk-outputs.json

4. **list-users.sh** - List all users
   - Formats output with jq to show Username and UserStatus

5. **delete-user.sh** - Delete user
   - Usage: `./scripts/delete-user.sh <username>`
   - Calls `admin-delete-user`

6. **get-token.sh** - Generate auth tokens
   - Usage: `./scripts/get-token.sh <username> <password>`
   - Uses ADMIN_USER_PASSWORD_AUTH flow
   - Returns AccessToken, IdToken, RefreshToken, ExpiresIn formatted with jq

**Verification:** All scripts are executable, pass bash syntax check, and have proper error handling for missing cdk-outputs.json

## Deviations from Plan

None - plan executed exactly as written. Task 1 was completed in a previous execution (commit edaa6b9), Task 2 completed in this execution (commit 3c6d207).

## Key Decisions

1. **REST API over HTTP API**: REST API chosen for mature Cognito authorizer support and CDK integration
2. **MockIntegration for /health**: Avoids Lambda cold start overhead for simple health checks
3. **NodejsFunction construct**: Automatic TypeScript bundling eliminates need for separate build step
4. **jq for config transform**: Shell-based transform keeps deployment scripts simple and readable
5. **admin-set-user-password --permanent**: Bypasses Cognito's default FORCE_CHANGE_PASSWORD status (per research pitfall #7)
6. **ADMIN_USER_PASSWORD_AUTH flow**: Enables CLI-based token generation for development without SRP complexity

## Testing Strategy

**Manual verification available:**
1. Run `./scripts/deploy.sh` to deploy all stacks
2. Verify `cdk-outputs.json` and `web/public/aws-config.json` are created
3. Create test user: `./scripts/create-user.sh testuser TestPass123`
4. Generate tokens: `./scripts/get-token.sh testuser TestPass123`
5. Test /health endpoint: `curl https://<api-url>/health`
6. Test /me endpoint with token: `curl -H "Authorization: Bearer <token>" https://<api-url>/me`

**Automated verification (completed):**
- CDK synth succeeds for all 3 stacks
- All scripts executable and syntax-valid
- deploy.sh contains jq transform pattern
- destroy.sh removes both config files
- create-user.sh has both admin commands with --permanent
- get-token.sh uses ADMIN_USER_PASSWORD_AUTH

## Outputs

**Infrastructure:**
- 3 CDK stacks ready to deploy: VNL-Auth, VNL-Api, VNL-Monitoring
- API Gateway with 2 endpoints (/health, /me)
- Lambda function for /me endpoint with Cognito authorization

**Automation:**
- One-command deployment with frontend config generation
- One-command teardown with cleanup
- Complete developer CLI for user management and token generation

**Configuration:**
- `cdk-outputs.json` - CDK stack outputs (generated by deploy.sh)
- `web/public/aws-config.json` - Frontend config (transformed from CDK outputs)

## Next Steps

1. Deploy infrastructure: `./scripts/deploy.sh`
2. Create test users and generate tokens for frontend development
3. Proceed to Phase 1 Plan 3: Frontend app with authentication UI

## Self-Check: PASSED

**Files created:**
- ✓ infra/lib/stacks/api-stack.ts
- ✓ scripts/deploy.sh
- ✓ scripts/destroy.sh
- ✓ scripts/create-user.sh
- ✓ scripts/list-users.sh
- ✓ scripts/delete-user.sh
- ✓ scripts/get-token.sh
- ✓ backend/src/handlers/me.ts

**Files modified:**
- ✓ infra/bin/app.ts

**Commits verified:**
- ✓ edaa6b9 (Task 1: API Gateway stack)
- ✓ 3c6d207 (Task 2: Deploy/destroy scripts and CLI tools)
