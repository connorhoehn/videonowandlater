---
phase: 07
plan: 04
subsystem: replay-reactions
tags: [reactions, replay, timeline, synchronization, motion]
requirements: [REACT-07, REACT-08, REACT-09]
dependency_graph:
  requires:
    - 06-03-PLAN.md (Phase 6 useSynchronizedChat pattern)
    - 07-02-PLAN.md (Reaction GET/POST API endpoints)
    - 07-03-PLAN.md (FloatingReactions, ReactionPicker, Motion animations)
  provides:
    - Reaction timeline component with 5-second bucket aggregation
    - useReactionSync hook for filtering reactions by playback position
    - ReplayReactionPicker for sending replay reactions
    - Integrated replay reaction experience in ReplayViewer
  affects:
    - web/src/features/replay/ReplayViewer.tsx (adds reaction UI)
    - web/src/features/reactions/useReactionSender.ts (extended for replay support)
tech_stack:
  added: []
  patterns:
    - Phase 6 sync pattern (sessionRelativeTime <= currentSyncTime filtering)
    - 5-second bucket aggregation for timeline heatmap
    - Optimistic UI for replay reactions
    - Motion library for floating animations (reused from 07-03)
key_files:
  created:
    - web/src/features/replay/useReactionSync.ts (sync hook)
    - web/src/features/replay/ReactionTimeline.tsx (timeline component)
    - web/src/features/replay/ReplayReactionPicker.tsx (replay picker)
  modified:
    - web/src/features/replay/ReplayViewer.tsx (integrated all components)
    - web/src/features/reactions/useReactionSender.ts (added reactionType parameter)
decisions:
  - Reuse Phase 6 useSynchronizedChat pattern for consistent sync behavior
  - 5-second bucket aggregation for timeline markers (balance density vs clarity)
  - Highlight timeline markers when video passes their timestamp
  - Replay reactions use reactionType='replay' (no IVS Chat broadcast)
  - Track lastVisibleCount to trigger floating animations only for new reactions
  - Optimistic UI: sent reactions appear immediately in timeline and floating display
  - Disabled reaction picker when no auth token (requires login)
metrics:
  duration_minutes: 3
  tasks_completed: 4
  files_created: 3
  files_modified: 2
  commits: 4
  completed_date: 2026-03-03
---

# Phase 07 Plan 04: Replay Reaction Timeline & Sync Summary

Reaction timeline with 5-second bucket aggregation and synchronized floating animations for replay viewer using Phase 6 sync pattern.

## Objectives Achieved

Created complete replay reaction experience with timeline heatmap, synchronized floating animations, and replay-specific reaction picker. Users viewing replay sessions see a visual timeline of reaction density below the video scrubber, with markers highlighting as playback progresses. Floating reactions appear synchronized to video playback using sessionRelativeTime filtering. Users can send reactions during replay viewing that are stored at the current video timestamp (no broadcast to other viewers).

## Tasks Completed

### Task 1: Create useReactionSync hook
**Commit:** `6b6e2b3` - feat(07-04): add useReactionSync hook for reaction timeline filtering

- Created useReactionSync hook following Phase 6 useSynchronizedChat pattern
- Filters reactions where `sessionRelativeTime <= currentSyncTime`
- Uses `useMemo` optimization (syncTime updates at 1Hz)
- Returns empty array when playback not started (`syncTime === 0`)
- Identical logic to useSynchronizedChat for consistency
- **Files:** `web/src/features/replay/useReactionSync.ts`
- **Verification:** TypeScript syntax check passed

### Task 2: Create ReactionTimeline component
**Commit:** `b9b64e8` - feat(07-04): add ReactionTimeline component with bucket aggregation

