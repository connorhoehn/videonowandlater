# Summary: Plan 13-01 — Fix Replay Viewer Auth Headers and Time Domain Mismatch

## Status: completed

## What Was Done
Fixed five integration gaps (REPLAY-04, REPLAY-06, REPLAY-07, REPLAY-09, REACT-09) in the replay viewer.

## Changes Made

### web/src/features/replay/ReplayViewer.tsx
- **Session fetch**: gated on `authToken`, added `Authorization: Bearer ${authToken}` header, added `authToken` to useEffect deps — fixes REPLAY-04 (was returning 401, HLS URL never loaded)
- **Reactions fetch**: same guard + auth header + dep — ensures reactions load after token is ready

### web/src/features/replay/ReplayChat.tsx
- **fetchMessages useEffect**: added `authToken` to deps array and `if (!authToken) return` guard — fixes REPLAY-06 (initial fetch fired with empty token, no re-fetch on token arrival)

### web/src/features/replay/useReplayPlayer.ts
- **SYNC_TIME_UPDATE handler**: replaced raw UTC `time` value with `player.getPosition() * 1000` — fixes REPLAY-07 and REACT-09 (UTC ms was being compared to relative ms, making all messages/reactions immediately visible)

## Requirements Completed
- REPLAY-04: ReplayViewer now loads session with auth header → HLS URL resolves → video plays
- REPLAY-06: ReplayChat re-fetches when authToken arrives → messages load
- REPLAY-07: syncTime is now relative ms → chat messages appear at correct playback positions
- REPLAY-09: Session metadata loads (unblocked by REPLAY-04 fix)
- REACT-09: Reaction timeline synchronizes correctly with playback position

## Verification
- `npm run build` in `web/` passes with no TypeScript errors
- All four files changed with minimal diffs (no logic changes beyond what was required)
