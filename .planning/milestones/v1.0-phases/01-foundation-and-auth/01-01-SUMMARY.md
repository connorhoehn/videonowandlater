---
phase: 01-foundation-and-auth
plan: 01
subsystem: infra
tags: [cdk, cognito, cloudwatch, typescript, monorepo, npm-workspaces]

# Dependency graph
requires: []
provides:
  - npm workspaces monorepo with infra, backend, and web packages
  - CDK app with Auth stack (Cognito UserPool and UserPoolClient)
  - CDK Monitoring stack (CloudWatch billing alarms at $10/$50/$100)
  - /me Lambda handler extracting username from Cognito authorizer claims
  - Shared TypeScript configuration (tsconfig.base.json)
affects: [01-02-PLAN, 01-03-PLAN, api-stack, deploy-scripts, frontend]

# Tech tracking
tech-stack:
  added: [aws-cdk-lib, constructs, typescript, ts-node, "@aws-sdk/client-cognito-identity-provider", "@types/aws-lambda"]
  patterns: [multi-stack CDK app, constructor injection for cross-stack refs, npm workspaces monorepo]

key-files:
  created:
    - package.json
    - tsconfig.base.json
    - cdk.json
    - infra/package.json
    - infra/tsconfig.json
    - infra/bin/app.ts
    - infra/lib/stacks/auth-stack.ts
    - infra/lib/stacks/monitoring-stack.ts
    - backend/package.json
    - backend/tsconfig.json
    - backend/src/handlers/me.ts
    - .gitignore
  modified: []

key-decisions:
  - "us-east-1 region for all stacks (billing metrics only available there)"
  - "RemovalPolicy.DESTROY on all resources for clean teardown"
  - "adminUserPassword auth flow enabled on UserPoolClient for DEV-02 token generation"

patterns-established:
  - "Multi-stack CDK: separate stacks for Auth, Monitoring (and later API) with constructor injection"
  - "Monorepo: npm workspaces with @vnl/ namespace for infra and backend packages"
  - "Lambda handlers: export async function handler with typed APIGatewayProxyEvent"

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 1 Plan 1: Monorepo Scaffold + CDK Auth & Monitoring Summary

**TypeScript monorepo with CDK-managed Cognito UserPool (username auth, self-signup, no email verification) and CloudWatch billing alarms at $10/$50/$100 thresholds**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T01:46:48Z
- **Completed:** 2026-03-02T01:49:40Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- npm workspaces monorepo with infra and backend packages, shared TypeScript config, and CDK app entry point
- Cognito UserPool with username sign-in, self-signup, no email verification, and DESTROY removal policy; UserPoolClient with userPassword, userSrp, and adminUserPassword auth flows
- CloudWatch billing alarms at $10, $50, $100 thresholds with SNS notification topic in us-east-1
- /me Lambda handler that extracts username from Cognito authorizer claims with CORS headers

## Task Commits

Each task was committed atomically:

1. **Task 1: Create monorepo scaffold with npm workspaces** - `38a0a10` (feat)
2. **Task 2: Create CDK Auth and Monitoring stacks** - `34ad08d` (feat)

**Plan metadata:** `fb4e07d` (docs: complete plan)

## Files Created/Modified
- `package.json` - Root workspace config with npm workspaces (infra, backend, web)
- `tsconfig.base.json` - Shared TypeScript config (ES2022, Node16, strict)
- `cdk.json` - CDK app config pointing to infra/bin/app.ts
- `infra/package.json` - @vnl/infra package with aws-cdk-lib and constructs
- `infra/tsconfig.json` - Extends base config, includes bin/ and lib/
- `infra/bin/app.ts` - CDK app entry point instantiating Auth and Monitoring stacks
- `infra/lib/stacks/auth-stack.ts` - Cognito UserPool and UserPoolClient with CfnOutputs
- `infra/lib/stacks/monitoring-stack.ts` - CloudWatch billing alarms at 3 thresholds with SNS
- `backend/package.json` - @vnl/backend package with AWS SDK and Lambda types
- `backend/tsconfig.json` - Extends base config, includes src/
- `backend/src/handlers/me.ts` - Lambda handler returning authenticated username
- `.gitignore` - Excludes node_modules, dist, cdk.out, generated config
- `package-lock.json` - Lock file for reproducible installs

## Decisions Made
- **us-east-1 for all stacks:** Billing alarms require us-east-1 (billing metrics only published there). Using same region for Auth stack simplifies deployment.
- **RemovalPolicy.DESTROY on all Cognito resources:** Ensures `cdk destroy --all` removes everything cleanly per INFRA-02.
- **adminUserPassword auth flow enabled:** Required for Plan 02's developer CLI token generation (DEV-02) using admin-initiate-auth.
- **No exportName on CfnOutputs for cross-stack refs:** Per research pitfall #4, using constructor injection instead. CfnOutput exports are for frontend consumption only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added .gitignore**
- **Found during:** Task 1 (Monorepo scaffold)
- **Issue:** Plan did not specify .gitignore; without it, node_modules, build artifacts, and CDK output would be committed
- **Fix:** Created .gitignore excluding node_modules, dist, cdk.out, generated config files
- **Files modified:** .gitignore
- **Verification:** git status shows correct tracked files only
- **Committed in:** 38a0a10 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for clean repository operation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Auth stack exposes `userPool` and `userPoolClient` properties for cross-stack reference by ApiStack in Plan 02
- Monitoring stack is complete and independent
- Monorepo structure ready for Plan 02 (API Gateway, deploy scripts, CLI tools) and Plan 03 (React frontend)
- CDK synth verified to produce valid CloudFormation templates

## Self-Check: PASSED

All 12 created files verified present. Both task commits (38a0a10, 34ad08d) verified in git log.

---
*Phase: 01-foundation-and-auth*
*Completed: 2026-03-02*
