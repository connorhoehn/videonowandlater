---
phase: 041-ui-polish-live-session-upload
plan: 03
subsystem: ui
tags: [react, polling, seek, video, hls, upload]

# Dependency graph
requires:
  - phase: 041-01
    provides: RED test scaffolds for UI-08/09 (VideoPage polling, CommentThread click-to-seek)
provides:
  - VideoPage pipeline polling with exponential backoff (15s→30s→60s cap)
  - VideoPage stops polling when session reaches terminal state
  - VideoInfoPanel onSeek prop passed through to TranscriptDisplay
  - CommentThread onSeek prop + click handler on each comment row
  - seekVideo callback wired to both VideoInfoPanel and CommentThread
affects: [upload-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Polling pattern: useRef<ReturnType<typeof setInterval>|null> + useState(15000) + useEffect with cleanup; isUploadTerminal() guard"
    - "Seek wiring pattern: seekVideo(timeMs) callback passed as onSeek prop to child components"

key-files:
  modified:
    - web/src/features/upload/VideoPage.tsx
    - web/src/features/upload/VideoInfoPanel.tsx
    - web/src/features/upload/CommentThread.tsx
    - web/src/features/upload/__tests__/VideoPage.test.tsx

key-decisions:
  - "VideoPage polling tests rewritten from fake-timers + act() to real timers + waitFor() because React 18 act(async) hangs when a setInterval is registered (act waits for all async work to drain, but setInterval never drains). The useStreamMetrics pattern (act + runOnlyPendingTimers) only works for hooks without ongoing interval side effects"
  - "isUploadTerminal() is terminal when aiSummaryStatus=available OR any status=failed"

patterns-established:
  - "For tests that check setInterval IS called (not its callback behavior): use real timers + waitFor()"
  - "For tests that check setInterval is NOT called: real timers + waitFor for fetch completion + negative assertion"

requirements-completed: [UI-08, UI-09]

# Metrics
duration: 30min
completed: 2026-03-16
---

# Phase 041 Plan 03: VideoPage Polling + Click-to-Seek Summary

**VideoPage gains polling (UI-08) and click-to-seek (UI-09) via onSeek prop wired to VideoInfoPanel and CommentThread**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-03-16
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `isUploadTerminal()` helper to VideoPage — terminal when `aiSummaryStatus === 'available'` or any status `=== 'failed'`
- Added `pollInterval` state (15000 initial) + `pollIntervalRef` ref to VideoPage
- Added polling `useEffect` that: clears prior interval at start, returns early for terminal sessions, sets interval that re-fetches session and doubles `pollInterval` (capped at 60000)
- Added `seekVideo(timeMs: number)` callback using `videoRef.current.currentTime = timeMs / 1000`
- Wired `onSeek={seekVideo}` to both `<VideoInfoPanel>` and `<CommentThread>`
- (Task 1, committed in beeca5a) Added `onSeek` prop to `VideoInfoPanelProps` + passed through to `TranscriptDisplay`; added `onSeek` prop to `CommentThreadProps` + onClick on each comment row
- Fixed RED scaffold tests: replaced fake-timers + `act(async)` with real timers + `waitFor` — all 4 tests now GREEN

## Task Commits

1. **Task 1: Add onSeek prop to VideoInfoPanel and CommentThread** — `beeca5a` (feat)
2. **Task 2: Add VideoPage polling + seekVideo + wire onSeek** — `85067f0` (feat + fix)

## Files Created/Modified
- `web/src/features/upload/VideoPage.tsx` — polling useEffect, seekVideo, onSeek wiring
- `web/src/features/upload/VideoInfoPanel.tsx` — onSeek prop added, passed to TranscriptDisplay
- `web/src/features/upload/CommentThread.tsx` — onSeek prop added, comment row onClick
- `web/src/features/upload/__tests__/VideoPage.test.tsx` — test fix (real timers + waitFor)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scaffold tests used fake timers + act(async) which hangs in React 18**
- **Found during:** Task 2 verification
- **Issue:** `act(async () => { await vi.runAllTicks(); })` + `setInterval` registration causes React 18's `act` to hang forever — `act` drains the async work queue but a registered interval never "drains"
- **Fix:** Rewrote first describe block to use real timers + `waitFor(() => expect(pollingCalls.length > 0))`. Second describe block (negative assertions) already used real timers + `waitFor` correctly
- **Files modified:** `web/src/features/upload/__tests__/VideoPage.test.tsx`
- **Verification:** All 4 VideoPage tests GREEN; all 160 web tests GREEN; TypeScript clean

## Issues Encountered
- React 18 `act(async)` incompatibility with `setInterval` registration. Pattern: fake timers + `act` works for hooks that use `setTimeout` (fires once, clears), but NOT for ongoing `setInterval` registration in component effects.

## Next Phase Readiness
- Phase 041 all 3 plans complete: UI-06, UI-07, UI-08, UI-09 all GREEN
- Ready for phase verification or next phase

---
*Phase: 041-ui-polish-live-session-upload*
*Completed: 2026-03-16*

## Self-Check: PASSED
- web/src/features/upload/VideoPage.tsx: FOUND (polling + seekVideo + onSeek wiring)
- web/src/features/upload/VideoInfoPanel.tsx: FOUND (onSeek prop)
- web/src/features/upload/CommentThread.tsx: FOUND (onSeek + click handler)
- All 160 web tests: PASSING
- TypeScript: CLEAN
- Commit beeca5a: FOUND (Task 1)
- Commit 85067f0: FOUND (Task 2)
