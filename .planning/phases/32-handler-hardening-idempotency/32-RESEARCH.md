# Phase 32: Handler Hardening & Idempotency — Research

**Researched:** 2026-03-11
**Domain:** Lambda error semantics, SQS retry semantics, idempotency patterns, AWS Transcribe job naming
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HARD-01 | `recording-ended.ts` throws on MediaConvert job submission failure | Remove `try/catch` wrapping MediaConvert submit; propagate error to SQS wrapper which reports batchItemFailure |
| HARD-02 | `transcode-completed.ts` throws on Transcribe job submission failure; idempotency key prevents duplicate Transcribe jobs on retry | Replace `Date.now()` epoch in job name with stable `${sessionId}-${mediaconvertJobId}` composite; throw on StartTranscriptionJobCommand failure |
| HARD-03 | `on-mediaconvert-complete.ts` throws on EventBridge PutEvents failure | Remove inner try/catch around PutEventsCommand call; let outer handler catch propagate |
| HARD-04 | `scan-stuck-sessions.ts` recovers sessions where `transcriptStatus='processing'` AND `updatedAt > 2h ago` | Add `transcriptStatusUpdatedAt` ISO timestamp written whenever transcriptStatus transitions; add 2h threshold filter alongside existing 45-min endedAt check |
| HARD-05 | `transcribe-completed.ts` job name parsing fall-back: log structured error with raw job name, skip without silently corrupting state | Replace silent `return` after parse failure with `logger.error` containing raw `jobName`; verify no DynamoDB writes occur on parse failure |
</phase_requirements>

---

## Summary

Phase 32 targets a single architectural defect introduced by Phase 31: the 5 pipeline handlers were wrapped in SQS event source mappings (batchSize=1, reportBatchItemFailures=true) but none of them actually throw on critical failures — they silently swallow errors, mark `batchItemFailures: []`, and let SQS delete the message. This means every critical pipeline failure is silently dropped with no retry.

The fix is surgical: identify the specific `try/catch` blocks that swallow critical errors and remove or restructure them so the SQS outer wrapper (`catch (err) → failures.push(record.messageId)`) can catch and report the failure. Non-critical side-effects (reaction summary, participant count, speaker segments) stay wrapped.

A second concern is the PIPE-06 trap: `scan-stuck-sessions.ts` was written to skip `transcriptStatus='processing'` sessions to prevent double-submission, but it has no time-bound — a session stuck in `'processing'` for 10 hours is permanently excluded. The fix adds a `transcriptStatusUpdatedAt` timestamp written whenever `transcriptStatus` transitions to `'processing'`, then adds a 2h stale-processing check to the eligibility filter.

**Primary recommendation:** One plan suffices. All 5 changes are in handler logic (no CDK infra changes). Prerequisite: Phase 31-02 (SQS handler wrapper refactor) MUST be executed before or as part of this phase's Wave 0.

---

## Pre-condition: Phase 31-02 Status

Phase 31-01 (CDK infra) is COMPLETE (commit d72517d). Phase 31-02 (handler SQS signature refactor) is NOT YET EXECUTED.

Evidence: `recording-ended.ts`, `transcode-completed.ts`, `transcribe-completed.ts` still export `handler(event: EventBridgeEvent...)`. The test files (`recording-ended.test.ts`, `transcribe-completed.test.ts`) were speculatively updated to use `SQSEvent`/`makeSqsEvent` wrappers and `batchItemFailures` assertions, but the handler source hasn't been changed yet. As a result, 4 test suites currently fail with TypeScript error `Property 'batchItemFailures' does not exist on type 'void'`.

**Phase 32 Wave 0 MUST include execution of 31-02's handler refactor before any hardening changes.**

---

## Standard Stack

### Core (no new dependencies — all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `aws-lambda` types | existing | `SQSEvent`, `SQSBatchResponse` typings | Already used by test files |
| `@aws-lambda-powertools/logger` | ^2.31.0 | Structured logging for parse failures (HARD-05) | Already installed, in use by all 5 handlers |
| `@aws-sdk/client-mediaconvert` | existing | MediaConvert job submission | Already imported in recording-ended.ts |
| `@aws-sdk/client-transcribe` | existing | Transcribe job submission | Already imported in transcode-completed.ts |
| `@aws-sdk/client-eventbridge` | existing | PutEvents call in on-mediaconvert-complete.ts | Already imported |
| `@aws-sdk/lib-dynamodb` | existing | `UpdateCommand` for `transcriptStatusUpdatedAt` write | Already used across all handlers |

