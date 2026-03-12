# Phase 37: Event Schema Validation - Research

**Researched:** 2026-03-12
**Domain:** Event validation, error handling, AWS Lambda SQS/EventBridge integration
**Confidence:** HIGH

## Summary

Phase 37 hardens all 5 SQS-wrapped pipeline handlers (recording-ended, transcode-completed, on-mediaconvert-complete, transcribe-completed, store-summary) with boundary validation using Zod schemas. The phase addresses two critical bugs: (1) malformed events bypass validation and cause side effects or silent failures, and (2) start-transcribe swallows transient Transcribe API errors instead of retrying them via SQS. Validation failures route to DLQ without triggering retries. Structured logging captures validation errors for debugging.

**Primary recommendation:** Install Zod, define discriminated union schemas for each handler's EventBridge event types, apply `z.safeParse()` at the SQS record boundary, and rethrow transient errors while acknowledging permanent failures.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VALID-01 | All 5 pipeline handlers validate required event fields with Zod at the start of processEvent() before any side effects | Zod discriminated unions for event type validation; manual parsing pattern for SQS→EventBridge event extraction |
| VALID-02 | Schema validation failures route the event to DLQ (via batchItemFailures) without triggering SQS retries | SQS batchItemFailures acknowledges failed messages; failed item is moved to DLQ on maxReceiveCount exhaustion |
| VALID-03 | start-transcribe error handling fixed — transient Transcribe API errors throw and trigger SQS retry instead of being silently swallowed | AWS Transcribe ThrottlingException and ServiceUnavailableException must be distinguished from permanent failures (missing sessionId) and rethrown |
| VALID-04 | Validation failures log structured error details (field name, received value, handler name) via Powertools Logger | Powertools Logger with appendPersistentKeys for sessionId; structured object logging captures validation context |

## User Constraints

None — phase is fully planned and constrained by requirements.md.

## Standard Stack

### Core Validation
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^3.23 | Schema declaration and validation with type inference | TypeScript-first validation; discriminated unions for multi-type events; no runtime dependencies |
| @aws-lambda-powertools/logger | ^2.31.0 | Structured logging with persistent keys | Already in project; provides context injection for sessionId across log lines |

### Installation
```bash
npm install zod@^3.23
```

Note: Zod is NOT in backend/package.json yet. Add to dependencies section.

## Architecture Patterns

### Recommended Project Structure

Validation schemas should be colocated with handlers for clarity:

```
src/handlers/
├── schemas/
│   ├── recording-ended.schema.ts
│   ├── on-mediaconvert-complete.schema.ts
│   ├── transcribe-completed.schema.ts
│   ├── start-transcribe.schema.ts
│   ├── transcode-completed.schema.ts
│   └── index.ts                          # Re-exports all schemas
└── [handlers...]
```

### Pattern 1: Discriminated Union for Multi-Source Events

**What:** recording-ended receives events from two sources (IVS Low-Latency broadcast OR IVS RealTime Stage hangout), plus recovery events from scan-stuck-sessions. Use `z.discriminatedUnion` to type-safely handle all three shapes.

**When to use:** Events with a discriminator field (like `event_name` or `recoveryAttempt`) that determine the event shape.

**Example:**
```typescript
// Source: Zod documentation (zod.dev/api) + project pattern from STATE.md
const BroadcastRecordingEndSchema = z.object({
  channel_name: z.string(),
  stream_id: z.string(),
  recording_status: z.enum(['Recording End', 'Recording End Failure']),
  recording_s3_bucket_name: z.string(),
  recording_s3_key_prefix: z.string(),
  recording_duration_ms: z.number().positive(),
});

const StageParticipantRecordingEndSchema = z.object({
  session_id: z.string().uuid(),
  event_name: z.literal('Recording End'),
  participant_id: z.string(),
  recording_s3_bucket_name: z.string(),
  recording_s3_key_prefix: z.string(),
  recording_duration_ms: z.number().positive(),
});

const RecoveryEventSchema = z.object({
  recoveryAttempt: z.literal(true),
  sessionId: z.string().uuid(),
  recoveryAttemptCount: z.number().nonnegative(),
});

// Discriminated union: pick the schema based on presence of discriminator
const RecordingEndedDetailSchema = z.discriminatedUnion('event_name', [
  BroadcastRecordingEndSchema.extend({ event_name: z.undefined() }),
  StageParticipantRecordingEndSchema,
]).or(RecoveryEventSchema.extend({ event_name: z.undefined() }));

type RecordingEndedDetail = z.infer<typeof RecordingEndedDetailSchema>;
```

