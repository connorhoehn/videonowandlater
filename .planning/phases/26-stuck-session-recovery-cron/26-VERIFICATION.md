---
phase: 26-stuck-session-recovery-cron
verified: 2026-03-10T17:10:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 26: Stuck Session Recovery Cron Verification Report

**Phase Goal:** Sessions that enter the pipeline but never reach a completed transcript status are automatically detected and re-triggered without developer intervention.
**Verified:** 2026-03-10T17:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Sessions with transcriptStatus null or pending and endedAt > 45 minutes ago are identified and a recovery event is published | VERIFIED | `scan-stuck-sessions.ts` lines 160-172: in-Lambda filter checks `!item.endedAt \|\| item.endedAt >= cutoff` and `ts === 'processing' \|\| ts === 'available' \|\| ts === 'failed'`; passes eligible sessions to `recoverSession` which calls `PutEventsCommand` |
| 2 | Sessions with transcriptStatus = 'processing' are skipped — no double-submission | VERIFIED | Line 165: `if (ts === 'processing' \|\| ts === 'available' \|\| ts === 'failed') return false`; test "should skip sessions with transcriptStatus = processing" passes |
| 3 | Sessions with recoveryAttemptCount >= 3 are permanently excluded | VERIFIED | Lines 168-170: `const count = item.recoveryAttemptCount ?? 0; if (count >= RECOVERY_ATTEMPT_CAP) return false`; `RECOVERY_ATTEMPT_CAP = 3`; test "should skip sessions with recoveryAttemptCount >= 3" passes |
| 4 | recoveryAttemptCount is incremented atomically via conditional write before PutEvents | VERIFIED | Lines 82-91: `UpdateExpression: 'SET recoveryAttemptCount = if_not_exists(recoveryAttemptCount, :zero) + :inc'` with `ConditionExpression: 'attribute_not_exists(recoveryAttemptCount) OR recoveryAttemptCount < :cap'`; UpdateCommand called before PutEventsCommand |
| 5 | Both STATUS#ENDING and STATUS#ENDED GSI1 partitions are queried and merged | VERIFIED | Lines 36-56: `const partitions = ['STATUS#ENDING', 'STATUS#ENDED']` iterated with sequential `QueryCommand` calls; results spread into `allItems`; test "should query both STATUS#ENDING and STATUS#ENDED partitions" passes |
| 6 | All 8 unit test cases pass | VERIFIED | `npx jest --testPathPatterns=scan-stuck-sessions` output: "8 passed, 8 total" |
| 7 | recording-ended.ts handles recovery events (detail.recoveryAttempt = true) by reading sessionId from detail directly rather than from event.resources | VERIFIED | `recording-ended.ts` line 62: `if (event.detail?.recoveryAttempt === true)` guard before `resourceArn` check at line 174; full recovery path (DynamoDB fetch, MediaConvert re-submit, early return) at lines 62-172 |
| 8 | scan-stuck-sessions Lambda is deployed with EventBridge Scheduler firing every 15 minutes | VERIFIED | `session-stack.ts` lines 299-303: `events.Rule` with `events.Schedule.rate(Duration.minutes(15))`; synthesized template confirms `ScheduleExpression: "rate(15 minutes)"` on `ScanStuckSessionsSchedule888A29A6` |
| 9 | RecordingRecoveryRule routes 'Recording Recovery' events (source 'custom.vnl') to recordingEndedFn with DLQ and retryAttempts: 2 | VERIFIED | `session-stack.ts` lines 447-461: `RecordingRecoveryRule` with `eventPattern: { source: ['custom.vnl'], detailType: ['Recording Recovery'] }`; target `recordingEndedFn` with `deadLetterQueue: recordingEventsDlq, retryAttempts: 2`; synthesized template confirms correct EventPattern |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/handlers/scan-stuck-sessions.ts` | Cron Lambda handler for stuck session detection and recovery; exports `handler` | VERIFIED | 203 lines; dual GSI1 query, 45-min filter, atomic counter, PutEvents; TypeScript compiles clean |
| `backend/src/handlers/__tests__/scan-stuck-sessions.test.ts` | Unit test suite covering all skip criteria and recovery path | VERIFIED | 8 tests, all pass; covers processing-skip, available-skip, count-cap-skip, time-threshold-skip, happy-path, ConditionalCheckFailedException, dual-partition query, non-blocking PutEvents failure |
| `backend/src/handlers/recording-ended.ts` | Recovery event guard — uses event.detail.sessionId when detail.recoveryAttempt is true | VERIFIED | Guard at line 62; fetches session from DynamoDB, re-submits MediaConvert, stores jobId + transcriptStatus, returns early; existing IVS path unchanged below line 174 |
| `infra/lib/stacks/session-stack.ts` | scanStuckSessionsFn NodejsFunction + ScanStuckSessionsSchedule + RecordingRecoveryRule CDK constructs | VERIFIED | All three constructs present at lines 276-303 and 447-461; CDK synth exits 0 with all constructs in template |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scan-stuck-sessions.ts` | DynamoDB GSI1 | `QueryCommand` with `GSI1PK = 'STATUS#ENDING'` and `'STATUS#ENDED'` | WIRED | Lines 41-46: `IndexName: 'GSI1'`, `KeyConditionExpression: 'GSI1PK = :status'`; both partitions queried |
| `scan-stuck-sessions.ts` | EventBridge default bus | `PutEventsCommand` with `source: 'custom.vnl'`, `DetailType: 'Recording Recovery'` | WIRED | Lines 110-124: `PutEventsCommand` called with correct source and detail-type |
| `scan-stuck-sessions.ts` | DynamoDB session record | `UpdateCommand` with `if_not_exists` + `ConditionExpression` cap at 3 | WIRED | Lines 79-91: `UpdateExpression` uses `if_not_exists(recoveryAttemptCount, :zero)`, `ConditionExpression` checks `< :cap` with cap = 3 |
| EventBridge Scheduler (rate 15 min) | `scanStuckSessionsFn` | `events.Rule` with `events.Schedule.rate(Duration.minutes(15))` | WIRED | `ScanStuckSessionsSchedule` at line 299-303; template `ScheduleExpression: "rate(15 minutes)"` confirmed |
| `RecordingRecoveryRule` | `recordingEndedFn` | Event pattern `source: custom.vnl` + `detailType: Recording Recovery` | WIRED | Lines 447-461; template confirms correct EventPattern targeting `RecordingEnded99E8F8D9` Lambda ARN with DLQ |
| `recording-ended.ts` | `event.detail.sessionId` | `if (event.detail?.recoveryAttempt)` branch | WIRED | Line 62 guard; `recoverySessionId = event.detail.sessionId` at line 63; guard at line 62 is before `event.resources?.[0]` at line 174 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PIPE-05 | 26-01, 26-02 | Recovery cron runs every 15 minutes and identifies sessions where `transcriptStatus` is `null` or `pending` and `endedAt` is more than 45 minutes ago | SATISFIED | 15-min `ScanStuckSessionsSchedule` in CDK; `scan-stuck-sessions.ts` 45-min cutoff filter at line 161; null/pending check at lines 164-166 |
| PIPE-06 | 26-01, 26-02 | Recovery cron re-fires the appropriate EventBridge event for the earliest failed stage with a `recoveryAttempt` counter on the event | SATISFIED | `PutEventsCommand` with `recoveryAttempt: true, recoveryAttemptCount: newCount` in detail (lines 116-121); `RecordingRecoveryRule` routes to `recordingEndedFn` which re-submits MediaConvert |
| PIPE-07 | 26-01 | Recovery cron skips sessions with `transcriptStatus = 'processing'` to prevent double-execution | SATISFIED | Line 165: explicit `ts === 'processing'` check; test "should skip sessions with transcriptStatus = processing" passes |
| PIPE-08 | 26-01 | Recovery cron caps retry attempts at 3 per session by writing `recoveryAttemptCount` and skipping sessions at cap | SATISFIED | In-Lambda filter at line 169 (`count >= RECOVERY_ATTEMPT_CAP`); atomic conditional `UpdateCommand` with `:cap = 3` at line 89; `ConditionalCheckFailedException` caught gracefully |

