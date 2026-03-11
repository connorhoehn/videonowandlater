---
phase: 28-chat-moderation
plan: "01"
subsystem: backend-moderation
tags: [moderation, chat, ivs, dynamodb, lambda, cdk]
dependency_graph:
  requires:
    - create-chat-token.ts (modified — isBounced check added)
    - session-repository.ts (getSessionById)
    - ivs-clients.ts (getIVSChatClient)
    - dynamodb-client.ts (getDocumentClient)
  provides:
    - bounce-user.ts — POST /sessions/{id}/bounce handler
    - report-message.ts — POST /sessions/{id}/report handler
    - create-chat-token.ts isBounced check — 403 blocklist for bounced users
    - api-stack.ts BounceUserHandler + ReportMessageHandler CDK constructs
  affects:
    - IVS Chat room (DisconnectUser call)
    - DynamoDB sessions table (MOD# records)
tech_stack:
  added: []
  patterns:
    - MOD# SK prefix for moderation log in single-table DynamoDB
    - DisconnectUserCommand with ResourceNotFoundException passthrough
    - QueryCommand with begins_with(SK, 'MOD#') + Limit:1 for efficient blocklist check
key_files:
  created:
    - backend/src/handlers/bounce-user.ts
    - backend/src/handlers/report-message.ts
    - backend/src/handlers/__tests__/bounce-user.test.ts
    - backend/src/handlers/__tests__/report-message.test.ts
  modified:
    - backend/src/handlers/create-chat-token.ts
    - backend/src/handlers/__tests__/create-chat-token.test.ts
    - infra/lib/stacks/api-stack.ts
decisions:
  - "Moderation records use PK=SESSION#{id} SK=MOD#{iso-ts}#{uuid} enabling begins_with prefix queries"
  - "DisconnectUserCommand errors other than ResourceNotFoundException are re-thrown (not swallowed)"
  - "isBounced helper is inline in create-chat-token.ts (single-purpose read, no service layer needed)"
  - "report handler has no session ownership check — any authenticated user can report a message"
  - "Bounce IAM: ivschat:DisconnectUser only on bounceUserHandler; report handler DynamoDB-only"
metrics:
  duration_seconds: 259
  completed_date: "2026-03-10"
  tasks_completed: 3
  files_changed: 7
---

# Phase 28 Plan 01: Chat Moderation Backend Summary

**One-liner:** Bounce handler (IVS DisconnectUser + BOUNCE DynamoDB record) + report handler (REPORT record) + isBounced token blocklist in create-chat-token, wired via CDK with 17 new unit tests.

## What Was Built

### bounce-user.ts (new)
POST /sessions/{sessionId}/bounce — broadcaster-only action that:
1. Calls `DisconnectUserCommand` on the IVS Chat room (catches `ResourceNotFoundException` — user may have left)
2. Writes a `BOUNCE` moderation record: `PK=SESSION#{id}`, `SK=MOD#{ts}#{uuid}`, `actionType=BOUNCE`, `userId=targetUserId`, `actorId=callerId`
3. Returns 200 in all success cases including IVS not-found passthrough

Auth: 401 (no Cognito claim), 403 (caller != session.userId).
Validation: 400 (missing sessionId or userId body), 404 (session not found).

### report-message.ts (new)
POST /sessions/{sessionId}/report — any authenticated user can report:
1. Writes a `REPORT` moderation record: `PK=SESSION#{id}`, `SK=MOD#{ts}#{uuid}`, `actionType=REPORT`, `msgId`, `reporterId`, `reportedUserId`
2. Returns 200 on success. No session ownership check.

### create-chat-token.ts (modified)
Added `isBounced(tableName, sessionId, userId)` helper that runs a `QueryCommand` with:
- `KeyConditionExpression: PK = :pk AND begins_with(SK, :skPrefix)` (where skPrefix = `MOD#`)
- `FilterExpression: actionType = :actionType AND #userId = :userId` (BOUNCE only)
- `Limit: 1` — stops after first match for efficiency
- Returns `true` if `Count > 0`

Called immediately after userId/sessionId extraction, before `generateChatToken`. Returns 403 `{ error: 'You have been removed from this chat' }` if bounced.

### api-stack.ts (modified)
Two new CDK constructs added after the `speaker-segments` block:
- `BounceUserHandler` — `NodejsFunction` with `grantReadWriteData` + `ivschat:DisconnectUser` IAM policy
- `ReportMessageHandler` — `NodejsFunction` with `grantReadWriteData` only (no IVS permissions needed)

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| bounce-user.test.ts | 8 new | PASS |
| report-message.test.ts | 6 new | PASS |
| create-chat-token.test.ts | 3 new + 4 existing | PASS |
| Full suite (all 53) | 428 total | PASS |

Previous: 360 tests. New: 17 tests added. Total: 428 tests (53 suites).

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files created/modified:
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/bounce-user.ts` — FOUND
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/report-message.ts` — FOUND
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/create-chat-token.ts` — modified with isBounced
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/__tests__/bounce-user.test.ts` — FOUND
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/__tests__/report-message.test.ts` — FOUND
- `/Users/connorhoehn/Projects/videonowandlater/infra/lib/stacks/api-stack.ts` — contains BounceUserHandler + ReportMessageHandler

### Commits:
- `5d1736e` feat(28-01): add bounce-user handler with DisconnectUserCommand + BOUNCE DynamoDB record
- `6c6021f` feat(28-01): add report-message handler + isBounced blocklist in create-chat-token
- `2689af1` feat(28-01): wire bounce and report routes in api-stack.ts

## Self-Check: PASSED
