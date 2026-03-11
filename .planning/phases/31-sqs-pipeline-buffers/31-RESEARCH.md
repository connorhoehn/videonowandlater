# Phase 31: SQS Pipeline Buffers - Research

**Researched:** 2026-03-11
**Domain:** AWS CDK v2 — EventBridge→SQS→Lambda event source mappings, SQS queue configuration, DLQ wiring
**Confidence:** HIGH

## Summary

Phase 31 replaces the brittle EventBridge→Lambda direct invocation pattern with EventBridge→SQS→Lambda for the five critical pipeline handlers. The current `session-stack.ts` already imports `sqs` from `aws-cdk-lib` and has one shared `recordingEventsDlq` that catches EventBridge delivery failures. The new pattern introduces five dedicated SQS queues (one per handler) as the actual message path, not just a delivery fallback. Each queue gets its own per-handler DLQ.

The SQS event source mapping approach (`SqsEventSource` from `aws-cdk-lib/aws-lambda-event-sources`) is the standard CDK pattern. The Lambda polls its queue; EventBridge no longer invokes Lambda directly. The key mechanical change in CDK is: rule target changes from `targets.LambdaFunction(fn)` to `targets.SqsQueue(queue)`, and the Lambda gets `fn.addEventSource(new SqsEventSource(queue, { batchSize: 1, ... }))`.

The most important pre-implementation insight is that `recording-ended` is targeted by **three** separate EventBridge rules (IVS Recording End, IVS Stage Recording End, Recording Recovery). All three must route to the **same** SQS queue — that queue becomes the single subscriber for all three rules. This is safe with SQS because messages are processed sequentially per session (batch size 1) and there is no ordering guarantee needed at the queue level.

**Primary recommendation:** Use CDK `SqsEventSource` with `batchSize: 1`, `bisectBatchOnFunctionError: true`, and `reportBatchItemFailures: true` for all five handlers. Visibility timeout = 6× the Lambda function timeout. Each queue gets a dedicated DLQ with `maxReceiveCount: 3` and 14-day retention.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DUR-01 | Add SQS standard queue as EventBridge target (instead of Lambda direct) for all 5 critical pipeline handlers | SqsQueue target pattern in CDK; confirmed `targets.SqsQueue` accepts queue and optional message group / dead letter config |
| DUR-02 | Lambda SQS event source mappings (batch size 1); remove direct EventBridge→Lambda permissions for these handlers | `SqsEventSource` with `batchSize: 1`; existing `addPermission` calls for these handlers must be removed |
| DUR-03 | Each pipeline SQS queue has a DLQ with 14-day retention and maxReceiveCount=3 | Standard CDK `Queue` with `deadLetterQueue: { queue: dlq, maxReceiveCount: 3 }` |
| DUR-04 | Visibility timeout = 6× Lambda function timeout | Formula per handler documented below; CDK `visibilityTimeout: Duration.seconds(6 * lambdaTimeoutSeconds)` |
| DUR-05 | EventBridge rules grant sqs:SendMessage to each pipeline queue; existing DLQs for direct invocation replaced or repurposed | Queue resource policy via `queue.addToResourcePolicy()` with `events.amazonaws.com` principal and per-rule ArnLike condition |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `aws-cdk-lib/aws-sqs` | ^2.170.0 (already in infra/package.json) | SQS queue and DLQ constructs | Already imported and used in session-stack.ts (line 13) |
| `aws-cdk-lib/aws-lambda-event-sources` | ^2.170.0 (bundled with aws-cdk-lib) | `SqsEventSource` to wire Lambda ← SQS polling | The canonical CDK construct for SQS-triggered Lambda |
| `aws-cdk-lib/aws-events-targets` | ^2.170.0 (already imported as `targets`) | `targets.SqsQueue` to replace `targets.LambdaFunction` as EB rule target | Same module already used in session-stack.ts |
| `aws-cdk-lib/aws-iam` | ^2.170.0 (already imported) | Queue resource policy for EventBridge SendMessage grant | Same module already used |

