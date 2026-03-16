---
phase: 040-ui-polish-replay-feed
plan: 02
subsystem: ui
tags: [react, vitest, activity-feed, polling, exponential-backoff, tailwind]

# Dependency graph
requires:
  - phase: 040-01
    provides: TranscriptDisplay click-to-seek and SummaryDisplay visual states
provides:
  - PipelineStatusBadge component for converting/transcribing/summarizing/complete/failed states
  - BroadcastActivityCard with thumbnail image and human-readable duration format
  - HangoutActivityCard with human-readable duration format and status badge
  - HomePage polling with exponential backoff for non-terminal pipeline sessions
affects: [040-03, activity-feed, home-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "formatHumanDuration exported from BroadcastActivityCard, imported by HangoutActivityCard"
    - "hasNonTerminalSessions() guard pattern for polling lifecycle management"
    - "useRef for interval ID + pollInterval state for exponential backoff"

key-files:
  created:
    - web/src/features/activity/PipelineStatusBadge.tsx
    - web/src/features/activity/__tests__/PipelineStatusBadge.test.tsx
  modified:
    - web/src/features/activity/BroadcastActivityCard.tsx
    - web/src/features/activity/HangoutActivityCard.tsx
    - web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx
    - web/src/features/activity/__tests__/HangoutActivityCard.test.tsx
    - web/src/features/activity/BroadcastActivityCard.test.tsx
    - web/src/features/activity/__tests__/RecordingSlider.test.tsx
    - web/src/pages/HomePage.tsx

key-decisions:
  - "data-testid='thumbnail' added to BroadcastActivityCard img — alt='' makes it role=presentation, not role=img"
  - "pollIntervalRef tracks interval ID to prevent stale closure on cleanup; pollInterval state drives backoff"
  - "prevHasNonTerminalRef tracks transition from all-terminal to non-terminal for poll interval reset"

patterns-established:
  - "Thumbnail query pattern: use getByTestId not getByRole when alt='' (decorative image)"
  - "Polling pattern: useRef for interval ID + state for interval duration + hasNonTerminal guard"

requirements-completed: [UI-03, UI-04, UI-05]

# Metrics
duration: 3min
completed: 2026-03-15
---

# Phase 40 Plan 02: Activity Feed Polish Summary

**Activity feed cards with video thumbnails, human-readable duration (X min Y sec), pipeline status badges, and HomePage polling with 15s->30s->60s exponential backoff**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-15T20:18:00Z
- **Completed:** 2026-03-15T20:21:00Z
- **Tasks:** 2
- **Files modified:** 7 (+ 2 pre-existing test fixes)

## Accomplishments
- PipelineStatusBadge renders Converting (yellow), Transcribing (yellow), Summarizing (purple), Complete (green), Failed (red) based on session pipeline state priority order
- BroadcastActivityCard shows thumbnail img (data-testid="thumbnail") and formats duration as "X min Y sec"
- HangoutActivityCard imports formatHumanDuration and PipelineStatusBadge from BroadcastActivityCard
- HomePage polls /activity with exponential backoff (15s->30s->60s cap) when non-terminal sessions exist, stops on terminal states, resets on transition from terminal to non-terminal

## Task Commits

Each task was committed atomically:

1. **Task 1: PipelineStatusBadge + thumbnail + formatHumanDuration** - `7d0f7c8` (feat)
2. **Task 2: HomePage polling with exponential backoff** - `f7c3ff5` (feat)

## Files Created/Modified
- `web/src/features/activity/PipelineStatusBadge.tsx` - Status badge with priority order: failed > converting > transcribing > summarizing > complete > null
- `web/src/features/activity/__tests__/PipelineStatusBadge.test.tsx` - 6 tests covering all badge states
- `web/src/features/activity/BroadcastActivityCard.tsx` - Added data-testid to thumbnail img, already had formatHumanDuration and PipelineStatusBadge
- `web/src/features/activity/HangoutActivityCard.tsx` - Imports formatHumanDuration and PipelineStatusBadge, removed local formatDuration
- `web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx` - Updated to use getByTestId('thumbnail')
- `web/src/pages/HomePage.tsx` - Added hasNonTerminalSessions(), pollInterval state, pollIntervalRef, polling useEffect

## Decisions Made
- `data-testid="thumbnail"` added to the thumbnail img element since `alt=""` gives it `role="presentation"` in ARIA, making `getByRole('img')` fail; `getByTestId` is the correct query for decorative images
- `pollIntervalRef` stores interval ID to avoid stale closure issues in cleanup function
- `prevHasNonTerminalRef` tracks whether sessions were previously non-terminal to detect transition and reset poll interval to 15s

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test query for decorative thumbnail image**
- **Found during:** Task 1 (PipelineStatusBadge + activity cards)
- **Issue:** Test used `getByRole('img')` but `<img alt="">` is role="presentation" in ARIA accessibility tree, causing test failure
- **Fix:** Added `data-testid="thumbnail"` to the img element; updated test to use `getByTestId('thumbnail')`
- **Files modified:** BroadcastActivityCard.tsx, `__tests__/BroadcastActivityCard.test.tsx`
- **Verification:** All 7 BroadcastActivityCard tests pass
- **Committed in:** 7d0f7c8 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed 3 pre-existing test failures blocking verification**
- **Found during:** Task 2 (full test suite verification)
- **Issue 1:** `RecordingSlider.test.tsx` expected "Recent Broadcasts" but component was renamed to "Recent Videos" in a prior commit
- **Issue 2:** `BroadcastActivityCard.test.tsx` (root level) expected "Summary coming soon..." but SummaryDisplay says "Generating summary..."
- **Issue 3:** Same file expected duration "2:00" format but component now uses formatHumanDuration ("2 min")
- **Fix:** Updated all three test assertions to match current implementation
- **Files modified:** `__tests__/RecordingSlider.test.tsx`, `activity/BroadcastActivityCard.test.tsx`
- **Verification:** 139/139 frontend tests pass
- **Committed in:** f7c3ff5 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2x Rule 1 - Bug)
**Impact on plan:** Required for test suite correctness. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## Next Phase Readiness
- Activity feed visual polish complete (UI-03, UI-04, UI-05 requirements satisfied)
- PipelineStatusBadge and formatHumanDuration available for reuse in future phases
- HomePage polling infrastructure in place; can tune intervals or add socket-based updates later

---
*Phase: 040-ui-polish-replay-feed*
*Completed: 2026-03-15*