### Pattern 2: SQS Record → EventBridge Event → Custom Detail

**What:** SQS delivers EventBridge events in the `body` field as JSON string. The handler must: (1) parse JSON, (2) validate EventBridge envelope, (3) validate custom detail schema, (4) report validation failures via batchItemFailures.

**When to use:** All SQS-wrapped pipeline handlers.

**Example:**
```typescript
// Source: Powertools Parser + project handler patterns
async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      // Step 1: Parse JSON
      const ebEvent = JSON.parse(record.body) as Record<string, any>;

      // Step 2: Validate EventBridge envelope
      const ebResult = EventBridgeEventSchema.safeParse(ebEvent);
      if (!ebResult.success) {
        logger.error('Invalid EventBridge envelope', {
          messageId: record.messageId,
          errors: ebResult.error.flatten(),
        });
        failures.push({ itemIdentifier: record.messageId }); // Move to DLQ
        continue;
      }

      // Step 3: Validate custom detail
      const detailResult = YourDetailSchema.safeParse(ebResult.data.detail);
      if (!detailResult.success) {
        logger.error('Invalid event detail', {
          messageId: record.messageId,
          fieldErrors: detailResult.error.flatten().fieldErrors,
          receivedDetail: ebResult.data.detail, // Redact sensitive fields in production
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Step 4: Process validated event
      await processEvent(ebResult.data, detailResult.data);
    } catch (err: any) {
      // Transient errors (Transcribe API) throw and trigger SQS retry
      tracer.addErrorAsMetadata(err);
      logger.error('Failed to process record', {
        messageId: record.messageId,
        error: err.message,
        isTransient: isTransientError(err), // Helper function
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
```

### Pattern 3: Transient vs. Permanent Error Distinction

**What:** Transcribe API errors split into two categories: transient (throttle, service unavailable) → rethrow for SQS retry; permanent (missing sessionId) → log and acknowledge.

**When to use:** Handlers calling AWS APIs that can fail transiently.

**Example:**
```typescript
// Source: AWS Transcribe API docs + project error handling pattern
function isTransientError(error: any): boolean {
  const errorName = error.name || error.__type;
  return errorName === 'ThrottlingException' ||
         errorName === 'ServiceUnavailableException' ||
         errorName === 'RequestLimitExceededException' ||
         errorName === 'InternalFailureException';
}

async function processEvent(
  event: EventBridgeEvent<string, Record<string, any>>,
  tracer: Tracer
): Promise<void> {
  const { sessionId, recordingHlsUrl } = event.detail;

  // Permanent validation failure: log once and return (acknowledge SQS message)
  if (!sessionId || !recordingHlsUrl) {
    logger.error('Missing required fields in event detail', {
      sessionId: sessionId ?? 'missing',
      recordingHlsUrl: recordingHlsUrl ? 'present' : 'missing',
    });
    return; // SQS sees success; message acknowledged
  }

  try {
    // Call AWS API
    const response = await transcribe.send(new StartTranscriptionJobCommand(params));
    logger.info('Transcribe job started', { jobName: response.TranscriptionJob?.TranscriptionJobName });
  } catch (error: any) {
    // Transient error: rethrow to trigger SQS retry
    if (isTransientError(error)) {
      logger.warn('Transient Transcribe error, will retry via SQS', {
        errorName: error.name,
        message: error.message,
      });
      throw error; // SQS will add to batchItemFailures
    }

    // Permanent error (shouldn't happen if API contract is stable)
    logger.error('Permanent Transcribe error', {
      errorName: error.name,
      message: error.message,
    });
    // Don't throw — acknowledge the message to prevent retry loop
  }
}
```

### Pattern 4: Structured Validation Logging

**What:** Log validation failures with field name, received value, and handler context for debuggability.

**When to use:** At schema validation boundaries.