### No New Dependencies Required
All required CDK modules are already part of `aws-cdk-lib ^2.170.0`. The only new import needed is:
```typescript
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
```

**Installation:** No new packages needed. `aws-cdk-lib/aws-lambda-event-sources` is part of the monolithic `aws-cdk-lib` package already in `infra/package.json`.

---

## Architecture Patterns

### New Pattern: EventBridge → SQS → Lambda

```
EventBridge Rule  ──sqs:SendMessage──►  SQS Queue  ──event source mapping──►  Lambda
                                              │
                                              │ (on maxReceiveCount exceeded)
                                              ▼
                                          SQS DLQ (14-day retention)
```

The old pattern:
```
EventBridge Rule  ──InvokeFunction──►  Lambda
                       │
                       │ (on delivery failure)
                       ▼
                  recordingEventsDlq (shared)
```

### Pattern 1: Queue + DLQ Construction

```typescript
// Source: aws-cdk-lib/aws-sqs CDK documentation
const recordingEndedDlq = new sqs.Queue(this, 'RecordingEndedDlq', {
  queueName: 'vnl-recording-ended-dlq',
  retentionPeriod: Duration.days(14),
  removalPolicy: RemovalPolicy.DESTROY,
});

const recordingEndedQueue = new sqs.Queue(this, 'RecordingEndedQueue', {
  queueName: 'vnl-recording-ended',
  visibilityTimeout: Duration.seconds(6 * 30), // 6× Lambda timeout (30s)
  deadLetterQueue: {
    queue: recordingEndedDlq,
    maxReceiveCount: 3,
  },
  retentionPeriod: Duration.days(4),  // standard; messages process quickly
  removalPolicy: RemovalPolicy.DESTROY,
});
```

### Pattern 2: EventBridge Rule Target → SQS

```typescript
// Source: aws-cdk-lib/aws-events-targets SqsQueue
// Replace: this.recordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn, {...}))
// With:
this.recordingEndRule.addTarget(new targets.SqsQueue(recordingEndedQueue));
```

`targets.SqsQueue` automatically adds the necessary `sqs:SendMessage` resource policy to the queue for the EventBridge service principal, scoped to the rule ARN. However, the explicit `addToResourcePolicy` grant is also acceptable and preferred when multiple rules share one queue (see DUR-05 section).

### Pattern 3: SQS Event Source on Lambda

```typescript
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

// Add AFTER queue construction, AFTER Lambda construction
recordingEndedFn.addEventSource(new SqsEventSource(recordingEndedQueue, {
  batchSize: 1,
  bisectBatchOnFunctionError: true,  // on error, bisect batch to isolate bad message
  reportBatchItemFailures: true,     // partial batch response support
}));
```

### Pattern 4: Multiple EventBridge Rules → One SQS Queue

`recording-ended` is the one handler targeted by THREE rules. All three must send to the same queue:

```typescript
// All three rules target the same queue
this.recordingEndRule.addTarget(new targets.SqsQueue(recordingEndedQueue));
stageRecordingEndRule.addTarget(new targets.SqsQueue(recordingEndedQueue));
recordingRecoveryRule.addTarget(new targets.SqsQueue(recordingEndedQueue));

// SQS resource policy must allow ALL three rule ARNs
recordingEndedQueue.addToResourcePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  principals: [new iam.ServicePrincipal('events.amazonaws.com')],
  actions: ['sqs:SendMessage'],
  resources: [recordingEndedQueue.queueArn],
  conditions: {
    ArnLike: {
      'aws:SourceArn': [
        this.recordingEndRule.ruleArn,
        stageRecordingEndRule.ruleArn,
        recordingRecoveryRule.ruleArn,
      ],
    },
  },
}));
```

Note: `targets.SqsQueue` automatically adds a single-rule `sqs:SendMessage` policy. When three rules share one queue, you should either:
- Use the explicit `addToResourcePolicy` above (covers all three in one statement), OR
- Use `targets.SqsQueue` for each rule (CDK will add three separate policy statements — all valid)

The explicit single-statement approach is cleaner.

