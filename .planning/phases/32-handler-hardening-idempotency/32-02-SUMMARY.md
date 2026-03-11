---
phase: 32-handler-hardening-idempotency
plan: 02
subsystem: pipeline
tags: [transcribe, mediaconvert, idempotency, sqs, regex, logging]

# Dependency graph
requires:
  - phase: 32-handler-hardening-idempotency
    provides: Plan 01 recording-ended hardening with SQS retry semantics
  - phase: 31-sqs-pipeline-buffers
    provides: SQS wrapping for all pipeline handlers (transcode-completed, transcribe-completed)
provides:
  - Idempotent Transcribe job submission via stable vnl-{sessionId}-{jobId} composite key
  - ConflictException handling treats duplicate Transcribe submissions as idempotent success
  - Correct parse failure logging with rawJobName field at ERROR level
  - Updated regex accepts both epoch-only and MediaConvert job ID formats in transcribe-completed
affects: [transcribe, pipeline-observability, scan-stuck-sessions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent SQS handler: ConflictException on Transcribe = success, not failure"
    - "Stable composite job name: vnl-{sessionId}-{jobId} avoids epoch-based duplicate submissions"
    - "No updateTranscriptStatus('failed') before throw — leaves status as 'processing' for HARD-04 recovery"
    - "Regex anchored on epoch-ms prefix (>=10 digits) to correctly parse UUID session IDs with hyphens"

key-files:
  created: []
  modified:
    - backend/src/handlers/transcode-completed.ts
    - backend/src/handlers/transcribe-completed.ts
    - backend/src/handlers/__tests__/transcode-completed.test.ts
    - backend/src/handlers/__tests__/transcribe-completed.test.ts

key-decisions:
  - "Transcribe job name uses MediaConvert jobId (not epochMs) for idempotency: vnl-${sessionId}-${jobId}"
  - "ConflictException from Transcribe StartJob is idempotent success — still calls updateTranscriptStatus('processing')"
  - "Regex /^vnl-([a-z0-9-]+)-(\\d{10,}(?:-[a-f0-9]+)?)$/ anchors on >=10-digit epoch to avoid greedy UUID session ID capture"
  - "Parse failure logs at ERROR level with rawJobName field (not logger.warn with jobName)"

patterns-established:
  - "Idempotency via ConflictException: StartTranscriptionJobCommand with same name returns ConflictException on retry — treat as success"
  - "Job name parsing with epoch anchor: use \\d{10,} to distinguish job ID suffix from UUID session IDs"

requirements-completed: [HARD-02, HARD-05]

# Metrics
duration: 25min
completed: 2026-03-11
---

# Phase 32 Plan 02: Handler Hardening — Idempotent Transcribe Submission Summary

**Stable vnl-{sessionId}-{jobId} composite key replaces epoch-based names; ConflictException treated as idempotent success; parse failures log at ERROR with rawJobName field**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-11T22:50:00Z
- **Completed:** 2026-03-11T23:15:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- transcode-completed.ts uses stable `vnl-${sessionId}-${jobId}` composite job name so SQS retries don't submit duplicate Transcribe jobs
- ConflictException from StartTranscriptionJobCommand is caught and treated as idempotent success (updateTranscriptStatus('processing'), no throw)
- Transient Transcribe errors now throw for SQS retry without calling updateTranscriptStatus('failed') — leaves status as 'processing' for HARD-04 stale session recovery
- transcribe-completed.ts regex updated to accept both legacy epoch-only and new MediaConvert job ID formats, anchored on >=10 digit prefix to correctly parse UUID session IDs
- Parse failure logging upgraded from logger.warn to logger.error with structured rawJobName field
- 462 backend tests pass (up from 458 before this session — 4 new tests added)

## Task Commits

1. **Task 1: Idempotent job name + ConflictException handling in transcode-completed** - `67a863b` (feat)
2. **Task 2: Update transcribe-completed regex and parse failure logging** - `3209ca9` (feat)

## Files Created/Modified
- `backend/src/handlers/transcode-completed.ts` - Stable job name, ConflictException handling, throw on transient errors
- `backend/src/handlers/transcribe-completed.ts` - Updated regex with epoch anchor, logger.error with rawJobName
- `backend/src/handlers/__tests__/transcode-completed.test.ts` - Two new tests: ConflictException → success, non-ConflictException → batchItemFailure
- `backend/src/handlers/__tests__/transcribe-completed.test.ts` - Updated invalid-format test comment; new test for MediaConvert job ID format acceptance

## Decisions Made
- Used `\d{10,}` (>=10 digits) anchor in the transcribe-completed regex instead of the plan-specified `[\da-f-]+` — the plan's regex is greedy and incorrectly captures UUID session IDs with hyphens (e.g. `a1b2c3d4-e5f6-...`). The epoch-ms prefix is always >= 10 digits and UUID segments are never that long, so `\d{10,}` is a reliable discriminator.
- ConflictException handler still calls `updateTranscriptStatus('processing')` to handle the edge case where a previous attempt submitted the job but failed before updating DynamoDB.
- No `updateTranscriptStatus('failed')` before throw in the Transcribe error path — HARD-04 recovery cron handles stale 'processing' sessions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adjusted regex from plan-specified `[\da-f-]+` to `\d{10,}(?:-[a-f0-9]+)?`**
- **Found during:** Task 2 (transcribe-completed regex update)
- **Issue:** Plan's regex `/^vnl-([a-z0-9-]+)-[\da-f-]+$/` is greedy — for job name `vnl-newsession-1741723938123-abc123`, it captures `newsession-1741723938123` as the session ID instead of `newsession`. Root cause: both session IDs (UUIDs) and job IDs contain hyphens and hex digits.
- **Fix:** Changed suffix pattern to `(\d{10,}(?:-[a-f0-9]+)?)` — requires at least 10 consecutive digits (epoch ms timestamp), which UUID segments never have. Backtracking correctly terminates at the session ID boundary.
- **Files modified:** backend/src/handlers/transcribe-completed.ts
- **Verification:** New test `vnl-newsession-1741723938123-abc123` correctly parses `newsession` as sessionId; all 462 tests pass
- **Committed in:** 3209ca9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - regex correctness bug in plan spec)
**Impact on plan:** Fix is necessary for correct operation with UUID session IDs. The plan's regex would silently misparse session IDs on every Transcribe completion, causing all transcript storage to write to wrong DynamoDB records.

## Issues Encountered
- The plan-specified regex `[\da-f-]+` appears correct at first glance but has a greedy matching problem when session IDs contain hyphens (UUID format). Discovered during test execution when the new-format test captured the wrong session ID segment.

## Next Phase Readiness
- transcode-completed is now safe for SQS at-least-once delivery (ConflictException idempotency)
- transcribe-completed correctly parses all job name formats including new MediaConvert composite key
- HARD-04 (stale processing recovery) can safely recover sessions where Transcribe submission threw after job was already submitted

---
*Phase: 32-handler-hardening-idempotency*
*Completed: 2026-03-11*
