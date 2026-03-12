# Pitfalls Research

**Domain:** Event-driven SQS/Lambda pipeline hardening + React UI polish on existing AWS IVS platform
**Researched:** 2026-03-12
**Confidence:** HIGH (X-Ray and idempotency pitfalls verified against official Powertools docs; DLQ pitfalls from AWS official docs; Zod pitfalls from official changelog and community benchmarks; start-transcribe error-path pitfall confirmed by codebase inspection)

---

## Context: System-Specific Risk Profile

v1.7 adds instrumentation and validation ON TOP of a working pipeline. The five SQS-backed handlers (`recording-ended`, `transcode-completed`, `on-mediaconvert-complete`, `transcribe-completed`, `store-summary`) all follow the same batchSize:1 + batchItemFailures pattern established in v1.6. Pitfalls below are calibrated to what could go wrong when adding Powertools Tracer, Zod schema validation, Powertools idempotency, and DLQ re-drive tooling to this specific codebase — not generic AWS Lambda advice.

---

## Critical Pitfalls

### Pitfall 1: X-Ray Tracer Active Tracing Not Enabled in CDK — Silent Trace Dropping

**What goes wrong:**
All `tracer.captureAWSv3Client()` calls succeed at runtime (no exception thrown) but the X-Ray console has zero traces. Every instrumented AWS SDK call is silently dropped. There is no log message, no error, no warning. The developer believes tracing is working because the code runs clean.

**Why it happens:**
CDK's `NodejsFunction` does not enable X-Ray active tracing by default. Without `tracing: lambda.Tracing.ACTIVE` on each function in `session-stack.ts`, Lambda operates in PassThrough mode. Powertools Tracer auto-disables when `_X_AMZN_TRACE_ID` is absent from the Lambda execution context — the same behaviour that makes it safe to run locally. There is no runtime error.

**How to avoid:**
In `session-stack.ts`, add `tracing: lambda.Tracing.ACTIVE` to every `NodejsFunction` being instrumented. CDK automatically adds `xray:PutTraceSegments` and `xray:PutTelemetryRecords` to the function's execution role when this property is set — no separate IAM grant needed. After `cdk deploy`, verify in the Lambda console under "Configuration > Monitoring and operations tools" that X-Ray active tracing shows "Active."

**Warning signs:**
- X-Ray console shows zero traces 5+ minutes after handler invocations
- CloudWatch logs show normal handler execution but no X-Ray entries
- `POWERTOOLS_TRACE_ENABLED` env var not set, or explicitly set to `false`

**Phase to address:** X-Ray tracing phase

---

### Pitfall 2: AWS SDK Clients Constructed Inside `processEvent` — Tracer Cannot Capture Them

**What goes wrong:**
Four of the five pipeline handlers (`recording-ended`, `store-summary`, `transcribe-completed`, `on-mediaconvert-complete`) construct their AWS SDK clients (`MediaConvertClient`, `S3Client`, `BedrockRuntimeClient`, `EventBridgeClient`) inside the `processEvent()` function, not at module scope. `tracer.captureAWSv3Client()` must wrap the client at initialization — it cannot retroactively instrument a client that was created after the trace segment opened. The result is a trace map that shows the Lambda function node but no downstream AWS service nodes (no DynamoDB, no S3, no Bedrock, no MediaConvert).

**Why it happens:**
The current per-invocation client construction pattern predates Tracer. The `start-transcribe.ts` handler is the only one that already constructs its `TranscribeClient` at module scope. The other four handlers construct clients inside `processEvent` because that was idiomatic when they were written. When adding Tracer, developers add `tracer.captureAWSv3Client()` calls inside `processEvent` alongside the existing constructors — the wrapping call succeeds but the resulting instrumented client is discarded after the function returns.

**How to avoid:**
Move all AWS SDK client construction to module scope, the same level as the existing `Logger` instance. Apply `tracer.captureAWSv3Client()` at that scope:

```typescript
// Module scope — correct
const logger = new Logger({ serviceName: 'vnl-pipeline', ... });
const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const s3 = tracer.captureAWSv3Client(new S3Client({}));
const eventBridge = tracer.captureAWSv3Client(new EventBridgeClient({}));
```

The `MediaConvertClient` in `recording-ended.ts` requires `{ region: awsRegion }` from an env var. Since `AWS_REGION` is always set in Lambda, `new MediaConvertClient({ region: process.env.AWS_REGION! })` is safe at module scope.

**Warning signs:**
- X-Ray trace map shows Lambda node but no downstream service nodes
- `captureAWSv3Client` call inside `processEvent` returns an instrumented client but produces no subsegments in X-Ray

