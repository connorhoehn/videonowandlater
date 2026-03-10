---
phase: 27-speaker-attributed-transcripts
plan: "02"
subsystem: frontend-replay
tags: [speaker-diarization, transcript-display, api-gateway, cdk]
dependency_graph:
  requires: [27-01]
  provides: [SPKR-05, SPKR-06]
  affects: [web/src/features/replay, infra/lib/stacks/api-stack.ts]
tech_stack:
  added: []
  patterns: [chat-bubble-ui, conditional-render-mode, optional-prop-fallback]
key_files:
  created: []
  modified:
    - web/src/features/replay/TranscriptDisplay.tsx
    - web/src/features/replay/ReplayViewer.tsx
    - infra/lib/stacks/api-stack.ts
decisions:
  - "404 from speaker-segments endpoint is silent fallback to plain view — no error state set"
  - "speakerSegments.length > 0 is the render-mode gate — prop presence alone is not sufficient"
  - "Speaker fetch is non-blocking — errors logged to console, plain transcript still renders"
metrics:
  duration: 12m
  completed: "2026-03-10"
  tasks_completed: 2
  files_modified: 3
---

# Phase 27 Plan 02: Speaker-Attributed Transcript Frontend Summary

Chat-bubble speaker-turn display in ReplayViewer — Speaker 1 left/blue, Speaker 2 right/gray — with graceful plain-transcript fallback for pre-Phase-27 sessions.

## What Was Built

### Task 1 — CDK api-stack speaker-segments route (commit fcbd03f)

Added `GET /sessions/{sessionId}/speaker-segments` to `infra/lib/stacks/api-stack.ts`:

- `sessionSpeakerSegmentsResource` sub-resource on `sessionIdResource`
- `GetSpeakerSegmentsHandler` NodejsFunction pointing to `backend/src/handlers/get-speaker-segments.ts`
- Same environment vars as GetTranscriptHandler: `TABLE_NAME` + `TRANSCRIPTION_BUCKET`
- DynamoDB read grant + S3 `GetObject` on `vnl-transcription-vnl-session/*`
- Cognito authorizer on GET method

### Task 2 — TranscriptDisplay bubble mode + ReplayViewer prop pass (commit b1a2717)

`TranscriptDisplay.tsx`:
- Added `SpeakerSegment` interface (speaker, startTime, endTime, text)
- Added `diarizedTranscriptS3Path?: string` to `TranscriptDisplayProps`
- New state: `speakerSegments`, `currentSpeakerSegmentIndex`
- New ref: `activeSpeakerSegmentRef` with matching auto-scroll useEffect
- useEffect fetches `/sessions/{id}/speaker-segments` when `diarizedTranscriptS3Path` truthy; 404 = silent fallback, other errors logged but non-blocking
- useEffect watches `[currentTime, speakerSegments]` to track active speaker segment
- Bubble render mode (when `speakerSegments.length > 0`): alternating left/right flex layout, blue/gray bubble styling, speaker label + timestamp, `ring-2` active highlight
- Plain segment mode unchanged — renders when `speakerSegments` is empty

`ReplayViewer.tsx`:
- Added `diarizedTranscriptS3Path?: string` to local `Session` interface
- Passes `diarizedTranscriptS3Path={session.diarizedTranscriptS3Path}` to `<TranscriptDisplay>`

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `infra/lib/stacks/api-stack.ts` contains `speaker-segments`
- [x] `web/src/features/replay/TranscriptDisplay.tsx` contains `diarizedTranscriptS3Path`
- [x] `web/src/features/replay/ReplayViewer.tsx` contains `diarizedTranscriptS3Path`
- [x] Commit fcbd03f exists (Task 1)
- [x] Commit b1a2717 exists (Task 2)
- [x] `npx tsc --noEmit -p infra/tsconfig.json` — 0 errors
- [x] `cd web && npx tsc --noEmit` — 0 errors

## Self-Check: PASSED
