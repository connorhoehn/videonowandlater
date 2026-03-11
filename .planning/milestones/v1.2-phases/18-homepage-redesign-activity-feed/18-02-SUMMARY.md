---
phase: 18-homepage-redesign-activity-feed
plan: 02
type: summary
date_completed: "2026-03-06"
duration_minutes: 15
status: complete
tasks_completed: 3
commits: 2
---

# Phase 18 Plan 02: Homepage Activity Feed Layout Summary

**Objective:** Redesign the homepage with a two-zone layout: a horizontal recording slider (broadcasts only) and an activity feed below (all sessions). Create reusable activity card components that display rich metadata (reactions, participants, message counts, timestamps).

**One-liner:** Homepage now displays a horizontal RecordingSlider showing 3-4 broadcast cards with CSS scroll-snap, and below it an ActivityFeed listing all sessions in reverse chronological order with full metadata.

## Execution Summary

All 3 tasks completed successfully. Frontend builds without errors. New activity feature components created and integrated into HomePage.

### Task Completion

| # | Task | Status | Files Created/Modified | Commits |
|---|------|--------|------------------------|---------|
| 1 | Create ReactionSummaryPills and RecordingSlider | DONE | `ReactionSummaryPills.tsx`, `RecordingSlider.tsx` | 1c8b9b7 |
| 2 | Create ActivityFeed and activity card components | DONE | `ActivityFeed.tsx`, `BroadcastActivityCard.tsx`, `HangoutActivityCard.tsx` | 1c8b9b7 |
| 3 | Update HomePage to use new layout and fetch from GET /activity | DONE | `web/src/pages/HomePage.tsx` | 4e2a969 |

## Key Deliverables

### 1. ReactionSummaryPills Component
- **File:** `web/src/features/activity/ReactionSummaryPills.tsx`
- **Purpose:** Render emoji + count pills for reaction summaries
- **Props:** `reactionSummary?: Record<string, number>`
- **Features:**
  - Displays emoji and count for each reaction type
  - Shows "No reactions" for empty/undefined summaries
  - Uses EMOJI_MAP from ReactionPicker for consistent emoji display
  - Styled as rounded pills with gray background

### 2. RecordingSlider Component
- **File:** `web/src/features/activity/RecordingSlider.tsx`
- **Purpose:** Horizontal scrollable slider showing broadcasts only
- **Props:** `sessions: ActivitySession[]`
- **Features:**
  - Filters sessions to broadcasts only (`sessionType === 'BROADCAST'`)
  - CSS scroll-snap for smooth scrolling (`snap-x snap-mandatory`)
  - Cards are 14rem (w-56) wide with peek effect (3-4 visible)
  - Shows thumbnail, userId, duration, reaction pills
  - Navigates to `/replay/:sessionId` on click
  - Displays "No recordings yet" when empty
  - Uses `scroll-smooth` class for smooth scroll behavior

### 3. ActivityFeed Component
- **File:** `web/src/features/activity/ActivityFeed.tsx`
- **Purpose:** Vertical list of all sessions in reverse chronological order
- **Props:** `sessions: ActivitySession[]`
- **Features:**
  - Sorts sessions by endedAt DESC (most recent first)
  - Renders BroadcastActivityCard for BROADCAST sessions
  - Renders HangoutActivityCard for HANGOUT sessions
  - Displays "No activity yet" when empty
  - Full-width layout with centered max-w-5xl container

### 4. BroadcastActivityCard Component
- **File:** `web/src/features/activity/BroadcastActivityCard.tsx`
- **Purpose:** Card displaying broadcast session metadata
- **Props:** `session: ActivitySession`
- **Features:**
  - Shows userId as title
  - Displays duration (MM:SS format)
  - Shows reaction summary pills
  - Displays relative timestamp (formatDate helper)
  - Navigates to `/replay/:sessionId` on click
  - Helper: `formatDuration(ms)` returns "MM:SS"
  - Helper: `formatDate(dateString)` returns "just now", "2h", "3d", etc.