### Pattern 5: Remove Direct EventBridge → Lambda Permissions

For each of the 5 handlers, the existing `addPermission` calls must be **removed**:

```typescript
// REMOVE these (no longer needed — EventBridge targets SQS, not Lambda):
recordingEndedFn.addPermission('AllowEBRecordingEndInvoke', {...});
recordingEndedFn.addPermission('AllowEBStageRecordingEndInvoke', {...});
recordingEndedFn.addPermission('AllowEBRecoveryInvoke', {...});
transcodeCompletedFn.addPermission('AllowEBTranscodeCompletedInvoke', {...});
transcribeCompletedFn.addPermission('AllowEBTranscribeCompletedInvoke', {...});
storeSummaryFn.addPermission('AllowEBTranscriptStoreInvoke', {...});
// (startTranscribeFn has no explicit addPermission call currently)
```

### Pattern 6: Handler Event Type Change (SQS wrapper)

When a Lambda is triggered via SQS event source mapping, the Lambda receives an `SQSEvent`, not the raw EventBridge event. The SQS message body contains the original EventBridge event as a JSON string.

**This is the most critical handler change.** Each handler currently expects `EventBridgeEvent<...>` as its top-level argument. With SQS, the handler receives `SQSEvent` and must parse the EventBridge payload from `event.Records[0].body`.

```typescript
// Current handler signature (EventBridge direct):
export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => { ... }

// New handler signature (SQS-triggered):
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;
      await processEvent(ebEvent);  // extract existing logic into processEvent()
    } catch (err) {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
};
```

With `batchSize: 1`, `event.Records` always has exactly one item. However, using the `SQSBatchResponse` return type with `reportBatchItemFailures: true` is the correct pattern — it explicitly tells SQS which messages failed (enabling DLQ routing) rather than relying on Lambda throwing.

### Recommended Project Structure

No new directories needed. All changes are in:
```
infra/lib/stacks/
└── session-stack.ts       # CDK: queue/DLQ creation, rule target changes, event source adds
backend/src/handlers/
├── recording-ended.ts     # Handler: SQSEvent wrapper, extract EB event from record.body
├── transcode-completed.ts # Handler: SQSEvent wrapper
├── transcribe-completed.ts # Handler: SQSEvent wrapper
├── store-summary.ts       # Handler: SQSEvent wrapper
└── start-transcribe.ts    # Handler: SQSEvent wrapper
```

### Anti-Patterns to Avoid

- **Shared queue for multiple handlers:** Give each handler its own queue. Mixing messages from different pipeline stages in one queue makes DLQ inspection impossible and creates processing dependencies.
- **Using `targets.LambdaFunction` with `deadLetterQueue` for the pipeline handlers:** This is the OLD pattern. The DLQ on `LambdaFunction` target only captures EventBridge delivery failures, not Lambda execution failures. SQS-based retries cover both.
- **Forgetting the SQS resource policy:** `targets.SqsQueue` adds a policy statement automatically, but it only covers the single rule it's called from. For `recording-ended` with 3 rules, an explicit multi-rule policy is needed.
- **Not removing old `addPermission` calls:** Leaving stale direct invoke permissions is harmless but creates false signals that EventBridge still invokes Lambda directly.
- **Keeping `retryAttempts: 2` on old targets:** When replacing targets, the old `deadLetterQueue`/`retryAttempts` config on the old `targets.LambdaFunction` must be removed — they are irrelevant once the target is SQS.
- **Setting visibility timeout equal to Lambda timeout:** Must be 6× the timeout per DUR-04 and AWS best practice. If Lambda takes 30s but visibility is 30s, SQS re-delivers the message before Lambda finishes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQS→Lambda polling | Manual SQS polling in Lambda code | `SqsEventSource` CDK construct | Handles long polling, concurrency scaling, partial batch failures, error backoff automatically |
| EventBridge→SQS auth | Manual IAM role/assume-role chain | `targets.SqsQueue` + explicit `addToResourcePolicy` | CDK handles the service principal policy; no cross-account role needed |
| Message deserialization | Custom JSON envelope parsing | Standard `JSON.parse(record.body)` | EventBridge wraps the event in SQS message body as-is; straightforward parse |
| Partial batch failure tracking | Try/catch and manual re-queue | `SQSBatchResponse` with `batchItemFailures` | Native SQS partial batch response — SQS only retries failed records |

