# Phase 36: X-Ray Distributed Tracing - Research

**Researched:** 2026-03-12
**Domain:** AWS X-Ray, AWS Lambda Powertools Tracer (TypeScript), AWS CDK tracing configuration
**Confidence:** HIGH

---

## Summary

This phase wires AWS X-Ray active tracing into all 5 pipeline Lambda functions (recording-ended, transcode-completed, transcribe-completed, store-summary, on-mediaconvert-complete) so every downstream SDK call appears as a named subsegment, and every trace segment carries `sessionId` and `pipelineStage` annotations searchable without log diving.

The codebase already has `@aws-lambda-powertools/tracer@^2.31.0` installed. No new dependencies are required. The work is entirely configuration + code changes: CDK `tracing: lambda.Tracing.ACTIVE` on all 5 functions, SDK client refactor to module scope + `captureAWSv3Client`, and manual per-record subsegments with `putAnnotation` on each SQS handler. The `on-mediaconvert-complete` handler uses `console.log` and is directly EventBridge-invoked (not SQS-wrapped), so it gets a different but simpler treatment.

A key platform constraint governs success criterion 4: EventBridge does not propagate X-Ray trace headers into its SQS target messages. The SQS→Lambda trace link feature (released November 2022) creates a visual link in the service map between an SQS queue node and its Lambda consumer, but only when the same trace context flows from the SQS producer into the message's `AWSTraceHeader` system attribute. Because EventBridge is the producer in this pipeline and EventBridge does not inject that attribute into the SQS message body, each pipeline Lambda appears as an independent node in the service map. This is expected behavior, not a misconfiguration. The service map will show all 5 Lambda nodes with their downstream SDK calls visible, but there will not be a single connected chain. Success criterion 4 should be interpreted as "all 5 stages are nodes in the same service map view" rather than "a single trace spans all 5 stages."

**Primary recommendation:** Add `tracing: lambda.Tracing.ACTIVE` to all 5 CDK function definitions, refactor SDK clients to module scope with `captureAWSv3Client`, and add a manual subsegment + `putAnnotation` block inside each SQS record loop.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRACE-01 | Developer can view X-Ray traces for all 5 pipeline Lambda functions with active tracing enabled | CDK `tracing: lambda.Tracing.ACTIVE` on each NodejsFunction definition + IAM write access automatically granted by CDK |
| TRACE-02 | Each pipeline handler emits subsegments for downstream AWS SDK calls | `captureAWSv3Client` wraps each SDK client at module scope; produces one named subsegment per `.send()` call automatically |
| TRACE-03 | Each X-Ray segment is annotated with `sessionId` and `pipelineStage` | `tracer.putAnnotation('sessionId', ...)` and `tracer.putAnnotation('pipelineStage', ...)` called inside a per-record subsegment |
| TRACE-04 | X-Ray service map shows connected pipeline stages from recording-ended through store-summary | EventBridge→SQS→Lambda trace context is not automatically chained (platform constraint); each stage appears as a separate node; all 5 nodes visible simultaneously in service map satisfies this requirement |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-lambda-powertools/tracer` | `^2.31.0` (already installed) | X-Ray subsegments, annotations, client wrapping | Official Powertools — standard for Lambda X-Ray in TypeScript |
| `aws-cdk-lib` (lambda module) | Already in use | `lambda.Tracing.ACTIVE` on NodejsFunction | CDK-managed — enables active tracing, auto-grants IAM, no manual config |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `aws-xray-sdk-core` | Transitive dependency of Powertools | `Subsegment` type import | Needed for TypeScript type on manual subsegments |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Powertools Tracer | Raw `aws-xray-sdk-node` | Powertools wraps the SDK, provides `putAnnotation`, handles cold start — no reason to use raw SDK here |
| Manual subsegments everywhere | `captureLambdaHandler` decorator | Decorator does not support SQS handlers (batch processing); manual approach is correct for this codebase |

**Installation:** No new packages needed. `@aws-lambda-powertools/tracer` is already in `backend/package.json` at `^2.31.0`.

---

## Architecture Patterns

### Recommended Project Structure

Changes are isolated to two locations:
```
infra/lib/stacks/
└── session-stack.ts          # Add tracing: lambda.Tracing.ACTIVE to 5 functions