**Phase to address:** X-Ray tracing phase

---

### Pitfall 3: Applying `@tracer.captureLambdaHandler()` to the SQS Outer Handler Creates One Trace Per Batch

**What goes wrong:**
Using the `@tracer.captureLambdaHandler()` decorator on the exported `handler` function creates a single root segment for the entire SQS batch. With `batchSize:1`, this is harmless in practice, but if batchSize is ever increased or if the decorator is applied to a handler processing multiple records, all per-record spans appear as subsegments of a single trace — making it impossible to isolate a single failing message in the X-Ray console. The trace for "batch processed 3 records, 1 failed" looks like one unit of work rather than three separable operations.

**Why it happens:**
The decorator pattern is the idiomatic Powertools approach for non-SQS handlers. It is natural to copy it to the SQS handler. The problem is that SQS batches are parallel work units that benefit from per-message traces.

**How to avoid:**
Do not use `@tracer.captureLambdaHandler()` on the outer SQS handler. Instead, open a manual subsegment per record inside the processing loop:

```typescript
for (const record of event.Records) {
  const subsegment = tracer.getSegment()?.addNewSubsegment(`record-${record.messageId}`);
  try {
    await processEvent(JSON.parse(record.body));
    subsegment?.close();
  } catch (err) {
    subsegment?.addError(err as Error);
    subsegment?.close();
    failures.push({ itemIdentifier: record.messageId });
  }
}
```

Given `batchSize:1`, this is cosmetic for now, but establishes the correct pattern if batchSize is ever relaxed.

**Warning signs:**
- X-Ray trace map shows single Lambda invocation with all downstream calls bundled under one segment regardless of message count
- Per-message tracing cannot be filtered in X-Ray console by messageId

**Phase to address:** X-Ray tracing phase

---

### Pitfall 4: Powertools Idempotency Defaults to Full SQS Event as Key — DLQ Redrives Always Re-Execute

**What goes wrong:**
If `makeIdempotent` is applied without an `eventKeyJmesPath`, the idempotency hash is computed over the entire function argument — which, for the SQS outer handler, includes `receiptHandle`, `attributes.SentTimestamp`, and other SQS-generated fields that change on every delivery, including DLQ redrives. Every retry looks like a unique new event. Idempotency is bypassed entirely for retried or redriven messages.

Conversely, if `makeIdempotent` is applied at the outer `handler` level (wrapping the SQS batch event), and an `eventKeyJmesPath` of `Records[0].messageId` is used, the key is the SQS `messageId` — which is stable for retries of the same delivery but changes when a message is redriven from the DLQ (redriven messages get new `messageId` values).

**Why it happens:**
The interaction between SQS wrapper metadata and the underlying EventBridge event body is not intuitive. Developers reach for `messageId` as the idempotency key because it is guaranteed unique by SQS — but DLQ redrives invalidate that assumption.

**How to avoid:**
Apply idempotency at the `processEvent` level (not the outer `handler` level), keyed on a stable business identifier extracted from the EventBridge event detail:

```typescript
// In transcode-completed.ts
const config = new IdempotencyConfig({
  eventKeyJmesPath: 'detail.jobId',  // MediaConvert job ID — stable across redrives
});
const idempotentProcessEvent = makeIdempotent(processEvent, { persistenceStore, config });
```

For handlers keyed on sessionId:
```typescript
const config = new IdempotencyConfig({
  eventKeyJmesPath: 'detail.sessionId',
});
```

Note: `transcode-completed.ts` already has a manual `ConflictException` catch for Transcribe idempotency. Keep that catch alongside Powertools idempotency — it is the fallback if the idempotency record has been cleared.

**Warning signs:**
- Idempotency DynamoDB table has zero entries despite multiple pipeline runs (key is changing on every invocation)
- DLQ redrive causes duplicate Transcribe jobs, duplicate MediaConvert jobs, or duplicate Bedrock invocations
- `ConflictException` from Transcribe API fires on redrives despite idempotency utility being in place

**Phase to address:** Idempotency gap coverage phase

---

### Pitfall 5: Idempotency DynamoDB Table Missing TTL — Table Grows Without Bound

**What goes wrong:**
Powertools writes an `expiration` Unix timestamp on every idempotency record but does not delete expired records itself. DynamoDB only removes expired items if `timeToLiveAttribute` is configured on the table. Without TTL, every session that passes through the pipeline leaves a permanent idempotency record. At ~5 pipeline stages per session, the table accumulates 5N records for N sessions, growing indefinitely. Old records prevent forced reprocessing of sessions after the idempotency window should have expired.

