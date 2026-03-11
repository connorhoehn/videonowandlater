---
phase: 32-handler-hardening-idempotency
plan: "01"
subsystem: pipeline
tags: [sqs, mediaconvert, error-handling, retry, idempotency, lambda, tdd]

# Dependency graph
requires:
  - phase: 31-sqs-pipeline-buffers
    provides: SQS queue wrapping for recording-ended handler with batchItemFailures support
provides:
  - recording-ended handler that throws on MediaConvert submission failure
  - Pool resource release in finally block guaranteeing cleanup on all code paths
  - SQS batchItemFailures populated when MediaConvert rejects
affects:
  - 32-02 (transcribe-completed hardening — same throw pattern)
  - 32-03 (transcode-completed hardening — same throw pattern)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "try/finally for critical resource cleanup: MediaConvert attempt in try, pool release in finally"
    - "Outer processEvent catch re-throws — SQS wrapper handles batchItemFailures population"
    - "Non-critical ops (reaction summary, participant count) keep own try/catch; critical pipeline ops do not"

key-files:
  created: []
  modified:
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/__tests__/recording-ended.test.ts

key-decisions:
  - "MediaConvert submission is now critical (throws on failure) — SQS ensures at-least-once retry semantics instead of silent discard"
  - "Pool release moved to finally block — guaranteed cleanup regardless of MediaConvert success or failure"
  - "transcriptStatus left as 'processing' on transient failures so HARD-04 recovery cron can detect and resubmit"
  - "Do NOT add updateTranscriptStatus('failed') in throw path — recovery cron uses 'processing' as the retry signal"

patterns-established:
  - "Critical pipeline operation pattern: unwrapped (throws) + try/finally for cleanup"
  - "Non-critical operation pattern: wrapped in own try/catch, logged, non-blocking"

requirements-completed:
  - HARD-01

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 32 Plan 01: Handler Hardening — Recording Ended Summary

**recording-ended MediaConvert submission now throws on failure so SQS delivers batchItemFailures for at-least-once retry, with pool resource release guaranteed via finally block**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T19:40:56Z
- **Completed:** 2026-03-11T19:43:35Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Removed inner try/catch around `mediaConvertClient.send()` — MediaConvert errors now propagate to outer catch
- Moved pool resource release (channel, stage, chatRoom) into `finally` block — cleanup always executes
- Changed outer `processEvent` catch to `throw error` — SQS wrapper adds messageId to batchItemFailures
- Added `jest.mock('@aws-sdk/client-mediaconvert')` and two new tests covering the failure path
- All 457 backend tests pass

## Task Commits

Each task was committed atomically:

1. **Tasks 1+2: Remove MediaConvert suppression, add finally block, add failure tests** - `1fd17e9` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks combined into single atomic commit (implementation + tests)_

## Files Created/Modified
- `backend/src/handlers/recording-ended.ts` - MediaConvert block unwrapped, pool release in finally, outer catch re-throws
- `backend/src/handlers/__tests__/recording-ended.test.ts` - Added @aws-sdk/client-mediaconvert mock, two new failure tests

## Decisions Made
- Combined Task 1 (implementation) and Task 2 (tests) into a single atomic commit since TDD RED→GREEN cycle was used — the test file and handler file were always in sync
- Pool resources placed in `finally` of an inner try/finally, not the outer processEvent try — this ensures the outer catch's `throw error` still propagates after cleanup

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The structural change was straightforward: the existing code had a clearly isolated MediaConvert try/catch block and sequential pool release that mapped directly to the try/finally pattern specified in the plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- recording-ended now participates correctly in SQS retry semantics
- Pattern established for hardening remaining handlers (transcribe-completed, transcode-completed)
- Ready for 32-02: harden transcribe-completed handler

---
*Phase: 32-handler-hardening-idempotency*
*Completed: 2026-03-11*
