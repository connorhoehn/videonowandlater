---
phase: 06-replay-viewer
plan: 02
subsystem: replay-viewer
tags: [replay, video-playback, hls, ivs-player, cloudfront, cors]
requirements: [REPLAY-04, REPLAY-05, REPLAY-09]

dependency_graph:
  requires: [06-01]
  provides:
    - replay-viewer-page
    - ivs-player-hook-with-sync
    - cloudfront-cors-policy
  affects: []

tech_stack:
  added:
    - ResponseHeadersPolicy (CloudFront CORS)
    - IVS Player SYNC_TIME_UPDATE events
  patterns:
    - React hooks for player lifecycle management
    - Native HTML5 video controls for HLS playback
    - Protected routes for authenticated replay access

key_files:
  created:
    - web/src/features/replay/useReplayPlayer.ts
    - web/src/features/replay/ReplayViewer.tsx
  modified:
    - infra/lib/stacks/session-stack.ts
    - web/src/App.tsx

decisions:
  - decision: "Use native video controls over custom UI"
    rationale: "Browser controls provide battle-tested play/pause/seek/fullscreen functionality with accessibility built-in"
    impact: "Faster implementation, better mobile UX, defers custom controls to future enhancement"
  - decision: "Track syncTime via SYNC_TIME_UPDATE in useReplayPlayer"
    rationale: "Prepares for chat replay synchronization in Plan 06-03 where chat messages need video timestamp context"
    impact: "Hook returns syncTime ready for next plan, no rework needed"
  - decision: "CloudFront CORS policy allows all origins (*)"
    rationale: "Public recordings feed requires HLS playback from any referring page, no security risk for video content"
    impact: "Browser HLS requests succeed from any origin, enables future embedding"

metrics:
  duration_minutes: 3
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  commits: 2
  completed_at: "2026-03-03T02:06:27Z"
---

# Phase 06 Plan 02: Replay Viewer with HLS Playback

**One-liner:** HLS replay viewer with CloudFront CORS policy and IVS Player controls for recorded session playback

## What Was Built

Implemented dedicated replay viewer page enabling users to watch recorded sessions with low-latency HLS playback from CloudFront. Created React components and CDK infrastructure to support browser-based video playback with native controls.

### Core Components

**CloudFront CORS Policy (Task 1 - commit d960888):**
- Added `ResponseHeadersPolicy` with Access-Control-Allow-Origin/Methods/Headers
- Configured CORS behavior allowing GET/HEAD/OPTIONS from any origin
- Attached policy to CloudFront distribution defaultBehavior
- Enables browser HLS manifest (.m3u8) and segment (.ts) fetching without CORS errors

**useReplayPlayer Hook (Task 2 - commit eb9e629):**
- React hook managing IVS Player SDK lifecycle for HLS playback
- State tracking: `syncTime` (UTC milliseconds from getSyncTime), `isPlaying`
- Event listeners: PLAYING/IDLE state changes, SYNC_TIME_UPDATE for future chat sync
- Cleanup on unmount via `player.delete()`
- Returns `videoRef`, `syncTime`, `isPlaying`, `player` for component use

**ReplayViewer Component (Task 2 - commit eb9e629):**
- Full-page viewer at `/replay/:sessionId` route
- Fetches session metadata from `GET /sessions/:id`
- IVS Player with native HTML5 controls (play/pause/seek/volume/fullscreen)
- Metadata panel displaying broadcaster, duration, recording date
- Error handling: 404 not found, missing HLS URL, fetch failures
- Loading states with spinner, error states with back button

**Route Integration (Task 2 - commit eb9e629):**
- Added `/replay/:sessionId` route to App.tsx
- Wrapped in `<ProtectedRoute>` requiring authentication
- Imported and rendered `<ReplayViewer />` component

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

**Automated checks passed:**
- [x] TypeScript compilation succeeds (infra + web)
- [x] ResponseHeadersPolicy present in session-stack.ts
- [x] corsBehavior configured with CORS headers
- [x] responseHeadersPolicy attached to CloudFront distribution
- [x] useReplayPlayer hook exported
- [x] SYNC_TIME_UPDATE event listener present
- [x] ReplayViewer uses useReplayPlayer hook
- [x] /replay/:sessionId route exists in App.tsx
- [x] Web build succeeds with no errors

## Key Learnings

**CloudFront ResponseHeadersPolicy API:**
- CDK requires `accessControlAllowCredentials: false` property (not optional)
- CORS arrays use plain string arrays, not `{ items: [...] }` format
- Policy must be referenced in distribution `responseHeadersPolicy` field

**IVS Player Events:**
- SYNC_TIME_UPDATE fires continuously during playback (every ~1 second)
- Returns UTC milliseconds suitable for chat message timestamp synchronization
- Required for Plan 06-03 chat replay sync implementation

**Native Video Controls Pattern:**
- HTML5 `controls` attribute provides full playback UI out-of-box
- `playsInline` prevents iOS fullscreen takeover on tap
- `setAutoplay(false)` respects mobile browser autoplay policies

## Next Steps

**Immediate (Plan 06-03 - Chat Replay Sync):**
- Use `syncTime` from useReplayPlayer to filter chat messages by `sessionRelativeTime`
- Display chat panel alongside video player
- Sync chat visibility to current video playback position

**Future Enhancements:**
- Custom playback controls with speed adjustment (0.5x, 1x, 1.25x, 1.5x, 2x)
- Picture-in-picture mode for multitasking during replay
- Shareable timestamps (e.g., /replay/:sessionId?t=120 jumps to 2:00)
- Keyboard shortcuts (Space=play/pause, Arrow keys=seek, F=fullscreen)

## Dependencies

**Requires:**
- Phase 05 Recording Infrastructure (CloudFront distribution, S3 bucket)
- Phase 06-01 RecordingFeed (session data with recordingHlsUrl)

**Enables:**
- Phase 06-03 Chat Replay Sync (syncTime provides timestamp context)

## Files Changed

**Infrastructure:**
```
infra/lib/stacks/session-stack.ts
├── Added ResponseHeadersPolicy for CORS
├── Configured corsBehavior with Access-Control headers
└── Attached policy to CloudFront distribution
```

**Web Application:**
```
web/src/features/replay/useReplayPlayer.ts (NEW)
├── IVS Player lifecycle management
├── syncTime tracking via SYNC_TIME_UPDATE
└── Player state management (playing/idle)

web/src/features/replay/ReplayViewer.tsx (NEW)
├── Session metadata fetching
├── Video player with native controls
├── Metadata display panel
└── Error/loading state handling

web/src/App.tsx
└── Added /replay/:sessionId route with ProtectedRoute
```

## Self-Check: PASSED

All verification checks completed successfully:

**Files Created:**
- ✓ web/src/features/replay/useReplayPlayer.ts
- ✓ web/src/features/replay/ReplayViewer.tsx

**Commits Verified:**
- ✓ d960888 (Task 1: CloudFront CORS policy)
- ✓ eb9e629 (Task 2: Replay viewer components)

**Build Verification:**
- ✓ Infrastructure TypeScript compilation passes
- ✓ Web application TypeScript compilation passes
- ✓ Vite production build succeeds
