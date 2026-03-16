---
phase: 041-ui-polish-live-session-upload
plan: 02
subsystem: ui
tags: [react, confirmation-dialog, reactions, hangout, broadcast, emoji, ivs-chat]

# Dependency graph
requires:
  - phase: 041-01
    provides: RED test scaffolds for UI-06/07 (ConfirmDialog, HangoutPage leave guard, reaction parity)
provides:
  - ConfirmDialog shared component with data-testid attributes for test compatibility
  - BroadcastPage Stop Broadcast guarded by ConfirmDialog
  - HangoutPage Leave buttons guarded by ConfirmDialog
  - HangoutPage full reaction system (ReactionPicker, FloatingReactions, useReactionSender, useReactionListener)
affects: [041-03, hangout-ux, broadcast-ux]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ConfirmDialog pattern: fixed overlay with data-testid=confirm-dialog, confirm-btn, cancel-btn for test compatibility"
    - "Leave/stop guard pattern: setShowXxxConfirm(true) on button click; handleAction() + setShowXxxConfirm(false) on confirm"
    - "Reaction parity pattern: useReactionSender + useReactionListener + FloatingReactions wired identically to BroadcastPage"

key-files:
  created:
    - web/src/components/ConfirmDialog.tsx
  modified:
    - web/src/features/broadcast/BroadcastPage.tsx
    - web/src/features/hangout/HangoutPage.tsx

key-decisions:
  - "Added data-testid='confirm-dialog', 'confirm-btn', 'cancel-btn' to real ConfirmDialog component so tests work with both the real component and the mock — the test's vi.mock path resolves to a different absolute path than the import, so the real component renders; data-testid attributes make both paths work"
  - "ConfirmDialog placed outside the isJoined conditional in HangoutPage so it remains mounted even before join completes (accessible for header Leave button)"
  - "FloatingReactions placed inside the video section container div (before Controls) with relative positioning on parent"

patterns-established:
  - "Destructive action guard pattern: replace direct onClick={action} with onClick={() => setShowConfirm(true)}; ConfirmDialog onConfirm calls action() + setShowConfirm(false)"

requirements-completed: [UI-06, UI-07]

# Metrics
duration: 20min
completed: 2026-03-16
---

# Phase 041 Plan 02: ConfirmDialog + HangoutPage Reaction Parity Summary

**Shared ConfirmDialog guards destructive actions on BroadcastPage and HangoutPage; HangoutPage gains full emoji reaction system matching BroadcastPage**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-03-16T14:17:00Z
- **Completed:** 2026-03-16T14:32:32Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `ConfirmDialog` shared component — fixed overlay, white card, Cancel/Confirm buttons, configurable label
- Wired Stop Broadcast guard into BroadcastPage via `showStopConfirm` state; `stopBroadcast()` only fires on confirm
- Wired Leave guard into both header and controls-bar Leave buttons in HangoutPage
- Added full reaction system to HangoutPage: `useReactionSender`, `useReactionListener`, `ReactionPicker`, `FloatingReactions`
- All 12 new UI-06 + UI-07 tests GREEN; all 7 existing BroadcastPage tests still pass; TypeScript clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ConfirmDialog shared component** - `027eb44` (feat)
2. **Task 1 deviation: Add data-testid attributes to ConfirmDialog** - `e79dad7` (part of Task 2 commit — combined with wiring changes)
3. **Task 2: Wire ConfirmDialog into BroadcastPage + add HangoutPage reactions + leave guard** - `e79dad7` (feat)

## Files Created/Modified
- `web/src/components/ConfirmDialog.tsx` - Reusable confirmation dialog; `isOpen`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`; data-testid on overlay + buttons
- `web/src/features/broadcast/BroadcastPage.tsx` - Added ConfirmDialog import + `showStopConfirm` state; Stop Broadcast opens dialog instead of calling `stopBroadcast` directly
- `web/src/features/hangout/HangoutPage.tsx` - Added reaction imports + state + hooks; both Leave buttons open dialog; ConfirmDialog at bottom of JSX; ReactionPicker in controls bar; FloatingReactions in video section

## Decisions Made
- Added `data-testid` attributes to the real ConfirmDialog component because the test's `vi.mock('../../components/ConfirmDialog', ...)` resolves to a different absolute path from the test's `__tests__/` subdirectory vs the import path from HangoutPage, so the mock is not applied. Adding data-testid to the real component makes the HangoutPage integration tests work with the actual component.
- ConfirmDialog placed outside the `isJoined && (...)` block in HangoutPage so the header "← Leave" button (rendered unconditionally) can open it before joining completes.
- `FloatingReactions` placed directly inside the video section container div, between VideoGrid and Controls, with `relative` added to the container.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added data-testid attributes to ConfirmDialog for test compatibility**
- **Found during:** Task 2 (HangoutPage tests failing)
- **Issue:** vi.mock path `../../components/ConfirmDialog` from `__tests__/` subdir resolves to `web/src/features/components/ConfirmDialog` (non-existent), not `web/src/components/ConfirmDialog`. The real component renders without data-testid attributes, so `getByTestId('confirm-dialog')` fails.
- **Fix:** Added `data-testid="confirm-dialog"` to the overlay div, `data-testid="cancel-btn"` and `data-testid="confirm-btn"` to the buttons. All 6 ConfirmDialog unit tests still pass (they use getByRole/getByText, not getByTestId).
- **Files modified:** web/src/components/ConfirmDialog.tsx
- **Verification:** All 12 HangoutPage tests pass; all 6 ConfirmDialog tests pass
- **Committed in:** e79dad7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential for test compatibility. No behavior change — only added data-testid attributes.

## Issues Encountered
- Vitest vi.mock path resolution: mocks in `__tests__/` subdirectory resolve `../../` one level higher than the source file importing at the same relative path. Added data-testid to real component as the pragmatic fix.

## Next Phase Readiness
- ConfirmDialog, BroadcastPage Stop guard, HangoutPage Leave guard + reactions all complete
- Ready for 041-03: VideoPage polling (UI-08) and CommentThread click-to-seek (UI-09)
- Pre-existing RED scaffold tests in VideoPage.test.tsx (2 failing) are intentional — waiting for 041-03 implementation

---
*Phase: 041-ui-polish-live-session-upload*
*Completed: 2026-03-16*

## Self-Check: PASSED
- web/src/components/ConfirmDialog.tsx: FOUND
- web/src/features/broadcast/BroadcastPage.tsx: FOUND
- web/src/features/hangout/HangoutPage.tsx: FOUND
- .planning/phases/041-ui-polish-live-session-upload/041-02-SUMMARY.md: FOUND
- Commit 027eb44: FOUND
- Commit e79dad7: FOUND
