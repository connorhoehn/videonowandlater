---
phase: 26-stuck-session-recovery-cron
plan: "02"
subsystem: pipeline
tags:
  - recording-ended
  - scan-stuck-sessions
  - eventbridge
  - cdk
  - mediaconvert
  - recovery
dependency_graph:
  requires:
    - 26-01
  provides:
    - recovery-event-routing
    - scan-stuck-sessions-cron
  affects:
    - recording-ended
    - session-stack
tech_stack:
  added: []
  patterns:
    - EventBridge rule with custom source routing
    - EventBridge Scheduler rate-based cron
    - Recovery guard early-exit pattern in Lambda handler
key_files:
  created: []
  modified:
    - backend/src/handlers/recording-ended.ts
    - infra/lib/stacks/session-stack.ts
decisions:
  - "Used static import for GetCommand/UpdateCommandDirect at module top instead of dynamic require() as specified in plan — cleaner TypeScript, no behavior difference"
  - "MEDIACONVERT_ROLE_ARN, TRANSCRIPTION_BUCKET, AWS_ACCOUNT_ID already set on recordingEndedFn — skipped addEnvironment calls as instructed"
  - "Removed unused epochMs variable in recovery path that was included in plan spec"
metrics:
  duration_seconds: 229
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_modified: 2
---

# Phase 26 Plan 02: Stuck Session Recovery Wiring Summary

**One-liner:** Recovery event guard in recording-ended.ts + scanStuckSessionsFn cron + RecordingRecoveryRule EventBridge routing to close the full stuck-session recovery loop.

## What Was Built

### Task 1: Recovery Event Guard in recording-ended.ts

Added a recovery event early-exit code path at the top of the `handler` body in `backend/src/handlers/recording-ended.ts`. This guard fires before the existing `event.resources?.[0]` check, allowing recovery events (which carry no IVS ARN in resources) to be handled without crashing.

The recovery path:
1. Checks `event.detail?.recoveryAttempt === true`
2. Reads `sessionId` from `event.detail.sessionId`
3. Fetches the session from DynamoDB to get `recordingS3Path` and `recordingHlsUrl`
4. Re-submits a MediaConvert job using `s3://${recordingS3Path}/media/hls/master.m3u8` as input
5. Stores the new `mediaconvertJobId` and sets `transcriptStatus = 'processing'`
6. Returns early — the existing IVS ARN-based path is never reached for recovery events

Also added `GetCommand` and `UpdateCommandDirect` as named imports at module scope (replacing the `require()` style specified in plan for cleaner TypeScript).

### Task 2: CDK Constructs in session-stack.ts

Three new constructs added to `infra/lib/stacks/session-stack.ts`:

**scanStuckSessionsFn** (after `ReplenishPoolSchedule` block):
- `NodejsFunction` pointing to `backend/src/handlers/scan-stuck-sessions.ts`
- 5-minute timeout, `TABLE_NAME` + `AWS_ACCOUNT_ID` environment variables
- `LogGroup` with `ONE_MONTH` retention and `DESTROY` removal policy
- `grantReadWriteData` for DynamoDB access
- `events:PutEvents` IAM policy for publishing recovery events

**ScanStuckSessionsSchedule** (immediately after scanStuckSessionsFn):
- EventBridge Rule with `events.Schedule.rate(Duration.minutes(15))`
- Target: `scanStuckSessionsFn`

**RecordingRecoveryRule** (after `AllowEBStageRecordingEndInvoke` permission):
- EventBridge Rule matching `source: ['custom.vnl']` + `detailType: ['Recording Recovery']`
- Target: `recordingEndedFn` with `recordingEventsDlq` and `retryAttempts: 2`
- `AllowEBRecoveryInvoke` Lambda permission

## Verification

- TypeScript: 0 errors (`npx tsc --noEmit`)
- Tests: 402/402 pass (50 test suites)
- CDK synth: exit code 0, `ScanStuckSessions` bundled successfully
- Template contains: 21 occurrences of `ScanStuckSessions`, 8 of `RecordingRecovery`
- `ScanStuckSessionsSchedule` has `ScheduleExpression: "rate(15 minutes)"`
- Recovery guard on line 62 is before `resourceArn` check on line 174

## Decisions Made

1. **Static imports over dynamic require()**: Plan specified `require('@aws-sdk/lib-dynamodb')` inside the recovery block. Used static `import { GetCommand, UpdateCommandDirect }` at module top instead — cleaner TypeScript pattern, no behavioral difference, consistent with rest of file.

2. **Skipped redundant addEnvironment calls**: Plan said to add `MEDIACONVERT_ROLE_ARN`, `TRANSCRIPTION_BUCKET`, `AWS_ACCOUNT_ID` environment vars to `recordingEndedFn` if not already present. All three were already set on lines 471-473. Skipped.

3. **Removed unused epochMs variable**: Plan template included `const epochMs = Date.now()` in the recovery path but `epochMs` was never referenced. Removed to prevent TypeScript no-unused-variable warnings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused epochMs variable in recovery code path**
- **Found during:** Task 1
- **Issue:** Plan template included `const epochMs = Date.now()` in recovery path but it was never used — would cause TypeScript unused-variable warning
- **Fix:** Removed the line
- **Files modified:** `backend/src/handlers/recording-ended.ts`
- **Commit:** d0e9d5c

**2. [Rule 1 - Bug] Used static import instead of require() for GetCommand**
- **Found during:** Task 1
- **Issue:** Plan specified `const { GetCommand } = require('@aws-sdk/lib-dynamodb')` inside handler body — mixes CommonJS require with ES module imports, not idiomatic TypeScript
- **Fix:** Added `import { GetCommand, UpdateCommandDirect } from '@aws-sdk/lib-dynamodb'` at module top
- **Files modified:** `backend/src/handlers/recording-ended.ts`
- **Commit:** d0e9d5c

## Self-Check: PASSED

- `backend/src/handlers/recording-ended.ts` — FOUND
- `infra/lib/stacks/session-stack.ts` — FOUND
- Commit d0e9d5c — FOUND
- Commit a3d4d08 — FOUND
- "recoveryAttempt" in recording-ended.ts — FOUND (line 62)
- "ScanStuckSessions" in session-stack.ts — FOUND
- "RecordingRecoveryRule" in session-stack.ts — FOUND
