---
phase: 32-handler-hardening-idempotency
verified: 2026-03-11T23:45:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 32: Handler Hardening & Idempotency Verification Report

**Phase Goal:** Remove broad error suppression in pipeline handlers, add idempotency keys for job submission, fix PIPE-06 processing trap for stuck sessions. Handlers must throw on critical failures so SQS retry semantics work correctly.
**Verified:** 2026-03-11T23:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | recording-ended.ts throws on MediaConvert submission failure | VERIFIED | No inner try/catch wrapping `mediaConvertClient.send()` — line 408. Outer catch at line 460 ends with `throw error`. |
| 2 | transcode-completed.ts throws on Transcribe submission failure; idempotency key prevents duplicate Transcribe jobs | VERIFIED | Job name is `vnl-${sessionId}-${jobId}` (line 83). ConflictException caught as success (line 113). Non-conflict errors throw (line 129). No `updateTranscriptStatus('failed')` in throw path. |
| 3 | on-mediaconvert-complete.ts throws on EventBridge PutEvents failure | VERIFIED | No inner try/catch around `eventBridgeClient.send()` (lines 67-81). Outer catch rethrows at line 95: `throw error; // Propagate to EventBridge for retry`. |
| 4 | scan-stuck-sessions.ts recovers sessions where transcriptStatus='processing' and updatedAt >2h ago | VERIFIED | `PROCESSING_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000` at line 25. Three-branch filter at lines 172-178. `transcriptStatusUpdatedAt` written in `updateTranscriptStatus` (session-repository.ts line 500). |
| 5 | transcribe-completed.ts logs structured error with raw job name when parsing fails | VERIFIED | `logger.error('Failed to parse sessionId from Transcribe job name', { rawJobName: jobName, ... })` at lines 136-140. Regex `\d{10,}(?:-[a-f0-9]+)?` anchors correctly. |
| 6 | All backend tests pass (updated to cover new throw behavior) | VERIFIED | 462/462 tests pass across 56 suites. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/handlers/recording-ended.ts` | Throws on MediaConvert failure; pool release in finally | VERIFIED | try/finally at lines 320-456; outer catch rethrows line 463 |
| `backend/src/handlers/__tests__/recording-ended.test.ts` | Tests for MediaConvert failure → batchItemFailures | VERIFIED | Lines 590-676: two new tests covering failure path and pool release under failure |
| `backend/src/handlers/transcode-completed.ts` | Stable job name; ConflictException idempotent; throws on transient errors | VERIFIED | `vnl-${sessionId}-${jobId}` line 83; ConflictException block lines 113-122; `throw error` line 129 |
| `backend/src/handlers/transcribe-completed.ts` | Updated regex; logger.error with rawJobName on parse failure | VERIFIED | Regex `/^vnl-([a-z0-9-]+)-(\d{10,}(?:-[a-f0-9]+)?)$/` line 134; `logger.error` with `rawJobName` line 136-139 |
| `backend/src/handlers/__tests__/transcode-completed.test.ts` | ConflictException → success; non-ConflictException → batchItemFailure | VERIFIED | Lines 263-339: both test cases present; `not.toHaveBeenCalledWith(..., 'failed')` assertion at line 334 |
| `backend/src/handlers/__tests__/transcribe-completed.test.ts` | Invalid job name → early return; test comment updated | VERIFIED | Line 371 confirms early return after logger.error with rawJobName |
| `backend/src/handlers/on-mediaconvert-complete.ts` | No inner PutEvents catch; outer catch rethrows | VERIFIED | PutEventsCommand unguarded lines 67-81; `throw error` line 95 |
| `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` | DynamoDB and EventBridge failures assert rejects.toThrow | VERIFIED | Lines 430, 650: `rejects.toThrow('DynamoDB error')` and `rejects.toThrow('EventBridge publish failed')` |
| `backend/src/repositories/session-repository.ts` | updateTranscriptStatus writes transcriptStatusUpdatedAt | VERIFIED | Lines 500-502: push to updateParts, expressionAttributeNames, expressionAttributeValues |
| `backend/src/handlers/scan-stuck-sessions.ts` | PROCESSING_STALE_THRESHOLD_MS + staleProcessingCutoff filter | VERIFIED | Constant at line 25; cutoff computed line 159; three-branch filter lines 172-178 |
| `backend/src/handlers/__tests__/scan-stuck-sessions.test.ts` | Three processing-status test cases | VERIFIED | Lines 107, 119, 133: no-timestamp skip; recent-skip; stale-recover |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| recording-ended.ts MediaConvert block | SQS outer handler catch | `throw error` at outer catch line 463 | WIRED | try/finally (lines 320-456) propagates MediaConvert throws to outer catch |
| recording-ended.ts pool release | finally block | `finally { releasePoolResource... }` at line 440 | WIRED | Pool release always executes regardless of MediaConvert outcome |
| transcode-completed.ts job name | `StartTranscriptionJobCommand` | `vnl-${sessionId}-${jobId}` line 83 | WIRED | `jobId` extracted from `detail.jobId` line 39 |
| transcode-completed.ts ConflictException catch | idempotent return | `error.name === 'ConflictException'` block lines 113-122 | WIRED | Returns early without throw; calls `updateTranscriptStatus('processing')` |
| transcode-completed.ts transient error | throw propagation | `throw error` line 129 | WIRED | No `updateTranscriptStatus('failed')` before throw |
| transcribe-completed.ts parse failure | `logger.error` with `rawJobName` | Field `rawJobName: jobName` lines 136-139 | WIRED | Returns after logging, no state corruption |
| on-mediaconvert-complete.ts PutEventsCommand | outer catch | No inner try/catch around send (lines 67-81) | WIRED | Any rejection propagates to outer catch at line 93 |
| on-mediaconvert-complete.ts outer catch | EventBridge retry | `throw error` line 95 | WIRED | Confirmed by test: `rejects.toThrow('EventBridge publish failed')` line 650 |
| session-repository.ts updateTranscriptStatus | DynamoDB UpdateExpression | `transcriptStatusUpdatedAt = :now` lines 500-502 | WIRED | Applied unconditionally before s3Path/plainText optionals |
| scan-stuck-sessions.ts eligibility filter | stale-processing recovery | `statusUpdatedAt < staleProcessingCutoff` line 177 | WIRED | Three-branch logic; falls through only when timestamp present AND > 2h old |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HARD-01 | 32-01-PLAN.md | recording-ended.ts throws on MediaConvert failure | SATISFIED | `throw error` at outer catch line 463; try/finally guarantees pool release |
| HARD-02 | 32-02-PLAN.md | transcode-completed.ts throws on Transcribe failure; idempotency prevents duplicate jobs | SATISFIED | Stable job name `vnl-${sessionId}-${jobId}`; ConflictException treated as success; `throw error` on transient failures without setting 'failed' |
| HARD-03 | 32-03-PLAN.md | on-mediaconvert-complete.ts throws on PutEvents failure | SATISFIED | Inner try/catch removed; outer catch rethrows line 95 |
| HARD-04 | 32-04-PLAN.md | scan-stuck-sessions.ts recovers stale-processing sessions | SATISFIED | `PROCESSING_STALE_THRESHOLD_MS` + `transcriptStatusUpdatedAt` written on every status transition |
| HARD-05 | 32-02-PLAN.md | transcribe-completed.ts logs structured error with raw job name | SATISFIED | `logger.error` with `rawJobName` field; regex updated to accept new job ID format |

No orphaned requirements found — all five HARD-* IDs are claimed by plans and verified in the codebase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `recording-ended.ts` | 325-326 | `epochMs` still used in `jobName` variable | Info | This is for the MediaConvert job name (not the Transcribe job name). The plan explicitly preserved this: "Do NOT remove epoch from the MediaConvert jobName variable." Correct — this is distinct from the Transcribe idempotency key in transcode-completed.ts. |

No blocker or warning anti-patterns found.

### Human Verification Required

None required. All goal criteria are verifiable programmatically and have been confirmed against the codebase.

### Gaps Summary

No gaps. All six success criteria from ROADMAP.md are fully implemented and verified:

1. `recording-ended.ts` — MediaConvert submission is unwrapped; pool resources in finally block; outer catch rethrows. Test verifies batchItemFailures and pool release under failure.

2. `transcode-completed.ts` — Stable `vnl-${sessionId}-${jobId}` composite key; ConflictException caught and treated as idempotent success with status set to 'processing'; transient errors throw without poisoning transcriptStatus to 'failed'. Two new tests cover both cases.

3. `on-mediaconvert-complete.ts` — Inner PutEvents try/catch removed; outer catch at line 95 rethrows unconditionally. Tests assert `rejects.toThrow` on both DynamoDB and EventBridge failures.

4. `scan-stuck-sessions.ts` — `PROCESSING_STALE_THRESHOLD_MS = 2h`; filter allows recovery only when `transcriptStatusUpdatedAt` is present AND older than 2h. `updateTranscriptStatus` in session-repository writes the timestamp on every call. Three tests cover no-timestamp, recent, and stale cases.

5. `transcribe-completed.ts` — Regex `\d{10,}(?:-[a-f0-9]+)?` anchors on epoch prefix to correctly parse UUID session IDs; parse failure logs at ERROR level with `rawJobName` field.

6. All 462 backend tests pass across 56 suites.

---

_Verified: 2026-03-11T23:45:00Z_
_Verifier: Claude (gsd-verifier)_
