# Phase 25: Pipeline Observability - Research

**Researched:** 2026-03-10
**Domain:** AWS Lambda structured logging with Lambda Powertools Logger + CDK log group retention
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-01 | Every Lambda handler in the recording pipeline emits a structured JSON log entry at start and completion with sessionId, stage, status, and durationMs | Logger initialized at module scope with `persistentKeys: { pipelineStage }` + `appendPersistentKeys({ sessionId })` inside handler; `Date.now()` delta for durationMs |
| PIPE-02 | Pipeline log entries use a consistent correlation structure so all events for one session can be retrieved with a single CloudWatch Logs Insights query | All handlers share `serviceName: 'vnl-pipeline'`; sessionId written as persistent key; single Logs Insights query filters on `sessionId` across all log groups |
| PIPE-03 | Lambda Powertools Logger is initialized with persistent `pipelineStage` key per handler so logs are filterable without post-processing | `new Logger({ persistentKeys: { pipelineStage: 'handler-name' } })` at module scope; key appears on every log line automatically |
| PIPE-04 | All pipeline Lambda CDK definitions specify log group retention (30 days) to prevent unbounded CloudWatch log accumulation | `logGroup: new logs.LogGroup(this, '...LogGroup', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY })` — follows existing `IvsEventAuditLogGroup` pattern in session-stack.ts |
</phase_requirements>

---

## Summary

Phase 25 adds structured, correlated logging to the five Lambda handlers that form the recording-to-transcript pipeline: `recording-ended.ts`, `transcode-completed.ts`, `start-transcribe.ts`, `transcribe-completed.ts`, and `store-summary.ts`. The work is purely additive — no behavior changes, no new API routes, no new DynamoDB schemas.

`@aws-lambda-powertools/logger` at `^2.31.0` is **already installed** in `backend/package.json`. The package provides automatic JSON structuring, cold-start detection, X-Ray trace ID injection, and the `appendPersistentKeys` API needed to attach `sessionId` per invocation without modifying every log call. No new npm packages are needed anywhere in the project.

The CDK changes follow a pattern that already exists in the codebase: `ivsEventAuditFn` in `session-stack.ts` (line 794–803) already declares an explicit `logGroup` with `logs.RetentionDays.ONE_WEEK`. Phase 25 applies the same pattern to the five pipeline Lambdas, using `RetentionDays.ONE_MONTH` (30 days) as required by PIPE-04.

**Primary recommendation:** Initialize Logger at module scope with `persistentKeys: { pipelineStage: '<handler-name>' }`, call `logger.appendPersistentKeys({ sessionId })` at the top of each handler invocation, and emit `logger.info(...)` at entry and completion with `durationMs`. Add explicit `logGroup` to the five CDK Lambda definitions following the `IvsEventAuditLogGroup` pattern.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-lambda-powertools/logger` | `^2.31.0` (already installed) | Structured JSON logging with persistent keys, cold-start flag, X-Ray trace ID | Already in `backend/package.json`; zero marginal install cost; official AWS Powertools TypeScript library |
| `aws-cdk-lib/aws-logs` | (bundled with CDK) | `logs.LogGroup`, `logs.RetentionDays` | Already imported at top of `session-stack.ts` (line 12) |

### No New Packages

All required libraries are already present. `@aws-lambda-powertools/tracer` is also installed at `^2.31.0` but is out of scope for this phase — plain structured logging with Logger is sufficient.

---

## Architecture Patterns

### Recommended Handler Structure

Every pipeline handler gets this pattern applied:

```typescript
// Source: official Powertools Logger docs + existing project conventions
import { Logger } from '@aws-lambda-powertools/logger';

// Module scope — persists across warm invocations
const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: {
    pipelineStage: 'recording-ended', // unique per file
  },
});

