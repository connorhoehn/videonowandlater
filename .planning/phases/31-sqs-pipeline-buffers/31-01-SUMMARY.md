---
phase: 31-sqs-pipeline-buffers
plan: "01"
subsystem: infra
tags: [sqs, eventbridge, cdk, pipeline, durability]
dependency_graph:
  requires: []
  provides: [sqs-queue-pairs, event-source-mappings, sqs-rule-targets]
  affects: [recording-ended, transcode-completed, transcribe-completed, store-summary, start-transcribe]
tech_stack:
  added: [SqsEventSource from aws-cdk-lib/aws-lambda-event-sources]
  patterns: [EventBridge→SQS→Lambda at-least-once delivery, per-handler DLQ pattern]
key_files:
  created: []
  modified:
    - infra/lib/stacks/session-stack.ts
decisions:
  - "bisectBatchOnFunctionError removed — property does not exist in CDK v2.170 SqsEventSourceProps; using batchSize:1 + reportBatchItemFailures:true instead"
  - "Queue declarations placed after recordingEventsDlq (not at file bottom) to avoid TypeScript forward-reference errors"
  - "recordingEndedQueue serves 3 rules (recordingEndRule, stageRecordingEndRule, recordingRecoveryRule) — no manual resource policy needed; targets.SqsQueue auto-adds per-rule policy statements"
metrics:
  duration_seconds: 246
  completed_date: "2026-03-11"
  tasks_completed: 2
  files_modified: 1
---

# Phase 31 Plan 01: SQS Pipeline Buffers Summary

**One-liner:** Five SQS queue pairs with per-handler DLQs replacing direct EventBridge→Lambda invocation for all pipeline handlers, wired via SqsEventSource mappings.

## What Was Built

Added 10 SQS constructs (5 queue + DLQ pairs) to the CDK session stack and migrated all five critical pipeline EventBridge rules from direct Lambda invocation to SQS buffering. Each Lambda now polls its dedicated queue.

### Queue Pairs Created

| Queue | DLQ | Visibility Timeout | Serves |
|-------|-----|--------------------|--------|
| `vnl-recording-ended` | `vnl-recording-ended-dlq` | 180s (6×30s) | 3 rules: recordingEndRule, stageRecordingEndRule, recordingRecoveryRule |
| `vnl-transcode-completed` | `vnl-transcode-completed-dlq` | 180s (6×30s) | transcodeCompletedRule |
| `vnl-transcribe-completed` | `vnl-transcribe-completed-dlq` | 180s (6×30s) | transcribeCompletedRule |
| `vnl-store-summary` | `vnl-store-summary-dlq` | 360s (6×60s) | transcriptStoreRule |
| `vnl-start-transcribe` | `vnl-start-transcribe-dlq` | 180s (6×30s) | uploadRecordingAvailableRule |

All DLQs: `retentionPeriod: 14 days`, `maxReceiveCount: 3`.

### Event Source Mappings

All 5 Lambdas now poll their queue via `SqsEventSource` with `batchSize: 1` and `reportBatchItemFailures: true`.

### Rule Target Changes

| Rule | Before | After |
|------|--------|-------|
| recordingEndRule | `targets.LambdaFunction(recordingEndedFn, { dlq, retryAttempts: 2 })` | `targets.SqsQueue(recordingEndedQueue)` |
| stageRecordingEndRule | same | `targets.SqsQueue(recordingEndedQueue)` |
| recordingRecoveryRule | same | `targets.SqsQueue(recordingEndedQueue)` |
| transcodeCompletedRule | `targets.LambdaFunction(transcodeCompletedFn, { dlq, retryAttempts: 2 })` | `targets.SqsQueue(transcodeCompletedQueue)` |
| transcribeCompletedRule | same | `targets.SqsQueue(transcribeCompletedQueue)` |
| transcriptStoreRule | `targets.LambdaFunction(storeSummaryFn)` (inline) | `targets.SqsQueue(storeSummaryQueue)` |
| uploadRecordingAvailableRule | `targets.LambdaFunction(startTranscribeFn)` (inline) | `targets.SqsQueue(startTranscribeQueue)` |

### Permissions Cleaned Up

Removed 6 stale `addPermission` calls:
- `AllowEBRecordingEndInvoke`
- `AllowEBStageRecordingEndInvoke`
- `AllowEBRecoveryInvoke`
- `AllowEBTranscodeCompletedInvoke`
- `AllowEBTranscribeCompletedInvoke`
- `AllowEBTranscriptStoreInvoke`

`recordingEventsDlq` resource policy updated to reference only `recordingStartRule` (the one non-migrated handler still using this DLQ).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 0534c11 | Add SQS queue pairs and event source mappings |
| Task 2 | d72517d | Redirect EventBridge targets to SQS, clean up permissions |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `bisectBatchOnFunctionError` not in CDK v2.170 `SqsEventSourceProps`**
- **Found during:** Task 1 — TypeScript compilation
- **Issue:** Plan specified `bisectBatchOnFunctionError: true` in `SqsEventSourceProps` but this property does not exist in the installed CDK version. CDK v2.170 `SqsEventSourceProps` only supports: `batchSize`, `maxBatchingWindow`, `reportBatchItemFailures`, `enabled`, `filters`, `filterEncryption`, `maxConcurrency`, `metricsConfig`.
- **Fix:** Removed `bisectBatchOnFunctionError` from all 5 event source mapping definitions. `batchSize: 1` + `reportBatchItemFailures: true` retained.
- **Files modified:** `infra/lib/stacks/session-stack.ts`
- **Commit:** 0534c11

**2. [Rule 3 - Blocking] Queue declarations must precede first usage**
- **Found during:** Task 2 — TypeScript compilation after adding SQS targets to mid-file rules
- **Issue:** Plan recommended grouping queue declarations at file bottom ("after all Lambdas") but TypeScript `const` declarations cannot be referenced before their declaration in the same scope.
- **Fix:** Moved all 5 queue pair declarations to immediately after `recordingEventsDlq` (line ~405), ensuring all rule targets can reference the queue variables at their mid-file usage points.
- **Files modified:** `infra/lib/stacks/session-stack.ts`
- **Commit:** d72517d

## Self-Check: PASSED

- [x] `infra/lib/stacks/session-stack.ts` modified — exists
- [x] Commit 0534c11 exists (`feat(31-01): add SQS queue pairs`)
- [x] Commit d72517d exists (`feat(31-01): redirect EventBridge rule targets`)
- [x] `grep -c "SqsEventSource"` → 6 (1 import + 5 usages)
- [x] `grep -c "targets.SqsQueue"` → 7 (3 for recordingEnded + 4 for other queues)
- [x] Stale addPermission count → 0
- [x] TypeScript compilation: clean