**Key insight:** SQS event source mappings handle all the complexity of reliable Lambda invocation. The handler only needs to: (1) parse the SQS record body as an EventBridge event, (2) process it, (3) return `batchItemFailures` for any records that failed.

---

## Common Pitfalls

### Pitfall 1: Handler Receives SQSEvent, Not EventBridgeEvent
**What goes wrong:** Handler code tries to access `event.detail`, `event.source`, `event.resources` directly but receives `event.Records[0].body` as a JSON string.
**Why it happens:** When EventBridge targets SQS, the EventBridge event becomes the message body. The Lambda receives an `SQSEvent` envelope around it.
**How to avoid:** Parse the EventBridge event: `const ebEvent = JSON.parse(record.body)`. Use `SQSEvent` as the handler parameter type, not `EventBridgeEvent`.
**Warning signs:** TypeScript errors on `event.detail`, `event.source`, or `event.resources` after changing to SQS-triggered.

### Pitfall 2: Visibility Timeout Too Short Causes Duplicate Processing
**What goes wrong:** SQS re-delivers a message while Lambda is still processing it. Two Lambda invocations process the same event simultaneously.
**Why it happens:** Default SQS visibility timeout is 30 seconds. If Lambda timeout is also 30 seconds, SQS may re-deliver at second 29 while Lambda is still running.
**How to avoid:** Set `visibilityTimeout = Duration.seconds(6 * lambdaTimeoutSeconds)` on the queue. For 30s Lambda timeout → 180s visibility. For 60s Lambda timeout → 360s visibility.
**Warning signs:** DynamoDB conditional check failures from simultaneous writes, duplicate MediaConvert/Transcribe job submissions.

### Pitfall 3: recordingEventsDlq Resource Policy Covers Non-Existent Targets
**What goes wrong:** After the migration, the existing `recordingEventsDlq.addToResourcePolicy()` call still lists the old rule ARNs that no longer target Lambda directly. This is harmless but creates confusion.
**Why it happens:** The DLQ policy lists `transcodeCompletedRule.ruleArn` and `transcribeCompletedRule.ruleArn` as sources. After migration, these rules target SQS queues (not Lambda), so EventBridge will never write to this DLQ from those rules.
**How to avoid:** In Phase 31, remove the old multi-rule policy statement from `recordingEventsDlq` or update it to only cover the rules that still target Lambda (e.g., `recordingStartRule` / `recordingStartedFn` which is NOT being migrated).
**Warning signs:** Policy statement references rule ARNs that no longer send to the queue.

### Pitfall 4: transcribeCompletedRule Matches ALL Transcribe Jobs in the Account
**What goes wrong:** The `transcribeCompletedRule` has no `TranscriptionJobName` filter — it fires for every Transcribe job in the account. With SQS, every job completion for any purpose in the AWS account will enqueue a message to `vnl-transcribe-completed-queue`.
**Why it happens:** This was already true with the direct invoke pattern. It is tolerable because `transcribe-completed.ts` parses the job name and skips non-`vnl-` prefixed jobs.
**How to avoid:** No action needed for Phase 31 (same behavior as before). Note for future: add a job-name prefix filter to the rule to limit noise.
**Warning signs:** High `ApproximateNumberOfMessagesVisible` on the transcribe-completed queue from non-VNL Transcribe jobs.