**Example:**
```typescript
// Source: Powertools Logger documentation + Zod error structure
const result = EventDetailSchema.safeParse(event.detail);
if (!result.success) {
  const fieldErrors = result.error.flatten().fieldErrors;
  logger.error('Event validation failed', {
    handler: 'start-transcribe',
    messageId: record.messageId,
    validationErrors: Object.entries(fieldErrors).map(([field, messages]) => ({
      field,
      issues: messages,
    })),
    receivedDetail: {
      // Redact sensitive fields in production logs
      sessionId: event.detail.sessionId?.substring(0, 8) + '***',
      recordingHlsUrl: event.detail.recordingHlsUrl?.substring(0, 30) + '***',
    },
  });
  failures.push({ itemIdentifier: record.messageId });
}
```

### Anti-Patterns to Avoid

- **No validation at SQS boundary:** Malformed events bypass all checks and cause side effects. Always validate at handler entry, not just inside processEvent.
- **Throwing on permanent failures:** If sessionId is missing, throwing causes SQS to retry indefinitely. Return early (success) instead.
- **Catching and logging transient errors without rethrowing:** start-transcribe currently swallows ThrottlingException. Must rethrow to allow SQS retry.
- **Union types without discriminators:** `z.union([SchemaA, SchemaB])` tries all schemas and reports all errors. `z.discriminatedUnion('field', [...])` is more efficient and provides clearer error messages.
- **Mixing validation schemas in processEvent:** Keep validation at the handler entry point (after SQS parsing) to ensure no side effects if schema check fails.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event type validation | Custom if/else on event fields | Zod with discriminated unions | Handles complex event shapes, type inference, error reporting; Zod is battle-tested |
| Structured logging with context | String concatenation | Powertools Logger with appendPersistentKeys | Automatic JSON formatting, reduces log spam, sessionId propagates across all records |
| Error categorization (transient vs. permanent) | Manual error.name string parsing | Helper function with error name constants | Single source of truth; prevents false retries; testable |
| SQS retry logic | Custom messageId tracking | SQS batchItemFailures + maxReceiveCount | AWS manages retry policy and DLQ movement; no custom state needed |

**Key insight:** Validation is deceptively complex when events come from multiple sources (broadcast, hangout, recovery paths) with different shapes. Zod's discriminated unions and Powertools' structured logging prevent the "silent failure" bugs that plagued the pipeline in v1.6.

## Common Pitfalls

### Pitfall 1: Validation Inside processEvent()

**What goes wrong:** Handler accepts any SQS record, passes it to processEvent, and processEvent validates. If validation fails after side effects start (e.g., UpdateCommand partially succeeds), the database is left in an inconsistent state.

**Why it happens:** Developers assume "processEvent is called only for valid events" when SQS provides no such guarantee.

**How to avoid:** Validate at the handler entry point (immediately after JSON.parse), before any async operations. Use batchItemFailures to reject invalid records without calling processEvent.

**Warning signs:** Logs show "event detail missing sessionId" after a DynamoDB update has already started. Always check handler code for validation order.

### Pitfall 2: Throwing on Permanent Validation Failures

**What goes wrong:** Handler throws when sessionId is missing. SQS retries the same message, handler throws again, message bounces between queue and DLQ indefinitely until maxReceiveCount exhaustion.

**Why it happens:** Developers confuse "validation failed" with "operation failed." Validation failures are permanent; operation failures may be transient.

**How to avoid:** For permanent failures (missing required field), log and return (acknowledge). For transient failures (API throttle), log and throw (let SQS retry).

**Warning signs:** DLQ fills with messages that all have the same validation error (missing sessionId, malformed JSON). Check logs for identical error patterns.

### Pitfall 3: Swallowing Transient API Errors

**What goes wrong:** start-transcribe catches any error from Transcribe API and logs it without rethrowing (current code, lines 87-90). A throttle exception is treated as "operation skipped" instead of "retry needed." The session never gets transcribed.

**Why it happens:** Developers use try-catch to "handle" errors generally, not realizing some errors need to surface to the SQS layer.

**How to avoid:** Distinguish error types: transient (ThrottlingException, ServiceUnavailableException) rethrow; permanent (missing sessionId, invalid detail) return. Use an `isTransientError()` helper function.

