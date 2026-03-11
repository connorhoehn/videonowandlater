---
phase: 02-session-model-and-resource-pool
plan: 02
subsystem: resource-pool
tags: [scheduled-lambda, ivs-api, pool-replenishment, aws-sdk-v3]
completed_date: "2026-03-02T14:37:08Z"
duration_minutes: 7

dependencies:
  requires: [02-01]
  provides: [ivs-client-singletons, dynamodb-client-singleton, pool-replenishment-lambda]
  affects: [session-stack, backend-handlers]

tech_stack:
  added:
    - "@aws-sdk/client-ivs: ^3.1000.0"
    - "@aws-sdk/client-ivs-realtime: ^3.1000.0"
    - "@aws-sdk/client-ivschat: ^3.1000.0"
    - "@aws-sdk/lib-dynamodb: ^3.1000.0"
    - "uuid: ^10.0.0"
    - "@aws-lambda-powertools/logger: ^2.31.0"
    - "@aws-lambda-powertools/tracer: ^2.31.0"
  patterns:
    - "Singleton pattern for AWS SDK clients (Lambda warm start optimization)"
    - "EventBridge scheduled Lambda for background pool maintenance"
    - "GSI1 query with FilterExpression for counting available resources by type"
    - "Promise.all for parallel IVS resource creation"

key_files:
  created:
    - backend/src/lib/ivs-clients.ts
    - backend/src/lib/dynamodb-client.ts
    - backend/src/handlers/replenish-pool.ts
    - backend/src/handlers/__tests__/replenish-pool.test.ts
  modified:
    - infra/lib/stacks/session-stack.ts
    - backend/package.json

decisions:
  - title: "Singleton pattern for AWS SDK clients"
    rationale: "Lambda container reuse optimization - avoid recreating clients on every invocation"
    alternatives: ["Create clients on each invocation", "Use global instances"]
    chosen: "Lazy singleton initialization"
  - title: "5-minute EventBridge schedule"
    rationale: "Balance between pool freshness and Lambda invocation costs"
    alternatives: ["1-minute (faster replenishment)", "15-minute (lower cost)"]
    chosen: "5-minute schedule"
  - title: "Continue on individual resource creation failures"
    rationale: "Partial pool replenishment better than complete failure"
    alternatives: ["Fail fast on first error", "Retry failed resources"]
    chosen: "Log error and continue with other resources"
  - title: "Store streamKey in pool items"
    rationale: "Addresses Pitfall 5 from research - streamKey only returned on CreateChannel, not GetChannel"
    alternatives: ["Fetch streamKey on claim", "Store separately"]
    chosen: "Store in pool item during creation"

metrics:
  tasks_completed: 3
  tests_added: 6
  files_created: 4
  files_modified: 2
  commits: 5
---

# Phase 02 Plan 02: Pool Replenishment Summary

**One-liner:** Scheduled Lambda with EventBridge triggers every 5 minutes to maintain pool of pre-warmed IVS resources (channels, stages, chat rooms) using AWS SDK v3 and DynamoDB persistence.

## What Was Built

Implemented the automated background system that maintains a pool of AVAILABLE IVS resources ready for instant session claims. The replenishment Lambda queries GSI1 to count available resources by type, compares against configurable thresholds, and creates new IVS resources in parallel when the pool drops below minimum levels.

### Core Components

1. **AWS SDK Client Singletons** (`backend/src/lib/`)
   - IVS client for Low-Latency streaming channels
   - IVS RealTime client for interactive stages
   - IVS Chat client for chat rooms
   - DynamoDB DocumentClient for native JavaScript type marshalling
   - Lazy initialization pattern for Lambda warm start optimization

2. **Pool Replenishment Lambda** (`backend/src/handlers/replenish-pool.ts`)
   - EventBridge-triggered handler (every 5 minutes)
   - `countAvailableResources()`: Queries GSI1 with `STATUS#AVAILABLE` partition key, filters by resource type
   - `createChannel()`: Creates IVS channel with LOW latency mode, stores streamKey (addresses Pitfall 5)
   - `createStage()`: Creates IVS RealTime stage, stores playback/ingest endpoints
   - `createRoom()`: Creates IVS Chat room
   - Parallel resource creation with `Promise.all`
   - Error handling that continues on individual failures

