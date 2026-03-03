---
phase: 08-realtime-hangouts
plan: 01
subsystem: hangout-infrastructure
tags: [ivs-realtime, participant-tokens, authentication, security]
dependency_graph:
  requires: [phase-02-pool, cognito-auth]
  provides: [participant-token-generation, stage-arn-lookup]
  affects: [session-repository, api-stack]
tech_stack:
  added: [CreateParticipantTokenCommand]
  patterns: [token-generation, scan-based-lookup]
key_files:
  created:
    - backend/src/handlers/join-hangout.ts
    - backend/src/handlers/__tests__/join-hangout.test.ts
  modified:
    - backend/src/repositories/session-repository.ts
    - backend/src/repositories/__tests__/session-repository.test.ts
    - infra/lib/stacks/api-stack.ts
decisions:
  - decision: "Use DynamoDB Scan for Stage ARN lookup"
    rationale: "No GSI exists for claimedResources.stage field. Scan is acceptable for low-frequency queries (recording-ended events only). Can add GSI3 later if needed for high-frequency access."
    alternatives: ["Add GSI3 immediately", "Use in-memory cache"]
  - decision: "Wildcard IAM resource for CreateParticipantToken"
    rationale: "IVS RealTime doesn't support resource-level permissions for CreateParticipantToken action. AWS limitation, not security oversight."
  - decision: "12-hour participant token TTL"
    rationale: "Balance between user experience (long sessions) and security (token rotation). Matches IVS maximum TTL recommendation."
metrics:
  duration_seconds: 265
  duration_minutes: 4
  completed_at: "2026-03-03T13:57:29Z"
  tasks_completed: 3
  files_modified: 5
  tests_added: 7
---

# Phase 08 Plan 01: Participant Token Generation Summary

**One-liner:** Server-side IVS RealTime participant token generation with PUBLISH+SUBSCRIBE capabilities, Cognito auth integration, and Stage ARN-based session lookup for recording event handling.

## What Was Built

### Lambda Handler (join-hangout.ts)
- Generates IVS RealTime participant tokens for authenticated users joining hangout sessions
- Validates session exists and is `HANGOUT` type (not `BROADCAST`)
- Extracts userId from Cognito JWT authorizer claims
- Creates tokens with:
  - **Capabilities:** `['PUBLISH', 'SUBSCRIBE']` (full bidirectional RTC)
  - **Duration:** 43200 seconds (12 hours)
  - **Attributes:** `{ username }` for audit trail and participant display
- Returns token, participantId, and expirationTime to client
- **Security:** Never exposes Stage ARN to clients - tokens are the only hangout access mechanism

### Session Repository Extension (findSessionByStageArn)
- Query function finds sessions by IVS Stage ARN using DynamoDB Scan
- FilterExpression: `begins_with(PK, 'SESSION#') AND claimedResources.stage = :stageArn`
- Returns first matching session (Stage ARNs are unique per session)
- **Use case:** Recording-ended handler (Plan 08-03) will use this to map EventBridge events to sessions

### API Integration
- **Route:** POST `/sessions/{sessionId}/join`
- **Authorization:** Cognito JWT required (same as other protected endpoints)
- **Permissions:**
  - DynamoDB `GetItem` on sessions table
  - IAM `ivs:CreateParticipantToken` (wildcard resource - AWS limitation)
- **Timeout:** 10 seconds (token generation is fast)

## Commits

| Commit | Description | Files |
|--------|-------------|-------|
| f3bf28f | feat(08-01): implement join-hangout handler with participant token generation | backend/src/handlers/join-hangout.ts, backend/src/handlers/__tests__/join-hangout.test.ts |
| d37364a | feat(08-01): add findSessionByStageArn query to session repository | backend/src/repositories/session-repository.ts, backend/src/repositories/__tests__/session-repository.test.ts |
| 262b763 | feat(08-01): wire join-hangout handler to API | infra/lib/stacks/api-stack.ts |

## Test Coverage

**Total tests added:** 7 (4 join-hangout + 3 session-repository)

### join-hangout.test.ts (4 tests)
1. Handler validates sessionId and userId presence (400 if missing)
2. Handler returns 404 if session not found or sessionType != HANGOUT
3. Handler generates token with userId, capabilities:[PUBLISH,SUBSCRIBE], 12-hour TTL
4. Handler returns token structure: {token, participantId, expirationTime}

