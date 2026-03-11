---
phase: 26-stuck-session-recovery-cron
plan: "01"
subsystem: pipeline
tags:
  - cron
  - stuck-session-recovery
  - eventbridge
  - dynamodb-gsi
  - pipeline-reliability

dependency_graph:
  requires:
    - GSI1 index on session DynamoDB table (STATUS#ENDING, STATUS#ENDED partitions)
    - EventBridge default bus
    - "@aws-lambda-powertools/logger"
  provides:
    - scan-stuck-sessions Lambda handler (cron entry point for PIPE-05 through PIPE-08)
    - Recording Recovery EventBridge events consumed by recording-ended.ts
  affects:
    - session-stack.ts (EventBridge Scheduler wiring — covered in plan 26-02)

tech_stack:
  added: []
  patterns:
    - Dual GSI1 partition query (STATUS#ENDING + STATUS#ENDED) merged in-Lambda
    - Conditional UpdateCommand with if_not_exists + cap guard for atomic counter
    - ConditionalCheckFailedException caught per-session (concurrent cron race safe)
    - Non-blocking PutEventsCommand with per-session try/catch
    - Promise.all parallel batch processing capped by MAX_RECOVERY_PER_RUN

key_files:
  created:
    - backend/src/handlers/scan-stuck-sessions.ts
    - backend/src/handlers/__tests__/scan-stuck-sessions.test.ts
  modified: []

decisions:
  - "PutEvents to EventBridge default bus (not direct Lambda.invoke) preserves DLQ/retry semantics"
  - "GSI1 dual-partition query (not ScanCommand) prevents RCU cost explosion"
  - "In-Lambda filter for endedAt, transcriptStatus, and recoveryAttemptCount avoids FilterExpression costs"
  - "ConditionalCheckFailedException is caught per-session, not per-batch — other sessions still process"

metrics:
  duration_seconds: 114
  completed_date: "2026-03-10T16:49:47Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
  tests_added: 8
  tests_total: 402
---

# Phase 26 Plan 01: Scan Stuck Sessions Handler Summary

**One-liner:** Cron Lambda that queries GSI1 STATUS#ENDING/STATUS#ENDED, filters stuck sessions via 45-min threshold and transcriptStatus gate, atomically increments recoveryAttemptCount (capped at 3), and publishes Recording Recovery events to EventBridge.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement scan-stuck-sessions.ts handler | 3b8cfea | backend/src/handlers/scan-stuck-sessions.ts |
| 2 | Write unit tests for scan-stuck-sessions handler | 857cf66 | backend/src/handlers/__tests__/scan-stuck-sessions.test.ts |

## What Was Built

### scan-stuck-sessions.ts

The handler implements the full PIPE-05 through PIPE-08 requirements:

- `queryEndingSessions(tableName)` — two sequential QueryCommands against GSI1 (STATUS#ENDING, STATUS#ENDED), errors are per-partition non-blocking
- In-Lambda filter with 45-minute cutoff (`Date.now() - 45 * 60 * 1000`), transcriptStatus gate (skip processing/available/failed), and recoveryAttemptCount cap (skip >= 3)
- `recoverSession(item, tableName, awsRegion)` — atomic UpdateCommand with `if_not_exists(recoveryAttemptCount, :zero) + :inc` and `ConditionExpression: recoveryAttemptCount < :cap`; catches ConditionalCheckFailedException for concurrent cron safety
- PutEventsCommand to EventBridge default bus with `source: 'custom.vnl'`, `DetailType: 'Recording Recovery'`, and detail payload including sessionId, recoveryAttempt, recoveryAttemptCount, recordingHlsUrl, recordingS3Path
- MAX_RECOVERY_PER_RUN env var cap (default 25) with systemic-issue warning when exceeded
- Logs "Pipeline stage entered" and "Pipeline stage completed" with durationMs, sessionsRecovered, sessionsSkipped following the established Powertools Logger pattern

### scan-stuck-sessions.test.ts

8 unit tests covering all documented criteria:
1. Skip transcriptStatus = 'processing'
2. Skip transcriptStatus = 'available'
3. Skip recoveryAttemptCount >= 3
4. Skip endedAt within 45 minutes
5. Happy path: UpdateCommand with correct expression + PutEventsCommand with source/detail-type
6. ConditionalCheckFailedException: handler does not throw, PutEvents not called
7. Dual-partition query: QueryCommand called for STATUS#ENDING then STATUS#ENDED
8. Non-blocking PutEvents failure: handler resolves without error

## Verification

- TypeScript: no errors (`npx tsc --noEmit` clean)
- New tests: 8/8 pass
- Full suite: 402/402 pass (no regressions)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `backend/src/handlers/scan-stuck-sessions.ts` — EXISTS
- [x] `backend/src/handlers/__tests__/scan-stuck-sessions.test.ts` — EXISTS
- [x] Commit 3b8cfea — Task 1 handler
- [x] Commit 857cf66 — Task 2 tests

## Self-Check: PASSED
