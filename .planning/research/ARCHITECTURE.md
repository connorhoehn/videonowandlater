# Architecture Research

**Domain:** AWS Lambda event-driven pipeline hardening — X-Ray tracing, schema validation, DLQ re-drive, idempotency
**Researched:** 2026-03-12
**Confidence:** HIGH (verified against official Powertools docs, CDK v2 API docs, AWS SQS API reference)

## Standard Architecture

### System Overview

```
EventBridge Rules
       |
       v
SQS Queue (batchSize:1 + reportBatchItemFailures)
  +-- recordingEndedQueue       --> recording-ended Lambda
  +-- transcodeCompletedQueue   --> transcode-completed Lambda
  +-- transcribeCompletedQueue  --> transcribe-completed Lambda
  +-- storeSummaryQueue         --> store-summary Lambda
  +-- startTranscribeQueue      --> start-transcribe Lambda
          |
          v (on maxReceiveCount=3 exceeded)
      Handler DLQ
          |
          v
   [v1.7: DLQ Inspector GET endpoint]
   [v1.7: DLQ Redrive POST endpoint --> StartMessageMoveTask]
```

After v1.7 hardening, each Lambda gains:
- `tracing: Tracing.ACTIVE` in CDK + X-Ray segments per invocation
- `captureAWSv3Client` on DynamoDB/S3/Transcribe/Bedrock/MediaConvert clients
- Zod schema `safeParse` at SQS record body entry point
- Powertools Idempotency wrapper for handlers missing it
- DLQ re-drive endpoint for manual replay of failed messages

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Tracer (module-scope) | Creates X-Ray subsegments, captures AWS SDK calls, annotates cold start | `new Tracer({ serviceName })` at module scope; `captureAWSv3Client` on each SDK client |
| Zod schema | Parses `JSON.parse(record.body)` result into typed, validated shape | `z.object(...)` defined per handler; `safeParse` on the SQS body; ZodError routes to batchItemFailure |
| Idempotency table | Stores `{id, status, expiration}` records keyed on event field per handler | Separate DynamoDB table; TTL on `expiration` attribute; pay-per-request billing |
| DLQ re-drive Lambda | Calls `sqs:StartMessageMoveTask` with DLQ ARN as source | New Lambda + API Gateway route `POST /admin/dlq/redrive` |
| DLQ inspector Lambda | Polls DLQ with `sqs:ReceiveMessage` (VisibilityTimeout=0); returns message list | New Lambda + API Gateway route `GET /admin/dlq/:handler` |

## Recommended Project Structure

```
backend/src/handlers/
+-- recording-ended.ts          # Modify: add Tracer, Zod schema, captureAWSv3Client
+-- transcode-completed.ts      # Modify: add Tracer, Zod schema, idempotency, captureAWSv3Client
+-- transcribe-completed.ts     # Modify: add Tracer, Zod schema, captureAWSv3Client
+-- store-summary.ts            # Modify: add Tracer, Zod schema, idempotency, captureAWSv3Client
+-- start-transcribe.ts         # Modify: add Tracer, Zod schema, captureAWSv3Client
+-- on-mediaconvert-complete.ts # Modify: add Tracer, Zod schema (direct EB handler, not SQS)
+-- dlq-inspector.ts            # NEW: poll DLQ, return messages without deleting
+-- dlq-redrive.ts              # NEW: move messages from DLQ back to source queue

backend/src/schemas/            # NEW: Zod schemas shared across handlers
+-- recording-ended-event.ts    # BroadcastRecordingEnd + StageParticipantRecordingEnd union
+-- transcode-completed-event.ts
+-- transcribe-completed-event.ts
+-- transcript-stored-event.ts
+-- upload-recording-available-event.ts

infra/lib/stacks/session-stack.ts
# Modify: add tracing: Tracing.ACTIVE to 5+ pipeline Lambdas
# Modify: CDK adds xray:PutTraceSegments + xray:GetSamplingRules automatically
# Add: IdempotencyTable DynamoDB resource (vnl-idempotency)
# Add: DLQ inspector/redrive Lambda + API Gateway admin routes
# Add: IDEMPOTENCY_TABLE_NAME env var on transcode-completed + store-summary
```

