# Stack Research

**Domain:** AWS Lambda event pipeline — X-Ray tracing, schema validation, DLQ re-drive, idempotency (v1.7 additions)
**Researched:** 2026-03-12
**Confidence:** HIGH (all packages verified via npm registry + official AWS Powertools docs + CDK API docs + AWS SQS API reference)

---

## Scope

This is an additive research document for the v1.7 milestone. The existing stack (CDK v2.170+, Lambda Node 20, DynamoDB, SQS+DLQs, EventBridge, Powertools Logger, React + Vite + Tailwind) is unchanged. This file covers **only the new capabilities**: X-Ray tracing, event schema validation, DLQ re-drive tooling, and idempotency gap coverage.

---

## Context: What Already Exists (Do Not Re-add)

The following are already in `backend/package.json` and must not be duplicated:

| Already Present | Version | Notes |
|-----------------|---------|-------|
| `@aws-lambda-powertools/logger` | ^2.31.0 | Module-scope pattern with `appendPersistentKeys` — in use across all 5 pipeline handlers |
| `@aws-lambda-powertools/tracer` | ^2.31.0 | **Present but not wired into any handler or CDK Lambda definition** |
| `@aws-sdk/client-dynamodb` | ^3.1000.0 | Satisfies idempotency peer dep |
| `@aws-sdk/lib-dynamodb` | ^3.1000.0 | Satisfies idempotency peer dep |
| `aws-cdk-lib` | ^2.170.0 | CDK v2; `lambda.Tracing.ACTIVE` is available |

**Critical finding:** `@aws-lambda-powertools/tracer` is already installed. The v1.7 X-Ray work is wiring it into handlers and enabling `tracing: lambda.Tracing.ACTIVE` in CDK — no npm install needed for tracing.

---

## New Packages Required

### Core Additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@aws-lambda-powertools/parser` | 2.31.0 | Event schema validation with built-in SQS + EventBridge envelopes | Ships `SqsEnvelope` and `EventBridgeEnvelope` that unwrap the double-JSON structure (SQS body → EventBridge JSON → detail). Zod-based so schema definitions produce TypeScript types automatically via `z.infer<>`. Same Powertools family as Logger/Tracer — same version pin, same import style. Replaces scattered `event.detail.recording_s3_key_prefix as string` casts with validated typed access. |
| `zod` | ^4.3.6 | Schema definition language for `@aws-lambda-powertools/parser` | Peer dependency of `@aws-lambda-powertools/parser@2.31.0`. Specifies `zod: '4.x'`. Do not install zod v3. Provides TypeScript inference from schema definitions. |
| `@aws-lambda-powertools/idempotency` | 2.31.0 | Full handler-level idempotency for SQS handlers | Manages the INPROGRESS/COMPLETE state machine, concurrent request locking, Lambda timeout handling, and response caching in DynamoDB. Closes gaps that the current manual `ConflictException` catch on `transcode-completed.ts` does not cover: duplicate DynamoDB writes on SQS retry, concurrent in-flight identical SQS deliveries, and partial executions that succeed on the first external call but fail before returning. |
| `@aws-sdk/client-sqs` | ^3.x | `StartMessageMoveTask` API for DLQ re-drive | The SQS native re-drive API (released June 2023) moves messages from a DLQ back to its source queue asynchronously. No custom polling loop needed. The `StartMessageMoveTaskCommand` is only in `@aws-sdk/client-sqs` — not in any Powertools package. |

### Supporting Libraries (Evaluate Per Phase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@aws-lambda-powertools/batch` | 2.31.0 | `BatchProcessor` + `processPartialResponse` for SQS batch handling | Only if replacing the current manual `batchItemFailures` loop with the Powertools pattern to integrate cleanly with `makeIdempotent`. Current loops are correct and passing tests — do not migrate in v1.7 unless a phase specifically targets it. |

---

## CDK Changes Required (infra only, no new npm packages)

All CDK changes use existing `aws-cdk-lib`. No new package needed in `infra/package.json`.