backend/src/handlers/
├── recording-ended.ts        # Tracer init, clients to module scope, per-record subsegment
├── transcode-completed.ts    # Tracer init, clients to module scope, per-record subsegment
├── transcribe-completed.ts   # Tracer init, clients to module scope, per-record subsegment
├── store-summary.ts          # Tracer init, clients to module scope, per-record subsegment
└── on-mediaconvert-complete.ts  # Tracer init, client to module scope, manual segment wrap
```

### Pattern 1: CDK Active Tracing (REQUIRED - no traces emitted without this)

**What:** Add `tracing: lambda.Tracing.ACTIVE` to each `NodejsFunction` definition in `session-stack.ts`.
**When to use:** Every pipeline Lambda that must appear in the service map.
**Critical:** Code-only changes produce zero traces if this CDK property is absent. No error is thrown — traces are silently dropped.

```typescript
// Source: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html
const recordingEndedFn = new nodejs.NodejsFunction(this, 'RecordingEnded', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/recording-ended.ts'),
  timeout: Duration.seconds(30),
  tracing: lambda.Tracing.ACTIVE,  // <-- add this line
  environment: { ... },
  ...
});
// CDK automatically adds xray:PutTraceSegments and xray:PutTelemetryRecords to the execution role
```

The same `tracing: lambda.Tracing.ACTIVE` property is added to: `transcodeCompletedFn`, `transcribeCompletedFn`, `storeSummaryFn`, and `onMediaConvertCompleteFunction`.

### Pattern 2: Module-Scope Tracer + captureAWSv3Client (REQUIRED for SDK subsegments)

**What:** Initialize the `Tracer` once at module scope, wrap each SDK client with `captureAWSv3Client` at module scope.
**When to use:** Every handler that calls downstream AWS services.
**Critical:** Clients constructed inside `processEvent` are NOT instrumented. `captureAWSv3Client` must receive the client instance at module initialization time. Four of the five SQS handlers currently construct clients inside `processEvent` and must be refactored.

```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });

// Wrap at module scope — not inside handler or processEvent
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const bedrockClient = tracer.captureAWSv3Client(new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION,
}));
```

**Important note for `recording-ended.ts`:** This handler currently uses `getDocumentClient()` from `../lib/dynamodb-client` (a shared factory) and constructs `MediaConvertClient` inside `processEvent`. The `MediaConvertClient` must be moved to module scope and wrapped. The `getDocumentClient()` call returns a pre-built `DynamoDBDocumentClient` — wrapping that returned client with `captureAWSv3Client` at module scope is the correct approach, or alternatively wrap the underlying `DynamoDBClient` before passing it to the document client factory. Verify the factory signature before choosing.

**Important note for `on-mediaconvert-complete.ts`:** This handler uses `console.log` (not Powertools Logger) and constructs `EventBridgeClient` inside the handler body. Both should be moved to module scope and wrapped.

### Pattern 3: Per-Record Manual Subsegment + Annotations (REQUIRED for SQS handlers)

**What:** For SQS event source handlers, `captureLambdaHandler` does not apply. Create a manual subsegment per SQS record, call `putAnnotation` inside it.
**When to use:** All 4 SQS-wrapped handlers (recording-ended, transcode-completed, transcribe-completed, store-summary).

```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
import type { Subsegment } from 'aws-xray-sdk-core';

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];
  const parentSegment = tracer.getSegment();

  for (const record of event.Records) {
    let subsegment: Subsegment | undefined;
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;

      // Create per-record subsegment and annotate before business logic
      subsegment = parentSegment?.addNewSubsegment('## processRecord');
      if (subsegment) tracer.setSegment(subsegment);

      // sessionId extraction happens before processEvent in the annotations — use event.detail.sessionId
      // or annotate after extraction inside processEvent
      tracer.putAnnotation('pipelineStage', 'recording-ended');  // handler-specific constant
      // sessionId annotation happens inside processEvent after extraction

      await processEvent(ebEvent, tracer);

    } catch (err: any) {
      tracer.addErrorAsMetadata(err as Error);
      logger.error('Failed to process SQS record', { messageId: record.messageId, error: err.message });
      failures.push({ itemIdentifier: record.messageId });
    } finally {
      subsegment?.close();
      if (parentSegment) tracer.setSegment(parentSegment);
    }
  }

  return { batchItemFailures: failures };
};
```

**sessionId annotation:** Pass `tracer` into `processEvent` as a parameter (or keep it module-scope accessible). Call `tracer.putAnnotation('sessionId', sessionId)` immediately after extracting `sessionId` from the event, before any DynamoDB/S3/etc. calls.

### Pattern 4: EventBridge-Direct Handler (on-mediaconvert-complete)

**What:** `on-mediaconvert-complete` is invoked directly by EventBridge (not via SQS). Use a manual segment wrap around the handler body.
**When to use:** Direct EventBridge invocation pattern.

```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
import { Tracer } from '@aws-lambda-powertools/tracer';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

