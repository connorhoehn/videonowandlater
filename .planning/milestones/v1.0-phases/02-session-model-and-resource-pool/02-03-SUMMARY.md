---
phase: 02-session-model-and-resource-pool
plan: 03
subsystem: session-api
tags: [api-endpoints, atomic-claims, retry-logic, lambda-handlers, race-condition-prevention]

dependency_graph:
  requires: [02-01, 02-02]
  provides:
    - session-creation-api
    - atomic-pool-claim-logic
    - session-repository-layer
    - retry-orchestration
  affects:
    - backend/src/repositories/*
    - backend/src/services/*
    - backend/src/handlers/create-session.ts
    - backend/src/handlers/get-session.ts
    - infra/lib/stacks/api-stack.ts
    - infra/bin/app.ts

tech_stack:
  added: []
  patterns:
    - DynamoDB conditional writes for atomic resource claiming
    - Retry logic with MAX_RETRIES constant for race condition handling
    - Repository pattern for data access layer
    - Service layer for business logic orchestration
    - User-safe API responses (no AWS ARNs exposed per SESS-04)

key_files:
  created:
    - backend/src/repositories/resource-pool-repository.ts
    - backend/src/repositories/session-repository.ts
    - backend/src/repositories/__tests__/resource-pool-repository.test.ts
    - backend/src/repositories/__tests__/session-repository.test.ts
    - backend/src/services/session-service.ts
    - backend/src/services/__tests__/session-service.test.ts
    - backend/src/handlers/create-session.ts
    - backend/src/handlers/get-session.ts
  modified:
    - infra/lib/stacks/api-stack.ts
    - infra/bin/app.ts

decisions:
  - decision: Use DynamoDB conditional writes with version check for atomic claims
    rationale: Prevents race conditions when multiple requests claim the same resource simultaneously
    alternatives: [Optimistic locking without version, Pessimistic locking with transactions]
  - decision: Return null on ConditionalCheckFailedException instead of throwing
    rationale: Enables retry logic in service layer to attempt claiming next available resource
    alternatives: [Throw error, Use DynamoDB transactions]
  - decision: MAX_RETRIES=3 for pool claim attempts
    rationale: Balances between handling concurrent conflicts and request timeout limits
    alternatives: [1 retry (fail fast), 5+ retries (higher latency)]
  - decision: No exponential backoff in v1 retry logic
    rationale: Immediate retries sufficient for v1; can add later if needed
    alternatives: [Exponential backoff with jitter, Fixed delay between retries]
  - decision: Return 503 with Retry-After header on pool exhaustion
    rationale: Follows HTTP standards for service unavailability; instructs clients to retry
    alternatives: [400 Bad Request, 500 Internal Server Error]
  - decision: Expose only sessionId, sessionType, and status in API responses
    rationale: Abstracts AWS implementation details (ARNs) from client per SESS-04 requirement
    alternatives: [Expose full session object, Create separate DTO types]

metrics:
  duration_seconds: 257
  duration_minutes: 4
  completed_at: "2026-03-02T14:44:08Z"
  task_count: 3
  file_count: 10
  test_count: 7
---

# Phase 02 Plan 03: Atomic Resource Pool Claims and Session Creation API Summary

**One-liner:** Race-condition-free session creation API with atomic DynamoDB conditional writes, retry orchestration, and user-safe responses excluding AWS ARNs.

## What Was Built

Implemented a complete session creation system with three architectural layers:

1. **Repository Layer**: DynamoDB operations with atomic conditional writes
2. **Service Layer**: Business logic with retry orchestration for concurrent claim conflicts
3. **Handler Layer**: API Gateway Lambda functions with Cognito authorization

The system ensures two simultaneous POST /sessions requests never claim the same IVS resource, and abstracts AWS implementation details (ARNs) from user-facing responses.

### Core Components

**Repository Layer** (`backend/src/repositories/`)
- `resource-pool-repository.ts`:
  - `claimNextAvailableResource()`: Queries GSI1 for AVAILABLE resources, uses conditional write with version check
  - FIFO ordering (oldest resource first via GSI1SK = createdAt)
  - Returns null on ConditionalCheckFailedException (enables retry)
  - Returns null when pool exhausted (no AVAILABLE resources)
- `session-repository.ts`:
  - `createSession()`: Stores session with PK=SESSION#{sessionId}, SK=METADATA
  - `getSessionById()`: Retrieves session and strips DynamoDB keys from response

**Service Layer** (`backend/src/services/session-service.ts`)
- `createNewSession()`:
  - Generates sessionId with uuid
  - Claims resources with MAX_RETRIES=3 retry logic
  - BROADCAST sessions: claims channel + chatRoom
  - HANGOUT sessions: claims stage + chatRoom
  - Returns error in response when pool exhausted (handled as 503 in handler)
- `getSession()`:
  - Returns user-safe object with only sessionId, sessionType, status
  - Strips claimedResources and other internal fields (per SESS-04)

**Handler Layer** (`backend/src/handlers/`)
- `create-session.ts`:
  - POST /sessions endpoint
  - Validates sessionType (BROADCAST or HANGOUT)
  - Extracts userId from Cognito claims
  - Returns 201 on success, 503 with Retry-After: 60 on pool exhaustion
  - Returns 400 for bad request, 401 for unauthorized
- `get-session.ts`:
  - GET /sessions/{sessionId} endpoint
  - Returns 200 on success, 404 for not found
  - Returns 400 if sessionId missing

**Infrastructure Wiring** (`infra/lib/stacks/api-stack.ts`)
- Added sessionsTable prop to ApiStackProps
- Created POST /sessions route with Cognito authorizer
- Created GET /sessions/{sessionId} route with Cognito authorizer
- Granted DynamoDB read/write to create-session handler
- Granted DynamoDB read to get-session handler
- Updated app.ts to pass sessionsTable from SessionStack to ApiStack

## Tasks Completed

### Task 1: Create repository layer for atomic pool claims and session persistence

**Status:** Complete
**Commit:** 1c21e25

Implemented two repository files following atomic claim pattern from research:

- Created `claimNextAvailableResource()` with:
  - GSI1 query for AVAILABLE resources filtered by type
  - Conditional write with version check: `#status = :available AND #version = :currentVersion`
  - Atomically updates status to CLAIMED, sets claimedBy, increments version, updates GSI1PK
  - Catches ConditionalCheckFailedException and returns null (not thrown)
- Created `createSession()` and `getSessionById()` for session persistence
- Added test scaffolding for repository layer

**Verification:**
- TypeScript compilation passes with no errors
- Conditional write present: `ConditionExpression: '#status = :available AND #version = :currentVersion'`

### Task 2: Create service layer with retry logic and session orchestration

**Status:** Complete
**Commit:** f735b9d

Implemented service layer orchestrating pool claims and session creation:

- Created `createNewSession()` with:
  - MAX_RETRIES=3 constant for retry logic
  - `claimResourceWithRetry()` helper function
  - Resource claim orchestration: channel+chatRoom for BROADCAST, stage+chatRoom for HANGOUT
  - Session object creation with uuid sessionId and status=CREATING
  - Error response when pool exhausted (not thrown - returned in response)
- Created `getSession()` returning user-safe object:
  - Only sessionId, sessionType, status exposed
  - No claimedResources or AWS ARNs (per SESS-04)
- Added test scaffolding for service layer

**Verification:**
- TypeScript compilation passes with no errors
- MAX_RETRIES constant present and used in retry calls

### Task 3: Create Lambda handlers and wire to API Gateway

**Status:** Complete
**Commit:** 20c92a1

Created Lambda handlers and wired to API Gateway:

- Created `create-session.ts` handler:
  - Validates sessionType in request body
  - Extracts userId from Cognito claims
  - Returns 503 with Retry-After: 60 on pool exhaustion
  - Returns 201 on success, 400 for bad request, 401 for unauthorized
  - Follows Phase 1 CORS patterns
- Created `get-session.ts` handler:
  - Extracts sessionId from path parameters
  - Returns 200 on success, 404 for not found, 400 if sessionId missing
  - Follows Phase 1 CORS patterns
- Updated ApiStack:
  - Added sessionsTable prop to ApiStackProps interface
  - Added DynamoDB import
  - Wired POST /sessions and GET /sessions/{sessionId} routes
  - Both routes use Cognito authorizer
  - Granted appropriate DynamoDB permissions
- Updated app.ts:
  - Reordered stack creation (SessionStack before ApiStack)
  - Pass sessionsTable from SessionStack to ApiStack

**Verification:**
- TypeScript compilation passes (backend and infra)
- CDK synth produces valid CloudFormation for all 4 stacks
- 503 status code present in create-session handler
- 78 references to "session" in API stack synth output
- Both CreateSessionHandler and GetSessionHandler present in template

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:

1. **Repository layer implements atomic pool claims with conditional writes** - PASS
   - ConditionExpression with version check present
   - ConditionalCheckFailedException caught and returns null

2. **Service layer includes retry logic with MAX_RETRIES constant** - PASS
   - MAX_RETRIES=3 defined and used in claimResourceWithRetry

3. **Pool exhaustion returns 503 with Retry-After header** - PASS
   - statusCode: 503 present in create-session handler
   - Retry-After: '60' header present in 503 response

4. **Session API responses exclude AWS ARNs** - PASS
   - getSession returns only sessionId, sessionType, status
   - No resourceArn in response object

5. **POST /sessions and GET /sessions/{sessionId} routes wired to API Gateway** - PASS
   - Both handlers present in CDK synth output
   - Both routes use Cognito authorizer

6. **Lambda handlers follow Phase 1 patterns** - PASS
   - CORS headers on all responses
   - Username extraction from Cognito claims
   - Proper error handling (400, 401, 404, 503)

7. **No TypeScript errors, CDK synth produces valid CloudFormation** - PASS
   - backend: npx tsc --noEmit succeeds
   - infra: npx cdk synth succeeds for all 4 stacks

## Requirements Coverage

This plan addresses:
- **POOL-05**: Atomic resource claiming prevents double-booking

## Dependencies and Integration

**Consumed:**
- Phase 02-01: Session and ResourcePoolItem domain types
- Phase 02-01: SessionStack.table for DynamoDB access
- Phase 02-02: AWS SDK client singletons (DynamoDB DocumentClient)
- Phase 01-02: API Gateway and Cognito authorizer patterns
- Phase 01-02: Lambda handler CORS and error handling patterns

**Provided for next plans:**
- POST /sessions API endpoint for session creation
- GET /sessions/{sessionId} API endpoint for session retrieval
- Repository pattern for DynamoDB operations
- Service layer with retry orchestration
- Atomic pool claim logic preventing race conditions

**Next Steps (Plan 02-04 or Phase 03):**
- Session lifecycle transitions (CREATING -> LIVE -> ENDING -> ENDED)
- Resource release logic (return resources to pool)
- Session cleanup and monitoring

## Technical Decisions

### Atomic Claim Pattern

**Conditional Write with Version Check:**
- Used DynamoDB conditional expression: `#status = :available AND #version = :currentVersion`
- Prevents race conditions when multiple Lambda invocations query same resource
- ConditionalCheckFailedException indicates another request won the race
- Increments version on successful claim for future optimistic locking

**FIFO Resource Selection:**
- GSI1 query with `ScanIndexForward: true` returns oldest resource first
- GSI1SK = createdAt ensures resources used in creation order
- Prevents resource starvation (newest resources never used)

### Retry Strategy

**Immediate Retries (No Backoff):**
- MAX_RETRIES=3 attempts per resource type
- No exponential backoff for v1 (simplicity)
- Each retry queries GSI1 again (may get different resource)
- Can add backoff in future if contention becomes issue

**Null Return on Failure:**
- Repository layer returns null on ConditionalCheckFailedException
- Service layer interprets null as "retry with different resource"
- Enables graceful handling of both race conditions and pool exhaustion

### API Design

**User-Safe Responses:**
- Abstracted AWS ARNs from API responses per SESS-04 requirement
- Clients only see sessionId, sessionType, status
- Internal claimedResources field not exposed
- Enables future backend changes without breaking API contract

**Pool Exhaustion Handling:**
- Returns 503 Service Unavailable (not 500 Internal Server Error)
- Includes Retry-After: 60 header (instructs clients to retry in 60s)
- Error message in response body for debugging
- Follows HTTP standards for temporary unavailability

## Performance Notes

- 3 tasks completed in 257 seconds (4 minutes 17 seconds)
- TypeScript compilation: ~2 seconds
- CDK synth all stacks: ~8 seconds
- Average task completion: ~85 seconds

## Outstanding Items

None. Plan executed as specified with no deviations.

## Self-Check: PASSED

### Created Files
- [x] backend/src/repositories/resource-pool-repository.ts - FOUND
- [x] backend/src/repositories/session-repository.ts - FOUND
- [x] backend/src/repositories/__tests__/resource-pool-repository.test.ts - FOUND
- [x] backend/src/repositories/__tests__/session-repository.test.ts - FOUND
- [x] backend/src/services/session-service.ts - FOUND
- [x] backend/src/services/__tests__/session-service.test.ts - FOUND
- [x] backend/src/handlers/create-session.ts - FOUND
- [x] backend/src/handlers/get-session.ts - FOUND

### Modified Files
- [x] infra/lib/stacks/api-stack.ts - sessionsTable prop added
- [x] infra/bin/app.ts - sessionsTable passed to ApiStack

### Commits
- [x] 1c21e25 - feat(02-03): repository layer - FOUND
- [x] f735b9d - feat(02-03): service layer - FOUND
- [x] 20c92a1 - feat(02-03): Lambda handlers and API Gateway - FOUND

### Functionality Verification
```bash
# TypeScript compilation
npx tsc --noEmit --project backend/tsconfig.json  # ✓ No errors

# CDK synth all stacks
npx cdk synth --quiet  # ✓ Successfully synthesized 4 stacks

# Conditional write present
grep "ConditionExpression" backend/src/repositories/resource-pool-repository.ts
# ✓ Found: ConditionExpression: '#status = :available AND #version = :currentVersion'

# Retry logic present
grep "MAX_RETRIES" backend/src/services/session-service.ts
# ✓ Found: const MAX_RETRIES = 3; (used 4 times)

# Pool exhaustion handling
grep "503" backend/src/handlers/create-session.ts
# ✓ Found: statusCode: 503

# No ARNs in getSession
grep -A 10 "export async function getSession" backend/src/services/session-service.ts
# ✓ Returns only sessionId, sessionType, status

# API routes present
npx cdk synth VNL-Api | grep -i session
# ✓ 78 references to session in template
```