3. **Infrastructure Wiring** (`infra/lib/stacks/session-stack.ts`)
   - NodejsFunction with 5-minute timeout
   - EventBridge Rule with rate(5 minutes) schedule
   - IAM policies for IVS (CreateChannel, CreateStage, CreateRoom) with `resources: ['*']` (IVS doesn't support resource-level permissions for Create* actions)
   - DynamoDB read/write permissions for pool table
   - Environment variables: `TABLE_NAME`, `MIN_CHANNELS=3`, `MIN_STAGES=2`, `MIN_ROOMS=5`

### TDD Implementation

Task 2 followed TDD workflow:
- **RED**: Created failing tests for client singletons and handler structure (commit e4cd8c3)
- **GREEN**: Implemented clients and handler to pass tests (commit cc8c65d)
- **Test update**: Fixed class name expectations to match AWS SDK actual class names (commit 18e5908)

All 6 tests passing:
- IVS client singleton returns IvsClient instance
- IVS RealTime client singleton returns IVSRealTimeClient instance
- IVS Chat client singleton returns IvschatClient instance
- DynamoDB client singleton returns DynamoDBDocumentClient instance
- Handler reads environment variables
- Handler returns summary with channelsCreated, stagesCreated, roomsCreated

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All verification criteria met:

1. **TypeScript compilation**: No errors (`npx tsc --noEmit`)
2. **CDK synth**: Produces valid CloudFormation with Lambda, EventBridge Rule, IAM policies
3. **EventBridge rule**: Present in synthesized template (`AWS::Events::Rule`)
4. **Lambda environment vars**: `MIN_CHANNELS`, `MIN_STAGES`, `MIN_ROOMS` present in template
5. **IVS IAM permissions**: `ivs:CreateChannel`, `ivs:CreateStage`, `ivschat:CreateRoom` in template
6. **streamKey field**: Stored in pool items (addresses research Pitfall 5)

## Task Completion

| Task | Name                                                      | Status | Commit  | Files                                                                            |
| ---- | --------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------- |
| 1    | Install AWS SDK v3 packages for IVS and DynamoDB         | ✓      | 230dec1 | backend/package.json                                                             |
| 2    | Create AWS SDK singleton clients and replenishment Lambda | ✓      | cc8c65d | backend/src/lib/ivs-clients.ts, dynamodb-client.ts, replenish-pool.ts            |
| 2    | TDD tests                                                 | ✓      | e4cd8c3 | backend/src/handlers/\_\_tests\_\_/replenish-pool.test.ts                        |
| 2    | Test updates                                              | ✓      | 18e5908 | backend/src/handlers/\_\_tests\_\_/replenish-pool.test.ts                        |
| 3    | Wire Lambda to SessionStack with EventBridge and IAM      | ✓      | bc49384 | infra/lib/stacks/session-stack.ts                                                |

## Requirements Coverage

This plan addresses:
- **POOL-01**: Pre-warmed resource pool for instant session claims
- **POOL-02**: Scheduled background replenishment
- **POOL-03**: Configurable pool size thresholds
- **POOL-04**: DynamoDB persistence with AVAILABLE status

## Next Steps

Plan 02-03 (Pool Claim and Release) will:
1. Implement atomicClaimResource() with DynamoDB conditional write
2. Add releaseResource() for returning resources to pool
3. Create API endpoints for session claim/release
4. Add GSI1 query logic to find oldest available resource (FIFO claim pattern)

## Self-Check: PASSED

**Created files verification:**
- ✓ backend/src/lib/ivs-clients.ts exists
- ✓ backend/src/lib/dynamodb-client.ts exists
- ✓ backend/src/handlers/replenish-pool.ts exists
- ✓ backend/src/handlers/__tests__/replenish-pool.test.ts exists

**Modified files verification:**
- ✓ infra/lib/stacks/session-stack.ts contains ReplenishPool Lambda
- ✓ infra/lib/stacks/session-stack.ts contains EventBridge Rule
- ✓ backend/package.json contains @aws-sdk/client-ivs

**Commits verification:**
- ✓ 230dec1 exists (chore: install AWS SDK packages)
- ✓ e4cd8c3 exists (test: add failing tests - TDD RED)
- ✓ cc8c65d exists (feat: implement pool replenishment - TDD GREEN)
- ✓ 18e5908 exists (test: update test expectations)
- ✓ bc49384 exists (feat: wire Lambda to SessionStack)

**Functionality verification:**
- ✓ TypeScript compiles without errors
- ✓ CDK synth produces valid CloudFormation
- ✓ EventBridge rule present in template
- ✓ Lambda environment variables present
- ✓ IVS IAM permissions present
- ✓ streamKey field stored in pool items