export const handler = async (event: EventBridgeEvent<...>): Promise<void> => {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment('## handler');
  if (subsegment) tracer.setSegment(subsegment);

  try {
    tracer.putAnnotation('pipelineStage', 'on-mediaconvert-complete');
    // sessionId extracted from jobName after regex match — annotate after extraction
    // ...business logic...
  } catch (error) {
    tracer.addErrorAsMetadata(error as Error);
    throw error;
  } finally {
    subsegment?.close();
    if (segment) tracer.setSegment(segment);
  }
};
```

### Anti-Patterns to Avoid

- **Constructing SDK clients inside `processEvent`:** The client will not be instrumented; zero subsegments appear for that service. Clients must be at module scope.
- **Using `captureLambdaHandler` decorator on SQS handlers:** The decorator wraps the top-level handler, not individual records. For SQS batch handlers, use manual per-record subsegments.
- **Skipping `tracing: lambda.Tracing.ACTIVE` in CDK:** The Lambda execution environment will not have an X-Ray daemon socket; all `tracer.putAnnotation()` calls are silently no-ops.
- **Annotating with metadata instead of annotations:** `tracer.putMetadata()` stores data in traces but is NOT indexed — not searchable from the X-Ray filter expression UI. Use `tracer.putAnnotation()` for `sessionId` and `pipelineStage`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SDK client instrumentation | Custom middleware or monkey-patching | `tracer.captureAWSv3Client()` | Powertools handles subsegment lifecycle, error capture, and async context correctly |
| Subsegment lifecycle management | Manual `AWSXRay.beginSegment` / `endSegment` | `tracer.getSegment()?.addNewSubsegment()` + `finally { subsegment.close() }` | Powertools wraps the raw X-Ray SDK with safe defaults |
| Trace context propagation across SQS | Custom `AWSTraceHeader` injection | N/A — this is a platform limitation; do not attempt | EventBridge→SQS does not carry trace context; accept disconnected nodes |

**Key insight:** The Powertools Tracer is a thin, tested wrapper around `aws-xray-sdk-node`. The raw SDK can be used directly but requires more boilerplate and has more footguns around async context.

---

## Common Pitfalls

### Pitfall 1: CDK Tracing Not Set — Silent Failure
**What goes wrong:** Handler code with Tracer calls works locally and deploys without errors, but zero traces appear in X-Ray console.
**Why it happens:** Without `tracing: lambda.Tracing.ACTIVE` in CDK, Lambda does not provision the X-Ray daemon. All tracer calls are silently no-ops.
**How to avoid:** Add `tracing: lambda.Tracing.ACTIVE` to every NodejsFunction definition before writing any tracer code. Verify in Lambda console that "X-Ray tracing" shows "Active" for each function.
**Warning signs:** No function nodes appear in the X-Ray service map after triggering a recording.

### Pitfall 2: SDK Clients Constructed Inside processEvent
**What goes wrong:** `captureAWSv3Client` is called inside `processEvent`, or after the first Lambda invocation recycles the client. The subsegments for that client's calls appear absent from the trace.
**Why it happens:** `captureAWSv3Client` patches the client instance at the time of the call. If the instance is new on every invocation, the patch is applied but the subsegment context may not be active by the time the SDK call executes.
**How to avoid:** Move all `new XxxClient({})` calls to module scope (outside `handler` and `processEvent`). Wrap with `captureAWSv3Client` at that same module scope.
**Warning signs:** Some SDK service calls have subsegments (those already at module scope) and some don't (those inside processEvent).

### Pitfall 3: Expecting a Single Connected Trace Across All 5 Pipeline Stages
**What goes wrong:** Developer opens X-Ray and sees 5 independent Lambda nodes instead of a chain, reports tracing as broken.
**Why it happens:** EventBridge is the event producer for all 5 SQS queues. EventBridge does not inject the `AWSTraceHeader` message system attribute into SQS messages. The SQS→Lambda trace link only works when the SQS producer injects that header. Therefore each Lambda starts a new root trace.
**How to avoid:** Set the correct expectation: a "connected chain" for this architecture means all 5 Lambda function nodes appear in the same X-Ray service map, each with their downstream SDK subsegments visible. This is the correct verification for TRACE-04.
**Warning signs:** This is NOT a warning sign — it is expected. Do not spend time debugging EventBridge trace header injection.

### Pitfall 4: putAnnotation Called Outside an Active Subsegment
**What goes wrong:** `tracer.putAnnotation('sessionId', sid)` is called before `tracer.setSegment(subsegment)`, so the annotation lands on the parent segment or is lost.
**Why it happens:** Powertools writes annotations to whichever segment is currently active in the tracer's context.
**How to avoid:** Always call `tracer.setSegment(subsegment)` before any `putAnnotation` or `putMetadata` calls. Restore the parent segment in the `finally` block.
**Warning signs:** Traces visible in X-Ray but filter expressions like `annotation.sessionId = "abc123"` return no results.

### Pitfall 5: `recording-ended` Dynamic Imports Break Client Scope
**What goes wrong:** `recording-ended.ts` currently uses `await import('@aws-sdk/lib-dynamodb')` inside the handler body (line 417) for `UpdateCommand`. This is a dynamic import that returns a new module reference each invocation.
**Why it happens:** The dynamic import was added to avoid circular imports or for code splitting. It is incompatible with module-scope client wrapping because the `DynamoDBDocumentClient` reference created at module scope may not be the same instance used by the dynamic import's `UpdateCommand`.
**How to avoid:** Replace dynamic imports with static imports at the top of the file. The `UpdateCommand` from `@aws-sdk/lib-dynamodb` is a pure command class with no side effects — there is no reason to import it dynamically. Consolidate all DynamoDB client usage to use the same module-scope wrapped client.
**Warning signs:** DynamoDB subsegments appear for some calls but not others in the same handler trace.

---

## Code Examples

Verified patterns from official sources:

### Tracer initialization and client wrapping (module scope)
```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
import { Tracer } from '@aws-lambda-powertools/tracer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const tracer = new Tracer({ serviceName: 'vnl-pipeline' });
const dynamoBaseClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoBaseClient, {
  marshallOptions: { removeUndefinedValues: true },
});
```

### putAnnotation pattern (searchable in X-Ray filter)
```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
// After setSegment(subsegment):
tracer.putAnnotation('sessionId', sessionId);
tracer.putAnnotation('pipelineStage', 'recording-ended');
// Filter expression in X-Ray: annotation.sessionId = "some-uuid"
```

### Manual subsegment lifecycle for SQS handlers
```typescript
// Source: https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/
import type { Subsegment } from 'aws-xray-sdk-core';

