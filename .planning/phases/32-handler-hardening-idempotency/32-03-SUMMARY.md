---
phase: 32-handler-hardening-idempotency
plan: "03"
subsystem: backend/handlers
tags: [hardening, error-propagation, eventbridge, upload-pipeline]
dependency_graph:
  requires: []
  provides: [on-mediaconvert-complete-throws-on-failure]
  affects: [upload-transcription-pipeline, eventbridge-retry-semantics]
tech_stack:
  added: []
  patterns: [throw-on-critical-failure, no-inner-catch-suppression]
key_files:
  modified:
    - backend/src/handlers/on-mediaconvert-complete.ts
    - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
decisions:
  - Remove inner try/catch around PutEventsCommand so EventBridge failures propagate to outer catch and trigger Lambda retry
  - Outer catch rethrows unconditionally (throw error) — EventBridge retries the invocation and DLQ captures permanently failing events
  - ERROR/CANCELED paths unchanged — terminal MediaConvert failure is not a transient error, no rethrow needed
metrics:
  duration_minutes: 15
  completed_date: "2026-03-11"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 32 Plan 03: on-mediaconvert-complete Hardening Summary

**One-liner:** Remove PutEvents error suppression from on-mediaconvert-complete.ts so EventBridge and DynamoDB failures cause Lambda to throw, enabling EventBridge retry semantics for the upload transcription pipeline.

## What Was Built

The `on-mediaconvert-complete.ts` handler previously had an inner try/catch around `eventBridgeClient.send(PutEventsCommand)` that silently swallowed errors. This meant that if the "Upload Recording Available" EventBridge event failed to publish, the transcription pipeline for uploaded videos was permanently skipped with no retry.

Two changes were made:

1. **Removed the inner PutEvents try/catch** — `eventBridgeClient.send(...)` now stands alone; any rejection propagates directly to the outer catch block.

2. **Outer catch rethrows** — The outer catch already had `throw error` from a prior partial fix; this plan completes the hardening by removing the inner suppressor that was making the throw unreachable for EventBridge failures.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove PutEvents error suppression; outer catch throws | 3ab380c | backend/src/handlers/on-mediaconvert-complete.ts |
| 2 | Update tests to assert throw behavior | 9ef2db9 | backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Handler had inner catch that wasn't visible from plan context**
- **Found during:** Task 1 execution
- **Issue:** The plan showed the handler as already having `throw error` in the outer catch (from a prior partial fix), but the inner try/catch around PutEventsCommand was still present, making the outer throw unreachable for EventBridge failures
- **Fix:** Removed inner try/catch block (lines 67-87 in original); `eventBridgeClient.send(...)` now unguarded
- **Files modified:** backend/src/handlers/on-mediaconvert-complete.ts
- **Commit:** 3ab380c

### Out-of-Scope Discoveries

- `transcribe-completed.test.ts` has 12 failing tests from in-progress phase 32 plan 02/04 changes — not caused by this plan's changes; logged to deferred-items

## Verification Results

```
# No inner catch around PutEvents
grep "Don't rethrow|non-blocking" backend/src/handlers/on-mediaconvert-complete.ts
→ No suppression comments found

# Outer catch rethrows
grep "throw error" backend/src/handlers/on-mediaconvert-complete.ts
→ 95: throw error; // Propagate to EventBridge for retry

# Test updated
grep "rejects.toThrow" backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
→ 430: await expect(handler(event)).rejects.toThrow('DynamoDB error');
→ 650: await expect(handler(event)).rejects.toThrow('EventBridge publish failed');

# on-mediaconvert-complete tests
Tests: 16 passed, 16 total
```

## Self-Check: PASSED

- FOUND: backend/src/handlers/on-mediaconvert-complete.ts
- FOUND: backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
- FOUND: .planning/phases/32-handler-hardening-idempotency/32-03-SUMMARY.md
- FOUND: commit 3ab380c (fix: remove PutEvents error suppression)
- FOUND: commit 9ef2db9 (test: update tests to assert throw behavior)