**Why it happens:**
CDK table creation and DynamoDB TTL configuration are a two-step process. The CDK `Table` construct has a `timeToLiveAttribute` property but it is optional and not mentioned in the Powertools quickstart CDK snippet. The default Powertools `DynamoDBPersistenceLayer` uses the attribute name `expiration` — if the table TTL attribute is named anything else (e.g., `ttl`, `expires`), TTL deletion silently stops working.

**How to avoid:**
In CDK, when creating the idempotency table, the attribute name must exactly match Powertools' default:

```typescript
const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: 'expiration',  // Must match Powertools default exactly
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
});
```

Set `expiresAfterSeconds` in `DynamoDBPersistenceLayer` to 86400 (24 hours) — long enough to cover DLQ retry windows (3 retries × 5-minute visibility timeout = 15 minutes maximum) while allowing reprocessing the next day.

**Warning signs:**
- Idempotency table item count grows proportionally to session count with no apparent cleanup
- DynamoDB "Time to live" column in the table console shows no TTL attribute configured
- Old sessions from weeks ago still appear in the idempotency table

**Phase to address:** Idempotency gap coverage phase

---

### Pitfall 6: Lambda Context Not Registered — INPROGRESS Records Block Retries After Timeout

**What goes wrong:**
If a Lambda times out while holding an idempotency record in `INPROGRESS` state and `config.registerLambdaContext(context)` was never called, Powertools cannot set `inProgressExpiryTimestamp`. The next retry finds the `INPROGRESS` record, determines it should still be in-progress (no expiry timestamp to check against), and blocks execution entirely — stalling the pipeline until DynamoDB TTL cleans up the record, which takes up to 48 hours after the `expiration` time. The session is stuck with `transcriptStatus = 'processing'` with no recovery path other than manual DynamoDB intervention.

**Why it happens:**
The existing handler signature is `async (event: SQSEvent): Promise<SQSBatchResponse>` — the Lambda `context` argument is present but not currently used by any handler. When applying `makeIdempotent`, developers copy the config setup from documentation but omit the `registerLambdaContext` call because nothing in the existing code uses `context`.

**How to avoid:**
Update every handler signature to capture `context`, and call `config.registerLambdaContext(context)` at the start of the processing function (not inside the try/catch). The existing handlers all have `(event: SQSEvent)` — add `, context: Context` from `aws-lambda`.

**Warning signs:**
- Pipeline stalls after a Lambda timeout with no downstream processing and no error logs
- Idempotency table has records stuck in `INPROGRESS` status for more than the Lambda timeout duration
- CloudWatch DLQ depth alarm fires but re-drive produces no handler invocation logs

**Phase to address:** Idempotency gap coverage phase

---

### Pitfall 7: Zod Validation Failures Retry via SQS and Land in DLQ — Wasting 3 Retries on Permanent Failures

**What goes wrong:**
Zod's `parse()` throws a `ZodError` on validation failure. If the catch block in the SQS outer handler treats `ZodError` identically to transient errors (pushes to `failures` array), SQS retries the malformed message 3 times before routing it to the DLQ. This wastes Lambda invocations and DLQ capacity on events that will never succeed regardless of retry count. The DLQ then fills with structurally invalid messages, obscuring genuinely retryable failures.

**Why it happens:**
All five pipeline handlers use a uniform catch pattern that pushes any exception to `failures` for SQS retry. There is no current distinction between permanent failures (bad schema) and transient failures (downstream unavailable). Adding Zod without updating the catch pattern propagates the wrong semantics.

**How to avoid:**
Use `safeParse()` at the handler boundary. On a `ZodError`, acknowledge the message (do NOT push to `failures`) and log the structured error with the raw message body:

```typescript
const parseResult = RecordingEndedEventSchema.safeParse(ebEvent);
if (!parseResult.success) {
  logger.error('Schema validation failed — poisoned event acknowledged without retry', {
    messageId: record.messageId,
    issues: parseResult.error.issues,
    // log body only at DEBUG level to avoid CloudWatch Logs exposure of full payload
  });
  // No push to failures — SQS will ACK and delete the message
  continue;
}
```

Alert on this path via a CloudWatch metric filter on `"poisoned event acknowledged"` log string, not via DLQ depth.

**Warning signs:**
- DLQ fills with messages that all share the same malformed structure (same missing field across many messages)
- CloudWatch shows 3 Lambda invocations per `messageId` before DLQ routing for schema errors
- Same `messageId` appears 3 times in CloudWatch logs before disappearing from the source queue

**Phase to address:** Schema validation phase

---

### Pitfall 8: start-transcribe Handler Swallows Transient Errors — Messages Silently Lost

