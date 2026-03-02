---
phase: 03-broadcasting
plan: 03
subsystem: backend, scripts
tags: [tdd, eventbridge, ivs-api, developer-tools]
requires: [Phase 3 Plan 1 APIs, pool replenishment]
provides: [session cleanup, viewer count API, dev testing tools]
affects: [backend API, EventBridge, developer workflow]
tech-stack:
  added: [IVS GetStream API, FFmpeg streaming script]
  patterns: [EventBridge cleanup handler, API response caching, developer testing scripts]
key-files:
  created:
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/get-viewer-count.ts
    - backend/src/services/broadcast-service.ts
    - scripts/test-broadcast.sh
    - scripts/README.md
  modified:
    - backend/src/repositories/resource-pool-repository.ts
    - infra/lib/stacks/api-stack.ts
    - infra/lib/stacks/session-stack.ts
key-decisions:
  - decision: "15-second cache TTL for viewer count API"
    rationale: "Matches IVS update frequency and avoids 5 TPS rate limit while providing fresh data"
  - decision: "releasePoolResource updates status and clears claimedBy/claimedAt atomically"
    rationale: "Ensures clean resource state for replenishment; version increment prevents race conditions"
  - decision: "FFmpeg script with automatic ingest config fetching"
    rationale: "Developer-friendly - no manual copy/paste of credentials; works with any session"
requirements-completed: [BCAST-04, POOL-06, SESS-03, DEV-06]
duration: 5min
completed: 2026-03-02T15:38:00Z
---

# Phase 3 Plan 3: Cleanup Lifecycle and Dev Tools Summary

**One-liner:** EventBridge-driven cleanup releases pool resources, viewer count API with caching, FFmpeg script for camera-less testing

## What Was Built

Completed the broadcast lifecycle with cleanup automation and developer tooling:

1. **recording-ended EventBridge Handler**
   - Listens for IVS Recording State Change events with recording_status='Recording End'
   - Finds session by channel ARN (using scan for v1)
   - Transitions session from ENDING to ENDED
   - Sets endedAt timestamp
   - Releases channel and chat room resources back to pool
   - Logs cleanup progress and errors

2. **releasePoolResource Repository Function**
   - Extracts resourceId and resourceType from ARN
   - Updates pool item status from CLAIMED to AVAILABLE
   - Clears claimedBy and claimedAt fields
   - Updates GSI1PK for status-based queries
   - Increments version for optimistic locking

3. **Viewer Count API** - GET /sessions/:id/viewers
   - Public endpoint (no authentication)
   - Returns current viewer count from IVS GetStream API
   - Caches results for 15 seconds to avoid rate limits (IVS allows 5 TPS)
   - Returns 0 for offline streams or HANGOUT sessions
   - broadcast-service module encapsulates caching logic

4. **FFmpeg Streaming Script** - scripts/test-broadcast.sh
   - Accepts session ID and video file as arguments
   - Fetches ingest config from API automatically
   - Streams video via FFmpeg with IVS-recommended settings (1080p30, 3.5 Mbps)
   - Loops video indefinitely for testing
   - Uses RTMPS for secure streaming
   - Comprehensive README with examples

## Implementation Approach

- **TDD workflow:** All backend tasks used RED-GREEN-REFACTOR cycle
- **EventBridge wiring:** Added Recording End rule to session-stack.ts
- **API Gateway wiring:** Added /viewers route (public) to api-stack.ts
- **Developer experience:** Script automates credential fetching, no manual copy/paste

## Key Files

**Created:**
- `backend/src/handlers/recording-ended.ts` (77 lines) - Cleanup handler
- `backend/src/handlers/get-viewer-count.ts` (73 lines) - Viewer count API
- `backend/src/services/broadcast-service.ts` (51 lines) - GetStream caching
- `scripts/test-broadcast.sh` (71 lines) - FFmpeg streaming script
- `scripts/README.md` (44 lines) - Developer documentation

**Modified:**
- `backend/src/repositories/resource-pool-repository.ts` (+49 lines) - releasePoolResource function
- `infra/lib/stacks/api-stack.ts` (+27 lines) - Viewer count route + IVS permissions
- `infra/lib/stacks/session-stack.ts` (+28 lines) - Recording End EventBridge rule

**Tests Created:**
- `backend/src/handlers/__tests__/recording-ended.test.ts`
- `backend/src/handlers/__tests__/get-viewer-count.test.ts`
- `backend/src/services/__tests__/broadcast-service.test.ts`
- `backend/src/repositories/__tests__/resource-pool-repository.test.ts` (updated)

## Metrics

- **Duration:** 5 minutes
- **Tasks:** 3 (2 TDD, 1 script)
- **Files created:** 5
- **Commits:** 5 (3 TDD cycles + script)
- **Tests added:** 4 test files

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

**Ready for:** Phase verification

**Blockers:** None

**Dependencies satisfied:**
- Session cleanup lifecycle complete (CREATING -> LIVE -> ENDING -> ENDED)
- Pool resources released automatically when broadcasts end
- Viewer count API available for frontend integration
- Developer can test broadcasts without camera using FFmpeg script