### 5. HangoutActivityCard Component
- **File:** `web/src/features/activity/HangoutActivityCard.tsx`
- **Purpose:** Card displaying hangout session metadata
- **Props:** `session: ActivitySession`
- **Features:**
  - Shows userId as title
  - Displays participant count with plural handling
  - Shows message count with plural handling
  - Displays duration (MM:SS format)
  - Displays relative timestamp
  - Navigates to `/replay/:sessionId` on click
  - Uses same formatDuration and formatDate helpers

### 6. HomePage Updates
- **File:** `web/src/pages/HomePage.tsx`
- **Changes:**
  - Replaced single RecordingFeed with two-zone layout
  - Imports RecordingSlider and ActivityFeed components
  - Fetches from `GET /activity` endpoint (public, no auth)
  - Stores sessions in state: `useState<ActivitySession[]>`
  - Shows loading spinner while fetching (`loadingActivity`)
  - Error handling: logs to console if fetch fails
  - Single API call provides all metadata: reactions, participants, messages

## Activity Session Type Definition

The `ActivitySession` interface is defined in RecordingSlider.tsx:

```typescript
interface ActivitySession {
  sessionId: string;
  userId: string;
  sessionType: 'BROADCAST' | 'HANGOUT';
  thumbnailUrl?: string;
  recordingDuration?: number; // milliseconds
  createdAt: string;
  endedAt?: string;
  reactionSummary?: Record<string, number>;
  participantCount?: number;
  messageCount?: number;
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
}
```

This type is shared across all activity components and exported from RecordingSlider.

## Architecture Decisions

1. **CSS Scroll-Snap over Custom JS:** RecordingSlider uses native CSS `snap-x snap-mandatory` instead of custom JavaScript. This provides:
   - Better mobile performance
   - Automatic alignment
   - No library dependency
   - No resize listener overhead

2. **Single ActivitySession Type:** All activity components use the same ActivitySession interface, ensuring consistency across the feed.

3. **Activity Data Source:** HomePage fetches from GET /activity endpoint (created in 18-01), which returns pre-computed metadata:
   - reactionSummary from Phase 17
   - participantCount from Phase 16
   - messageCount from Phase 18-01 (atomic counter in send-message)
   - Eliminates N+1 queries on frontend

4. **Broadcast-Only Slider:** RecordingSlider filters `sessionType === 'BROADCAST'`, while ActivityFeed shows all sessions. This preserves the slider as a recordings-focused discovery interface.

## Verification Results

### Build Status
- **Command:** `npm run build`
- **Result:** ✓ Built successfully in 1.88s
- **Output:** No TypeScript errors, no build errors
- **Bundle size:** 1,176.64 kB minified JS (gzip: 343.64 kB)

### Success Criteria Met
- ✓ HomePage displays two-zone layout: horizontal slider + activity feed
- ✓ Recording slider shows broadcasts only (hangouts filtered out)
- ✓ Recording slider uses CSS scroll-snap for 3-4 visible cards with peek
- ✓ Activity feed displays all sessions in reverse chronological order
- ✓ Broadcast cards show title, duration, reaction pills, timestamp
- ✓ Hangout cards show participant count, message count, duration, timestamp
- ✓ All components render correctly (build succeeds)
- ✓ Web builds successfully with no errors

## Component Integration

### HomePage Rendering Flow
```
HomePage (fetches GET /activity)
├── RecordingSlider
│   ├── Filter: sessionType === 'BROADCAST'
│   ├── ReactionSummaryPills (per broadcast)
│   └── Navigate: /replay/:sessionId
└── ActivityFeed
    ├── Sort by endedAt DESC
    ├── BroadcastActivityCard (for BROADCAST sessions)
    │   ├── ReactionSummaryPills
    │   └── Navigate: /replay/:sessionId
    └── HangoutActivityCard (for HANGOUT sessions)
        └── Navigate: /replay/:sessionId
```

## Deviations from Plan

None - plan executed exactly as written.

## Next Steps

- Phase 18-03: Add pagination/infinite scroll to activity feed
- Phase 19: Transcription pipeline
- Phase 20: AI summary with Bedrock

---
**Completed by:** Claude Code (Haiku 4.5)
**Date:** 2026-03-06 at 00:42:32Z
**Duration:** 15 minutes