| Change | CDK API | Notes |
|--------|---------|-------|
| Enable X-Ray per Lambda | `tracing: lambda.Tracing.ACTIVE` on each `NodejsFunction` | CDK automatically adds `xray:PutTraceSegments` and `xray:PutTelemetryRecords` to the execution role — no manual `addToRolePolicy` call needed |
| Idempotency DynamoDB table | `new dynamodb.Table(...)` with `timeToLiveAttribute: 'expiration'` | One table shared across all Lambda functions; Powertools prefixes keys with function name automatically — no collisions |
| DLQ re-drive Lambda (optional tooling) | New `nodejs.NodejsFunction` for `dlq-redrive` handler | Needs `sqs:StartMessageMoveTask`, `sqs:GetQueueAttributes`, `sqs:ListMessageMoveTasks` IAM permissions on all 5 DLQ ARNs |

---

## Detailed Stack Decisions

### 1. X-Ray Tracing

**Package:** `@aws-lambda-powertools/tracer@^2.31.0` — already installed.

**CDK change:** Add `tracing: lambda.Tracing.ACTIVE` to the `NodejsFunction` constructor for each of the 5 pipeline Lambdas (`recording-ended`, `transcode-completed`, `on-mediaconvert-complete`, `transcribe-completed`, `store-summary`). CDK automatically adds `xray:PutTraceSegments` and `xray:PutTelemetryRecords` IAM — no separate policy statement required.

**Use `ACTIVE` not `PASS_THROUGH`:** The pipeline is EventBridge → SQS → Lambda. Neither EventBridge nor SQS injects X-Ray trace headers into SQS messages. `PASS_THROUGH` would produce no traces at all for these handlers. `ACTIVE` causes Lambda to always start a new trace segment.

**Handler initialization — follow existing Logger pattern (module scope):**

```typescript
import { Tracer } from '@aws-lambda-powertools/tracer';

// Module scope — same as Logger instantiation
const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
```

**For SQS handlers, use manual subsegment (decorators require class-based handlers):**

```typescript
const segment = tracer.getSegment();
const subsegment = segment?.addNewSubsegment(`## processEvent`);
try {
  // handler logic
  subsegment?.close();
} catch (err) {
  subsegment?.addError(err as Error);
  subsegment?.close();
  throw err;
}
```

**Recommended environment variable** on each Lambda to avoid capturing large event/response bodies in traces:
```
POWERTOOLS_TRACER_CAPTURE_RESPONSE=false
POWERTOOLS_TRACER_CAPTURE_ERROR=true
```

**Integration with Logger:** Tracer and Logger operate independently. Both use `serviceName: 'vnl-pipeline'` as a convention. Powertools Logger already automatically includes `xray_trace_id` in every log line when tracing is active — this provides log-to-trace correlation in CloudWatch without any additional configuration.

### 2. Event Schema Validation

**Packages:** `@aws-lambda-powertools/parser@2.31.0` + `zod@^4.3.6`

**Why Parser over raw Zod or AJV:**
- `SqsEnvelope` handles the double-JSON decode automatically (SQS `body` is a JSON string containing an EventBridge event JSON object containing a `detail` JSON object — three layers)
- `EventBridgeEnvelope` can be composed with `SqsEnvelope` to extract `detail` directly
- `safeParse: true` returns typed error results instead of throwing, enabling the SQS handler to report a specific `batchItemFailure` for a malformed record rather than crashing the whole batch
- Zod provides `z.infer<typeof Schema>` — the validated parse result is fully typed; no more `event.detail.field as string` casts that bypass type checking
- AJV is 5-18x faster but requires separate TypeScript type generation tooling; for this pipeline's volume (one event per recording session), the performance delta is irrelevant

**Usage pattern (manual parse, no middy required):**

```typescript
import { z } from 'zod';
import { parse, safeParse } from '@aws-lambda-powertools/parser';
import { SqsEnvelope } from '@aws-lambda-powertools/parser/envelopes/sqs';

// Define schema for the EventBridge detail payload
const RecordingEndDetailSchema = z.object({
  recording_s3_key_prefix: z.string().min(1),
  recording_s3_bucket_name: z.string().min(1),
  recording_duration_ms: z.number(),
  recording_status: z.enum(['Recording End', 'Recording End Failure']).optional(),
  channel_name: z.string().optional(),
  stream_id: z.string().optional(),
});