### Pitfall 5: on-mediaconvert-complete.ts Uses Same MediaConvert Rule Filter as transcode-completed.ts
**What goes wrong:** Both `transcodeCompletedRule` and `mediaConvertCompleteRule` in the current CDK use identical filters (`source: aws.mediaconvert`, `phase: 19-transcription`). Both fire for the same MediaConvert job completion events.
**Why it happens:** This is the existing architecture — `transcode-completed` handles the recording pipeline, `on-mediaconvert-complete` handles the upload pipeline. They currently both match `phase: 19-transcription`. The two handlers are designed to be idempotent/complementary, not redundant. Phase 31 only adds SQS buffering to `transcode-completed`; `on-mediaconvert-complete` stays on direct EventBridge→Lambda per the requirements.
**How to avoid:** Do NOT add SQS buffering to `on-mediaconvert-complete.ts` in Phase 31 (only the 5 handlers in DUR-01 are in scope). Phase 32 (HARD-03) addresses `on-mediaconvert-complete` separately.
**Warning signs:** Confusion when reviewing CDK — two rules matching the same event pattern is intentional.

### Pitfall 6: SQS Queue Policy Required Before Deployment
**What goes wrong:** `cdk deploy` fails with "Resource handler returned message: Error: Queue policy must include sqs:SendMessage permission for EventBridge service principal".
**Why it happens:** When `targets.SqsQueue` is used, CDK auto-adds the policy. But if you manually create the queue and then add rules, the policy statement must be explicitly attached via `addToResourcePolicy` before the rule is created (or in the same synth cycle).
**How to avoid:** Either use `targets.SqsQueue` (auto-policy) OR use explicit `addToResourcePolicy`. Do not mix — don't use `targets.SqsQueue` AND manually add a policy (will create a duplicate policy statement, which is harmless but noisy).
**Warning signs:** CloudFormation deployment error referencing SQS resource policy on first deploy.

---

## Code Examples

### Complete Queue Pair Construction

```typescript
// Source: aws-cdk-lib/aws-sqs documentation pattern
function makePipelineQueue(
  scope: Construct,
  id: string,
  queueName: string,
  lambdaTimeoutSeconds: number
): { queue: sqs.Queue; dlq: sqs.Queue } {
  const dlq = new sqs.Queue(scope, `${id}Dlq`, {
    queueName: `vnl-${queueName}-dlq`,
    retentionPeriod: Duration.days(14),
    removalPolicy: RemovalPolicy.DESTROY,
  });

  const queue = new sqs.Queue(scope, `${id}Queue`, {
    queueName: `vnl-${queueName}`,
    visibilityTimeout: Duration.seconds(6 * lambdaTimeoutSeconds),
    deadLetterQueue: {
      queue: dlq,
      maxReceiveCount: 3,
    },
    removalPolicy: RemovalPolicy.DESTROY,
  });

  return { queue, dlq };
}
```

### SQS Handler Wrapper Pattern

```typescript
// Source: aws-lambda TypeScript types (SQSEvent, SQSBatchResponse)
import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';

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

### EventBridge Rule to SQS Target

```typescript
// Source: aws-cdk-lib/aws-events-targets SqsQueue
import * as targets from 'aws-cdk-lib/aws-events-targets';

// Old (remove):
rule.addTarget(new targets.LambdaFunction(fn, { deadLetterQueue, retryAttempts: 2 }));

// New (add):
rule.addTarget(new targets.SqsQueue(queue));
// Note: targets.SqsQueue auto-adds sqs:SendMessage policy scoped to this rule's ARN
```

### SqsEventSource on Lambda

```typescript
// Source: aws-cdk-lib/aws-lambda-event-sources SqsEventSource
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

