---
phase: 16-hangout-participant-tracking
plan: 01
subsystem: backend
tags: [dynamodb, participant-tracking, hangout, session-lifecycle]
dependency_graph:
  requires: []
  provides: [addHangoutParticipant, getHangoutParticipants, updateParticipantCount, HangoutParticipant, participantCount]
  affects: [join-hangout, recording-ended, session-domain]
tech_stack:
  added: []
  patterns: [co-located-dynamo-items, best-effort-persistence, idempotent-upsert]
key_files:
  created: []
  modified:
    - backend/src/domain/session.ts
    - backend/src/repositories/session-repository.ts
    - backend/src/repositories/__tests__/session-repository.test.ts
    - backend/src/handlers/join-hangout.ts
    - backend/src/handlers/__tests__/join-hangout.test.ts
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/__tests__/recording-ended.test.ts
decisions:
  - "PutCommand (not UpdateCommand) for participant writes — enables idempotent re-join without ConditionalCheckFailedException"
  - "displayName = cognito:username — no separate display name field exists in the auth context"
  - "Participant count computed at session end (recording-ended handler), not maintained as atomic counter during joins"
metrics:
  duration_minutes: 4
  completed: "2026-03-06T00:34:12Z"
  tasks_completed: 2
  tasks_total: 2
  tests_added: 11
  tests_total: 195
---

# Phase 16 Plan 01: Hangout Participant Tracking Summary

Co-located PARTICIPANT items in DynamoDB under existing session PK, with best-effort persistence in join-hangout and count computation in recording-ended -- zero new AWS services or CDK changes.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Domain model extension and participant repository functions with tests | f591a4a | session.ts, session-repository.ts, session-repository.test.ts |
| 2 | Wire participant tracking into join-hangout and recording-ended handlers with tests | 04a5283 | join-hangout.ts, recording-ended.ts + test files |

## What Was Built

### Task 1: Domain Model + Repository Functions

**Domain extension:** Added `participantCount?: number` to the `Session` interface in `backend/src/domain/session.ts`.

**New interface:** `HangoutParticipant` exported from `session-repository.ts` with fields: `sessionId`, `userId`, `displayName`, `participantId`, `joinedAt`.

**Three new repository functions:**

1. `addHangoutParticipant(tableName, sessionId, userId, displayName, participantId)` -- Uses PutCommand with `PK=SESSION#{sessionId}`, `SK=PARTICIPANT#{userId}`, `entityType='PARTICIPANT'`. PutCommand makes re-joins idempotent (overwrites existing item, no ConditionalCheckFailedException).

2. `getHangoutParticipants(tableName, sessionId)` -- Uses QueryCommand with `begins_with(SK, 'PARTICIPANT#')`. Returns `HangoutParticipant[]` with PK/SK/entityType stripped.

3. `updateParticipantCount(tableName, sessionId, participantCount)` -- Uses UpdateCommand on `SESSION#{sessionId}/METADATA` to SET participantCount and increment version.

**Tests added:** 6 new tests in session-repository.test.ts covering all three functions including idempotent re-join behavior and empty result handling.

### Task 2: Handler Integrations

**join-hangout.ts:** After IVS token generation (line 65), calls `addHangoutParticipant` in a dedicated try/catch. On failure, logs error but continues to return 200 with token. Participant tracking is best-effort and does not block the user from joining.

**recording-ended.ts:** After reaction summary computation and BEFORE pool resource release, checks `session.sessionType === SessionType.HANGOUT`. If hangout, calls `getHangoutParticipants` then `updateParticipantCount` in a dedicated try/catch. Failure does not block pool resource release. BROADCAST sessions skip this logic entirely.

**Tests added:** 2 new tests in join-hangout.test.ts (participant persistence + error resilience), 3 new tests in recording-ended.test.ts (count computation for hangout + broadcast skip + error non-blocking).

## Decisions Made

1. **PutCommand for participant writes** -- Enables idempotent re-join. If a user disconnects and reconnects, the same PK/SK is overwritten (timestamp and participantId updated). No conditional expressions needed.

2. **displayName = cognito:username** -- The auth context only provides `cognito:username`, not a separate display name. Using userId as displayName keeps the field available for future enhancement without schema change.

3. **Count-at-end, not atomic counter** -- Participant count is computed at session end by querying all PARTICIPANT items and counting them. This avoids atomic counter race conditions during concurrent joins and is simpler since count is only needed for activity cards (post-session).

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

- Full backend test suite: **195 tests passing across 33 suites** (11 new tests added)
- All exports verified: `addHangoutParticipant`, `getHangoutParticipants`, `updateParticipantCount`, `HangoutParticipant`
- `participantCount` field present on Session interface
- Handler integrations verified: `addHangoutParticipant` called in join-hangout.ts, `getHangoutParticipants`/`updateParticipantCount` called in recording-ended.ts
- Best-effort patterns verified: both handlers continue normal operation when participant tracking fails

## Self-Check: PASSED

All 8 modified files exist on disk. Both task commits (f591a4a, 04a5283) verified in git log.