**What goes wrong:**
The current `start-transcribe.ts` `processEvent` function catches all errors internally and logs them but does not re-throw. The outer SQS handler loop therefore never receives an exception, never adds the `messageId` to `failures`, and SQS acknowledges and deletes the message as successfully processed. A transient `ThrottlingException` from the Transcribe API — which would be completely recoverable with a retry — permanently loses the message. The session is stuck at `transcriptStatus = 'processing'` with no recovery path other than `scan-stuck-sessions`.

This is confirmed by inspecting the handler (line 87-90 in `start-transcribe.ts`):

```typescript
} catch (error) {
  // Log error but don't throw - non-blocking pattern
  logger.error('Pipeline stage failed', { ... });
}
```

**Why it happens:**
`start-transcribe` was originally a fire-and-forget EventBridge direct-trigger target. The "non-blocking" comment reflects that design. It was wrapped in an SQS handler in v1.6 without updating the error-handling semantics — the same v1.6 hardening that was applied to `recording-ended`, `transcode-completed`, and `on-mediaconvert-complete` was not applied to `start-transcribe`.

**How to avoid:**
In the schema validation phase (natural time to audit all handler error paths), update `start-transcribe.ts` to re-throw on transient Transcribe API errors. Permanent failures (missing `sessionId`, missing `recordingHlsUrl`) should remain non-throwing (acknowledge and log). This matches the error-handling pattern in all other four handlers.

**Warning signs:**
- Sessions stuck at `transcriptStatus = 'processing'` with no `start-transcribe` error logs after Transcribe API throttling
- CloudWatch `start-transcribe` invocation count matches SQS message count, DLQ is empty, but sessions never complete transcription
- `scan-stuck-sessions` continuously recovers the same session (because the root cause — swallowed Transcribe error — is not fixed)

**Phase to address:** Schema validation phase (error-path audit pass)

---

### Pitfall 9: DLQ Re-drive Idempotency Window Conflict — Forced Reprocessing Does Nothing

**What goes wrong:**
A message is redriven from the DLQ for intentional forced reprocessing (e.g., after a bug fix deployment). If the original processing completed successfully and the idempotency record is still within its `expiresAfterSeconds` window, Powertools returns the cached result and skips all business logic. The re-drive appears to succeed (no error) but no downstream work is done. The developer is left debugging why the pipeline did not re-execute.

**Why it happens:**
DLQ redrives after bug fixes are intentional re-executions, not retries of failures. The idempotency window is designed to prevent duplicate execution during failure recovery — not to block intentional forced reprocessing. The two use cases are in conflict and the resolution requires a manual step.

**How to avoid:**
Document the re-drive playbook explicitly:
1. For routine DLQ redrives after transient failures: idempotency behaves correctly — skips if already processed.
2. For forced reprocessing after a bug fix: manually delete the idempotency DynamoDB record for the affected `sessionId` before re-driving. The idempotency table partition key format is `functionName#hash` — the hash is derived from the `eventKeyJmesPath` value. A helper CLI script that accepts `sessionId` and deletes all idempotency records matching it should be part of the re-drive tooling.

The existing `transcode-completed.ts` `ConflictException` catch should be preserved as a backstop — if the idempotency record is cleared but the Transcribe job already exists, the `ConflictException` path handles it gracefully.

**Warning signs:**
- Re-drive from DLQ produces no CloudWatch logs for the handler's processing logic
- Re-drive appears to succeed (SQS message deleted) but session state is unchanged
- Support tickets: "I re-drove the DLQ but nothing happened for session X"

**Phase to address:** DLQ re-drive tooling phase (playbook must include forced-reprocessing path) and idempotency gap phase (CLI helper for record deletion)

---

## Moderate Pitfalls

### Pitfall 10: Zod Added at Module Scope With Large Union Schemas Increases Cold Start Duration

**What goes wrong:**
Defining a large shared `PipelineEventSchema` at module scope (e.g., a `z.discriminatedUnion()` covering all five pipeline event variants) registers the schema in every Lambda's initialization path, including handlers that only process one event type. For memory-constrained Lambdas (128MB default), large schema initialization can add 50-200ms to cold start duration.

**Why it happens:**
The natural instinct is to define all pipeline event schemas in a shared `pipeline-events.ts` file and import from it. With esbuild bundling, the entire imported module is included in each Lambda's bundle regardless of what's actually used — tree-shaking does not work reliably with Zod's class-based schema definitions.

**How to avoid:**
Keep each handler's schema co-located in its own handler file, scoped to exactly the event type that handler processes. No shared pipeline-events module. Each file defines one schema of 3-6 fields. Cold start impact per handler stays under 5ms.

