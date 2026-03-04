---
phase: 11-hangout-recording-lifecycle-fix
plan: 01
subsystem: infra
tags: [eventbridge, ivs, lambda, typescript, jest, recording, hangout, stage]

# Dependency graph
requires:
  - phase: 10-integration-wiring-fixes
    provides: "RecordingEndRule wired to recordingEndedFn; recording-ended handler exists"
provides:
  - "StageRecordingEndRule EventBridge rule routing IVS RealTime participant recording-end events to recordingEndedFn"
  - "Unified recording-ended handler supporting both broadcast (channel) and Stage (hangout) event shapes"
  - "Correct ARN extraction from event.resources[0] for both event types"
  - "Conditional S3 URL construction: multivariant.m3u8 for Stage, master.m3u8 for broadcast"
  - "9 passing tests covering both IVS event shapes"
affects: [hangout-recording, replay-feed, recording-metadata, ivs-stage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified EventBridge handler for multiple IVS event types via EventBridgeEvent<string, Record<string, any>>"
    - "ARN type detection via resources[0] split on colon then slash"
    - "Conditional recording URL construction based on resourceType channel vs stage"
    - "Stage Recording End is always available (no recording_status field)"

key-files:
  created: []
  modified:
    - infra/lib/stacks/session-stack.ts
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/__tests__/recording-ended.test.ts

key-decisions:
  - "Read ARN from event.resources[0] not event.detail.channel_name — channel_name is human-readable display name, not the resource ARN"
  - "Single unified Lambda (recordingEndedFn) handles both IVS Recording State Change and IVS Participant Recording State Change events — no separate handler needed"
  - "Stage events always produce available status (no recording_status field present) — undefined != 'Recording End Failure' evaluates to available correctly"
  - "Stage S3 path uses media/hls/multivariant.m3u8 and media/latest_thumbnail/high/thumb.jpg; broadcast uses master.m3u8 and thumb-0.jpg"

patterns-established:
  - "IVS event ARN is always in event.resources[0], not in detail fields"
  - "EventBridgeEvent<string, Record<string, any>> broadened signature handles multiple IVS event detail-types in one handler"

requirements-completed: [HANG-14, HANG-15, HANG-16]

# Metrics
duration: 3min
completed: 2026-03-04
---

# Phase 11 Plan 01: Stage ARN Detection and EventBridge Routing Fix Summary

**StageRecordingEndRule EventBridge rule added to CDK + recording-ended handler unified for both broadcast and IVS RealTime Stage recording events with correct ARN extraction from resources[0]**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-04T21:20:14Z
- **Completed:** 2026-03-04T21:22:55Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added StageRecordingEndRule to CDK session-stack targeting recordingEndedFn, so hangout composite recordings now route to the handler
- Fixed the root ARN extraction bug: reads `event.resources[0]` instead of `event.detail.channel_name` (channel_name is a human-readable display name, not the resource ARN)
- Implemented conditional URL construction so Stage events get the correct `media/hls/multivariant.m3u8` and `media/latest_thumbnail/high/thumb.jpg` paths while broadcast events keep their existing `master.m3u8` and `thumb-0.jpg` paths
- Updated all 5 existing tests to put ARN in `resources[0]` and set `channel_name` to human-readable strings; added 3 new Stage-specific test cases; all 9 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add StageRecordingEndRule to CDK and fix recording-ended handler** - `205fc60` (feat)
2. **Task 2: Fix recording-ended tests to use correct event shapes and add Stage test cases** - `da8d560` (test)

## Files Created/Modified

- `infra/lib/stacks/session-stack.ts` - Added StageRecordingEndRule EventBridge rule with `IVS Participant Recording State Change` detailType, targeting recordingEndedFn
- `backend/src/handlers/recording-ended.ts` - Fixed ARN extraction to use `event.resources[0]`; broadened handler signature; added BroadcastRecordingEndDetail and StageParticipantRecordingEndDetail interfaces; conditional URL construction for Stage vs broadcast; Stage events always produce `available` status
- `backend/src/handlers/__tests__/recording-ended.test.ts` - Updated all 5 existing tests to use correct event shapes (ARN in resources[0]); added 3 new Stage event tests covering ARN detection, URL construction, and status derivation

## Decisions Made

- Read ARN from `event.resources[0]` not `event.detail.channel_name` — `channel_name` is a human-readable display name in IVS events, not the resource ARN
- Single unified Lambda (recordingEndedFn) handles both event types — no separate handler needed, resourceType detection via ARN parsing gates behavior
- Stage events always produce `available` status — no `recording_status` field present; undefined compared to `'Recording End Failure'` evaluates to available correctly
- Broadened handler signature to `EventBridgeEvent<string, Record<string, any>>` to accept both `IVS Recording State Change` and `IVS Participant Recording State Change` detail-types

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — both TypeScript compilations passed clean on first attempt; all 9 tests passed on first run.

Note: 4 pre-existing test failures in `get-viewer-count`, `start-broadcast`, `join-hangout`, and `get-playback` were present before this plan (from the prior WIP commit) and are unrelated to recording-ended changes.

## User Setup Required

**Deployment required:** Run `cdk deploy VNL-Session` in the live AWS environment to provision the new StageRecordingEndRule EventBridge rule. Without deployment, hangout recording-end events will not route to the Lambda in production. This is outside automated testing scope.

## Next Phase Readiness

- EventBridge routing for Stage recording-end events is now wired at the CDK level
- Handler correctly extracts ARN and builds S3 paths for both event types
- After `cdk deploy VNL-Session`, hangout composite recordings will have metadata written and appear in the home feed (HANG-14, HANG-15, HANG-16)
- Additional plans in phase 11 can proceed to address any remaining hangout recording lifecycle issues

## Self-Check: PASSED

- FOUND: infra/lib/stacks/session-stack.ts (contains IVS Participant Recording State Change)
- FOUND: backend/src/handlers/recording-ended.ts (reads event.resources[0], contains multivariant.m3u8)
- FOUND: backend/src/handlers/__tests__/recording-ended.test.ts (9 tests passing)
- FOUND: .planning/phases/11-hangout-recording-lifecycle-fix/11-01-SUMMARY.md
- FOUND commit: 205fc60 (feat CDK + handler)
- FOUND commit: da8d560 (test fixes + new Stage tests)

---
*Phase: 11-hangout-recording-lifecycle-fix*
*Completed: 2026-03-04*