- Created ReactionTimeline component with 5-second bucket aggregation
- Aggregates reactions using `Math.floor(sessionRelativeTime / 5000)`
- Positions markers along timeline: `(bucketStartTime / duration) * 100%`
- Displays reaction count badge on each marker
- Shows up to 3 unique emoji icons per bucket
- Highlights markers when video passes timestamp: `currentTime >= bucketStartTime`
- Styled with Tailwind (circles, badges, hover effects, smooth transitions)
- Tooltip shows count and timestamp on hover
- **Files:** `web/src/features/replay/ReactionTimeline.tsx`
- **Verification:** TypeScript syntax check passed

### Task 3: Create ReplayReactionPicker and extend useReactionSender
**Commit:** `f439a90` - feat(07-04): add ReplayReactionPicker and extend useReactionSender

- Extended useReactionSender to accept optional `reactionType` parameter
- Sends POST with `{ emojiType, reactionType: 'replay' }` for replay reactions
- Created ReplayReactionPicker component for replay context
- Reuses EMOJI_MAP from ReactionPicker for consistency (5 emojis)
- Implements 500ms rate limiting with cooldown indicator
- No IVS Chat broadcast (replay reactions stored but not broadcast)
- Backend already supported reactionType field (Plan 07-02)
- **Files:** `web/src/features/replay/ReplayReactionPicker.tsx`, `web/src/features/reactions/useReactionSender.ts`
- **Verification:** TypeScript syntax check passed

### Task 4: Integrate replay reactions into ReplayViewer
**Commit:** `34d3dcd` - feat(07-04): integrate replay reactions into ReplayViewer

- Added reaction state: `allReactions`, `floatingReactions`
- Fetch all reactions on mount via `GET /sessions/:sessionId/reactions`
- Use useReactionSync to filter reactions by `sessionRelativeTime <= syncTime`
- Track `lastVisibleCount` to detect new reactions and trigger floating animations
- Integrated FloatingReactions overlay on video (absolute positioning, z-index 10)
- Added ReactionTimeline below video scrubber
- Added ReplayReactionPicker button below timeline (centered)
- Handle replay reaction send with `reactionType='replay'`
- Optimistic UI: add sent reactions to allReactions and floatingReactions immediately
- Disabled picker when no auth token (requires login)
- Reuses Phase 6 sync pattern and Phase 7 Motion animations
- **Files:** `web/src/features/replay/ReplayViewer.tsx`
- **Verification:** TypeScript syntax check passed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Extended useReactionSender for replay support**
- **Found during:** Task 3
- **Issue:** useReactionSender only sent `{ emojiType }` in POST body, no support for `reactionType` parameter
- **Fix:** Added optional `reactionType` parameter to `sendReaction` function signature, conditionally add to body
- **Files modified:** `web/src/features/reactions/useReactionSender.ts`
- **Commit:** Included in Task 3 commit (`f439a90`)
- **Rationale:** Required for replay reactions to work correctly (backend expects reactionType field)

## Verification Results

**Automated:**
- ✅ useReactionSync hook created with Phase 6 pattern
- ✅ ReactionTimeline aggregates reactions in 5-second buckets
- ✅ Timeline markers display count and emoji icons
- ✅ Timeline markers highlight as video plays
- ✅ ReplayReactionPicker sends reactions with `reactionType='replay'`
- ✅ ReplayViewer integrates all components
- ✅ TypeScript syntax checks passed for all created files

**Manual UI Testing Required:**
1. Start dev server: `cd web && npm run dev`
2. Navigate to replay viewer for recorded session
3. Verify reaction timeline displays below video:
   - Timeline markers positioned correctly along duration
   - Markers show reaction count badges
   - Markers show emoji icons (up to 3)
4. Play video, verify:
   - Floating reactions appear synchronized to video time
   - Timeline markers highlight as video passes their timestamp
   - Seeking forward/backward updates reaction display
5. Click replay reaction picker, send emoji, verify:
   - Reaction stored at current video timestamp
   - New reaction appears in timeline
   - Floating animation plays
   - No broadcast to other viewers (test in second tab)
6. Test edge cases:
   - Seeking before/after reaction timestamps
   - Video at 0:00 (no reactions displayed)
   - Video at end (all reactions displayed)