// In the SQS handler, parse the SQS record body
const parsed = safeParse(JSON.parse(record.body).detail, RecordingEndDetailSchema);
if (!parsed.success) {
  logger.error('Schema validation failed', { errors: parsed.error });
  failures.push({ itemIdentifier: record.messageId });
  continue;
}
const detail = parsed.data; // fully typed as RecordingEndDetail
```

**Recovery event path note:** The `recording-ended` handler has a recovery path (`event.detail.recoveryAttempt === true`) with a different detail shape. Define a union schema or use `z.discriminatedUnion` on `recoveryAttempt` to handle both paths with full type coverage.

### 3. DLQ Re-drive

**Approach:** Custom Lambda calling `SQSClient.StartMessageMoveTask` — no CDK construct abstraction needed.

**Why not the `mbonig/sqs-redrive` CDK construct:** This construct predates the June 2023 native `StartMessageMoveTask` API and adds unnecessary abstraction. The native API is the standard approach and is available directly via `@aws-sdk/client-sqs`.

**Why `StartMessageMoveTask` fits VNL's setup:** The API requires the source queue to be a DLQ configured as the dead-letter queue of another SQS queue. All 5 VNL DLQs (`vnl-recording-ended-dlq`, `vnl-transcode-completed-dlq`, `vnl-transcribe-completed-dlq`, `vnl-on-mediaconvert-complete-dlq`, `vnl-store-summary-dlq`) are SQS-sourced DLQs. This matches the API requirement exactly.

**What `StartMessageMoveTask` does NOT support:** Lambda DLQ (Lambda's own `onFailure` destination) and SNS-sourced DLQs. VNL does not use these patterns for the 5 pipeline handlers.

**Handler pattern:**

```typescript
import {
  SQSClient,
  StartMessageMoveTaskCommand,
  ListMessageMoveTasksCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({});

// Inspect DLQ depth before redrive
const attrs = await sqsClient.send(new GetQueueAttributesCommand({
  QueueUrl: dlqUrl,
  AttributeNames: ['ApproximateNumberOfMessages'],
}));
const depth = parseInt(attrs.Attributes?.ApproximateNumberOfMessages ?? '0', 10);

// Start redrive — omit DestinationArn to redrive to original source queue
if (depth > 0) {
  await sqsClient.send(new StartMessageMoveTaskCommand({
    SourceArn: dlqArn,
    // DestinationArn omitted = auto-redrives to source queue
    MaxNumberOfMessagesPerSecond: 10, // safe default; max is 500
  }));
}
```

**IAM permissions for the re-drive Lambda:**

```typescript
redriveToolFn.addToRolePolicy(new iam.PolicyStatement({
  actions: [
    'sqs:StartMessageMoveTask',
    'sqs:GetQueueAttributes',
    'sqs:GetQueueUrl',
    'sqs:ListMessageMoveTasks',
    'sqs:CancelMessageMoveTask',
  ],
  resources: [
    recordingEndedDlq.queueArn,
    transcodeCompletedDlq.queueArn,
    transcribeCompletedDlq.queueArn,
    onMediaConvertCompleteDlq.queueArn,
    storeSummaryDlq.queueArn,
  ],
}));
```

**Operational constraint:** Only one active move task per queue at a time. Check `ListMessageMoveTasks` before starting to avoid `MessageMoveTaskAlreadyRunning` errors.

### 4. Idempotency

**Package:** `@aws-lambda-powertools/idempotency@2.31.0`

**Peer deps already satisfied:** `@aws-sdk/client-dynamodb@^3.1000.0` and `@aws-sdk/lib-dynamodb@^3.1000.0` are already in `backend/package.json`. No additional SDK packages needed.

**New DynamoDB table in CDK (session-stack.ts):**

```typescript
const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
  tableName: 'vnl-idempotency',
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: 'expiration',
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
});
```

One table for all 5 pipeline handlers. Powertools prefixes each key with the Lambda function name (`functionName#hashOfPayload`) — no cross-handler collisions.

**Why this closes gaps beyond current `transcode-completed.ts` manual pattern:**

| Scenario | Current Manual Approach | `makeIdempotent` Behavior |
|----------|------------------------|---------------------------|
| Duplicate Transcribe submission (same sessionId + jobId) | Catches `ConflictException` from Transcribe API | Stops execution before any external call via stored COMPLETE record |
| SQS retry after partial handler execution | No protection — DynamoDB writes can duplicate | Idempotency key check at entry prevents replay |
| Two concurrent SQS deliveries of same message | Race condition — both may proceed | `INPROGRESS` lock throws `IdempotencyAlreadyInProgressError` for the second |
| Lambda timeout mid-execution then retry | No protection — retried from start | Detects timed-out INPROGRESS records and resets them for safe retry |
| Successful execution replayed by SQS visibility timeout | Re-executes everything | Returns cached response without executing handler body |

