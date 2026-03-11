---
phase: 15-replay-and-hangout-integration-fixes
plan: "01"
subsystem: backend/session-service
tags: [session, recording, api, tdd]
dependency_graph:
  requires: []
  provides: [GetSessionResponse with recording fields]
  affects: [ReplayViewer, RecordingFeed, metadata panel]
tech_stack:
  added: []
  patterns: [service-layer data projection, security boundary filtering]
key_files:
  created:
    - backend/src/handlers/__tests__/get-session.test.ts
  modified:
    - backend/src/services/session-service.ts
key_decisions:
  - "GetSessionResponse is a distinct interface from CreateSessionResponse — recording fields only exist post-creation"
  - "claimedResources, recordingS3Path, version excluded per SESS-04 security boundary"
  - "getSession() return type changed from CreateSessionResponse to GetSessionResponse — additive, non-breaking for callers"
metrics:
  duration_minutes: 1
  completed_date: "2026-03-05"
  tasks_completed: 2
  files_changed: 2
---

# Phase 15 Plan 01: Fix getSession() Recording Fields Summary

**One-liner:** Extended getSession() to return recording metadata (recordingHlsUrl, recordingStatus, recordingDuration, thumbnailUrl) and session metadata (userId, createdAt, endedAt) via a new GetSessionResponse interface, unblocking the replay viewer.

## What Was Built

The replay viewer was completely broken because `session-service.ts::getSession()` stripped all recording fields before returning to the caller. A single targeted fix — adding a `GetSessionResponse` interface and populating all non-sensitive fields in the return object — unblocks four features simultaneously (REPLAY-04, REPLAY-05, REPLAY-07, REPLAY-09).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend getSession() with GetSessionResponse type | e221bd3 | backend/src/services/session-service.ts |
| 2 | Add get-session.test.ts unit tests | acc5b5d | backend/src/handlers/__tests__/get-session.test.ts |

## Verification Results

- `npx tsc --noEmit`: CLEAN
- `jest --testPathPatterns=get-session`: 3 passed (400, 404, 200 with recording fields)
- `GetSessionResponse` interface present with all required fields
- `claimedResources`, `recordingS3Path`, `version` confirmed absent from getSession() return

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `backend/src/services/session-service.ts`: FOUND
- `backend/src/handlers/__tests__/get-session.test.ts`: FOUND
- Commit e221bd3: FOUND
- Commit acc5b5d: FOUND