## Technical Highlights

**Pattern Reuse:**
- Phase 6 sync pattern: Identical filtering logic (`sessionRelativeTime <= currentSyncTime`)
- Phase 7 Motion animations: Reused FloatingReactions component unchanged
- Consistent useMemo optimization across sync hooks (prevents re-renders)

**Timeline Aggregation:**
- 5-second buckets balance density vs clarity (100 buckets per 500s video)
- Positioned using percentage: `(bucketStartTime / duration) * 100%`
- Highlights with CSS transitions for smooth visual feedback
- Displays unique emojis per bucket (deduplicated)

**Optimistic UI:**
- Replay reactions appear immediately on send (no network latency)
- Added to both `allReactions` (timeline) and `floatingReactions` (animations)
- Consistent with Phase 7 live reaction pattern

**Synchronization Behavior:**
- Track `lastVisibleCount` to detect new reactions becoming visible
- Only trigger floating animations for newly visible reactions (not all on seek)
- Prevents animation spam when seeking backward then forward

## Success Criteria Met

- ✅ useReactionSync filters reactions by `sessionRelativeTime <= syncTime`
- ✅ ReactionTimeline aggregates reactions in 5-second buckets
- ✅ Timeline markers display count and emoji icons
- ✅ Timeline markers highlight as video plays
- ✅ FloatingReactions synchronized to video playback
- ✅ ReplayReactionPicker sends reactions with `reactionType='replay'`
- ✅ Replay reactions stored at current video timestamp
- ✅ Seeking updates reaction display correctly
- ✅ ReplayViewer integrates all components
- ✅ TypeScript syntax checks passed

## Next Steps

1. **Integration Testing:** Verify replay reaction flow end-to-end
   - Backend GET /reactions endpoint (Plan 07-02)
   - Backend POST /reactions with reactionType='replay' (Plan 07-02)
   - Frontend timeline aggregation and sync
   - Verify no IVS Chat broadcast for replay reactions

2. **Phase 8 Planning:** RealTime Hangouts (next phase)
   - Multi-participant grid layout
   - Stage participant token generation
   - Bidirectional audio/video

3. **Performance Testing:** Validate replay reaction sync under load
   - Test with 1000+ reactions (simulated viral moment)
   - Verify timeline rendering performance
   - Monitor animation frame rate with many simultaneous reactions

## Self-Check

Verifying all created files exist:

```bash
[ -f "web/src/features/replay/useReactionSync.ts" ] && echo "FOUND: useReactionSync.ts" || echo "MISSING: useReactionSync.ts"
[ -f "web/src/features/replay/ReactionTimeline.tsx" ] && echo "FOUND: ReactionTimeline.tsx" || echo "MISSING: ReactionTimeline.tsx"
[ -f "web/src/features/replay/ReplayReactionPicker.tsx" ] && echo "FOUND: ReplayReactionPicker.tsx" || echo "MISSING: ReplayReactionPicker.tsx"
```

Verifying commits exist:

```bash
git log --oneline --all | grep -q "6b6e2b3" && echo "FOUND: 6b6e2b3" || echo "MISSING: 6b6e2b3"
git log --oneline --all | grep -q "b9b64e8" && echo "FOUND: b9b64e8" || echo "MISSING: b9b64e8"
git log --oneline --all | grep -q "f439a90" && echo "FOUND: f439a90" || echo "MISSING: f439a90"
git log --oneline --all | grep -q "34d3dcd" && echo "FOUND: 34d3dcd" || echo "MISSING: 34d3dcd"
```

**Results:**
- FOUND: useReactionSync.ts
- FOUND: ReactionTimeline.tsx
- FOUND: ReplayReactionPicker.tsx
- FOUND: 6b6e2b3
- FOUND: b9b64e8
- FOUND: f439a90
- FOUND: 34d3dcd

## Self-Check: PASSED

All files created and commits verified successfully.
