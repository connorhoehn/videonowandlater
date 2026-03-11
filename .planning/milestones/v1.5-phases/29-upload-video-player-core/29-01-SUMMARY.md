---
phase: 29-upload-video-player-core
plan: "01"
subsystem: frontend-upload-player
tags: [hls, video-player, quality-switching, react-hook]
dependency_graph:
  requires: []
  provides: [useHlsPlayer, QualitySelector]
  affects: [VideoPage (Plan 02), UploadViewer]
tech_stack:
  added: [hls.js@1.6.15]
  patterns: [HLS.js lifecycle management, MSE/Safari bifurcation, nextLevel quality switching]
key_files:
  created:
    - web/src/features/upload/useHlsPlayer.ts
    - web/src/features/upload/QualitySelector.tsx
  modified:
    - web/package.json
    - package-lock.json
decisions:
  - "Use hls.nextLevel (not hls.currentLevel) for quality switching to avoid buffer flush and mid-stream stall"
  - "Safari fallback uses video.src = hlsUrl via canPlayType check; quality picker hidden with isSafari flag"
  - "hls.js hoisted to root node_modules by npm workspaces — package resolves correctly from web/"
metrics:
  duration: "103 seconds"
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_created: 2
  files_modified: 2
---

# Phase 29 Plan 01: HLS.js Player Hook and Quality Selector Summary

HLS.js quality-switching player hook with Safari fallback and headless QualitySelector component.

## What Was Built

**useHlsPlayer hook** (`web/src/features/upload/useHlsPlayer.ts`):
- Initializes HLS.js on MSE-capable browsers (Chrome, Firefox, Edge) via `Hls.isSupported()`
- Falls back to native `video.src` on Safari via `canPlayType('application/vnd.apple.mpegurl')`
- Populates `qualities` array from `MANIFEST_PARSED` event: Auto (-1) + per-rendition levels (e.g., "1080p", "720p")
- Tracks `syncTime` as `currentTime * 1000` (milliseconds) for Phase 30 comment anchoring
- `setQuality` uses `hls.nextLevel` (not `hls.currentLevel`) to avoid buffer stall on mid-stream switch
- Returns `isSafari` flag so callers can hide quality controls on Safari

**QualitySelector component** (`web/src/features/upload/QualitySelector.tsx`):
- Returns `null` on Safari (no quality API available)
- Returns `null` when `qualities.length <= 1` (single rendition or not yet loaded)
- Renders a styled `<select>` element with Tailwind dark overlay classes when multiple renditions available

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Install hls.js and create useHlsPlayer hook | 2b5b007 |
| 2 | Create QualitySelector component | 985d951 |

## Verification

- TypeScript compilation: PASS (no errors)
- hls.js@1.6.15 present in root node_modules (hoisted by npm workspaces)
- `nextLevel` setter confirmed in useHlsPlayer.ts (not `currentLevel`)
- `QualitySelector` returns null on isSafari and qualities.length <= 1

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files confirmed present:
- web/src/features/upload/useHlsPlayer.ts: FOUND
- web/src/features/upload/QualitySelector.tsx: FOUND

Commits confirmed:
- 2b5b007: feat(29-01): install hls.js and create useHlsPlayer hook
- 985d951: feat(29-01): create QualitySelector component