fn.addEventSource(new SqsEventSource(queue, {
  batchSize: 1,
  bisectBatchOnFunctionError: true,
  reportBatchItemFailures: true,
}));
```

---

## Handler-by-Handler Visibility Timeout Table

| Handler | Lambda Timeout (CDK) | Visibility Timeout (6×) | Queue Name |
|---------|---------------------|------------------------|------------|
| `recording-ended` | 30s | 180s (3 min) | `vnl-recording-ended` |
| `transcode-completed` | 30s | 180s (3 min) | `vnl-transcode-completed` |
| `transcribe-completed` | 30s | 180s (3 min) | `vnl-transcribe-completed` |
| `store-summary` | 60s | 360s (6 min) | `vnl-store-summary` |
| `start-transcribe` | 30s | 180s (3 min) | `vnl-start-transcribe` |

Lambda timeouts verified from `session-stack.ts`:
- `recordingEndedFn`: `Duration.seconds(30)`
- `transcodeCompletedFn`: `Duration.seconds(30)`
- `transcribeCompletedFn`: `Duration.seconds(30)`
- `storeSummaryFn`: `Duration.seconds(60)` — Bedrock latency buffer
- `startTranscribeFn`: `Duration.seconds(30)`

---

## EventBridge Rules Currently Targeting Each Handler

| Handler | EventBridge Rules (current) | Source Events |
|---------|----------------------------|---------------|
| `recording-ended` | `recordingEndRule`, `stageRecordingEndRule`, `recordingRecoveryRule` | `aws.ivs` Recording End, `aws.ivs` Participant Recording End, `custom.vnl` Recording Recovery |
| `transcode-completed` | `transcodeCompletedRule` | `aws.mediaconvert` COMPLETE/ERROR/CANCELED with `phase: 19-transcription` |
| `transcribe-completed` | `transcribeCompletedRule` | `aws.transcribe` COMPLETED/FAILED |
| `store-summary` | `transcriptStoreRule` | `custom.vnl` Transcript Stored |
| `start-transcribe` | `uploadRecordingAvailableRule` | `vnl.upload` Upload Recording Available |

**Key implication:** `recording-ended` queue must accept messages from 3 rules. The `addToResourcePolicy` for that queue must include all 3 rule ARNs.

---

## Handlers NOT Being Changed

| Handler | Current Trigger | Reason to Leave Unchanged |
|---------|----------------|--------------------------|
| `start-mediaconvert` | SNS → Lambda | SNS has built-in at-least-once delivery with retry and DLQ support. Already durable. Out of scope for Phase 31. |
| `on-mediaconvert-complete` | EventBridge → Lambda (direct) | Phase 32 scope (HARD-03 handles its throw behavior). Phase 31 DUR-01 explicitly lists only the 5 handlers above. |
| `stream-started` | EventBridge → Lambda (direct) | Not a pipeline handler — transitions session to LIVE. Not in scope. |
| `stream-ended` | EventBridge → Lambda (direct) | Not a pipeline handler — transitions session to ENDING. Not in scope. |
| `recording-started` | EventBridge → Lambda (direct) | Not a pipeline handler — records recording start event. Not in scope. |
| `ivs-event-audit` | EventBridge → Lambda (direct) | Audit/observability only; event loss is acceptable. Not in scope. |
| `scan-stuck-sessions` | EventBridge Scheduler → Lambda | Scheduled cron; scheduler has retry semantics. Not in scope. |
| `replenish-pool` | EventBridge Schedule → Lambda | Pool maintenance; not a pipeline handler. Not in scope. |

---

## recordingEventsDlq Disposition

The existing `recordingEventsDlq` (named `vnl-recording-events-dlq`) was a shared DLQ for EventBridge delivery failures across all pipeline handlers. After Phase 31:

- The multi-rule resource policy on `recordingEventsDlq` will reference rules that no longer send to it.
- The handlers that DO continue with direct EventBridge→Lambda (`recording-started` via `recordingStartRule`) still reference this DLQ via `targets.LambdaFunction(..., { deadLetterQueue: recordingEventsDlq })`.
- **Recommended approach:** Keep `recordingEventsDlq` for the non-migrated handlers (recording-started). Remove the policy statement entries for the 5 migrated rules. Update the resource policy to only cover `recordingStartRule` (and any other non-migrated rules that use it).
- The 5 new per-handler DLQs fully replace the DLQ function for the migrated handlers.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventBridge → Lambda (fire and forget) | EventBridge → SQS → Lambda | Phase 31 | At-least-once delivery; retries on Lambda failure, not just delivery failure |
| Single shared DLQ for all pipeline rules | Per-handler DLQ | Phase 31 | DLQ messages are attributable to specific handler; easier triage |
| EventBridge retry (2 attempts, ~18min window) | SQS retry (3 attempts via maxReceiveCount, visibility-timeout-gated) | Phase 31 | Retries happen faster (minutes, not hours); Lambda failures are retried |
| `EventBridgeEvent` as Lambda parameter type | `SQSEvent` with EventBridge payload in `record.body` | Phase 31 | Handler must parse `record.body` to get EventBridge event |

---

## Open Questions

1. **`targets.SqsQueue` auto-policy vs explicit `addToResourcePolicy`**
   - What we know: `targets.SqsQueue` adds a `sqs:SendMessage` policy scoped to the specific rule ARN automatically. For single-rule-to-queue relationships, this is sufficient.
   - What's unclear: When 3 rules target the same queue via 3 separate `addTarget` calls using `targets.SqsQueue`, CDK will add 3 separate policy statements. This is valid but verbose.
   - Recommendation: For `recording-ended` queue (3 rules), use explicit `addToResourcePolicy` with all 3 ARNs in one condition. For the other 4 queues (1 rule each), `targets.SqsQueue` auto-policy is fine.

2. **SQS encryption (SSE)**
   - What we know: SQS standard queues support SSE with KMS or SSE-SQS. The existing queues in session-stack.ts do not use explicit encryption.
   - What's unclear: Whether a project security policy requires SSE on queues.
   - Recommendation: Use SQS-managed SSE (`encryption: sqs.QueueEncryption.SQS_MANAGED`) for the new queues for consistency with security posture. Confirm with CLAUDE.md — no explicit policy found since CLAUDE.md did not exist.

3. **Handler `processEvent` refactoring scope**
   - What we know: Each handler must be refactored from `(event: EventBridgeEvent)` to `(event: SQSEvent)` with a body-parse wrapper.
   - What's unclear: Whether the inner logic should be extracted into a separate `processEvent(ebEvent)` function or inlined.
   - Recommendation: Extract to `processEvent` for testability. Existing tests mock the EventBridge event — a `processEvent` function export lets tests call it directly without constructing an SQSEvent wrapper.

---

## Sources

### Primary (HIGH confidence)
- `infra/lib/stacks/session-stack.ts` — current CDK architecture, all existing rules, Lambda timeouts, existing DLQ, existing SQS imports
- `backend/src/handlers/recording-ended.ts` — handler timeout behavior, multiple rule triggers, recovery event path
- `backend/src/handlers/transcode-completed.ts`, `transcribe-completed.ts`, `store-summary.ts`, `start-transcribe.ts` — handler timeouts, event shapes, error handling patterns
- `backend/src/handlers/on-mediaconvert-complete.ts` — confirmed this handler is NOT in scope (upload-only, EventBridge → Lambda directly)
- `.planning/REQUIREMENTS.md` — DUR-01 through DUR-05 exact requirements
- `.planning/ROADMAP.md` — Phase 31 success criteria

### Secondary (MEDIUM confidence)
- CDK documentation patterns for `SqsEventSource`, `targets.SqsQueue` — well-established patterns in CDK v2 since v2.0; confirmed present in `aws-cdk-lib ^2.170.0`
- AWS documentation: SQS visibility timeout = 6× Lambda timeout recommendation — standard AWS best practice documented in Lambda+SQS integration guides

### Tertiary (LOW confidence)
- None — all critical claims are grounded in the actual codebase or well-established CDK patterns.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already present in aws-cdk-lib ^2.170.0; no new installs needed
- Architecture: HIGH — patterns derived from direct inspection of session-stack.ts and all 5 handler files
- Pitfalls: HIGH — pitfall 1 (SQSEvent vs EventBridgeEvent) is the most critical and is a factual consequence of the SQS event source mapping design; others derived from code inspection
- Handler timeout values: HIGH — verified from CDK construct definitions in session-stack.ts
- Rule→handler mapping: HIGH — verified from CDK rule target definitions in session-stack.ts

**Research date:** 2026-03-11
**Valid until:** 2026-06-11 (CDK v2 SQS/Lambda event source mapping APIs are very stable)