### Structure Rationale

- **`backend/src/schemas/`:** Centralising Zod schemas keeps handler files focused on business logic; schemas can be unit-tested independently; shared schemas prevent drift between handlers that reference the same event format (e.g. EventBridge envelope wrapper `source`, `detail-type`, `detail`)
- **`dlq-inspector.ts` / `dlq-redrive.ts` separate from pipeline handlers:** DLQ operations are operator tooling, not part of the event pipeline; they need different IAM permissions (SQS management actions vs. DynamoDB/Transcribe/Bedrock) and different API Gateway routes (admin-gated)

## Architectural Patterns

### Pattern 1: Tracer at Module Scope + captureAWSv3Client

**What:** `Tracer` is instantiated once outside the handler export. Each AWS SDK client is wrapped with `tracer.captureAWSv3Client()` at module scope. The SQS handler manually opens a subsegment bracketing the `processEvent()` call, then closes it in `finally`.

**When to use:** Required for every pipeline Lambda. Module scope init pays the cold-start cost once; subsequent warm invocations reuse the already-instrumented clients with no repeated wrapping overhead.

**Trade-offs:**
- Pro: automatic subsegments for every DynamoDB/S3/Transcribe/Bedrock/MediaConvert call; sessionId annotation is filterable in X-Ray console
- Pro: CDK `Tracing.ACTIVE` automatically grants `xray:PutTraceSegments` and `xray:GetSamplingRules` — no manual IAM needed
- Con: adds ~2ms overhead per subsegment creation; must set `captureResponse: false` on large-payload handlers (transcript JSON) to stay under X-Ray's 64 KB metadata limit
- Con: SQS→Lambda trace links show as disconnected nodes in the X-Ray service map (SQS breaks the W3C trace header chain); this is an X-Ray platform limitation, not a bug

**Example:**
```typescript
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const rawDdbClient = new DynamoDBClient({});
const ddbClient = tracer.captureAWSv3Client(rawDdbClient); // auto-subsegments per call

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## handler');
  if (subsegment) tracer.setSegment(subsegment);
  tracer.annotateColdStart();

  try {
    // ... processEvent loop
  } finally {
    subsegment?.close();
    if (segment) tracer.setSegment(segment);
  }
};
```

**CDK change required (per pipeline Lambda):**
```typescript
const recordingEndedFn = new nodejs.NodejsFunction(this, 'RecordingEnded', {
  // ... existing config unchanged
  tracing: lambda.Tracing.ACTIVE,  // ADD THIS LINE
});
// CDK automatically grants xray:PutTraceSegments + xray:GetSamplingRules
```

### Pattern 2: Zod Schema Validation at SQS Record Body Entry

**What:** Each handler defines a Zod schema matching its expected EventBridge event shape. Inside the SQS for-loop, `JSON.parse(record.body)` output is passed to `schema.safeParse()`. A `ZodError` (`.success === false`) is caught and pushed to `batchItemFailures` without rethrowing — schema errors are permanent failures and retrying a structurally invalid message provides no value.

**When to use:** At the top of the SQS for-loop, before calling `processEvent()`. The correct placement is outside `processEvent()` because: (1) `processEvent` receives a typed argument; (2) catching ZodError separately from transient errors enables different disposition (permanent DLQ vs. retry).

**Trade-offs:**
- Pro: surfaces malformed events immediately as structured logs with field-level Zod error details; prevents downstream AWS SDK calls on bad data
- Pro: Zod's `.infer<typeof Schema>` eliminates the `as any` casts present in current handlers (e.g. `detail as any` in `transcode-completed.ts`)
- Con: Zod adds ~25 KB to the bundled Lambda; this is acceptable given Powertools is already ~800 KB in the bundle