**Warning signs:**
- Lambda init duration increases by 50ms+ after schema module is added (visible in CloudWatch INIT duration)
- All five pipeline handlers show increased cold start times simultaneously

**Phase to address:** Schema validation phase

---

### Pitfall 11: X-Ray Sampling Rate Too Low for Low-Volume Pipeline — Zero Traces in Console

**What goes wrong:**
X-Ray default sampling is 1 request/second + 5% of additional requests. For a pipeline that processes 10-50 sessions per day (roughly 50-250 handler invocations/day), the default sampling may capture only a fraction of traces. During debugging, the developer triggers a single pipeline run expecting to see it in X-Ray and finds nothing.

**Why it happens:**
The default sampling rule is designed for high-volume web APIs where 100% tracing would be cost-prohibitive. For a low-volume pipeline, the same rule results in near-zero traces at off-peak times.

**How to avoid:**
Create a custom X-Ray sampling rule targeting `serviceName = 'vnl-pipeline'` with `fixedRate = 1.0` (100% sampling). At the expected volume of <500 pipeline invocations/day, 100% sampling produces fewer than 500 traces/day — well within the 100,000 free traces/month tier. Add this rule in CDK as an `aws_xray.CfnSamplingRule` resource.

X-Ray pricing: first 100,000 recorded traces/month free; $0.000005 per additional trace. 500 traces/day × 30 days = 15,000 traces/month — entirely within free tier.

**Warning signs:**
- X-Ray console shows traces for only 1-2 of 10 pipeline runs
- Traces appear at the start of a test run (the 1/sec rule fires) but subsequent runs produce no traces

**Phase to address:** X-Ray tracing phase

---

### Pitfall 12: UI Transcript Panel Shows Blank Instead of Status-Appropriate State

**What goes wrong:**
When `transcriptStatus = 'processing'` or `transcriptStatus = 'failed'`, the transcript panel renders blank (no content, no loading indicator, no error message). Users cannot distinguish between "transcript not started yet," "transcript is being processed," and "transcript failed." Users who see a blank panel assume the feature is broken.

**Why it happens:**
The transcript panel was built to display transcript content. The `transcriptStatus` field exists on the session record but the UI rendering logic may not branch on all possible values — particularly `failed`. The panel may also not distinguish between `transcriptStatus = undefined` (pre-pipeline) and `transcriptStatus = 'failed'` (pipeline ran but failed).

**How to avoid:**
Implement explicit rendering branches for each `transcriptStatus` value:
- `undefined` / `null`: "Transcript not available for this session"
- `'processing'`: "Transcript being generated..." with elapsed-time indicator
- `'available'`: render transcript content
- `'failed'`: "Transcript generation failed" with option to report the issue

Test each branch manually before marking the UI polish phase complete.

**Warning signs:**
- Blank transcript panel with no loading or error indicator for sessions in non-`available` states
- `transcriptStatus = 'failed'` sessions show the same blank panel as `transcriptStatus = 'processing'`

**Phase to address:** UI polish phase

---

### Pitfall 13: Activity Feed Stale After Pipeline Completion — No State Refresh Trigger

**What goes wrong:**
A user navigates to the activity feed while a session's pipeline is running. The session card shows "Processing" status. The pipeline completes (transcript available, AI summary ready). The user refreshes manually and sees the updated state. But if the user stays on the page without refreshing, the card shows stale state indefinitely. For AI summaries (which can take 2-5 minutes after recording ends), this creates a confusing experience where the summary appears to be missing.

**Why it happens:**
The frontend fetches session state once on page load with no background refresh for sessions in non-terminal states. The pipeline completion events fire in the backend but there is no push mechanism to the frontend.

**How to avoid:**
For sessions where `transcriptStatus` is `'processing'` or `aiSummaryStatus` is `'processing'`, implement polling with exponential backoff: check every 15s, then 30s, then 60s (cap at 60s). Stop polling when the status reaches a terminal value (`available` or `failed`). The total polling window for a typical session should be under 10 minutes.

Do not implement WebSocket or SSE push for this — polling is sufficient given the processing time of 2-5 minutes and the low frequency of checks.

**Warning signs:**
- Activity feed session cards show "Processing" permanently without refreshing the page
- AI summaries appear only after manual page reload

