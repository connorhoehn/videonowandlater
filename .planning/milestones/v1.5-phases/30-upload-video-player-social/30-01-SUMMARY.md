---
phase: 30-upload-video-player-social
plan: "01"
subsystem: backend
tags: [comments, dynamodb, lambda, tdd]
dependency_graph:
  requires: []
  provides: [POST /sessions/{id}/comments, GET /sessions/{id}/comments, createUploadSession startedAt fix]
  affects: [create-reaction.ts startedAt guard, Phase 30 plans 02 and 03]
tech_stack:
  added: []
  patterns: [TDD red-green, DynamoDB PutCommand, DynamoDB QueryCommand begins_with, zero-padded SK for natural sort]
key_files:
  created:
    - backend/src/handlers/create-comment.ts
    - backend/src/handlers/get-comments.ts
    - backend/src/handlers/__tests__/create-comment.test.ts
    - backend/src/handlers/__tests__/get-comments.test.ts
  modified:
    - backend/src/repositories/session-repository.ts
decisions:
  - "Comments do not verify session existence in create-comment.ts — keeps handler fast and simple, consistent with plan spec"
  - "get-comments returns natural DynamoDB SK sort order (COMMENT#{padded ms}#uuid = ascending videoPositionMs) without client-side sort"
metrics:
  duration_seconds: 248
  tasks_completed: 2
  files_changed: 5
  completed_date: "2026-03-11"
---

# Phase 30 Plan 01: Comments API + Upload Session Fix Summary

**One-liner:** JWT-guarded comments API with 15-digit zero-padded SK for natural sort order and one-line startedAt fix enabling upload session reactions.

## What Was Built

Two Lambda handlers for the Phase 30 social features backend, plus a one-line fix to unblock upload session reactions.

### create-comment.ts
- `POST /sessions/{sessionId}/comments` handler
- Validates: sessionId, userId (401), text (non-empty), videoPositionMs (non-negative)
- DynamoDB SK: `COMMENT#{videoPositionMs.padStart(15, '0')}#{uuid}` — enables ascending sort by position
- Returns 201 with `{ commentId, videoPositionMs, createdAt }`
- 10 unit tests covering all validation and success cases

### get-comments.ts
- `GET /sessions/{sessionId}/comments` handler
- QueryCommand with `begins_with(SK, 'COMMENT#')` + Limit 500
- Returns comments in ascending videoPositionMs order (natural SK sort)
- Returns `{ comments: [] }` when no comments exist
- 7 unit tests covering validation, empty results, field mapping, and query structure

### session-repository.ts fix
- Added `startedAt: now` to `createUploadSession` uploadSession object
- Previously missing — caused `create-reaction.ts` to return 400 ("Session has no startedAt timestamp") for UPLOAD sessions

## Test Results

- create-comment: 10/10 passing
- get-comments: 7/7 passing
- Full suite: 445/445 passing (up from 360 — includes all intervening phases)
- TypeScript: 0 errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test helper used JavaScript default parameter for undefined**
- **Found during:** Task 1 GREEN phase
- **Issue:** `createEvent(body, undefined)` in the test was triggering the default parameter value `'session-123'` instead of passing undefined, causing the sessionId validation test to receive a valid sessionId and return 201
- **Fix:** Replaced positional parameters with an `opts` object (`{ sessionId?, userId? }`) so callers can explicitly pass `null` to bypass defaults
- **Files modified:** `backend/src/handlers/__tests__/create-comment.test.ts`
- **Commit:** c88f550

**2. [Rule 1 - Bug] Jest mock hoisting - mockSend initialized before declaration**
- **Found during:** Task 2 RED/GREEN phase
- **Issue:** `jest.mock()` is hoisted by Babel/ts-jest above variable declarations, causing `Cannot access 'mockSend' before initialization` when the factory closure references an outer `let` variable
- **Fix:** Moved `mockSend` declaration inside `beforeEach` with `require('../../lib/dynamodb-client')` to access the mock after module resolution
- **Files modified:** `backend/src/handlers/__tests__/get-comments.test.ts`
- **Commit:** 88e6c93

## Commits

| Hash | Message |
|------|---------|
| c88f550 | feat(30-01): create-comment handler and fix createUploadSession startedAt |
| 88e6c93 | feat(30-01): get-comments handler with DynamoDB query |

## Self-Check: PASSED
