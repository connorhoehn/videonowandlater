---
phase: 040-ui-polish-replay-feed
plan: 01
subsystem: frontend-replay
tags: [ui-polish, click-to-seek, summary-display, tdd]
dependency_graph:
  requires: []
  provides: [TranscriptDisplay.onSeek, SummaryDisplay.visual-states]
  affects: [ReplayViewer, BroadcastActivityCard, HangoutActivityCard]
tech_stack:
  added: []
  patterns: [tdd-red-green, optional-callback, status-based-rendering]
key_files:
  created: []
  modified:
    - web/src/features/replay/TranscriptDisplay.tsx
    - web/src/features/replay/TranscriptDisplay.test.tsx
    - web/src/features/replay/SummaryDisplay.tsx
    - web/src/features/replay/SummaryDisplay.test.tsx
    - web/src/features/replay/ReplayViewer.tsx
decisions:
  - "Use videoRef.current.currentTime setter (not IVS player.seekTo) for seek — avoids stale ref issue since playerRef.current is captured at render time but player initializes asynchronously"
  - "SummaryDisplay pending state text changed from 'Summary coming soon...' to 'Generating summary...' — acceptable in UI polish phase"
  - "className prop on SummaryDisplay applies to outermost element in all states for consistent external styling"
metrics:
  duration: "< 30 minutes (implementation phase)"
  completed: "2026-03-15"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 40 Plan 01: TranscriptDisplay Click-to-Seek + SummaryDisplay Visual States Summary

Click-to-seek on transcript segments via onSeek callback wired to videoRef.currentTime, plus SummaryDisplay restyled with spinner/blue-card/red-card for pending/available/failed states.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add onSeek callback to TranscriptDisplay + wire in ReplayViewer | d88b8fd | TranscriptDisplay.tsx, TranscriptDisplay.test.tsx, ReplayViewer.tsx |
| 2 | Restyle SummaryDisplay with distinct visual states | bb6ad76 | SummaryDisplay.tsx, SummaryDisplay.test.tsx |

## What Was Built

### Task 1: TranscriptDisplay Click-to-Seek

Added `onSeek?: (timeMs: number) => void` to `TranscriptDisplayProps`. Both render paths updated:

- **Plain segment mode**: `onClick={() => onSeek?.(segment.startTime)}` + `cursor-pointer` class when prop provided. Inactive segments get `hover:bg-blue-50` as click affordance.
- **Speaker bubble mode**: `onClick={() => onSeek?.(seg.startTime)}` + `cursor-pointer` on outer flex div.

In `ReplayViewer.tsx`, a `handleSeek` function was added that sets `videoRef.current.currentTime = timeMs / 1000`. This uses the HTMLVideoElement directly rather than `player.seekTo()` — the IVS player attaches to the video element so this approach works and avoids the stale playerRef issue.

### Task 2: SummaryDisplay Visual States

Restyled three states with distinct treatments:

- **Pending**: `<div className="flex items-center gap-2 {className}">` containing a `animate-spin` spinner div + "Generating summary..." span
- **Available**: `<div className="bg-blue-50 border border-blue-100 rounded-lg p-3 {className}">` wrapping a `<p>` with optional `line-clamp-2`
- **Failed**: `<div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg p-3 {className}">` with SVG exclamation icon + "Summary unavailable" span

The `truncate` prop applies `line-clamp-2` to the `<p>` in available state only. The `className` prop applies to the outermost element in each state.

## Test Results

All 18 Plan-01-related tests pass:
- TranscriptDisplay.test.tsx: 5/5 passed (click-to-seek in both render modes, optional callback, cursor-pointer class)
- SummaryDisplay.test.tsx: 13/13 passed (all three states, spinner, cards, truncate, className, backward compat)

## Deviations from Plan

### Pre-existing state at execution start

**Finding:** Task 1 (TranscriptDisplay + ReplayViewer) was already fully implemented when this executor started. Commit `d88b8fd` had already completed the GREEN phase for Task 1. The `SummaryDisplay.test.tsx` had been updated to its failing state (RED phase for Task 2) but `SummaryDisplay.tsx` still had the old implementation.

**Action:** Recognized this as a continuation scenario — executed only the missing GREEN phase for Task 2.

No architectural deviations.

## Self-Check

- [x] `web/src/features/replay/SummaryDisplay.tsx` — modified with new visual states
- [x] `web/src/features/replay/SummaryDisplay.test.tsx` — updated with new test assertions
- [x] `web/src/features/replay/TranscriptDisplay.tsx` — onSeek callback (prior commit)
- [x] `web/src/features/replay/ReplayViewer.tsx` — handleSeek wired (prior commit)

Commits verified:
- d88b8fd: feat(040-01): add click-to-seek on transcript segments
- bb6ad76: feat(040-01): restyle SummaryDisplay with distinct visual states

## Self-Check: PASSED