**SQS handler lifecycle with Zod:**
```
SQSEvent.Records iteration:
  1. JSON.parse(record.body)                -- raw deserialization
  2. MyEventSchema.safeParse(parsed)        -- schema validation (NEW)
     ZodError -> batchItemFailure, continue  -- permanent: don't retry
  3. processEvent(parseResult.data)         -- business logic with typed input
     throw Error -> batchItemFailure         -- transient: SQS retries
```

**Example:**
```typescript
import { z } from 'zod';

const TranscodeCompletedSchema = z.object({
  source: z.literal('aws.mediaconvert'),
  detail: z.object({
    status: z.enum(['COMPLETE', 'ERROR', 'CANCELED']),
    userMetadata: z.object({
      sessionId: z.string().min(1),
      phase: z.string(),
    }),
    outputGroupDetails: z.array(z.object({
      outputDetails: z.array(z.object({
        outputFilePaths: z.array(z.string()),
      })).optional(),
    })).optional(),
  }),
});

// In handler for-loop:
const parseResult = TranscodeCompletedSchema.safeParse(JSON.parse(record.body));
if (!parseResult.success) {
  logger.error('Schema validation failed', {
    errors: parseResult.error.issues,
    messageId: record.messageId,
  });
  failures.push({ itemIdentifier: record.messageId }); // permanent: don't retry
  continue;
}
await processEvent(parseResult.data); // now fully typed
```

### Pattern 3: Powertools Idempotency with JMESPath Key on SQS Events

**What:** `makeIdempotent` wraps `processEvent()` using `DynamoDBPersistenceLayer`. The idempotency key uses a JMESPath expression pointing to a stable field in the validated EventBridge event. A separate DynamoDB table stores idempotency records with TTL.

**When to use:** Apply to handlers that perform non-idempotent mutations:
- `transcode-completed`: starts a Transcribe job (currently guarded with manual `ConflictException` catch — replace with Powertools)
- `store-summary`: invokes Bedrock + writes DynamoDB (no guard today; Bedrock is not idempotent)

Do NOT apply to handlers that are already safe to replay:
- `transcribe-completed`: S3 `PutObject` is idempotent; DynamoDB `SET` attributes are idempotent
- `recording-ended`: pool release uses conditional DynamoDB writes; MediaConvert submission is the only risk (add idempotency here only if replay scenarios require it)
- `start-transcribe`: verify if a `ConflictException` guard already exists

**Trade-offs:**
- Pro: eliminates the manual `ConflictException` check in `transcode-completed`; protects `store-summary` from duplicate Bedrock invocations on SQS retry
- Pro: DynamoDB idempotency records auto-expire via TTL; no manual cleanup
- Con: requires a new DynamoDB table; adds 1 DynamoDB read (and conditional write) per invocation
- Con: `makeIdempotent` wraps the function before the SQS outer loop sees the result — `context.registerLambdaContext(context)` is required for Lambda timeout protection

**Key decision — separate table vs main table:**
Use a dedicated `vnl-idempotency` table. Rationale: (1) Powertools uses a fixed PK format (`functionName#hash`) that would pollute the single-table namespace; (2) TTL is 1 hour vs the main table's multi-year data; (3) keeping them separate preserves clean DLQ replay analysis.

**Example (transcode-completed):**
```typescript
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { IdempotencyConfig, makeIdempotent } from '@aws-lambda-powertools/idempotency';

const persistence = new DynamoDBPersistenceLayer({
  tableName: process.env.IDEMPOTENCY_TABLE_NAME!,
});

const idempotencyConfig = new IdempotencyConfig({
  eventKeyJmesPath: 'detail.userMetadata.sessionId', // stable per MediaConvert job
  expiresAfterSeconds: 3600,
});

const processEventIdempotently = makeIdempotent(processEvent, {
  persistenceStore: persistence,
  config: idempotencyConfig,
});

export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
  idempotencyConfig.registerLambdaContext(context); // timeout protection
  for (const record of event.Records) {
    const parseResult = TranscodeCompletedSchema.safeParse(JSON.parse(record.body));
    if (!parseResult.success) { failures.push(...); continue; }
    try {
      await processEventIdempotently(parseResult.data);
    } catch (err) {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};
```