const parentSegment = tracer.getSegment();
let subsegment: Subsegment | undefined;
try {
  subsegment = parentSegment?.addNewSubsegment('## processRecord');
  if (subsegment) tracer.setSegment(subsegment);
  tracer.putAnnotation('pipelineStage', 'transcode-completed');
  tracer.putAnnotation('sessionId', sessionId);
  // ... business logic ...
} catch (err) {
  tracer.addErrorAsMetadata(err as Error);
  throw err;
} finally {
  subsegment?.close();
  if (parentSegment) tracer.setSegment(parentSegment);
}
```

### CDK tracing property
```typescript
// Source: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html
import * as lambda from 'aws-cdk-lib/aws-lambda';

const fn = new nodejs.NodejsFunction(this, 'RecordingEnded', {
  // ... other props ...
  tracing: lambda.Tracing.ACTIVE,
  // CDK auto-adds xray:PutTraceSegments + xray:PutTelemetryRecords to execution role
});
```

---

## Current State Audit (Per-Handler Analysis)

### recording-ended.ts
- **SDK clients inside processEvent:** `MediaConvertClient` (line 109, 324), `DynamoDBDocumentClient` via dynamic import (line 417)
- **Uses `getDocumentClient()`:** Yes — shared factory. Must wrap the underlying `DynamoDBClient` before passing to factory, OR replace with module-scope wrapped client.
- **Dynamic imports to fix:** `await import('@aws-sdk/lib-dynamodb')` at line 417 — replace with static import
- **Logger:** Powertools Logger already in use — `pipelineStage` already set as persistent key
- **Tracer:** Not present — add `Tracer` import and module-scope initialization
- **SQS handler:** Yes — use per-record subsegment pattern

### transcode-completed.ts
- **SDK clients inside processEvent:** `TranscribeClient` (line 82)
- **Logger:** Powertools Logger, `pipelineStage: 'transcode-completed'` already set
- **Tracer:** Not present
- **SQS handler:** Yes — use per-record subsegment pattern

### transcribe-completed.ts
- **SDK clients inside processEvent:** `S3Client` (line 165), `EventBridgeClient` (line 215, 253)
- **Logger:** Powertools Logger, `pipelineStage: 'transcribe-completed'` already set
- **Tracer:** Not present
- **SQS handler:** Yes — use per-record subsegment pattern

### store-summary.ts
- **SDK clients inside processEvent:** `S3Client` (line 37), `BedrockRuntimeClient` (line 38)
- **Note:** These are constructed inside `processEvent` but assigned to local consts — must move to module scope
- **Logger:** Powertools Logger, `pipelineStage: 'store-summary'` already set
- **Tracer:** Not present
- **SQS handler:** Yes — use per-record subsegment pattern

### on-mediaconvert-complete.ts
- **SDK clients inside handler:** `EventBridgeClient` (line 65)
- **Logger:** Uses `console.log` — consider migrating to Powertools Logger as part of this phase (same file touch)
- **Tracer:** Not present
- **SQS handler:** No — direct EventBridge invocation; use manual segment wrap on handler body

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `captureAWS()` / `captureAWSClient()` | `captureAWSv3Client()` | Powertools v2 / AWS SDK v3 migration | v2 SDK methods deprecated; v3 method is the only correct one for SDK v3 clients |
| `captureLambdaHandler` decorator for all handlers | Manual subsegments for SQS/batch handlers | When SQS event sources became common | Decorator wraps handler-level only; batch records need per-record subsegments |
| `aws.ivs` EventBridge → Lambda direct invocation | EventBridge → SQS → Lambda (v1.6 Phase 31) | v1.6 milestone | SQS→Lambda trace linking works at message level; however EventBridge producer does not inject `AWSTraceHeader` so cross-stage linking remains disconnected |

**Deprecated/outdated:**
- `captureAWS()`: Deprecated in Powertools v2, targets SDK v2 — do not use.
- `captureAWSClient()`: Deprecated in Powertools v2 — do not use.

---

## Open Questions

1. **`getDocumentClient()` wrapping approach**
   - What we know: `recording-ended.ts` calls `getDocumentClient()` from `../lib/dynamodb-client` — a shared factory function used across many handlers.
   - What's unclear: Whether the factory exposes the underlying `DynamoDBClient` for wrapping, or whether the caller must construct the wrapped client separately.
   - Recommendation: Read `backend/src/lib/dynamodb-client.ts` before planning task 36-01. If the factory constructs a new client each call, refactor `recording-ended.ts` to construct its own module-scope wrapped client directly. Do not modify the shared factory (other handlers may not want tracing).

2. **`on-mediaconvert-complete` Logger migration**
   - What we know: This handler uses `console.log` throughout while all other pipeline handlers use Powertools Logger.
   - What's unclear: Whether this was intentional (simpler EventBridge handler) or an oversight.
   - Recommendation: Migrate to Powertools Logger in the same file touch, setting `pipelineStage: 'on-mediaconvert-complete'` as a persistent key. This is low-risk and improves consistency without scope creep.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30 + ts-jest |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd backend && npm test -- --testPathPattern recording-ended` |
