---
phase: 06-replay-viewer
plan: 03
subsystem: replay-viewer
tags: [chat-sync, replay, video-playback, auto-scroll]
requires: [06-02-replay-player, 04-01-chat-history]
provides: [synchronized-chat-replay, chat-timeline-matching]
affects: [replay-viewer-ui]
tech_stack:
  added: []
  patterns: [useMemo-optimization, auto-scroll-pattern, responsive-grid-layout]
key_files:
  created:
    - web/src/features/replay/useSynchronizedChat.ts
    - web/src/features/replay/ReplayChat.tsx
  modified:
    - web/src/features/replay/ReplayViewer.tsx
decisions:
  - Use useMemo in chat sync hook to prevent unnecessary re-renders on SYNC_TIME_UPDATE events (fires 1Hz)
  - Filter messages by sessionRelativeTime <= syncTime for accurate timeline matching
  - Auto-scroll chat using scrollIntoView on visibleMessages changes
  - Responsive grid layout (2/3 video, 1/3 chat on desktop; stacked on mobile)
metrics:
  duration_minutes: 2
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  commits: 3
  completed_date: 2026-03-03
---

# Phase 06 Plan 03: Synchronized Chat Replay Summary

**One-liner:** Chat messages display synchronized to video playback timeline using sessionRelativeTime filtering with auto-scroll and responsive grid layout.

## What Was Built

Implemented synchronized chat display for replay viewer that matches chat messages to video playback position, auto-scrolls as video plays, and updates on seek operations.

### Components Created

1. **useSynchronizedChat Hook** (`web/src/features/replay/useSynchronizedChat.ts`)
   - Filters chat messages based on video playback position
   - Uses useMemo to optimize performance (prevents re-renders on 1Hz SYNC_TIME_UPDATE events)
   - Compares sessionRelativeTime (ms since stream start) to syncTime (IVS Player UTC time)
   - Returns filtered array of messages that should be visible at current playback position

2. **ReplayChat Component** (`web/src/features/replay/ReplayChat.tsx`)
   - Read-only chat panel for replay viewing
   - Fetches all messages via GET /sessions/:id/messages on mount
   - Displays synchronized subset using useSynchronizedChat hook
   - Auto-scrolls chat using scrollIntoView when visibleMessages changes
   - Shows message count indicator (visible/total)
   - Displays loading and error states
   - Formats timestamps for readability

3. **ReplayViewer Integration** (`web/src/features/replay/ReplayViewer.tsx`)
   - Exposes syncTime from useReplayPlayer hook
   - Responsive grid layout: video (2/3 width) + chat (1/3 width) on desktop
   - Stacked layout on mobile (video top, chat below)
   - Fixed chat height (600px) to prevent infinite scroll container
   - Metadata panel moved below video

## Technical Implementation

### Chat Synchronization Logic

The synchronization works by comparing two timestamps:
- **sessionRelativeTime**: Stored on each ChatMessage (ms since stream start) - set during live chat in Phase 4
- **syncTime**: Current playback position from IVS Player getSyncTime API - tracked in useReplayPlayer (Plan 06-02)

Filter logic:
```typescript
return allMessages.filter(
  msg => msg.sessionRelativeTime !== undefined &&
         msg.sessionRelativeTime <= currentSyncTime
);
```

### Performance Optimization

SYNC_TIME_UPDATE event fires every second during playback. Without useMemo, filtering 500+ messages every second causes performance issues. The useMemo optimization caches the filtered result until dependencies change.

### Auto-Scroll Behavior

Chat auto-scrolls when visibleMessages array changes:
```typescript
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [visibleMessages]);
```

This creates natural chat progression as video plays forward, and instant updates when seeking.

### Layout Pattern

Responsive grid layout follows live viewer pattern (video + chat side-by-side):
- Desktop: `grid-cols-3` with video `col-span-2`, chat `col-span-1`
- Mobile: `grid-cols-1` stacks vertically
- Fixed chat height prevents infinite container issues

## Success Criteria Met

- [x] useSynchronizedChat hook filters messages by sessionRelativeTime <= syncTime
- [x] ReplayChat component fetches all messages and displays synchronized subset
- [x] Chat auto-scrolls as video plays using useEffect + scrollIntoView
- [x] ReplayViewer integrates chat panel in responsive grid layout
- [x] Seeking video updates chat position correctly (filter logic handles forward/backward seeks)
- [x] Build succeeds with no TypeScript errors
- [x] Performance acceptable with large message lists (useMemo optimization)

## Deviations from Plan

None - plan executed exactly as written.

## Must-Haves Verification

### Truths
- [x] Chat messages display alongside replay video (responsive grid layout)
- [x] Chat auto-scrolls as video plays (useEffect with visibleMessages dependency)
- [x] Chat synchronization matches video.currentTime to message timestamps (sessionRelativeTime <= syncTime)
- [x] Seeking video updates chat position (filter logic updates on syncTime changes)

### Artifacts
- [x] `web/src/features/replay/ReplayChat.tsx` - Chat panel component (143 lines)
- [x] `web/src/features/replay/useSynchronizedChat.ts` - Exports useSynchronizedChat hook
- [x] `web/src/features/replay/ReplayViewer.tsx` - Contains ReplayChat component

### Key Links
- [x] `useSynchronizedChat.ts` filters by sessionRelativeTime <= syncTime pattern
- [x] `ReplayChat.tsx` fetches from GET /sessions/:id/messages endpoint
- [x] `ReplayViewer.tsx` renders `<ReplayChat sessionId={...} currentSyncTime={syncTime} />`

## Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create chat synchronization hook | eeded82 | web/src/features/replay/useSynchronizedChat.ts |
| 2 | Create ReplayChat component with auto-scroll | 88a13f4 | web/src/features/replay/ReplayChat.tsx |
| 3 | Integrate ReplayChat into ReplayViewer layout | 5dec3ec | web/src/features/replay/ReplayViewer.tsx |

## Next Steps

Plan 06-03 completes Phase 06 (Replay Viewer). This phase delivered:
- Plan 06-01: Recording discovery feed
- Plan 06-02: Replay viewer with HLS playback
- Plan 06-03: Synchronized chat replay (this plan)

Phase 07 (Reactions) will build on this replay infrastructure to add time-series reaction data synchronized to video playback.

## Self-Check

Verifying all claimed files and commits exist:

### Files Created
✓ web/src/features/replay/useSynchronizedChat.ts exists
✓ web/src/features/replay/ReplayChat.tsx exists

### Files Modified
✓ web/src/features/replay/ReplayViewer.tsx exists

### Commits
✓ Commit eeded82 exists
✓ Commit 88a13f4 exists
✓ Commit 5dec3ec exists

**Self-Check: PASSED** ✓