export const handler = async (event: EventBridgeEvent<...>): Promise<void> => {
  const sessionId = /* extracted from event */;
  const startMs = Date.now();

  // Attach sessionId for the lifetime of this invocation
  logger.appendPersistentKeys({ sessionId });

  logger.info('Pipeline stage entered', {
    source: event.source,
    detailType: event['detail-type'],
  });

  try {
    // ... existing handler logic unchanged ...

    logger.info('Pipeline stage completed', {
      status: 'success',
      durationMs: Date.now() - startMs,
    });
  } catch (error: any) {
    logger.error('Pipeline stage failed', {
      status: 'error',
      durationMs: Date.now() - startMs,
      errorMessage: error.message,
      errorCode: error.Code,
    });
    // preserve existing throw/non-throw behavior
  }
};
```

### Pattern: CDK Log Group with Retention

Follow the **exact** existing pattern from `session-stack.ts` lines 794–803 (`ivsEventAuditFn`):

```typescript
// Source: infra/lib/stacks/session-stack.ts lines 794-803 (existing IvsEventAudit pattern)
const recordingEndedFn = new nodejs.NodejsFunction(this, 'RecordingEnded', {
  // ... existing options unchanged ...
  logGroup: new logs.LogGroup(this, 'RecordingEndedLogGroup', {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  }),
});
```

Apply to these five CDK constructs (CDK logical ID → handler file):

| CDK Logical ID | Handler File | CDK LogGroup Logical ID |
|---------------|--------------|------------------------|
| `RecordingEnded` | `recording-ended.ts` | `RecordingEndedLogGroup` |
| `TranscodeCompleted` | `transcode-completed.ts` | `TranscodeCompletedLogGroup` |
| `StartTranscribe` | `start-transcribe.ts` | `StartTranscribeLogGroup` |
| `TranscribeCompleted` | `transcribe-completed.ts` | `TranscribeCompletedLogGroup` |
| `StoreSummary` | `store-summary.ts` | `StoreSummaryLogGroup` |

**Note:** `RecordingEnded` and `TranscodeCompleted` are defined in `session-stack.ts` as inline `new nodejs.NodejsFunction(this, 'RecordingEnded', {...})` blocks — the `logGroup` property is added directly there. `StartTranscribe` (CDK name `StartTranscribe`, line 739) has no `depsLockFilePath` set — this is an existing inconsistency; do not change it.

### CloudWatch Logs Insights Query (PIPE-02)

Single query to reconstruct the full pipeline timeline for one session:

```
fields @timestamp, pipelineStage, message, status, durationMs, errorMessage
| filter sessionId = "SESSION-ID-HERE"
| sort @timestamp asc
```

Query across all pipeline stages for error audit:

```
fields @timestamp, pipelineStage, message, errorMessage
| filter status = "error"
| stats count() by pipelineStage
| sort count desc
```

Both queries work across all five log groups if a CloudWatch Logs Insights query is run against the log group set — or individually per handler log group.

### Per-Handler pipelineStage Values

| Handler File | `pipelineStage` value |
|---|---|
| `recording-ended.ts` | `'recording-ended'` |
| `transcode-completed.ts` | `'transcode-completed'` |
| `start-transcribe.ts` | `'start-transcribe'` |
| `transcribe-completed.ts` | `'transcribe-completed'` |
| `store-summary.ts` | `'store-summary'` |

### Extracting sessionId Per Handler

Each handler receives events from different sources. The sessionId extraction differs per handler:

| Handler | SessionId Source |
|---------|----------------|
| `recording-ended.ts` | Already resolved as `session.sessionId` after DynamoDB lookup (line 106) |
| `transcode-completed.ts` | `event.detail.userMetadata?.sessionId` from MediaConvert job metadata |
| `start-transcribe.ts` | `event.detail.sessionId` (line 25 — already destructured) |
| `transcribe-completed.ts` | Parsed from Transcribe job name (e.g., `vnl-${sessionId}-${epoch}`) or from `event.detail.TranscriptionJobName` |
| `store-summary.ts` | From the `custom.vnl` `Transcript Stored` event detail |

### Anti-Patterns to Avoid

- **Do not call `CloudWatchLogsClient.PutLogEvents` directly** — Lambda Powertools Logger writes to stdout; the Lambda runtime delivers logs to CloudWatch. Direct SDK calls require log group pre-creation, add 200ms latency, and require additional IAM permissions.
- **Do not initialize Logger inside the handler function** — module-scope initialization is required for warm invocation efficiency and cold-start flag accuracy.
- **Do not use `logger.resetKeys()` between invocations** — Lambda invocations are independent; `appendPersistentKeys` scopes correctly to one invocation when called at the handler entry point.
- **Do not rely on Lambda auto-created log groups for retention** — auto-created `/aws/lambda/FunctionName` groups have no retention policy (logs accumulate forever). Explicit CDK `logGroup` is the only reliable way to set retention before first invocation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON log with cold-start, trace ID | Custom `console.log(JSON.stringify(...))` wrapper | `@aws-lambda-powertools/logger` (already installed) | Powertools adds `cold_start`, `xray_trace_id`, log level filtering, `appendPersistentKeys` — none of which a wrapper gets for free |
| Log group retention | CloudFormation console manual config | CDK `logs.LogGroup` with `RetentionDays.ONE_MONTH` | CDK manages it declaratively; manual config drifts on re-deploy |
| Per-invocation correlation key | Pass sessionId to every log call | `logger.appendPersistentKeys({ sessionId })` once at handler entry | Key is injected into every subsequent log line automatically |

---

## Common Pitfalls

### Pitfall 1: Log Group Auto-Creation Race
**What goes wrong:** Lambda auto-creates `/aws/lambda/FunctionName` on first invocation. If the first invocation arrives within seconds of deploy (as happens with EventBridge rules that fire on live IVS events), the log group may not exist yet, causing the first log lines to be lost.
**How to avoid:** Explicit CDK `logGroup` property on the Lambda construct pre-creates the log group before any invocation.
**Warning signs:** CloudWatch shows Lambda invocation metrics but zero log events for a newly deployed function.

### Pitfall 2: appendPersistentKeys Accumulates Across Warm Invocations
**What goes wrong:** If `appendPersistentKeys({ sessionId })` is called but never cleared, a warm Lambda invocation for sessionId B will still have sessionId A's key in the persistent set.
**How to avoid:** Call `logger.appendPersistentKeys({ sessionId })` at the **start** of every handler invocation — it overwrites the previous value for the `sessionId` key. This is the correct Powertools pattern (overwrite, not accumulate).
**Warning signs:** CloudWatch logs show the wrong sessionId on log lines for a given session.

### Pitfall 3: durationMs Only Measures Lambda Compute, Not End-to-End
**What goes wrong:** `Date.now() - startMs` measures time within the Lambda invocation only. It does not capture queue time, EventBridge delivery latency, or downstream job wait time (MediaConvert, Transcribe). A developer reading `durationMs: 45` for `recording-ended` may assume the full MediaConvert submission took 45ms — it only measures the Lambda code path.
**How to avoid:** Log `durationMs` as "handler duration" not "pipeline stage duration." For end-to-end timing, compare `@timestamp` values across different stage log entries for the same sessionId in Logs Insights.

### Pitfall 4: start-transcribe.ts Has No depsLockFilePath
**What goes wrong:** The `StartTranscribe` CDK construct (session-stack.ts line 739) does not set `depsLockFilePath`, unlike all other pipeline Lambda constructs. Adding `logGroup` to this construct is safe, but do not add `depsLockFilePath` as part of this phase — that is a separate change with deploy implications.
**How to avoid:** Only add `logGroup` to `StartTranscribe`. Leave `depsLockFilePath` absent to match existing behavior.

---

## Code Examples

### Logger Initialization (module scope)
```typescript
// Source: Powertools Logger docs — https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: {
    pipelineStage: 'recording-ended',
  },
});
```

### Per-Invocation sessionId Binding
```typescript
// Inside handler, before any logger calls
logger.appendPersistentKeys({ sessionId });
```

### Timed Log Block
```typescript
const startMs = Date.now();
logger.info('Pipeline stage entered');
// ... work ...
logger.info('Pipeline stage completed', {
  status: 'success',
  durationMs: Date.now() - startMs,
});
```

### CDK Log Group (follows IvsEventAuditLogGroup pattern)
```typescript
// Source: infra/lib/stacks/session-stack.ts lines 799-803 (existing pattern)
logGroup: new logs.LogGroup(this, 'RecordingEndedLogGroup', {
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: RemovalPolicy.DESTROY,
}),
```

### Expected CloudWatch JSON Output
```json
{
  "level": "INFO",
  "message": "Pipeline stage completed",
  "service": "vnl-pipeline",
  "pipelineStage": "recording-ended",
  "sessionId": "abc-123",
  "status": "success",
  "durationMs": 312,
  "timestamp": "2026-03-10T14:22:01.000Z",
  "cold_start": false,
  "xray_trace_id": "1-abc-def"
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|---|---|---|
| `console.log('Recording End event received for resource:', resourceArn)` — unstructured | `logger.info('Pipeline stage entered', { sessionId, resourceArn })` — structured JSON | CloudWatch Logs Insights can now filter by sessionId; previously required full-text grep |
| No log group retention set on pipeline Lambdas | Explicit `logs.LogGroup` with `RetentionDays.ONE_MONTH` | Prevents unbounded log accumulation; existing handlers have no retention policy |
| `ivsEventAuditFn` uses `RetentionDays.ONE_WEEK` | Pipeline handlers use `RetentionDays.ONE_MONTH` | Pipeline logs retained longer for debugging session issues post-completion |

---

## Open Questions

1. **transcode-completed.ts sessionId extraction**
   - What we know: MediaConvert job tags include `sessionId` in `userMetadata` (set in `recording-ended.ts` line 271–272). The EventBridge event includes `detail.userMetadata`.
   - What's unclear: Exact field path in the EventBridge event for `transcode-completed.ts` — need to confirm it reads from `event.detail.userMetadata?.sessionId`.
   - Recommendation: Read `transcode-completed.ts` at plan time to confirm the extraction path before writing the plan task.

2. **transcribe-completed.ts sessionId extraction**
   - What we know: The Transcribe job name is `vnl-${sessionId}-${Date.now()}` (set in `start-transcribe.ts` line 43). The EventBridge event for Transcribe completion includes `TranscriptionJobName`.
   - What's unclear: Whether `transcribe-completed.ts` already parses sessionId from the job name.
   - Recommendation: Read `transcribe-completed.ts` and `store-summary.ts` at plan time to confirm sessionId extraction paths.

---

## Validation Architecture

Phase 25 is logging-only. All changes are additive wrappers around existing handler logic. No new behavior, no new DynamoDB writes, no new API routes. Existing backend test suite (360 tests) validates that handler behavior is unchanged after logging is added.

**Test strategy:** Ensure existing tests still pass after Logger is added to each handler. Logger initialization at module scope must not break Jest mocking. Powertools Logger writes to stdout; Jest captures stdout so no special mocking is needed.

**Quick run command:** `cd /Users/connorhoehn/Projects/videonowandlater/backend && npm test`

**Verification that logging is correct:** Requires a deployed test invocation and CloudWatch Logs Insights query — cannot be unit-tested. The plan should include a manual verification step after deploy.

---

## Sources

### Primary (HIGH confidence)
- `backend/package.json` (local read) — confirmed `@aws-lambda-powertools/logger@^2.31.0` already installed
- `infra/lib/stacks/session-stack.ts` (local read) — confirmed existing `IvsEventAuditLogGroup` pattern (lines 799–803), confirmed all five CDK Lambda construct names and their locations
- `backend/src/handlers/recording-ended.ts` (local read) — confirmed existing `console.log` calls to replace; confirmed sessionId extraction point (line 106)
- `backend/src/handlers/start-transcribe.ts` (local read) — confirmed `event.detail.sessionId` extraction (line 25)
- [AWS Lambda Powertools TypeScript Logger docs](https://docs.powertools.aws.dev/lambda/typescript/latest/core/logger/) — `persistentKeys`, `appendPersistentKeys`, module-scope initialization pattern

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` (local read) — Powertools usage pattern with `persistentKeys` and `appendPersistentKeys` verified
- `.planning/STATE.md` (local read) — confirmed architecture decision: use `@aws-lambda-powertools/logger` (not custom wrapper); module scope init; `appendPersistentKeys` per invocation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `@aws-lambda-powertools/logger` confirmed installed locally; CDK `logs` module already imported in session-stack.ts
- Architecture: HIGH — exact CDK pattern already exists in codebase (IvsEventAuditLogGroup); Logger API confirmed via prior STACK.md research
- Pitfalls: HIGH — based on direct codebase reading and prior v1.5 research

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (Powertools v2 API is stable; CDK logs API is stable)