### session-repository.test.ts (3 additional tests)
1. findSessionByStageArn returns session when claimedResources.stage matches
2. findSessionByStageArn returns null when no matching Stage ARN found
3. Query uses Scan with FilterExpression (no GSI for Stage ARN lookup)

**All tests passing.**

## Deviations from Plan

None - plan executed exactly as written.

## Deferred Items

### Pre-existing TypeScript compilation errors
**Found during:** Task 3 verification
**Files:** `recording-ended.test.ts`, `stream-started.test.ts`
**Error:** Mock function signature mismatches (Expected 1 arguments, but got 3)
**Impact:** Tests in those handlers may be failing, but doesn't affect current plan
**Resolution:** Out of scope - appears to be from previous phase, logged to deferred-items.md

## Verification Results

- [x] Backend tests pass: `npm test -- join-hangout` (4/4 passing)
- [x] Session repository tests pass: `npm test -- session-repository` (7/7 passing)
- [x] TypeScript compiles: Task-related code compiles successfully
- [x] CDK synth succeeds: `npx cdk synth VNL-Api` produces valid CloudFormation
- [x] API route exists: `/sessions/{sessionId}/join` found in template
- [x] IAM policy includes: `ivs:CreateParticipantToken` with wildcard resource

## Success Criteria Met

- [x] join-hangout.ts Lambda handler generates participant tokens with PUBLISH+SUBSCRIBE capabilities and 12-hour TTL
- [x] findSessionByStageArn repository function queries sessions by Stage ARN using Scan
- [x] POST /sessions/:sessionId/join API route authenticated with Cognito JWT authorizer
- [x] All backend unit tests pass (join-hangout, session-repository)
- [x] CDK synth produces valid CloudFormation with Lambda, API route, and IAM permissions

## Architecture Notes

### Token Generation Flow
```
Client → POST /sessions/{sessionId}/join
         ↓ (Cognito JWT)
join-hangout handler
         ↓ GetItem(SESSION#{sessionId})
DynamoDB
         ↓ session.claimedResources.stage
IVS RealTime CreateParticipantToken
         ↓ {token, participantId, expirationTime}
Client ← 200 OK
```

### Recording Event Flow (Plan 08-03)
```
IVS RealTime → EventBridge (recording-ended)
               ↓ event.stageArn
recording-ended handler
               ↓ findSessionByStageArn(stageArn)
DynamoDB Scan
               ↓ session
updateRecordingMetadata
```

### Security Model
- **Clients never receive Stage ARNs** - only opaque participant tokens
- **Tokens are capability-scoped** - PUBLISH+SUBSCRIBE for hangouts (vs. view-only for viewers)
- **Tokens include userId** - enables audit trail in IVS events
- **JWT required** - only authenticated users can join hangouts

### Performance Considerations
- **findSessionByStageArn uses Scan** - acceptable for low-frequency recording events
- **Future optimization:** Add GSI3 with PK=`STAGE#{stageArn}` if high-frequency Stage lookups needed
- **Participant token generation** - fast (<100ms), no need for caching

## Next Steps

**Plan 08-02:** Build hangout client with IVS Web Broadcast SDK
- Use participant tokens from this plan to join Stage
- Implement multi-participant video grid
- Handle publish/subscribe state management

**Plan 08-03:** Recording lifecycle for hangouts
- Use findSessionByStageArn for EventBridge event mapping
- Update session metadata when recordings complete

## Self-Check

Verifying all claims in this summary.

**Files created:**
- backend/src/handlers/join-hangout.ts ✓
- backend/src/handlers/__tests__/join-hangout.test.ts ✓

**Files modified:**
- backend/src/repositories/session-repository.ts ✓
- backend/src/repositories/__tests__/session-repository.test.ts ✓
- infra/lib/stacks/api-stack.ts ✓

**Commits exist:**
- f3bf28f ✓
- d37364a ✓
- 262b763 ✓

**Tests pass:**
- join-hangout: 4/4 passing ✓
- session-repository: 7/7 passing ✓

**Infrastructure:**
- CDK synth successful ✓
- JoinHangout Lambda in template ✓
- /sessions/{sessionId}/join route exists ✓
- ivs:CreateParticipantToken permission exists ✓

## Self-Check: PASSED