**Warning signs:** Transcribe jobs are never started for sessions that should be transcribed. Check CloudWatch logs for "Pipeline stage failed" followed by "Transcribe service unavailable" — if no retry happened, transient error was swallowed.

### Pitfall 4: No Validation for Recovery Events

**What goes wrong:** recording-ended receives recovery events (from scan-stuck-sessions.ts) with a different shape: `{ recoveryAttempt: true, sessionId, recoveryAttemptCount }`. If schema only validates the broadcast/hangout shapes, recovery events are rejected.

**Why it happens:** Developers forget that internal recovery logic can trigger the handler with non-standard event shapes.

**How to avoid:** Use discriminated union schema to accept all three event types: broadcast, hangout, recovery. Test recovery path explicitly in unit tests.

**Warning signs:** Recovery events logged as validation failures despite being well-formed. Check STATE.md for the recovery event shape and ensure schema includes it.

### Pitfall 5: DLQ Messages Never Move

**What goes wrong:** Handler logs "validation failed" but batchItemFailures is empty (or doesn't include the messageId). Message is NOT moved to DLQ because Lambda sees success.

**Why it happens:** Developers forget to add failed items to batchItemFailures array. For example, catching an error but not pushing to failures.

**How to avoid:** For each record processed: if any error (validation, API, etc.), add record.messageId to failures array BEFORE the loop continues to next record. Return failures even if array is empty.

**Warning signs:** Logs show validation failures but DLQ remains empty. Check handler return value in logs (or add console.log before return).

## Code Examples

Verified patterns from official sources:

### Zod Schema Definition with Discriminated Union

```typescript
// Source: Zod documentation (zod.dev/api) + project recording-ended.ts shape
import { z } from 'zod';

// Broadcast (IVS Low-Latency) shape
const BroadcastRecordingEndSchema = z.object({
  channel_name: z.string().min(1),
  stream_id: z.string().min(1),
  recording_status: z.enum(['Recording End', 'Recording End Failure']),
  recording_s3_bucket_name: z.string().min(1),
  recording_s3_key_prefix: z.string().min(1),
  recording_duration_ms: z.number().positive(),
});

// Stage (IVS RealTime) shape
const StageParticipantRecordingEndSchema = z.object({
  session_id: z.string(),
  event_name: z.literal('Recording End'),
  participant_id: z.string(),
  recording_s3_bucket_name: z.string(),
  recording_s3_key_prefix: z.string(),
  recording_duration_ms: z.number().positive(),
});

// Recovery event (from scan-stuck-sessions)
const RecoveryEventSchema = z.object({
  recoveryAttempt: z.literal(true),
  sessionId: z.string(),
  recoveryAttemptCount: z.number().nonnegative(),
});

// Union with discriminator
export const RecordingEndedDetailSchema = z.discriminatedUnion('event_name', [
  BroadcastRecordingEndSchema.extend({ event_name: z.undefined().optional() }),
  StageParticipantRecordingEndSchema,
]).or(RecoveryEventSchema);

export type RecordingEndedDetail = z.infer<typeof RecordingEndedDetailSchema>;
```

### SQS Handler with Validation Boundary

```typescript
// Source: Project handler pattern + Zod safeParse pattern
import type { SQSEvent, SQSBatchResponse, EventBridgeEvent } from 'aws-lambda';
import { RecordingEndedDetailSchema } from './schemas/recording-ended.schema';

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      // Parse JSON
      const ebEvent = JSON.parse(record.body) as EventBridgeEvent<string, Record<string, any>>;

      // Validate EventBridge envelope (minimal check)
      if (!ebEvent.detail) {
        logger.error('Missing EventBridge detail field', { messageId: record.messageId });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Validate custom detail schema
      const detailResult = RecordingEndedDetailSchema.safeParse(ebEvent.detail);
      if (!detailResult.success) {
        logger.error('Event detail validation failed', {
          messageId: record.messageId,
          validationErrors: detailResult.error.flatten().fieldErrors,
        });
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }

      // Pass validated event to processEvent
      await processEvent(ebEvent, tracer, docClient, mediaConvertClient);
    } catch (err: any) {
      tracer.addErrorAsMetadata(err);
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

### Transient Error Handling in start-transcribe

```typescript
// Source: AWS Transcribe API Reference + project error handling pattern
function isTransientError(error: any): boolean {
  const errorName = error.name || error.__type;
  return ['ThrottlingException', 'ServiceUnavailableException', 'RequestLimitExceededException'].includes(errorName);
}

async function processEvent(
  event: EventBridgeEvent<'Upload Recording Available', UploadRecordingAvailableDetail>
): Promise<void> {
  const { sessionId, recordingHlsUrl } = event.detail;

  // Permanent validation failure → acknowledge (return, don't throw)
  if (!sessionId || !recordingHlsUrl) {
    logger.error('Missing required fields', { sessionId: sessionId ?? 'missing', recordingHlsUrl: recordingHlsUrl ? 'present' : 'missing' });
    return;
  }

  try {
    const audioFileUri = recordingHlsUrl.replace('/hls/', '/recordings/').replace('/master.m3u8', '/audio.mp4');
    const transcribeParams = {
      TranscriptionJobName: `vnl-${sessionId}-${Date.now()}`,
      Media: { MediaFileUri: audioFileUri },
      OutputBucketName: process.env.TRANSCRIPTION_BUCKET!,
      OutputKey: `${sessionId}/transcript.json`,
      LanguageCode: 'en-US' as const,
      Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 },
    };

    const response = await transcribe.send(new StartTranscriptionJobCommand(transcribeParams));
    logger.info('Transcribe job started', { jobName: response.TranscriptionJob?.TranscriptionJobName, sessionId });
  } catch (error: any) {
    // Transient error → rethrow to trigger SQS retry
    if (isTransientError(error)) {
      logger.warn('Transient Transcribe error, will retry via SQS', { errorName: error.name, sessionId });
      throw error;
    }
    // Permanent error → log and return
    logger.error('Permanent Transcribe error', { errorName: error.name, message: error.message, sessionId });
  }
}
```

### Structured Validation Logging

```typescript
// Source: Powertools Logger + Zod error structure
const result = EventDetailSchema.safeParse(record.detail);
if (!result.success) {
  const fieldErrors = result.error.flatten().fieldErrors;
  logger.error('Validation failed', {
    messageId: record.messageId,
    pipelineStage: 'start-transcribe',
    fieldName: Object.keys(fieldErrors)[0],
    issues: fieldErrors[Object.keys(fieldErrors)[0]],
    receivedValue: record.detail[Object.keys(fieldErrors)[0]],
  });
  failures.push({ itemIdentifier: record.messageId });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No schema validation at handler boundary | Zod safeParse at SQS record entry point | v1.7 Phase 37 | Prevents malformed events from causing side effects; errors are logged and routed to DLQ |
| Catch-all error handling (don't distinguish transient from permanent) | Separate handling: transient (rethrow), permanent (log & return) | v1.7 Phase 37 | Transient Transcribe errors now trigger SQS retries instead of being silently swallowed; fixes session transcription gaps |
| Manual error categorization | Zod discriminated unions for multi-source events | v1.7 Phase 37 | Recording-ended now handles broadcast, hangout, and recovery events with type safety; prevents shape mismatches |
| Generic catch blocks with generic error messages | Structured logging with sessionId, handler name, field errors | v1.7 Phase 37 | Faster debugging; validation failures are immediately visible in logs with context |

**Deprecated/outdated:**
- Manual if/else type guards: replaced by Zod discriminated unions (clearer, less error-prone)
- Generic try-catch without error classification: replaced by transient/permanent distinction

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest + ts-jest (already configured) |
| Config file | backend/jest.config.js |
| Quick run command | `cd backend && npm test -- --testNamePattern="validation" --maxWorkers=4` |
| Full suite command | `cd backend && npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|------------|
| VALID-01 | recording-ended validates EventBridge envelope + RecordingEndedDetail schema at handler boundary before processEvent | unit | `npm test -- recording-ended.test.ts -t "should validate"` | ✅ recording-ended.test.ts |
| VALID-01 | start-transcribe validates UploadRecordingAvailableDetail schema + requires sessionId + recordingHlsUrl | unit | `npm test -- start-transcribe.test.ts -t "schema"` | ✅ start-transcribe.test.ts |
| VALID-01 | transcribe-completed validates TranscribeJobDetail schema at handler boundary | unit | `npm test -- transcribe-completed.test.ts -t "validation"` | ✅ transcribe-completed.test.ts |
| VALID-01 | transcode-completed validates MediaConvertJobDetail schema + sessionId from userMetadata | unit | `npm test -- transcode-completed.test.ts -t "schema"` | ✅ transcode-completed.test.ts |
| VALID-01 | store-summary validates TranscriptStoreDetail schema (sessionId, transcriptS3Uri required) | unit | `npm test -- store-summary.test.ts -t "validation"` | ✅ store-summary.test.ts |
| VALID-02 | Invalid EventBridge details are added to batchItemFailures without calling processEvent | unit | `npm test -- recording-ended.test.ts -t "should handle.*validation.*failure"` | ✅ Wave 0 (new test) |
| VALID-03 | start-transcribe throws on ThrottlingException to trigger SQS retry (not batchItemFailures) | unit | `npm test -- start-transcribe.test.ts -t "transient error"` | ❌ Wave 0 (new test needed) |
| VALID-04 | Logger captures validation error details (field name, received value, handler name) in structured object | unit | `npm test -- recording-ended.test.ts -t "logs.*validation.*error"` | ❌ Wave 0 (assert logger.error mock called with structured obj) |

### Sampling Rate
- **Per task commit:** `npm test -- --testNamePattern="validation" --maxWorkers=4` (validation-only tests, ~20 tests, < 30s)
- **Per wave merge:** `npm test` (full suite, 360 tests, ~60s)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/handlers/schemas/` directory — define Zod schemas for all 5 handlers
  - `recording-ended.schema.ts` — discriminated union for broadcast/hangout/recovery
  - `on-mediaconvert-complete.schema.ts` — MediaConvertJobDetail with jobName validation
  - `transcribe-completed.schema.ts` — TranscribeJobDetail with job status enum
  - `transcode-completed.schema.ts` — MediaConvertJobDetail with userMetadata.sessionId extraction
  - `start-transcribe.schema.ts` — UploadRecordingAvailableDetail with URL validation
- [ ] Update `backend/package.json` — add `zod@^3.23` to dependencies
- [ ] Update all 5 handler test files — add tests for validation failures and transient error retries
- [ ] Update handler code to call `schema.safeParse()` at SQS boundary before processEvent

## Sources

### Primary (HIGH confidence)
- Zod documentation (zod.dev) — discriminated unions, safeParse API, error structure
- AWS Lambda Powertools TypeScript documentation (docs.aws.amazon.com/powertools/typescript/) — Logger with appendPersistentKeys, Parser envelopes
- AWS Transcribe API Reference (docs.aws.amazon.com/transcribe/) — ThrottlingException, ServiceUnavailableException error types
- Project STATE.md — recording-ended recovery event shape, existing error handling patterns
- Project handler code (recording-ended.ts, start-transcribe.ts, etc.) — current validation and error handling

### Secondary (MEDIUM confidence)
- [Validating event payload with Powertools for AWS Lambda (TypeScript)](https://aws.amazon.com/blogs/compute/validating-event-payload-with-powertools-for-aws-lambda-typescript/) — structured validation patterns
- [SQS Dead Letter Queues: Failures Handling Best Practices](https://ranthebuilder.cloud/blog/amazon-sqs-dead-letter-queues-and-failures-handling-best-practices/) — batchItemFailures DLQ movement semantics
- [Parsing Discriminated Unions with Zod](https://timkapitein.nl/blog/parsing-discriminated-unions-with-zod) — discriminated union examples for multi-source events

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Zod is the ecosystem standard for TypeScript validation; Powertools Logger already used in project
- Architecture: HIGH — SQS batch failure handling is AWS-documented; discriminated unions are Zod best practice; error distinction pattern proven in v1.6 (ConflictException handling in transcode-completed)
- Pitfalls: HIGH — Based on observed bugs in STATE.md (start-transcribe line 87-90 swallows transient errors) and Phase 36 decisions (recovery event shape)
- Validation tests: MEDIUM — Existing test files are present but will need new test cases for validation failure scenarios and transient error retries

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (30 days — Zod and Powertools are stable; pipeline event shapes are frozen in v1.7)
