---
phase: 10-integration-wiring-fixes
plan: 01
subsystem: ui, api
tags: [react, typescript, replay, chat, hangout, ivs-realtime]

# Dependency graph
requires:
  - phase: 06-replay-viewer
    provides: ReplayChat and ReplayViewer components from Phase 06-03
  - phase: 08-realtime-hangouts
    provides: join-hangout Lambda handler and useHangout.ts consumer from Phase 08-01/08-02
provides:
  - ReplayChat.tsx fetching correct /chat/messages path with Cognito JWT Authorization header
  - ReplayViewer.tsx passing authToken prop to ReplayChat
  - join-hangout.ts returning userId field so local participant username displays correctly
affects: [phase-11, phase-12]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pass authToken from parent (ReplayViewer) down to child fetch components (ReplayChat) as explicit prop"
    - "Include userId: username in all join-type Lambda responses so frontend participant display works"

key-files:
  created: []
  modified:
    - web/src/features/replay/ReplayChat.tsx
    - web/src/features/replay/ReplayViewer.tsx
    - backend/src/handlers/join-hangout.ts

key-decisions:
  - "No architectural changes — both fixes are surgical one-liners; authToken already in scope in ReplayViewer from localStorage"
  - "userId in join-hangout response uses existing username variable (cognito:username claim) — no new extraction needed"

patterns-established:
  - "Auth prop threading: parent component reads token from localStorage and passes it as prop to child data-fetching components"

requirements-completed: [REPLAY-06, REPLAY-07, HANG-01]

# Metrics
duration: 1min
completed: 2026-03-04
---

# Phase 10 Plan 01: Integration Wiring Fixes Summary

**ReplayChat fixed to fetch /chat/messages with Cognito JWT auth header; join-hangout response now includes userId so local participant name renders correctly instead of "undefined (You)"**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-04T02:11:26Z
- **Completed:** 2026-03-04T02:12:16Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Fixed ReplayChat fetch URL from `/sessions/{id}/messages` to `/sessions/{id}/chat/messages` (the authoritative route defined in api-stack.ts)
- Added `Authorization: Bearer ${authToken}` header to the ReplayChat fetch so the Cognito-protected GET endpoint no longer returns 401
- Added `authToken: string` prop to `ReplayChatProps` and plumbed `authToken={authToken}` from ReplayViewer (token already read from localStorage at line 45)
- Added `userId: username` to the join-hangout 200 response body so useHangout.ts destructuring of `userId` receives the correct Cognito username

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix ReplayChat API path and add auth header** - `78fa630` (fix)
2. **Task 2: Add userId to join-hangout response** - `b4f1321` (fix)

## Files Created/Modified

- `web/src/features/replay/ReplayChat.tsx` - Added authToken prop, fixed fetch URL path (/chat/messages), added Authorization header
- `web/src/features/replay/ReplayViewer.tsx` - Pass authToken={authToken} to ReplayChat JSX
- `backend/src/handlers/join-hangout.ts` - Added userId: username field to 200 response JSON body

## Decisions Made

- No architectural changes required; both bugs were surgical one-line or one-field fixes
- authToken is already available in ReplayViewer.tsx from localStorage (line 45), so no new state or effect was needed — only prop threading

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Both TypeScript compilations passed without errors after the fixes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- REPLAY-06 satisfied: ReplayChat will now fetch messages successfully from the correct authenticated endpoint
- REPLAY-07 satisfied: useSynchronizedChat auto-scroll hook works once messages load (hook already correct from Phase 06-03)
- HANG-01 satisfied: join-hangout now returns userId, local participant will show correct username in HangoutRoom

## Self-Check: PASSED

- FOUND: web/src/features/replay/ReplayChat.tsx
- FOUND: web/src/features/replay/ReplayViewer.tsx
- FOUND: backend/src/handlers/join-hangout.ts
- FOUND: .planning/phases/10-integration-wiring-fixes/10-01-SUMMARY.md
- FOUND: commit 78fa630 (Task 1)
- FOUND: commit b4f1321 (Task 2)

---
*Phase: 10-integration-wiring-fixes*
*Completed: 2026-03-04*
