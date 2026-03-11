---
phase: 32-handler-hardening-idempotency
plan: "04"
subsystem: backend-pipeline
tags:
  - scan-stuck-sessions
  - session-repository
  - idempotency
  - transcript-recovery
  - tdd
dependency_graph:
  requires:
    - session-repository.ts (updateTranscriptStatus)
    - scan-stuck-sessions.ts (eligibility filter)
  provides:
    - transcriptStatusUpdatedAt timestamp on every status transition
    - 2-hour stale-processing recovery gate in scan-stuck-sessions
  affects:
    - Sessions stuck in transcriptStatus='processing' are now recoverable after 2 hours
tech_stack:
  added: []
  patterns:
    - ISO timestamp written alongside every status transition for audit/recovery use
    - Conservative skip (no timestamp = skip) vs. aggressive recovery (timestamp > 2h = recover)
key_files:
  created: []
  modified:
    - backend/src/repositories/session-repository.ts
    - backend/src/handlers/scan-stuck-sessions.ts
    - backend/src/handlers/__tests__/scan-stuck-sessions.test.ts
decisions:
  - "Conservative skip when transcriptStatusUpdatedAt is absent: unknown entry time → prefer safety over recovery"
  - "2-hour threshold chosen to exceed typical MediaConvert + Transcribe combined job runtime with margin"
  - "Timestamp written in repository (not in handlers) so all callers benefit automatically"
metrics:
  duration: "~15 minutes"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  completed_date: "2026-03-11"
---

# Phase 32 Plan 04: Stale-Processing Recovery for Stuck Sessions Summary

**One-liner:** Adds `transcriptStatusUpdatedAt` timestamp to every `updateTranscriptStatus` call, then gates scan-stuck-sessions to recover `processing` sessions only when that timestamp is more than 2 hours old.

## What Was Built

### Task 1: transcriptStatusUpdatedAt in session-repository

`updateTranscriptStatus` in `session-repository.ts` now always writes `transcriptStatusUpdatedAt = new Date().toISOString()` alongside every `transcriptStatus` transition. This ensures any downstream consumer (including scan-stuck-sessions) can determine when a session entered its current processing state without needing a separate query.

The three-line addition pushes into the existing dynamic `updateParts` / `expressionAttributeNames` / `expressionAttributeValues` structures, so it applies to all callers regardless of which optional params (s3Path, plainText) they pass.

### Task 2: Stale-processing gate in scan-stuck-sessions

Previously, scan-stuck-sessions unconditionally excluded all sessions with `transcriptStatus = 'processing'` (PIPE-06 guard). This meant any session where MediaConvert or Transcribe threw an error *after* setting status to 'processing' was permanently unrecoverable by the cron.

The fix introduces `PROCESSING_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000` (2 hours) and a `staleProcessingCutoff` date computed per run. The eligibility filter now applies three-branch logic for `transcriptStatus = 'processing'`:

1. **No `transcriptStatusUpdatedAt`** → skip conservatively (unknown entry time)
2. **`transcriptStatusUpdatedAt` >= staleProcessingCutoff** → skip (job may still be running)
3. **`transcriptStatusUpdatedAt` < staleProcessingCutoff** → falls through to eligibility (processing AND > 2h old → recover)

Terminal states (`available`, `failed`) remain excluded as before.

## Tests

Three new / updated tests in `scan-stuck-sessions.test.ts`:

| Test | Scenario | Expected |
|------|----------|----------|
| `should skip sessions with transcriptStatus = processing and no transcriptStatusUpdatedAt` | No timestamp field | Skip (PutEventsCommand not called) |
| `should skip sessions with transcriptStatus = processing updated less than 2h ago` | Updated 30 min ago | Skip |
| `should recover sessions with transcriptStatus = processing updated more than 2h ago` | Updated 3 hours ago | Recover (PutEventsCommand called) |

All 80 plan-related tests pass (70 session-repository + 10 scan-stuck-sessions).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `754dd77` | feat(32-04): add transcriptStatusUpdatedAt to updateTranscriptStatus |
| Task 2 | `ec76ddf` | feat(32-04): add stale-processing threshold to scan-stuck-sessions |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

**Files exist:**
- `backend/src/repositories/session-repository.ts` - contains `transcriptStatusUpdatedAt`
- `backend/src/handlers/scan-stuck-sessions.ts` - contains `PROCESSING_STALE_THRESHOLD_MS`
- `backend/src/handlers/__tests__/scan-stuck-sessions.test.ts` - contains 3 processing-status tests

**Commits exist:**
- `754dd77` - Task 1 repository change
- `ec76ddf` - Task 2 handler + test changes
