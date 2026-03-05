---
phase: 15-replay-and-hangout-integration-fixes
plan: "02"
subsystem: hangout-integration
tags: [hangout, join, iam, replay, recording-feed]
dependency_graph:
  requires: []
  provides: [hangout-chat-enabled, participant-names-resolved, hangout-recordings-playable]
  affects: [backend/handlers/join-hangout, infra/api-stack, web/replay/RecordingFeed]
tech_stack:
  added: []
  patterns: [updateSessionStatus-try-catch, iam-grantReadWriteData]
key_files:
  created: []
  modified:
    - backend/src/handlers/join-hangout.ts
    - backend/src/handlers/__tests__/join-hangout.test.ts
    - infra/lib/stacks/api-stack.ts
    - web/src/features/replay/RecordingFeed.tsx
decisions:
  - "Wrap updateSessionStatus in try/catch for idempotency — second participant joining already-LIVE session is expected, not an error"
  - "userId: username in participant attributes resolves useHangout participant name display without changes to frontend"
  - "Always route recordings to /replay/:id regardless of sessionType — HANGOUT live stage is dead after session ends"
metrics:
  duration: 4 minutes
  completed_date: "2026-03-05"
  tasks_completed: 3
  files_modified: 4
---

# Phase 15 Plan 02: Hangout Integration Fixes Summary

Three hangout integration bugs fixed simultaneously: join-hangout transitions session to LIVE for chat, passes userId attribute for participant names, and RecordingFeed routes all recordings to the replay viewer.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Fix join-hangout.ts — LIVE transition and userId attribute | 5f180cd | backend/src/handlers/join-hangout.ts |
| 2 | Update join-hangout.test.ts and fix api-stack.ts IAM grant | adadca4 | backend/src/handlers/__tests__/join-hangout.test.ts, infra/lib/stacks/api-stack.ts |
| 3 | Fix RecordingFeed.tsx HANGOUT navigation to replay viewer | 2811fa5 | web/src/features/replay/RecordingFeed.tsx |

## What Was Built

**join-hangout.ts (3 changes):**
- Import `updateSessionStatus` and `SessionStatus` alongside existing `getSessionById` / `SessionType`
- Add `userId: username` to `CreateParticipantTokenCommand` attributes so `useHangout.ts` resolves `participant.attributes?.userId`
- Call `updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt')` after successful token generation, wrapped in try/catch — second participant joining an already-LIVE session swallows the error with `console.info`

**join-hangout.test.ts (3 updates):**
- Add `mockUpdateSessionStatus` mock reference
- Set `mockUpdateSessionStatus.mockResolvedValue(undefined)` in `beforeEach`
- Assert `attributes: { username: USERNAME, userId: USERNAME }` in token test
- Assert `mockUpdateSessionStatus` called with `(TABLE_NAME, SESSION_ID, SessionStatus.LIVE, 'startedAt')`

**api-stack.ts (1 change):**
- `grantReadData` → `grantReadWriteData` for `joinHangoutHandler` — required for `UpdateItem` permission that `updateSessionStatus` uses

**RecordingFeed.tsx (1 change):**
- Remove HANGOUT navigation ternary; `destination` always `/replay/${recording.sessionId}`
- `isHangout` variable retained for purple badge rendering

## Verification

- All 4 join-hangout tests pass
- Backend TypeScript compiles clean (`npx tsc --noEmit`)
- `grantReadWriteData(joinHangoutHandler)` present in api-stack.ts line 304
- `updateSessionStatus` called in join-hangout.ts
- `userId: username` in join-hangout.ts attributes
- RecordingFeed.tsx destination always `/replay/` pattern

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `5f180cd` exists: join-hangout.ts changes
- `adadca4` exists: test + IAM changes
- `2811fa5` exists: RecordingFeed.tsx fix
- All 4 key files modified as specified