**Usage pattern for SQS handlers (compatible with current manual batchItemFailures loop):**

```typescript
import { makeIdempotent, IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';

const persistence = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE!,
});

const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'messageId', // Use SQS messageId as the idempotency key
});

const processIdempotently = makeIdempotent(processEvent, {
  persistenceStore: persistence,
  config: idempotencyConfig,
});

export const handler = async (
  event: SQSEvent,
  context: Context
): Promise<SQSBatchResponse> => {
  idempotencyConfig.registerLambdaContext(context);
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processIdempotently(record);
    } catch (err: any) {
      logger.error('Failed to process SQS record', { messageId: record.messageId, error: err.message });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
```

**Note on existing `transcode-completed.ts`:** The manual `ConflictException` catch can be removed once `makeIdempotent` wraps the handler, as the idempotency layer prevents reaching the Transcribe call on replay. Keep it as a belt-and-suspenders safety net or remove it during the phase to reduce noise.

**DynamoDB write cost:** 2 WCUs on initial invocation (PutItem for lock + UpdateItem for completion), 1 RCU on idempotent replay. For VNL's session volume this is negligible.

---

## Installation

```bash
# In backend/ — add new packages
npm install @aws-lambda-powertools/parser zod @aws-lambda-powertools/idempotency @aws-sdk/client-sqs

# @aws-lambda-powertools/tracer is already installed — no action needed
# @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb are already installed — peer deps satisfied
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@aws-lambda-powertools/parser` + `zod` | Raw `zod` without Powertools wrapper | Acceptable if you want to skip the Envelope pattern and manually `JSON.parse` + `z.safeParse`. More boilerplate, same outcome. |
| `@aws-lambda-powertools/parser` + `zod` | AJV directly | Use AJV only if existing JSON Schema `.json` files must be reused, or if validation is on a hot path processing thousands of events per second. VNL pipeline volume does not justify AJV's setup complexity. |
| `StartMessageMoveTask` native API | `mbonig/sqs-redrive` CDK construct | The CDK construct predates the native API. Native API is the current standard and avoids a third-party CDK dependency. |
| `makeIdempotent` Powertools utility | Manual `ConditionalCheckFailedException` per handler | Manual approach is adequate for single-call deduplication (one Transcribe job per sessionId). Use manual only if the handler has exactly one idempotency concern. Use `makeIdempotent` for full handler replay protection. |
| `lambda.Tracing.ACTIVE` | `lambda.Tracing.PASS_THROUGH` | Use PASS_THROUGH only when the upstream service injects X-Ray trace headers (e.g., API Gateway). EventBridge and SQS do not inject headers, so PASS_THROUGH produces zero traces for these handlers. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `aws-xray-sdk` directly | Raw SDK requires manual `AWSXRay.captureAWS()` patch calls and has no Powertools Logger integration. Produces `xray_trace_id` in logs only when used with Powertools Tracer. | `@aws-lambda-powertools/tracer` (already installed) |
| `joi` or `yup` for event validation | Neither integrates with Powertools Parser envelopes. Joi has no ESM build. Yup lacks discriminated union support needed for dual-path handlers (normal + recovery event). | `zod` via `@aws-lambda-powertools/parser` |
| SQS `ReceiveMessage` polling loop for DLQ inspection | Manual polling duplicates what the CloudWatch metrics and console already show. Creates operational overhead (concurrent polling, visibility timeout management). | `StartMessageMoveTask` for redrive; CloudWatch DLQ depth metrics already shipped in v1.6 |
| One idempotency DynamoDB table per handler | Creates 5 identical tables with no benefit. Powertools uses function-name-prefixed keys automatically — one shared table is correct. | Single `vnl-idempotency` table |
| Middy middleware (`injectLambdaContext`, `captureLambdaHandler`) | The project uses plain `async (event, context)` handlers without middleware. Introducing Middy would require refactoring all 5 pipeline handlers and adds framework overhead with no functional benefit for v1.7. | Module-scope Tracer instantiation + manual subsegment pattern |
| `@aws-lambda-powertools/batch` `BatchProcessor` | Current handlers use manual `batchItemFailures` loops that work correctly with 462/462 tests passing. Migrating to `BatchProcessor` is a refactor with no v1.7 functional gain. | Keep current manual loops; wrap `processEvent` with `makeIdempotent` |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@aws-lambda-powertools/parser@2.31.0` | `zod@^4.x` | Parser v2.31 peer dep specifies `zod: '4.x'`. Install zod v4. Do NOT install zod v3 — it is a breaking peer dep mismatch. |
| `@aws-lambda-powertools/idempotency@2.31.0` | `@aws-sdk/client-dynamodb@>=3.x` | Already satisfied by `^3.1000.0` in package.json. |
| `@aws-lambda-powertools/tracer@2.31.0` | `aws-cdk-lib@^2.170.0` | `lambda.Tracing.ACTIVE` has been in CDK since v1. No version constraint issue. |
| `zod@^4.3.6` | TypeScript `^5.5.0` | Zod v4 requires TypeScript 4.9+. Project uses `^5.5.0` — compatible. |
| All Powertools packages | Each other at `2.31.0` | All Powertools packages are versioned together. Pin all at `2.31.0` (or `^2.31.0`) to keep them in sync. |

---

## Stack Patterns by Variant

**If a handler has a recovery event path with different detail shape (e.g., `recording-ended`):**
- Define a `z.discriminatedUnion('recoveryAttempt', [...])` or use `z.union([normalSchema, recoverySchema])`
- Parse before branching so both paths are type-safe
- Do not skip validation on the recovery path — recovery events have sessionId and recoveryAttemptCount fields that should be validated

**If phase scope is too large to add idempotency to all 5 handlers at once:**
- Prioritize `transcode-completed` (has existing partial coverage) and `recording-ended` (most critical, longest execution)
- Add `store-summary` and `transcribe-completed` in a follow-up phase
- `on-mediaconvert-complete` is a pass-through (just calls PutEvents) — lowest priority for idempotency

**If DLQ re-drive is built as a CLI tool rather than a Lambda:**
- The `@aws-sdk/client-sqs` `StartMessageMoveTaskCommand` is usable from Node.js CLI scripts too
- Same pattern as the existing `debug-pipeline.js` and `replay-pipeline.js` in the project

---

## Sources

- [Powertools Tracer docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) — module-scope pattern, manual subsegment API, POWERTOOLS_TRACER_CAPTURE_RESPONSE env var — HIGH confidence
- [Powertools Parser docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/parser/) — SqsEnvelope, EventBridgeEnvelope, safeParse usage — HIGH confidence
- [Powertools Idempotency docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/idempotency/) — makeIdempotent, SQS handler pattern, DynamoDB table setup, cost model — HIGH confidence
- npm registry (`npm info`) — confirmed `@aws-lambda-powertools/{parser,idempotency,tracer,batch}@2.31.0`, `zod@4.3.6`, peer deps for parser (`zod: '4.x'`) and idempotency (`@aws-sdk/client-dynamodb: >=3.x`) — HIGH confidence
- [SQS StartMessageMoveTask API reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html) — native DLQ redrive API, SQS-only source limitation, parameter names — HIGH confidence
- [AWS blog: New SQS DLQ Redrive APIs](https://aws.amazon.com/blogs/aws/a-new-set-of-apis-for-amazon-sqs-dead-letter-queue-redrive/) — launch announcement, redrive to original queue behavior — HIGH confidence
- [CDK NodejsFunction props](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunctionProps.html) — `tracing: Tracing` property type, default `Tracing.Disabled` — HIGH confidence
- CDK PR #675 + AWS docs — confirmed CDK automatically adds `xray:PutTraceSegments` + `xray:PutTelemetryRecords` when `Tracing.ACTIVE` is set — HIGH confidence
- `backend/package.json` (local read) — confirmed tracer already installed, dynamodb clients present — HIGH confidence
- `infra/lib/stacks/session-stack.ts` (local read) — confirmed existing Lambda patterns, DLQ queue constructs available — HIGH confidence

---

*Stack research for: v1.7 Event Hardening & UI Polish — X-Ray tracing, schema validation, DLQ re-drive, idempotency*
*Researched: 2026-03-12*