| Full suite command | `cd backend && npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACE-01 | CDK produces Lambda with active tracing property set | infrastructure (CDK synth inspection) | manual CDK synth + console verify | ❌ Wave 0 |
| TRACE-02 | SDK clients wrapped at module scope — calls produce subsegments | unit (mock tracer + verify captureAWSv3Client called) | `cd backend && npm test -- --testPathPattern recording-ended` | ✅ (extend existing) |
| TRACE-03 | `putAnnotation` called with sessionId and pipelineStage | unit (mock tracer + verify putAnnotation args) | `cd backend && npm test -- --testPathPattern recording-ended\|transcode\|transcribe\|store-summary` | ✅ (extend existing) |
| TRACE-04 | Service map shows all 5 nodes | manual | Open X-Ray console after triggering recording | N/A manual-only |

**Manual-only justification for TRACE-01 and TRACE-04:** Active tracing configuration and service map visibility require a real AWS deployment. CDK unit tests (synth) can verify the property is set, but trace emission requires the Lambda daemon.

### Sampling Rate
- **Per task commit:** `cd backend && npm test -- --testPathPattern recording-ended|transcode|transcribe|store-summary|on-mediaconvert`
- **Per wave merge:** `cd backend && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/handlers/__tests__/recording-ended.test.ts` — extend to mock `Tracer` and assert `captureAWSv3Client` called for `MediaConvertClient` and `DynamoDBClient`; assert `putAnnotation` called with `sessionId` and `pipelineStage`
- [ ] `backend/src/handlers/__tests__/transcode-completed.test.ts` — extend to mock `Tracer`, assert `captureAWSv3Client` for `TranscribeClient`, assert `putAnnotation`
- [ ] `backend/src/handlers/__tests__/transcribe-completed.test.ts` — extend to mock `Tracer`, assert `captureAWSv3Client` for `S3Client` and `EventBridgeClient`, assert `putAnnotation`
- [ ] `backend/src/handlers/__tests__/store-summary.test.ts` — extend to mock `Tracer`, assert `captureAWSv3Client` for `S3Client` and `BedrockRuntimeClient`, assert `putAnnotation`
- [ ] `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` — extend to mock `Tracer`, assert `captureAWSv3Client` for `EventBridgeClient`, assert `putAnnotation`

*(All 5 test files exist — tests need new assertions added, not created from scratch.)*

---

## Sources

### Primary (HIGH confidence)
- [Tracer | Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) — captureAWSv3Client, putAnnotation, manual subsegments, module scope requirement
- [NodejsFunction CDK API docs](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html) — `tracing: lambda.Tracing.ACTIVE` property
- [Amazon SQS and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html) — trace linking for SQS→Lambda, non-Lambda consumers require manual propagation
- [Visualize Lambda function invocations using AWS X-Ray](https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html) — IAM permissions auto-granted by CDK, two nodes per trace

### Secondary (MEDIUM confidence)
- [EventBridge not propagating X-Ray trace header to SQS target (AWS re:Post)](https://repost.aws/questions/QUdDxf9nE6TJOLvw3a7-FEsA/eventbridge-not-propagating-x-ray-trace-header-to-sqs-target) — community confirmation that EventBridge→SQS does not propagate `AWSTraceHeader`
- [AWS X-Ray trace linking announcement (November 2022)](https://aws.amazon.com/about-aws/whats-new/2022/11/aws-x-ray-trace-linking-event-driven-applications-amazon-sqs-lambda/) — SQS→Lambda trace linking is automatic when producer injects header

### Tertiary (LOW confidence — corroborated by official sources above)
- STATE.md `## Accumulated Context` — pre-recorded pitfalls for this phase; consistent with official docs findings

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Powertools Tracer already installed; CDK property well-documented
- Architecture: HIGH — Official Powertools docs provide exact patterns; codebase read for per-handler specifics
- Pitfalls: HIGH — CDK tracing gap and client scope issues confirmed by official docs + STATE.md prior research; EventBridge→SQS trace context limitation confirmed by AWS docs and community

**Research date:** 2026-03-12
**Valid until:** 2026-09-12 (stable AWS services; Powertools API unlikely to change)