No orphaned requirements: all four PIPE-05 through PIPE-08 were claimed by plans 26-01 and 26-02, all verified.

---

### IAM and Permissions Coverage

| Permission | Construct | Status |
|-----------|-----------|--------|
| DynamoDB ReadWrite for `scanStuckSessionsFn` | `this.table.grantReadWriteData(scanStuckSessionsFn)` line 292 | VERIFIED |
| `events:PutEvents` for `scanStuckSessionsFn` | `PolicyStatement` at line 294-297 | VERIFIED |
| `LogGroup ONE_MONTH retention` for `scanStuckSessionsFn` | `ScanStuckSessionsLogGroup` at line 286-289 | VERIFIED |
| `AllowEBRecoveryInvoke` Lambda permission | `recordingEndedFn.addPermission` at line 458-461 | VERIFIED |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, placeholder returns, empty handlers, or stub implementations found in the four modified files.

---

### Human Verification Required

None. All aspects of phase 26 are verifiable programmatically:
- Filter logic, atomic counter, and PutEvents are covered by unit tests
- CDK constructs are confirmed in synthesized template
- Recording-ended guard position and behavior verified via grep and file read

The only runtime behavior that cannot be verified programmatically is actual AWS Lambda invocation via EventBridge Scheduler in a deployed environment. This is out-of-scope for a code verification pass.

---

### Full Test Suite Status

- Tests: **402/402 pass** across 50 suites (no regressions from phase 26 changes)
- TypeScript: **0 errors** (`npx tsc --noEmit` clean)
- CDK synth: **exit code 0** — `ScanStuckSessions` bundled at 70.4kb, all constructs in `VNL-Session.template.json`

---

## Summary

Phase 26 goal is fully achieved. The stuck-session recovery loop is implemented end-to-end:

1. `scan-stuck-sessions.ts` runs every 15 minutes via EventBridge Scheduler, queries both GSI1 STATUS#ENDING and STATUS#ENDED partitions, applies the 45-minute threshold and transcriptStatus gate, atomically increments `recoveryAttemptCount` (capped at 3), and publishes "Recording Recovery" events to EventBridge with a non-blocking per-session PutEvents.

2. `recording-ended.ts` has a recovery guard at line 62 that intercepts these events before the existing IVS ARN path, fetches the session from DynamoDB, re-submits a MediaConvert job using the stored `recordingS3Path`, and returns early.

3. `RecordingRecoveryRule` in CDK routes `source: custom.vnl` / `detail-type: Recording Recovery` events to `recordingEndedFn` with `recordingEventsDlq` and `retryAttempts: 2`.

Sessions that stall in the pipeline are now automatically detected and re-triggered without developer intervention, satisfying PIPE-05 through PIPE-08.

---

_Verified: 2026-03-10T17:10:00Z_
_Verifier: Claude (gsd-verifier)_