**Phase to address:** UI polish phase

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skipping `captureAWSv3Client` for S3 and DynamoDB calls inside `processEvent` | Faster implementation | Blind spots in X-Ray traces; cannot see downstream read/write latency | Never for the 5 pipeline-critical handlers |
| Using `z.any()` for unverified EventBridge detail fields | Avoids schema definition work | Defeats schema validation; poisoned events pass through silently | Never in pipeline handlers |
| Sharing one idempotency DynamoDB table across all 5 handlers | One table instead of five | Partition key collisions theoretically possible if two handlers use the same sessionId-based key (recovery events could trigger this); monitoring harder | Acceptable for v1.7 at current volume |
| Applying X-Ray to 3 of 5 handlers to save phase time | Faster shipping | Incomplete trace maps; gaps appear exactly at failure hotspots | Never — all 5 handlers or none |
| Manual DLQ re-drive via AWS console | No build time | Console viewing counts against `maxReceiveCount` on source queue, can accidentally move messages to DLQ prematurely | Never for production re-drives |
| Polling transcript status from frontend on every page load | Simple to implement | Unnecessary API calls for terminal sessions (already `available` or `failed`) | Acceptable if terminal states skip polling after first fetch |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Powertools Tracer + Logger | Assuming Logger automatically includes X-Ray trace ID in log entries | Trace IDs are NOT automatically injected into Logger output; use `tracer.getRootXrayTraceId()` and add to persistent keys manually if log-to-trace correlation is needed |
| Powertools Tracer + SQS batch handler | Applying `@tracer.captureLambdaHandler()` decorator to the outer SQS handler | Creates one root segment per batch; use manual subsegments per record inside the processing loop |
| Zod + esbuild bundler | Importing a shared pipeline-events schema module that contains all 5 event schemas | esbuild bundles the entire module regardless of what is imported; keep schemas per-file to minimize bundle size |
| Idempotency + SQS `batchSize:1` | Applying `makeIdempotent` to the outer `handler` function keyed on `Records[0].messageId` | `messageId` changes on DLQ redrive; key on EventBridge `detail` fields at the `processEvent` level |
| SQS DLQ redrive + idempotency | Expecting forced reprocessing after a bug fix to work automatically | If the idempotency record is within its TTL window, re-drive returns cached result; must delete the record manually first |
| X-Ray + Lambda at low invocation volume | Default 1 req/sec + 5% sampling rule misses all pipeline runs at <50/day | Create a custom X-Ray sampling rule at 100% for `serviceName = 'vnl-pipeline'` |
| DLQ re-drive CLI + IAM | Missing `sqs:StartMessageMoveTask`, `sqs:GetQueueAttributes`, or `sqs:ReceiveMessage` on DLQ | All three permissions required; test with IAM policy simulator before shipping the CLI |
| SQS DLQ re-drive + messages sent directly to DLQ | `CouldNotDetermineMessageSource` error when re-driving messages added directly to DLQ (not via SQS redrive policy) | Recovery events from `scan-stuck-sessions` go directly to EventBridge, not SQS — these messages never appear in the DLQ and cannot be re-driven via SQS tooling |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| AWS SDK clients constructed inside `processEvent` (current in 4 of 5 handlers) | Cold start pays client initialization cost on every invocation; Tracer cannot capture calls | Move all clients to module scope alongside Logger and Tracer | Already present at current volume; worsens with Tracer instrumentation overhead |
| X-Ray `captureHTTPsRequests: true` (default) with Bedrock calls in `store-summary` | HTTPS request tracing adds ~5ms per invocation; Bedrock response body may exceed 64KB X-Ray segment limit causing truncation | Set `captureHTTPsRequests: false` for `store-summary` or disable per-method | Any Bedrock call with transcript input >60KB |
| Idempotency DynamoDB reads on every invocation without local cache | 2 DDB reads + 2 DDB writes per unique invocation across all 5 handlers × N sessions/day | Enable `useLocalCache: true` in `IdempotencyConfig`; effective for same-execution-environment warm retries | Not a concern at current volume; worth enabling from the start for cleanliness |
| Zod schema parsing full SQS envelope (not just `record.body`) | Minor overhead; more importantly, SQS envelope fields vary between test and production | Parse only the JSON-parsed `record.body` content; never validate the SQS wrapper structure | Not a performance concern but a correctness concern |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| DLQ re-drive CLI tool using broad pipeline Lambda execution role credentials | Stolen credential can replay any pipeline event, triggering duplicate MediaConvert jobs and Bedrock calls | Scope the re-drive IAM role to `sqs:StartMessageMoveTask` + `sqs:ReceiveMessage` on specific DLQ ARNs only; do not reuse Lambda execution role |
| X-Ray traces capturing full event detail including `recording_s3_key_prefix` and `sessionId` | S3 path structure exposed in X-Ray console — same account so low severity, but violates least-exposure principle | Set `captureResponse: false` on handlers that process session data; add sessionId and status as explicit annotations only |
| Zod error messages logged at ERROR level with full `record.body` | CloudWatch Logs may expose raw EventBridge event payload at ERROR level to anyone with log read access | Log only `parseResult.error.issues` at ERROR; log `record.body` only at DEBUG level (which is typically not retained long-term) |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Transcript panel shows blank for `transcriptStatus = 'failed'` | User cannot distinguish failed transcript from processing transcript; assumes feature is broken | Show explicit "Transcript generation failed" state with distinct styling from loading state |
| AI summary displayed with no attribution label | Users may mistake AI-generated text for a human description; incorrect summaries damage trust | Add "AI-generated summary" label with a help tooltip |
| Upload video player has no "processing" state when `transcriptStatus` is not `available` | Transcript panel appears broken; video loads but sidebar is empty | Implement per-panel loading states independent of video player readiness |
| Activity feed session cards show stale pipeline status indefinitely | User sees "Processing" forever after pipeline has completed; may report a bug | Poll for non-terminal states with exponential backoff; stop polling on terminal state |
| Live session page "End Session" button does not disable on click | Double-tap triggers two API calls; second call fails with confusing error | Disable button immediately on first click; re-enable only on explicit API error |