No new npm packages required.

---

## Architecture Patterns

### Current SQS Wrapper Pattern (from Phase 31-02 plan)

All 5 handlers will have this outer structure after 31-02 executes:

```typescript
// Source: .planning/phases/31-sqs-pipeline-buffers/31-02-PLAN.md
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;
      await processEvent(ebEvent);
    } catch (err: any) {
      logger.error('Failed to process SQS record', {
        messageId: record.messageId,
        error: err.message,
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
```

For SQS retry to work, `processEvent` must throw. The current code catches everything and returns normally.

### Pattern 1: Remove Broad Error Suppression (HARD-01, HARD-02, HARD-03)

**What:** Replace the outer `try/catch` that swallows errors in `processEvent` with targeted catches only around non-critical operations.

**When to use:** Any operation that, if it fails, should trigger SQS retry (MediaConvert submission, Transcribe submission, EventBridge PutEvents).

**recording-ended.ts — Current (wrong):**
```typescript
// Lines 318-444 in recording-ended.ts
if (finalStatus === 'available') {
  try {
    // ... MediaConvert submission ...
  } catch (mediaConvertError: any) {
    logger.error('Failed to submit MediaConvert job (non-blocking):', { ... });
    // Do NOT throw — transcription is best-effort
  }
}
```

**recording-ended.ts — Fixed:**
```typescript
if (finalStatus === 'available') {
  // MediaConvert submission: throw on failure so SQS retries
  const result = await mediaConvertClient.send(createJobCommand);
  const jobId = result.Job?.Id;
  if (!jobId) {
    throw new Error('MediaConvert did not return a job ID');
  }
  // ... store jobId in DynamoDB ...
  logger.info('MediaConvert job submitted:', { jobId, sessionId });
}
```

The outer `try/catch` in `processEvent` that currently catches ALL errors (line 236, 465-468) must also throw rather than swallow. The outermost catch in `processEvent` currently logs and does not throw — it must be removed or re-thrown.

**transcode-completed.ts — Current (wrong):**
```typescript
} catch (error: any) {
  logger.error('Failed to submit Transcribe job:', { ... });
  // Non-blocking: update session status to failed
  try { await updateTranscriptStatus(tableName, sessionId, 'failed'); } catch { ... }
  // Implicitly returns undefined — no throw
}
```

**transcode-completed.ts — Fixed:**
```typescript
} catch (error: any) {
  logger.error('Failed to submit Transcribe job:', { ... });
  throw error; // Let SQS retry
}
```

**on-mediaconvert-complete.ts — Current (wrong):**
```typescript
try {
  await eventBridgeClient.send(new PutEventsCommand({ ... }));
} catch (error) {
  console.error('Failed to publish transcription event:', error);
  // Don't rethrow
}
```

**on-mediaconvert-complete.ts — Fixed:**
```typescript
await eventBridgeClient.send(new PutEventsCommand({ ... }));
// No catch — let outer handler catch propagate
```

