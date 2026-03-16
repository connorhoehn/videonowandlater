---
phase: 041-ui-polish-live-session-upload
plan: "01"
subsystem: web-frontend-tests
tags:
  - tdd
  - ui-polish
  - confirm-dialog
  - hangout-reactions
  - video-polling
  - comment-seek
dependency_graph:
  requires: []
  provides:
    - "web/src/components/__tests__/ConfirmDialog.test.tsx"
    - "web/src/features/hangout/__tests__/HangoutPage.test.tsx"
    - "web/src/features/upload/__tests__/VideoPage.test.tsx"
    - "web/src/features/upload/__tests__/CommentThread.test.tsx"
  affects:
    - "041-02-PLAN.md (ConfirmDialog + HangoutPage implementation)"
    - "041-03-PLAN.md (VideoPage polling + CommentThread onSeek)"
tech_stack:
  added: []
  patterns:
    - "vi.useFakeTimers + vi.spyOn(globalThis, 'setInterval') for polling assertions"
    - "Split describe blocks for fake/real timer tests in same file"
    - "vi.mock('../../components/ConfirmDialog') as inline mock to test wiring without implementation"
key_files:
  created:
    - "web/src/components/__tests__/ConfirmDialog.test.tsx"
    - "web/src/features/hangout/__tests__/HangoutPage.test.tsx"
    - "web/src/features/upload/__tests__/VideoPage.test.tsx"
    - "web/src/features/upload/__tests__/CommentThread.test.tsx"
  modified: []
decisions:
  - "Split VideoPage polling tests into two describe blocks: one uses vi.useFakeTimers() for 'starts polling' assertions, one uses real timers for 'does NOT start polling' assertions — mixing fake timers with waitFor causes deadlocks in Vitest"
  - "HangoutPage test mocks ConfirmDialog inline (not importing from non-existent file) so the wiring test can fail on the HangoutPage side without a module resolution error"
  - "CommentThread 'renders comments' and 'submission guard' tests pass now (behaviors exist); only click-to-seek test is RED (onSeek prop not wired)"
metrics:
  duration: "35 minutes"
  completed: "2026-03-16"
  tasks_completed: 4
  files_created: 4
  files_modified: 0
---

# Phase 41 Plan 01: Wave 0 Test Scaffolds Summary

Four failing test files defining behavioral contracts for Phase 41 UI Polish — ConfirmDialog component, HangoutPage leave-guard + reactions, VideoPage session polling, and CommentThread click-to-seek.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ConfirmDialog.test.tsx | 912534f | web/src/components/__tests__/ConfirmDialog.test.tsx |
| 2 | HangoutPage.test.tsx | 954b5cf | web/src/features/hangout/__tests__/HangoutPage.test.tsx |
| 3 | VideoPage.test.tsx | f054a13 | web/src/features/upload/__tests__/VideoPage.test.tsx |
| 4 | CommentThread.test.tsx | cbf1431 | web/src/features/upload/__tests__/CommentThread.test.tsx |

## RED State Summary

| File | RED Reason | Tests Failing |
|------|-----------|---------------|
| ConfirmDialog.test.tsx | Module `web/src/components/ConfirmDialog.tsx` does not exist | 5 (all) |
| HangoutPage.test.tsx | ConfirmDialog not rendered; ReactionPicker not present | 6 (all) |
| VideoPage.test.tsx | No polling `setInterval` called in VideoPage | 2 (non-terminal starts) |
| CommentThread.test.tsx | `onSeek` prop not wired on comment row click | 1 (click-to-seek) |

**Total: 9 tests RED, 145 pre-existing tests still GREEN. No regressions.**

## Behavioral Contracts Locked In

### ConfirmDialog (UI-06)
- Renders nothing when `isOpen=false`
- Renders title + message when `isOpen=true`
- `onConfirm` called when confirm button clicked
- `onCancel` called when cancel button clicked
- Custom `confirmLabel` overrides default "Confirm"
- Defaults to "Confirm" label when not provided

### HangoutPage (UI-06 + UI-07)
- Header "← Leave" button shows ConfirmDialog, NOT direct navigate
- Controls bar "Leave" button shows ConfirmDialog, NOT direct navigate
- ConfirmDialog Confirm calls `navigate("/")`
- ConfirmDialog Cancel dismisses without navigate
- `ReactionPicker` renders in controls bar when `isJoined=true`
- Clicking emoji in ReactionPicker calls `sendReaction` mock

### VideoPage (UI-08)
- `setInterval` called with delay >= 5000ms when `aiSummaryStatus === 'pending'`
- `setInterval` called when `transcriptStatus === 'processing'`
- `setInterval` NOT called when `aiSummaryStatus === 'available'` (terminal)
- `setInterval` NOT called when any status is `'failed'` (terminal)

### CommentThread (UI-09)
- Comment rows render with userId, text, and timestamp
- Clicking a comment row calls `onSeek(comment.videoPositionMs)` when prop provided
- Clicking a comment row does nothing (no error) when `onSeek` not provided
- Submit button disabled when `syncTime === 0`
- Submit button enabled when `syncTime > 0` and text non-empty

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Split VideoPage polling describe blocks for fake/real timer isolation**
- **Found during:** Task 3
- **Issue:** `vi.useFakeTimers()` in `beforeEach` combined with `waitFor()` inside tests 3 & 4 caused deadlocks — `waitFor` polls using `setTimeout` which fake timers intercept, causing 5000ms timeout
- **Fix:** Moved "starts polling" tests (need fake timers for spying on `setInterval`) into one `describe`, and "does NOT start polling" tests (need real async to settle) into a separate `describe` with real timers
- **Files modified:** `web/src/features/upload/__tests__/VideoPage.test.tsx`
- **Commit:** f054a13

## Self-Check: PASSED

All 4 test files confirmed present. All 4 task commits confirmed in git log.
- FOUND: web/src/components/__tests__/ConfirmDialog.test.tsx (912534f)
- FOUND: web/src/features/hangout/__tests__/HangoutPage.test.tsx (954b5cf)
- FOUND: web/src/features/upload/__tests__/VideoPage.test.tsx (f054a13)
- FOUND: web/src/features/upload/__tests__/CommentThread.test.tsx (cbf1431)