---

## "Looks Done But Isn't" Checklist

- [ ] **X-Ray tracing:** `tracing: lambda.Tracing.ACTIVE` set on **every** instrumented Lambda in `session-stack.ts` — verify in Lambda console "Configuration > Monitoring" tab shows "Active" for each function
- [ ] **X-Ray tracing:** `tracer.captureAWSv3Client()` called at module scope for every AWS SDK client — verify by triggering a pipeline run and confirming DynamoDB, S3, MediaConvert, Transcribe, Bedrock nodes appear on the X-Ray service map
- [ ] **X-Ray sampling:** Custom sampling rule created at 100% for `serviceName = 'vnl-pipeline'` — verify a single triggered pipeline run produces a complete trace in the X-Ray console
- [ ] **Idempotency:** DynamoDB idempotency table has `timeToLiveAttribute: 'expiration'` set — verify in DynamoDB console "Additional settings > Time to Live attribute" shows `expiration`
- [ ] **Idempotency:** `config.registerLambdaContext(context)` called in every wrapped handler — verify by checking handler signature includes `context: Context` argument
- [ ] **Idempotency:** `eventKeyJmesPath` set to a stable business identifier (not SQS `messageId`) in every handler — verify by inspecting the DynamoDB idempotency table; partition keys should contain sessionId or jobId values, not SQS messageId values
- [ ] **Schema validation:** Every handler uses `safeParse()` at the SQS record loop level and does NOT push schema errors to `failures` — verify by sending a malformed test event and confirming the message is acknowledged (not in DLQ) with an ERROR log
- [ ] **start-transcribe error handling:** `processEvent` throws on transient Transcribe API errors — verify by mocking a `ThrottlingException` and confirming the message appears in the DLQ after 3 retries
- [ ] **DLQ re-drive tooling:** Re-drive CLI documents the forced-reprocessing path (delete idempotency record + re-drive) — verify the playbook is tested with a real DLQ message
- [ ] **UI polish — transcript:** All four `transcriptStatus` values (`undefined`, `processing`, `available`, `failed`) render distinct states — verify manually with sessions in each state
- [ ] **UI polish — activity feed:** Sessions in non-terminal pipeline states refresh automatically without page reload — verify by triggering pipeline completion while on activity feed page

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Active tracing not enabled in CDK | LOW | Add `tracing: lambda.Tracing.ACTIVE`; `cdk deploy`; traces appear on next invocation |
| SDK clients in handler scope — no X-Ray capture | LOW | Move clients to module scope; redeploy; verify trace map on next run |
| Wrong idempotency key — DLQ redrives re-execute or fail to re-execute | MEDIUM | Clear idempotency records for affected sessionIds from DynamoDB; redeploy with correct `eventKeyJmesPath`; re-drive DLQ |
| Idempotency table missing TTL | LOW | Update CDK with `timeToLiveAttribute: 'expiration'`; `cdk deploy`; DynamoDB begins TTL deletion within 48h of expiry timestamps |
| Lambda context not registered — stuck INPROGRESS records | MEDIUM | Manually delete stuck `INPROGRESS` idempotency records from DynamoDB; add `registerLambdaContext` call; redeploy |
| Zod validation errors retrying 3x and landing in DLQ | LOW | Inspect DLQ messages for malformed pattern; fix upstream EventBridge rule or event producer; purge DLQ; switch to `safeParse` in handler |
| start-transcribe swallows errors — sessions stuck at processing | MEDIUM | Use `scan-stuck-sessions` CLI to recover affected sessions; fix error-handling in `start-transcribe.ts`; redeploy |
| DLQ re-drive returns cached idempotency result for forced reprocessing | LOW | Delete the specific idempotency DynamoDB record for the sessionId; re-drive the message |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Active tracing not enabled in CDK | X-Ray tracing phase | Lambda console shows "Active" for each instrumented function |
| SDK clients in handler scope — Tracer cannot capture | X-Ray tracing phase | X-Ray service map shows downstream nodes (DDB, S3, Bedrock, MediaConvert, Transcribe) |
| Single trace per SQS batch (decorator misuse) | X-Ray tracing phase | Single-message DLQ re-drive produces its own isolatable trace |
| Wrong idempotency key for EventBridge-in-SQS events | Idempotency gap phase | DLQ redrive within TTL window returns cached result without re-executing; key is sessionId or jobId in DynamoDB records |
| Idempotency table missing TTL configuration | Idempotency gap phase | DynamoDB TTL attribute set to `expiration`; table item count stabilizes after first pipeline run |
| Lambda context not registered for timeout protection | Idempotency gap phase | Lambda timeout test: INPROGRESS record expires and next invocation re-executes |
| Zod validation errors retrying on SQS | Schema validation phase | Malformed event test: message acknowledged (no DLQ entry) with ERROR log, not retried |
| Zod cold start overhead from shared schema module | Schema validation phase | Lambda init duration metric unchanged after adding per-file schemas |
| start-transcribe swallows transient errors | Schema validation phase (error-path audit) | Throttle simulation: message appears in DLQ after 3 retries |
| DLQ re-drive idempotency window conflict | DLQ re-drive tooling phase + idempotency phase | Forced-reprocessing playbook documented and tested; idempotency record deletion helper in CLI |
| Transcript UI blank for non-available states | UI polish phase | Manual test: all four `transcriptStatus` values show distinct UI states |
| Activity feed stale after pipeline completion | UI polish phase | Pipeline completion while on feed: card updates within 60s without manual reload |