Note: `on-mediaconvert-complete.ts` is NOT yet SQS-wrapped (it's not one of the 5 pipeline handlers in Phase 31). Its outer `try/catch` at line 23/100 still exists. HARD-03 requires removing the inner PutEvents catch and rethrowing from the outer catch, or simply removing the outer catch entirely.

### Pattern 2: Stable Idempotency Key for Transcribe Jobs (HARD-02)

**What:** Replace `Date.now()` epoch in Transcribe job name with a stable key derived from the MediaConvert job ID.

**Current (creates duplicates on retry):**
```typescript
// transcode-completed.ts line 83
const epochMs = Date.now();
const transcribeJobName = `vnl-${sessionId}-${epochMs}`;
```

**Fixed (idempotent — same inputs produce same job name):**
```typescript
// jobId comes from event.detail.jobId (the MediaConvert job ID)
const transcribeJobName = `vnl-${sessionId}-${jobId}`;
```

AWS Transcribe returns `ConflictException` if a job with the same name already exists. On SQS retry, this exception must be caught and treated as success (the job was already submitted), not as a failure that blocks the pipeline.

```typescript
try {
  await transcribeClient.send(startJobCommand);
} catch (error: any) {
  if (error.name === 'ConflictException') {
    // Job already exists from a previous attempt — idempotent success
    logger.info('Transcribe job already exists (idempotent retry):', { transcribeJobName, sessionId });
    await updateTranscriptStatus(tableName, sessionId, 'processing');
    return; // Not a failure
  }
  throw error; // Real failure — let SQS retry
}
```

**Job name length constraint:** AWS Transcribe job names must be 200 characters max and match `[0-9a-zA-Z._-]+`. The MediaConvert job ID format is typically `1234567890123-abcdef` (20 chars). `vnl-${sessionId}-${jobId}` stays well within 200 chars.

### Pattern 3: transcriptStatusUpdatedAt Timestamp (HARD-04)

**What:** Write a `transcriptStatusUpdatedAt` ISO timestamp alongside every `transcriptStatus` transition in `updateTranscriptStatus`.

**Where written:** `session-repository.ts → updateTranscriptStatus()` — add `transcriptStatusUpdatedAt = :now` to the UpdateExpression.

**Where read:** `scan-stuck-sessions.ts` eligibility filter — add stale-processing gate:

```typescript
// Current filter (excludes ALL processing sessions):
if (ts === 'processing' || ts === 'available' || ts === 'failed') {
  return false;
}

// Fixed filter (excludes only RECENT processing sessions):
if (ts === 'available' || ts === 'failed') {
  return false;
}
if (ts === 'processing') {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const statusUpdatedAt = item.transcriptStatusUpdatedAt as string | undefined;
  // Skip if status was updated within last 2h (job may still be running)
  if (!statusUpdatedAt || statusUpdatedAt >= twoHoursAgo) {
    return false;
  }
  // transcriptStatus='processing' AND updatedAt > 2h ago → eligible for recovery
}
```

The 2h threshold is appropriate: AWS Transcribe typically completes in minutes; a job stuck for 2h has failed silently (the Lambda threw before writing COMPLETE status, or Transcribe never sent the completion event).

### Pattern 4: Structured Parse Failure Logging (HARD-05)

**What:** Replace silent `return` in `transcribe-completed.ts` job name parse failure with structured `logger.error`.

**Current:**
```typescript
if (!jobNameMatch) {
  logger.warn('Cannot parse sessionId from job name:', { jobName });
  return;
}
```

**Fixed:**
```typescript
if (!jobNameMatch) {
  logger.error('Failed to parse sessionId from Transcribe job name', {
    rawJobName: jobName,
    expectedPattern: 'vnl-{sessionId}-{epochMs_or_mediaconvertJobId}',
  });
  return; // Still safe to return — no DynamoDB writes occur, no state corruption
}
```

Note: This is a `return` not a `throw`. A malformed job name means the event originated from an unrelated Transcribe job (not part of this pipeline). Throwing would put it on the DLQ for manual inspection; returning silently ignores it. Per the requirement: "logs structured error with raw job name and skips without silently corrupting session state." The `logger.error` is the fix; `return` is correct behavior.

### Anti-Patterns to Avoid

- **Removing ALL error handling:** Only critical path operations (job submission, PutEvents) should throw. Non-critical operations (reaction summary, participant count, speaker segment writes) must remain non-throwing — they should still catch and log.
- **Using `Date.now()` for idempotency keys:** Any retry-sensitive operation that calls an external API should use a deterministic composite key derived from upstream identifiers.
- **Calling `updateTranscriptStatus(failed)` before throwing:** In the fixed error path, do NOT update DynamoDB to `'failed'` before rethrowing. If the operation is being retried, setting `'failed'` permanently breaks the pipeline. Only set `'failed'` on terminal errors (MediaConvert ERROR status, Transcribe FAILED status) — not on transient submission failures.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotency store | Custom DynamoDB idempotency table | AWS Transcribe `ConflictException` catch | Transcribe enforces unique job names server-side — no separate store needed |
| Retry backoff | Custom exponential backoff logic | SQS visibility timeout (already configured at 6× Lambda timeout) | SQS handles retry timing; Lambda just needs to throw |
| Processing timeout detection | Custom CloudWatch alarm + Lambda | `transcriptStatusUpdatedAt` field + cron filter | Simpler: add one field, extend existing cron logic |

---

## Common Pitfalls

### Pitfall 1: Removing the updateTranscriptStatus('failed') call on throw
**What goes wrong:** If you throw from the Transcribe submission catch block AFTER calling `updateTranscriptStatus('failed')`, SQS retries the message but finds `transcriptStatus='failed'` and the pipeline is permanently broken even though the error was transient.
**Why it happens:** The existing code was designed for fire-and-forget (no retry), so marking failed was harmless. With SQS retries, it becomes destructive.
**How to avoid:** Only set `transcriptStatus='failed'` from the MediaConvert ERROR/CANCELED status handler path (terminal failures), not from the Transcribe submission error path (transient failures). On throw, leave `transcriptStatus='processing'` — HARD-04 will recover it if it stays stuck.
**Warning signs:** Test shows `updateTranscriptStatus` was called with `'failed'` before the handler throws.

### Pitfall 2: Transcribe ConflictException not caught as idempotent success
**What goes wrong:** On SQS retry after a Transcribe submission that timed out, AWS Transcribe returns `ConflictException` ("A transcription job with that name already exists"). If this propagates as an error, the message goes to DLQ even though the job IS running.
**Why it happens:** ConflictException is a real AWS error code; without special handling it looks like a failure.
**How to avoid:** In the Transcribe submission catch block, check `error.name === 'ConflictException'` and treat as success. Log it at INFO level (not WARN/ERROR).

### Pitfall 3: on-mediaconvert-complete.ts not part of Phase 31 SQS refactor
**What goes wrong:** `on-mediaconvert-complete.ts` is the upload flow handler (handles UPLOAD session MediaConvert completions, not the broadcast recording pipeline). Phase 31's SQS wrapping covers the 5 broadcast pipeline handlers. `on-mediaconvert-complete.ts` is still EventBridge-invoked directly.
**Why it matters for HARD-03:** The throw must work within the existing EventBridge direct invocation model. Removing the outer `try/catch` in `on-mediaconvert-complete.ts` will cause EventBridge to retry (with DLQ if configured). This is the correct behavior but the handler's test file (`on-mediaconvert-complete.test.ts`) has a test asserting "should not rethrow handler errors (non-blocking)" — that test MUST be updated to assert the opposite.
**How to avoid:** Update both the handler AND its test. The test change is: `await expect(handler(event)).resolves.toBeUndefined()` → `await expect(handler(event)).rejects.toThrow()` for the DynamoDB error scenario.

### Pitfall 4: transcriptStatusUpdatedAt not written on existing sessions
**What goes wrong:** Sessions that transition to `transcriptStatus='processing'` before this phase deploys will have no `transcriptStatusUpdatedAt` field. The filter `!statusUpdatedAt || statusUpdatedAt >= twoHoursAgo` handles this — `!statusUpdatedAt` evaluates to true, and we return false (skip). This is actually the correct conservative behavior: if we don't know when it entered 'processing', don't recover it.
**Why it happens:** Old sessions lack the new field.
**How to avoid:** The filter already handles the undefined case by skipping. Document this in comments.

### Pitfall 5: Phase 31-02 not executed — handlers still accept EventBridgeEvent
**What goes wrong:** HARD-01 through HARD-03 change `processEvent` (which doesn't exist yet — it's still the main `handler` in the current source). Without 31-02, there's no SQS wrapper to catch the thrown error; the Lambda would throw unhandled and trigger EventBridge retry, not SQS retry.
**How to avoid:** Phase 32 Wave 0 must execute the 31-02 handler refactor first, bringing all 4 failing test suites to green before any hardening changes.

---

## Code Examples

### recording-ended.ts — Critical path throw

The MediaConvert submission block (lines 318-444) currently has its own try/catch that swallows errors. The entire outer `processEvent` function also has a try/catch (lines 236-468) that logs and returns without throwing. Both must be restructured.

The outer try/catch structure in `processEvent`:

```typescript
// Source: recording-ended.ts (current structure simplified)
try {
  // 1. updateSessionStatus ENDING -> ENDED  (must stay — critical)
  // 2. update recording metadata            (can stay non-throwing)
  // 3. compute reaction summary             (must stay non-throwing)
  // 4. participant count                    (must stay non-throwing)
  // 5. submit MediaConvert job              (MUST THROW on failure)
  // 6. release pool resources               (must stay — critical)
} catch (error: any) {
  logger.error('Failed to clean up session:', { ... });
  // Don't throw — EventBridge will retry on error  ← THIS COMMENT IS NOW WRONG
}
```

After the fix: Remove the outer catch's swallowing behavior. Steps 2, 3, 4 keep their own inner try/catch. Steps 1, 5, 6 throw on failure.

### transcode-completed.ts — Idempotent job name construction

```typescript
// Source: transcode-completed.ts (fixed pattern)
const jobId: string = detail.jobId;  // already extracted from event.detail
const sessionId = userMetadata.sessionId;

// Idempotent: same MediaConvert jobId always produces the same Transcribe job name
const transcribeJobName = `vnl-${sessionId}-${jobId}`;

try {
  const result = await transcribeClient.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: transcribeJobName,
    // ...
  }));
  await updateTranscriptStatus(tableName, sessionId, 'processing');
} catch (error: any) {
  if (error.name === 'ConflictException') {
    logger.info('Transcribe job already exists — idempotent retry success', {
      transcribeJobName, sessionId,
    });
    // Already processing — do not mark as failed, do not throw
    return;
  }
  throw error; // Transient failure — let SQS retry
}
```

### updateTranscriptStatus — Add transcriptStatusUpdatedAt

```typescript
// Source: session-repository.ts (addition to updateTranscriptStatus)
updateParts.push('#transcriptStatusUpdatedAt = :now');
expressionAttributeNames['#transcriptStatusUpdatedAt'] = 'transcriptStatusUpdatedAt';
expressionAttributeValues[':now'] = new Date().toISOString();
```

### scan-stuck-sessions.ts — Processing stale check

```typescript
// Source: scan-stuck-sessions.ts (updated filter)
const PROCESSING_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

const staleProcessingCutoff = new Date(Date.now() - PROCESSING_STALE_THRESHOLD_MS).toISOString();

const eligibleSessions = allItems.filter((item) => {
  if (!item.endedAt || item.endedAt >= cutoff) return false;

  const ts = item.transcriptStatus;
  if (ts === 'available' || ts === 'failed') return false;

  if (ts === 'processing') {
    const statusUpdatedAt = item.transcriptStatusUpdatedAt as string | undefined;
    // No timestamp → unknown when it entered processing → skip (conservative)
    if (!statusUpdatedAt) return false;
    // Updated recently → job may still be running → skip
    if (statusUpdatedAt >= staleProcessingCutoff) return false;
    // Falls through: 'processing' AND updatedAt > 2h → eligible
  }

  const count: number = item.recoveryAttemptCount ?? 0;
  if (count >= RECOVERY_ATTEMPT_CAP) return false;

  return true;
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventBridge direct invocation (fire-and-forget) | SQS-buffered at-least-once delivery | Phase 31 (2026-03-11) | Enables true retries, but ONLY if handlers throw on critical failures |
| `Date.now()` epoch in Transcribe job names | Stable `sessionId + mediaconvertJobId` composite | Phase 32 (this phase) | Prevents duplicate Transcribe jobs on SQS retry |
| Skip ALL `transcriptStatus='processing'` sessions | Skip only RECENT `'processing'` sessions (< 2h) | Phase 32 (this phase) | Fixes permanent exclusion trap for stale-processing sessions |

---

## Open Questions

1. **Should `recording-ended.ts` throw before or after pool resource release?**
   - What we know: The handler does pool release AFTER MediaConvert submission (lines 447-461). If MediaConvert throws and we rethrow, pool release is skipped and pool resources leak.
   - What's unclear: Is resource release blocking (must succeed before retry) or non-blocking?
   - Recommendation: Move pool resource release BEFORE the MediaConvert submission, or put pool release in a `finally` block so it always runs even when MediaConvert throws. This way SQS can retry MediaConvert submission without leaking pool resources.

2. **Does `on-mediaconvert-complete.ts` need SQS wrapping before HARD-03?**
   - What we know: It's EventBridge-invoked directly (not through the Phase 31 SQS queues). HARD-03 says it must throw on PutEvents failure.
   - What's unclear: Will EventBridge retry a Lambda that throws, or will it go to DLQ?
   - Recommendation: EventBridge does retry with DLQ support (recordingEventsDlq exists but only covers recordingStartRule now). For this handler, the outer catch removal is sufficient — EventBridge will retry automatically. Check `on-mediaconvert-complete.ts` CDK wiring to confirm DLQ or retry policy.

3. **What is `mediaconvertJobId` format for Transcribe job name length?**
   - What we know: MediaConvert job IDs appear to be `<epoch13digits>-<6hex>` format (~20 chars). `vnl-${sessionId}` adds ~40 chars. Total ~60 chars, well under 200.
   - Recommendation: HIGH confidence this is safe. Add a length assertion in tests.

---

## Handler-by-Handler Summary

### recording-ended.ts (HARD-01)

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Line 436-444: MediaConvert catch | Logs error, does NOT throw (`// Do NOT throw`) | Remove catch block; let throw propagate to outer |
| Line 465-469: Outer catch | Logs error, does NOT throw (`// Don't throw`) | Change to `throw error` |
| Non-critical: reaction summary catch | Swallows, logs | Keep as-is (non-blocking) |
| Non-critical: participant count catch | Swallows, logs | Keep as-is (non-blocking) |
| Recovery path (lines 76-172) | Swallows all errors | Recovery path can stay non-throwing (it's a best-effort cron-driven path, not the primary SQS path) |

### transcode-completed.ts (HARD-02)

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Line 83: job name | `vnl-${sessionId}-${epochMs}` | Change to `vnl-${sessionId}-${jobId}` |
| Line 112-121: Transcribe submission catch | Logs, calls updateTranscriptStatus('failed'), does NOT throw | Remove `updateTranscriptStatus('failed')` call; add ConflictException handling; throw for non-conflict errors |

### on-mediaconvert-complete.ts (HARD-03)

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Lines 67-89: PutEvents inner try/catch | Catches, logs, does NOT rethrow (`// Don't rethrow`) | Remove inner catch; let PutEvents throw propagate to outer catch |
| Lines 23/100: Outer catch | Catches all, logs, does NOT rethrow | Change to `throw error` |

### scan-stuck-sessions.ts (HARD-04)

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Line 165: filter condition | `ts === 'processing'` → skip unconditionally | Add `transcriptStatusUpdatedAt` stale check (2h threshold) |
| session-repository.ts: updateTranscriptStatus | Does NOT write timestamp | Add `transcriptStatusUpdatedAt` to UpdateExpression |

### transcribe-completed.ts (HARD-05)

| Location | Current Behavior | Required Change |
|----------|-----------------|-----------------|
| Lines 130-134: parse failure | `logger.warn('Cannot parse sessionId')` + silent return | Change to `logger.error` with `rawJobName` field |

---

## Test File Changes Required

| File | Current Tests | New Tests Needed |
|------|--------------|-----------------|
| `recording-ended.test.ts` | Tests return `batchItemFailures: []` for all scenarios including MediaConvert errors | Add: MediaConvert submission failure → `batchItemFailures: ['test-message-id']` |
| `transcode-completed.test.ts` | Does not exist yet (created by 31-02) | After 31-02 creates it: add idempotency test (ConflictException → success), add Transcribe submission failure → batchItemFailures |
| `on-mediaconvert-complete.test.ts` | Has test asserting "should not rethrow handler errors" (`resolves.toBeUndefined()`) | Change to: PutEvents failure → throws; DynamoDB error → throws. Multiple existing tests need updating. |
| `scan-stuck-sessions.test.ts` | Has test "should skip sessions with transcriptStatus = processing" (unconditional skip) | Update: `transcriptStatus='processing'` with recent `transcriptStatusUpdatedAt` → skip; with stale `transcriptStatusUpdatedAt` (>2h) → recover |
| `transcribe-completed.test.ts` | Has test "handles invalid job name format gracefully" asserting `batchItemFailures: []` | Add: verify `logger.error` called with `rawJobName` field |

---

## Sources

### Primary (HIGH confidence)
- Codebase direct read: `backend/src/handlers/recording-ended.ts` — identified exact try/catch locations
- Codebase direct read: `backend/src/handlers/transcode-completed.ts` — confirmed `Date.now()` job naming
- Codebase direct read: `backend/src/handlers/on-mediaconvert-complete.ts` — confirmed swallowed PutEvents error
- Codebase direct read: `backend/src/handlers/scan-stuck-sessions.ts` — confirmed unconditional `'processing'` skip
- Codebase direct read: `backend/src/handlers/transcribe-completed.ts` — confirmed silent warn on parse failure
- Codebase direct read: `backend/src/repositories/session-repository.ts` — confirmed no `updatedAt` written
- Codebase direct read: `.planning/phases/31-sqs-pipeline-buffers/31-01-SUMMARY.md` — confirmed SQS wrapper pattern
- Codebase direct read: `.planning/phases/31-sqs-pipeline-buffers/31-02-PLAN.md` — confirmed 31-02 not yet executed
- Codebase direct read: `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` — identified test asserting non-throw behavior that must be updated
- npm test run — confirmed 4 test suites currently failing due to 31-02 pending

### Secondary (MEDIUM confidence)
- AWS Transcribe naming rules: job names must match `[0-9a-zA-Z._-]+`, max 200 chars (knowledge consistent with AWS documentation pattern)
- AWS Transcribe ConflictException: returned when job name already exists (standard AWS SDK behavior)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all changes are code logic
- Architecture patterns: HIGH — based on direct source read of all 5 handlers
- Pitfalls: HIGH — discovered from reading actual code + test failures

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain — no fast-moving dependencies)