**CDK table definition:**
```typescript
const idempotencyTable = new dynamodb.Table(this, 'IdempotencyTable', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: 'expiration',
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY,
  tableName: 'vnl-idempotency',
});
idempotencyTable.grantReadWriteData(transcodeCompletedFn);
idempotencyTable.grantReadWriteData(storeSummaryFn);
// Add IDEMPOTENCY_TABLE_NAME env var to each
```

### Pattern 4: DLQ Re-drive via StartMessageMoveTask

**What:** A `dlq-redrive` Lambda exposes a `POST /admin/dlq/redrive` endpoint. It calls `sqs:StartMessageMoveTask` with `SourceArn` set to the selected DLQ ARN and no `DestinationArn` (AWS defaults to the DLQ's registered source queue). A `dlq-inspector` Lambda exposes `GET /admin/dlq/:handler` using `sqs:ReceiveMessage` with `VisibilityTimeout=0` to preview DLQ contents without consuming messages.

**Why StartMessageMoveTask is applicable here:** Our DLQs are configured as the `deadLetterQueue` property on SQS queues (e.g. `recordingEndedQueue.deadLetterQueue = recordingEndedDlq`). This satisfies the API requirement: "source queue must be a DLQ of another Amazon SQS queue." The API limitation that blocks re-drive affects Lambda function-level OnFailure destinations and SNS subscription DLQs — neither of which we use.

**Trade-offs:**
- Pro: `StartMessageMoveTask` is fully async and AWS-managed; no polling loop in Lambda
- Pro: no second consumer Lambda needed — original SQS-triggered handlers process redriven messages naturally
- Con: only one active move task per queue; cannot re-drive one specific message (all-or-nothing per queue)
- Con: inspect-without-consuming (`VisibilityTimeout=0`) briefly hides messages from other consumers — use small `MaxNumberOfMessages` (1–10) and short call duration

**Required IAM on the re-drive Lambda:**
```
sqs:StartMessageMoveTask
sqs:ListMessageMoveTasks
sqs:CancelMessageMoveTask
sqs:ReceiveMessage        (for inspector)
sqs:DeleteMessage         (required by StartMessageMoveTask internals)
sqs:GetQueueAttributes
sqs:ListDeadLetterSourceQueues
```

**Example:**
```typescript
// dlq-redrive.ts
import { SQSClient, StartMessageMoveTaskCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

const DLQ_ARNS: Record<string, string> = {
  'recording-ended':       process.env.RECORDING_ENDED_DLQ_ARN!,
  'transcode-completed':   process.env.TRANSCODE_COMPLETED_DLQ_ARN!,
  'transcribe-completed':  process.env.TRANSCRIBE_COMPLETED_DLQ_ARN!,
  'store-summary':         process.env.STORE_SUMMARY_DLQ_ARN!,
  'start-transcribe':      process.env.START_TRANSCRIBE_DLQ_ARN!,
};

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const { handlerName } = JSON.parse(event.body || '{}');
  const dlqArn = DLQ_ARNS[handlerName];
  if (!dlqArn) return { statusCode: 400, body: JSON.stringify({ error: 'Unknown handler' }) };

  const result = await sqs.send(new StartMessageMoveTaskCommand({ SourceArn: dlqArn }));
  return { statusCode: 200, body: JSON.stringify({ taskHandle: result.TaskHandle }) };
};
```

## Data Flow

### Pipeline Event Flow (Current — v1.6)

```
IVS / MediaConvert / Transcribe / custom.vnl event
       |
       v
  EventBridge Rule
       |
       v
  SQS Queue (visibilityTimeout = 6x Lambda timeout, maxReceiveCount=3)
       |  (Lambda polls, batchSize:1)
       v
  Handler Lambda
    1. JSON.parse(record.body)
    2. processEvent(ebEvent)          --> DynamoDB writes, AWS API calls
    3. Success: return {}
    4. Failure throw: batchItemFailures --> message returns to queue
       After 3 receives --> DLQ (14-day retention)
```

### Pipeline Event Flow After v1.7 Hardening

```
EventBridge Rule --> SQS Queue --> Handler Lambda
    |
    +-- [NEW] Tracer subsegment opened (## handler)
    +-- [NEW] Zod schema.safeParse(JSON.parse(record.body))
    |         ZodError --> batchItemFailure (permanent: skip retry)
    +-- [NEW] makeIdempotent check in DynamoDB (transcode-completed, store-summary only)
    |         Already-processed --> return cached result immediately
    +-- processEvent(validatedEvent)
    |     +-- captureAWSv3Client calls auto-create X-Ray subsegments per AWS call
    |     +-- tracer.putAnnotation('sessionId', sessionId)
    +-- [NEW] Tracer subsegment closed
    +-- batchItemFailures --> DLQ (unchanged)
              |
              v [NEW v1.7 operator tooling]
         GET /admin/dlq/:handler    --> inspect DLQ without consuming
         POST /admin/dlq/redrive   --> StartMessageMoveTask (move all back to source queue)
```

### X-Ray Trace Topology

```
Lambda invocation (segment auto-created by runtime with Tracing.ACTIVE)
  +-- ## handler (manual subsegment)
        +-- DynamoDB:GetItem        (auto via captureAWSv3Client)
        +-- DynamoDB:UpdateItem     (auto via captureAWSv3Client)
        +-- MediaConvert:CreateJob  (auto via captureAWSv3Client)
        +-- S3:GetObject            (auto via captureAWSv3Client)
        +-- Transcribe:StartTranscriptionJob (auto via captureAWSv3Client)

Annotations (indexed, filterable): { sessionId, pipelineStage, coldStart }
Metadata (context, not indexed):   { jobId, durationMs, status }
```

Note: SQS-to-Lambda trace links appear as separate, disconnected trace nodes in the X-Ray service map. AWS X-Ray does not propagate trace context through SQS message attributes in the Lambda trigger path. Lambda segments will correctly show their downstream AWS call subsegments, but will not be visually connected to the upstream EventBridge or SQS node. This is an X-Ray platform constraint, confirmed in AWS documentation on SQS+X-Ray integration.

## Integration Points

### X-Ray Integration Points

| Integration Point | Change Required | Location |
|-------------------|-----------------|----------|
| Lambda tracing enabled | `tracing: lambda.Tracing.ACTIVE` per function | `session-stack.ts` NodejsFunction props (5 pipeline Lambdas + on-mediaconvert-complete) |
| X-Ray IAM permissions | Auto-added by CDK when `Tracing.ACTIVE` is set | No manual action needed |
| SDK client instrumentation | `tracer.captureAWSv3Client(client)` at module scope | Each handler file, wrap each SDK client used |
| Subsegment lifecycle | Manual open before `processEvent()` / close in `finally` | Each handler file |
| Cold start annotation | `tracer.annotateColdStart()` | Once per handler, in the subsegment block |
| Session annotation | `tracer.putAnnotation('sessionId', sessionId)` | Inside `processEvent` after sessionId is extracted from validated event |
| Large payload protection | Do not capture response on transcript/speakerSegment payloads | `transcribe-completed.ts`, `store-summary.ts` |

### Schema Validation Integration Points

| Handler | Event Shape | ZodError Disposition | Current Risk Without Schema |
|---------|-------------|----------------------|-----------------------------|
| `recording-ended.ts` | IVS Recording End (2 variants: channel + stage) | batchItemFailure (permanent) | `event.detail as Record<string, any>` — panics on missing fields reach SQS retry loop |
| `transcode-completed.ts` | MediaConvert State Change | batchItemFailure (permanent) | `detail as any` cast — missing `userMetadata` causes silent undefined |
| `transcribe-completed.ts` | Transcribe State Change | batchItemFailure (permanent) | Job name regex handles one case; detail fields not validated |
| `store-summary.ts` | Custom `Transcript Stored` | batchItemFailure (permanent) | `event.detail` typed via interface but not validated at runtime |
| `start-transcribe.ts` | Custom `Upload Recording Available` | batchItemFailure (permanent) | Not yet examined; likely uses `as any` |
| `on-mediaconvert-complete.ts` | MediaConvert State Change (direct EB, not SQS) | throw (EventBridge retries) | `detail.jobName` parsed by regex only |

### Idempotency Coverage After v1.7

| Handler | Gap Without Idempotency | Key Used | Priority |
|---------|------------------------|----------|----------|
| `transcode-completed.ts` | Duplicate Transcribe job start on SQS retry (currently catches ConflictException manually — fragile) | `detail.userMetadata.sessionId` | HIGH — replace manual guard |
| `store-summary.ts` | Duplicate Bedrock invocation + duplicate DynamoDB write (no guard today) | `detail.sessionId` | HIGH — Bedrock not idempotent |
| `recording-ended.ts` | Duplicate MediaConvert job submission (pool release uses conditional writes, but MediaConvert submission is unguarded on retry) | `resources[0]` (IVS resource ARN) | MEDIUM — MediaConvert accepts duplicate tags silently; add if v1.7 scope allows |
| `transcribe-completed.ts` | S3 PutObject is idempotent; DynamoDB SET is idempotent | N/A | LOW — safe to replay naturally |
| `start-transcribe.ts` | Transcribe ConflictException handling — verify if guard exists | `detail.sessionId` | MEDIUM — verify before deprioritising |

### DLQ Re-drive Integration Points

| DLQ | Source Queue | Re-drive Mechanism | Why StartMessageMoveTask Applies |
|-----|-------------|--------------------|---------------------------------|
| `vnl-recording-ended-dlq` | `vnl-recording-ended` | `StartMessageMoveTask` (no DestinationArn = auto-source) | DLQ configured on SQS queue, not Lambda function |
| `vnl-transcode-completed-dlq` | `vnl-transcode-completed` | Same | Same |
| `vnl-transcribe-completed-dlq` | `vnl-transcribe-completed` | Same | Same |
| `vnl-store-summary-dlq` | `vnl-store-summary` | Same | Same |
| `vnl-start-transcribe-dlq` | `vnl-start-transcribe` | Same | Same |

### New vs Modified Components Summary

| Component | Status | Change Description |
|-----------|--------|--------------------|
| `recording-ended.ts` | Modified | Add Tracer + captureAWSv3Client on MediaConvertClient + DynamoDB client; add Zod schema validation |
| `transcode-completed.ts` | Modified | Add Tracer + captureAWSv3Client; add Zod schema; replace ConflictException guard with Powertools idempotency |
| `transcribe-completed.ts` | Modified | Add Tracer + captureAWSv3Client on S3Client + EventBridgeClient; add Zod schema |
| `store-summary.ts` | Modified | Add Tracer + captureAWSv3Client on S3Client + BedrockRuntimeClient; add Zod schema; add idempotency |
| `start-transcribe.ts` | Modified | Add Tracer + captureAWSv3Client; add Zod schema |
| `on-mediaconvert-complete.ts` | Modified | Add Tracer + captureAWSv3Client; add Zod schema (direct EB handler, throw not batchItemFailures) |
| `dlq-inspector.ts` | New | GET /admin/dlq/:handler — ReceiveMessage with VisibilityTimeout=0, return messages |
| `dlq-redrive.ts` | New | POST /admin/dlq/redrive — StartMessageMoveTask per handler name |
| `backend/src/schemas/` | New dir | 5 Zod schema files, one per pipeline handler event type |
| `vnl-idempotency` DynamoDB table | New | PK=`id` (STRING), TTL attribute=`expiration`, pay-per-request |
| `session-stack.ts` | Modified | `Tracing.ACTIVE` on 6 Lambdas; IdempotencyTable; DLQ Lambda + API routes; DLQ ARN env vars |

## Build Order

Phase dependencies drive this ordering:

**Phase A: X-Ray Tracing (no dependencies — build first)**

Add `tracing: lambda.Tracing.ACTIVE` to all 6 pipeline Lambdas in `session-stack.ts`. Add `Tracer` module-scope instantiation + `captureAWSv3Client` wrappers + manual subsegment lifecycle to each handler. Add `@aws-lambda-powertools/tracer` — it is already in `backend/package.json` at `^2.31.0` so no package changes required.

Rationale: purely additive — zero risk of breaking existing behavior. Ships observability before touching any core logic. Subsequent phases benefit from X-Ray traces during testing.

**Phase B: Schema Validation (depends on: understanding handler inputs, benefits from Phase A observability)**

Create `backend/src/schemas/` with Zod schemas. Add `safeParse` call in each handler's SQS for-loop. Install `zod` package (`npm install zod`). Route ZodError to batchItemFailures (not throw). Write unit tests for each schema with valid and invalid inputs.

Rationale: schema validation is additive at runtime — ZodError on malformed events goes to DLQ (same as a panic today, but now with structured error detail). Having typed inputs from Zod makes Phase C idempotency key extraction reliable via JMESPath.

**Phase C: Idempotency (depends on: Phase B — typed/validated events make JMESPath key extraction reliable)**

Add `@aws-lambda-powertools/idempotency` package. Add `vnl-idempotency` table to CDK. Wire `makeIdempotent` to `transcode-completed` and `store-summary`. Remove the manual `ConflictException` guard from `transcode-completed`. Add `IDEMPOTENCY_TABLE_NAME` env var. Grant DynamoDB read/write to the two handlers.

Rationale: idempotency wraps `processEvent()` which now receives typed input from Phase B. The JMESPath expressions in `IdempotencyConfig` point to validated field paths.

**Phase D: DLQ Re-drive Tooling (depends on: Phase A for observability; independent of Phases B and C)**

Create `dlq-inspector.ts` + `dlq-redrive.ts`. Add API Gateway admin routes (Cognito-gated). Add CDK Lambda definitions + IAM for SQS management actions. Pass DLQ ARNs as env vars.

Rationale: DLQ tooling is independent of pipeline hardening and can be built in parallel with Phases B and C if development resources allow. Benefits from Phase A tracing when diagnosing why messages landed in DLQ.

## Anti-Patterns

### Anti-Pattern 1: Sharing the Main DynamoDB Table for Idempotency Records

**What people do:** Reuse `vnl-sessions` for idempotency records, adding `PK=IDEMPOTENCY#...` items alongside session data.

**Why it's wrong:** Powertools DynamoDBPersistenceLayer uses its own PK format (`functionName#hash`); these records pollute the single-table namespace and complicate DLQ replay analysis. Idempotency records have a 1-hour TTL that would require a filter expression on all queries to exclude expired state.

**Do this instead:** Provision a dedicated `vnl-idempotency` table. At current volume it costs essentially nothing (pay-per-request, ~1 write + 1 read per pipeline invocation per day).

### Anti-Pattern 2: Using `captureResponse: true` (Default) on Large Payload Handlers

**What people do:** Use default Tracer settings on handlers that process large objects like transcript JSON or speaker segment arrays.

**Why it's wrong:** X-Ray has a 64 KB limit on segment metadata. `transcribe-completed` fetches transcript JSON that can be hundreds of KB; `store-summary` processes transcript text. With default settings X-Ray silently truncates or rejects the segment.

**Do this instead:** Do not call `tracer.addResponseAsMetadata()` on handlers that process large payloads, or annotate only identifiers (sessionId, jobId, textLength) not the payload content itself.

### Anti-Pattern 3: Using `schema.parse()` (Throwing) Inside `processEvent()` Instead of `safeParse` in the SQS Loop

**What people do:** Call `schema.parse(JSON.parse(record.body))` inside `processEvent()`, letting ZodError propagate to the outer catch block which pushes to `batchItemFailures`, triggering SQS retries.

**Why it's wrong:** Schema validation failures are permanent — the event structure will not change between retries. Retrying 3 times wastes Lambda invocations, inflates CW alarm metrics, and delays the message reaching the DLQ where it can be inspected.

**Do this instead:** Use `schema.safeParse()` in the SQS for-loop before calling `processEvent()`. On `!result.success`, log the ZodError issues and immediately push to `failures`. Only transient errors (network, throttling, downstream API unavailability) should use the retry path.

### Anti-Pattern 4: Assuming Lambda Function-level DLQs Support StartMessageMoveTask

**What people do:** Configure `deadLetterQueueEnabled: true` on a Lambda function (Lambda OnFailure DLQ) and expect `StartMessageMoveTask` to re-drive those messages.

**Why it's wrong:** `StartMessageMoveTask` only accepts DLQ ARNs that are the `deadLetterQueue` of another SQS queue. Lambda function DLQs and SNS subscription DLQs are explicitly unsupported per the AWS API reference.

**Do this instead:** Ensure DLQs are configured at the SQS queue level (the `deadLetterQueue` property on the SQS Queue construct), not at the Lambda function level. This is exactly the existing pattern in `session-stack.ts` — all 5 pipeline queue pairs use `new sqs.Queue(..., { deadLetterQueue: { queue: xyzDlq, maxReceiveCount: 3 } })`. These DLQs fully support `StartMessageMoveTask`.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (~100 sessions/day) | X-Ray 5 traces/second default sampling covers all invocations; no adjustments needed |
| 1k–10k sessions/day | Consider X-Ray sampling rules to reduce storage costs; idempotency table scales automatically on-demand |
| 100k+ sessions/day | X-Ray sampling critical (both cost and performance); disable response capture globally; consider Powertools Tracer `POWERTOOLS_TRACER_CAPTURE_RESPONSE=false` env var |

## Sources

- [Tracer - Powertools for AWS Lambda (TypeScript) official docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) — HIGH confidence
- [CDK NodejsFunction API — tracing property](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunctionProps.html) — HIGH confidence
- [Idempotency - Powertools for AWS Lambda (TypeScript) 1.18](https://docs.aws.amazon.com/powertools/typescript/1.18.0/utilities/idempotency/) — HIGH confidence
- [Implementing idempotent AWS Lambda functions with Powertools - AWS Blog](https://aws.amazon.com/blogs/compute/implementing-idempotent-aws-lambda-functions-with-powertools-for-aws-lambda-typescript/) — HIGH confidence
- [StartMessageMoveTask SQS API Reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html) — HIGH confidence
- [SQS DLQ Redrive configuration guide](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) — HIGH confidence
- [Amazon SQS and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html) — HIGH confidence (explains SQS trace topology and disconnected node behavior)
- [How to reprocess Lambda DLQ messages on-demand - Yan Cui](https://theburningmonk.com/2024/01/how-would-you-reprocess-lambda-dead-letter-queue-messages-on-demand/) — MEDIUM confidence (community source; StartMessageMoveTask limitation for Lambda DLQs verified against AWS API docs)
- [Parser (Zod) - Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/2.1.1/utilities/parser/) — HIGH confidence
- Codebase direct analysis: `infra/lib/stacks/session-stack.ts`, all 5 pipeline handler files, `backend/package.json` — HIGH confidence

---
*Architecture research for: VideoNowAndLater v1.7 Event Hardening & UI Polish*
*Researched: 2026-03-12*