---

## Sources

- [Tracer - Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) — module scope requirements, captureAWSv3Client, active tracing prerequisites, facade segment annotation limitations, HTTPS tracing overhead
- [Implementing idempotent AWS Lambda functions with Powertools for AWS Lambda (TypeScript)](https://aws.amazon.com/blogs/compute/implementing-idempotent-aws-lambda-functions-with-powertools-for-aws-lambda-typescript/) — idempotency patterns, SQS integration, TTL configuration
- [Idempotency - Powertools for AWS Lambda (TypeScript) 2.1.1](https://docs.aws.amazon.com/powertools/typescript/2.1.1/utilities/idempotency/) — DynamoDB table TTL attribute naming, eventKeyJmesPath, in-progress timeout behavior, registerLambdaContext requirement, response size limits, exception-vs-record-deletion behavior
- [Troubleshoot Amazon SQS dead-letter queue and DLQ redrive issues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/troubleshooting-dlq-redrive.html) — CouldNotDetermineMessageSource error, console viewing counts against maxReceiveCount
- [Best practices for implementing partial batch responses](https://docs.aws.amazon.com/prescriptive-guidance/latest/lambda-event-filtering-partial-batch-responses-for-sqs/best-practices-partial-batch-responses.html) — batchItemFailures interaction with idempotency
- [Zod v4 release notes](https://zod.dev/v4) — bundle size improvements, Zod Mini option for tree-shaking
- [Zod v4 CommonJS bundle size regression issue](https://github.com/colinhacks/zod/issues/4637) — 4x bundle size increase with CommonJS for v4
- [AWS X-Ray pricing](https://aws.amazon.com/xray/pricing/) — 100K free traces/month, $0.000005/trace after; sampling at low invocation volume
- [AWS X-Ray Adaptive Sampling announcement (2025)](https://aws.amazon.com/about-aws/whats-new/2025/09/aws-x-ray-adaptive-sampling-automatic-error/) — adaptive sampling for error detection
- Codebase inspection (HIGH confidence): `recording-ended.ts`, `transcode-completed.ts`, `start-transcribe.ts`, `store-summary.ts`, `transcribe-completed.ts`, `session-stack.ts` — verified SDK client initialization locations, batchItemFailures patterns, missing error rethrow in start-transcribe, and absence of Tracer in all handlers

---

*Pitfalls research for: v1.7 Event Hardening & UI Polish on VideoNowAndLater AWS IVS platform*
*Researched: 2026-03-12*
*Supersedes: Previous PITFALLS.md (v1.5 Pipeline Reliability, Moderation & Upload Experience)*
