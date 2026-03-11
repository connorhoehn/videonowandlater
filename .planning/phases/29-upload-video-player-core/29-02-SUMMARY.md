---
phase: 29-upload-video-player-core
plan: "02"
subsystem: frontend
tags: [video-player, routing, hls, quality-selector, upload]
dependency_graph:
  requires: [29-01]
  provides: [VideoPage, /video/:sessionId route, UploadViewer redirect, UploadActivityCard nav]
  affects: [web/src/App.tsx, web/src/features/upload/, web/src/features/activity/]
tech_stack:
  added: []
  patterns: [ProtectedRoute wrapping, auth-gated fetch, Navigate redirect, HLS quality overlay]
key_files:
  created:
    - web/src/features/upload/VideoPage.tsx
  modified:
    - web/src/App.tsx
    - web/src/features/upload/UploadViewer.tsx
    - web/src/features/activity/UploadActivityCard.tsx
decisions:
  - "UploadViewer replaced entirely with Navigate redirect — no dead code left"
  - "VideoPage uses max-w-4xl layout (not max-w-7xl 3-col) — transcript column deferred to Phase 30"
metrics:
  duration_minutes: 1
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_changed: 4
---

# Phase 29 Plan 02: VideoPage Routing and Navigation Summary

**One-liner:** Dedicated /video/:sessionId player page with HLS.js + quality selector overlay, backward-compat redirect from /upload/, and activity card navigation update.

## What Was Built

Created `VideoPage.tsx` as the canonical player for uploaded videos at `/video/:sessionId`. The page:

- Fetches session metadata with auth guard (`fetchAuthSession` -> `Authorization: Bearer`)
- Calls `useHlsPlayer(session?.recordingHlsUrl)` for HLS.js playback
- Overlays `QualitySelector` bottom-right of the aspect-video container (hidden on Safari / single-rendition)
- Redirects non-UPLOAD sessions to `/replay/:sessionId`
- Shows `SessionAuditLog` when HLS URL is not yet available (processing state)
- Shows metadata panel: uploader, file size, duration, upload date, AI summary, processing status

Wired into App.tsx as a `ProtectedRoute`. `UploadViewer` collapsed to a one-line `<Navigate replace>` redirect so old `/upload/:sessionId` bookmarks continue to work. `UploadActivityCard.handleClick` now navigates to `/video/:sessionId` (VIDP-10).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create VideoPage.tsx | 42c3e1d | web/src/features/upload/VideoPage.tsx |
| 2 | Wire routing, redirect, card nav | 47ffc72 | web/src/App.tsx, web/src/features/upload/UploadViewer.tsx, web/src/features/activity/UploadActivityCard.tsx |

## Deviations from Plan

None - plan executed exactly as written.

The plan specified using `showTranscript` state in VideoPage for Phase 30 readiness. It is declared but unused — TypeScript compiled cleanly (no unused variable error since TypeScript does not flag unused React state by default). The transcript panel is deferred to Phase 30.

## Verification Results

- TypeScript compilation: 0 errors across entire web/ project
- `/video/:sessionId` route registered with ProtectedRoute in App.tsx
- `<Navigate replace>` in UploadViewer points to `/video/${sessionId}`
- `UploadActivityCard.handleClick` navigates to `/video/${session.sessionId}`
- `useHlsPlayer` called in VideoPage with `session?.recordingHlsUrl`
- `QualitySelector` rendered inside `absolute bottom-3 right-3 z-10` div

## Self-Check: PASSED

Files verified:
- FOUND: web/src/features/upload/VideoPage.tsx
- FOUND: commit 42c3e1d (VideoPage creation)
- FOUND: commit 47ffc72 (routing + redirect + card nav)
