---
phase: 03-broadcasting
plan: 01
subsystem: broadcasting
tags: [tdd, api, eventbridge, ivs]
requires: [Phase 2 session model, resource pool]
provides: [broadcast start API, playback API, stream-started handler]
affects: [backend API, EventBridge, session lifecycle]
tech-stack:
  added: [EventBridge IVS Stream State Change events]
  patterns: [EventBridge event handler, public API endpoint, session status transitions]
key-files:
  created:
    - backend/src/handlers/start-broadcast.ts
    - backend/src/handlers/get-playback.ts
    - backend/src/handlers/stream-started.ts
  modified:
    - backend/src/repositories/session-repository.ts
    - infra/lib/stacks/api-stack.ts
    - infra/lib/stacks/session-stack.ts
key-decisions:
  - decision: "Public playback endpoint (no auth) for viewer access"
    rationale: "Viewers don't need authentication to watch broadcasts - simpler UX and enables embedding"
  - decision: "Scan for session by channel ARN in stream-started handler"
    rationale: "v1 simplicity - inefficient but works; can add GSI in v2 for O(1) lookup"
  - decision: "updateSessionStatus validates transitions with canTransition before write"
    rationale: "Enforces state machine integrity - prevents invalid lifecycle transitions"
requirements-completed: [BCAST-01, BCAST-03, BCAST-06]
duration: 5min
completed: 2026-03-02T15:26:00Z
---

# Phase 3 Plan 1: Broadcast Backend API Summary

**One-liner:** POST /sessions/:id/start returns ingest config, GET /sessions/:id/playback returns HLS URL, EventBridge transitions sessions to LIVE when streams start

## What Was Built

Implemented three Lambda handlers completing the backend broadcast lifecycle:

1. **start-broadcast handler** - POST /sessions/:id/start
   - Validates user authorization and session ownership
   - Checks session status is CREATING (not already started)
   - Retrieves ingestEndpoint and streamKey from pool item by channel ARN
   - Returns ingest config for broadcaster to start streaming

2. **get-playback handler** - GET /sessions/:id/playback (public endpoint)
   - No authentication required - enables public viewing
   - Returns playbackUrl and session status
   - Handles HANGOUT sessions gracefully (no channel = null playbackUrl)

3. **stream-started handler** - EventBridge handler for IVS Stream Start events
   - Listens for IVS Stream State Change events with event_name='Stream Start'
   - Finds session by channel ARN (using scan for v1)
   - Transitions session from CREATING to LIVE
   - Sets startedAt timestamp
   - Logs warning if session not found (orphaned channel)

4. **updateSessionStatus repository function**
   - Validates state transitions using canTransition before write
   - Uses optimistic locking (version check) to prevent race conditions
   - Supports optional timestamp fields (startedAt, endedAt)
   - Throws error on invalid transitions or version mismatch

## Implementation Approach

- **TDD workflow:** All tasks used RED-GREEN-REFACTOR cycle
- **Testing:** Unit tests for handler structure and error cases (integration tests need DynamoDB)
- **EventBridge wiring:** Added Stream Start rule to session-stack.ts
- **API Gateway wiring:** Added /start (protected) and /playback (public) routes to api-stack.ts

## Key Files

**Created:**
- `backend/src/handlers/start-broadcast.ts` (135 lines) - Ingest config API
- `backend/src/handlers/get-playback.ts` (99 lines) - Playback URL API
- `backend/src/handlers/stream-started.ts` (58 lines) - EventBridge handler

**Modified:**
- `backend/src/repositories/session-repository.ts` (+60 lines) - Added updateSessionStatus function
- `infra/lib/stacks/api-stack.ts` (+44 lines) - Wired start/playback routes
- `infra/lib/stacks/session-stack.ts` (+22 lines) - Added Stream Start EventBridge rule

**Tests Created:**
- `backend/src/handlers/__tests__/start-broadcast.test.ts`
- `backend/src/handlers/__tests__/get-playback.test.ts`
- `backend/src/handlers/__tests__/stream-started.test.ts`
- `backend/src/repositories/__tests__/session-repository.test.ts` (updated)

## Metrics

- **Duration:** 5 minutes
- **Tasks:** 3 (all TDD)
- **Files modified:** 6
- **Commits:** 6 (3 RED, 3 GREEN)
- **Tests added:** 4 test files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

**Ready for:** Plan 03-02 (Frontend broadcast/viewer pages with IVS SDKs)

**Blockers:** None

**Dependencies satisfied:**
- POST /sessions/:id/start endpoint ready for IVS Web Broadcast SDK integration
- GET /sessions/:id/playback endpoint ready for IVS Player SDK integration
- EventBridge handler will transition sessions to LIVE when broadcaster starts streaming
