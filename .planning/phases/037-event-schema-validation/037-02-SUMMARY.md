---
phase: 37-event-schema-validation
plan: 02
subsystem: event-validation
tags:
  - zod-validation
  - sqs-boundary-validation
  - error-handling
dependency_graph:
  requires:
    - "37-01": "RecordingEndedDetailSchema, TranscodeCompletedDetailSchema from schemas directory"
  provides:
    - "37-03": "Validated handlers ready for application to remaining pipeline handlers"
  affects:
    - "on-mediaconvert-complete": "Handler validation pattern established"
    - "transcribe-completed": "Handler validation pattern established"
    - "store-summary": "Handler validation pattern established"
tech_stack:
  added:
    - "zod (dependency added in Plan 01, now used at handler boundaries)"
  patterns:
    - "Zod schema validation at SQS boundary before processEvent"
    - "Structured logging for validation failures with field-level error details"
    - "batchItemFailures route to DLQ for invalid events (no SQS retry)"
    - "Type guards for discriminated unions in multi-source events"
key_files:
  created: []
  modified:
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/transcode-completed.ts
    - backend/src/handlers/schemas/recording-ended.schema.ts
    - backend/src/handlers/schemas/transcode-completed.schema.ts
    - backend/src/handlers/__tests__/recording-ended.test.ts
    - backend/src/handlers/__tests__/transcode-completed.test.ts
duration_minutes: 45
completed_date: "2026-03-13"
decisions:
  - id: "VALID-BOUNDARY-01"
    decision: "Validation occurs at SQS record entry point (after JSON.parse, before processEvent) rather than inside processEvent"
    rationale: "Ensures no side effects occur if event structure is invalid. Follows AWS Lambda best practices for batch processing handlers"
    impact: "Invalid records immediately added to batchItemFailures, preventing processEvent from executing with malformed data"

  - id: "VALID-SCHEMA-02"
    decision: "recording-ended uses z.union() with type guards in processEvent rather than z.discriminatedUnion() with discriminator field"
    rationale: "Events come from multiple sources (broadcast/hangout/recovery) with different field sets. Some sources don't have a discriminator field (event_name only on hangout, not broadcast or recovery)"
    impact: "Requires runtime type guards (isBroadcastOrHangoutEvent) in processEvent, but ensures compatibility with existing event shapes from three sources"

  - id: "VALID-SCHEMA-03"
    decision: "recording-ended schema enum values corrected from ['ACTIVE', 'STOPPED', 'FAILED'] to ['Recording End', 'Recording End Failure']"
    rationale: "Actual IVS broadcast events use status values 'Recording End' and 'Recording End Failure', not ACTIVE/STOPPED/FAILED. Schema must match real event data"
    impact: "All test events now pass validation with correct enum values"

  - id: "VALID-SCHEMA-04"
    decision: "transcode-completed schema removed jobName field (not used by handler) but added detailed outputGroupDetails structure"
    rationale: "jobName is optional in MediaConvert events and unused by handler. outputGroupDetails structure needed for parsing MP4 output paths"
    impact: "Schema is leaner and more focused on required and actually-used fields"

  - id: "VALID-SCHEMA-05"
    decision: "transcode-completed schema allows optional sessionId within userMetadata"
    rationale: "Handler logs warning and returns early if sessionId is missing. Schema should allow this graceful degradation case"
    impact: "Events with missing sessionId are validated successfully and processed with early return (no Transcribe job submission)"

  - id: "TEST-ASSERTION-01"
    decision: "Updated transcode-completed test assertion from checking TranscribeClient constructor to checking mockTranscribeSend"
    rationale: "Handler always instantiates TranscribeClient at start for efficiency. Test should verify send() was not called, not that constructor wasn't called"
    impact: "Test correctly verifies that invalid events don't trigger AWS SDK operations"

metrics:
  tests_passing: 31
  test_suites: 2
  handlers_implemented: 2
  validation_failures_caught: 5
  commits: 2

---

# Phase 37 Plan 02: Event Validation at SQS Boundaries — Summary

## Objective

Implement Zod schema validation at the SQS boundary for recording-ended and transcode-completed handlers. These handlers manage complex event shapes and are entry points into the transcription pipeline. Invalid events must be rejected without side effects (DynamoDB writes, AWS API calls).

## What Was Built

### recording-ended Handler Validation

**File:** `backend/src/handlers/recording-ended.ts`

- **Validation boundary:** Validates EventBridge envelope and RecordingEndedDetail schema immediately after SQS record parsing
- **Schema:** Uses `z.union()` to accept three event shapes:
  - Broadcast (IVS Low-Latency): channel_name, stream_id, recording_status, S3 metadata
  - Hangout (IVS RealTime): event_name='Recording End', session_id, participant_id, S3 metadata
  - Recovery: recoveryAttempt=true, sessionId, recoveryAttemptCount
- **Type guards:** Helper function `isBroadcastOrHangoutEvent()` narrows union types for field access in processEvent
- **Error handling:** Structured logging with field-level validation errors; invalid records added to batchItemFailures
- **Schema fix:** Corrected `recording_status` enum from `['ACTIVE', 'STOPPED', 'FAILED']` to `['Recording End', 'Recording End Failure']` to match actual IVS event values

### transcode-completed Handler Validation

**File:** `backend/src/handlers/transcode-completed.ts`

- **Validation boundary:** Validates EventBridge envelope and TranscodeCompletedDetail schema immediately after SQS record parsing
- **Schema:** Validates MediaConvert job details with required jobId and status; optional userMetadata with optional sessionId
- **Nested structure:** Correctly validates outputGroupDetails nesting for MP4 output path extraction
- **Error handling:** Same structured logging pattern as recording-ended; invalid records routed to batchItemFailures
- **Schema design:** Removed unused jobName field; kept userMetadata.sessionId optional to allow graceful handling of missing sessionId in handler

## Test Results

```
Test Suites: 2 passed, 2 total
Tests:       31 passed, 31 total
```

### recording-ended Tests (20 tests)
- ✓ Valid broadcast events processed successfully
- ✓ Valid hangout/stage events processed successfully
- ✓ Recovery events with recoveryAttempt=true handled correctly
- ✓ Invalid events added to batchItemFailures
- ✓ Multiple records with one invalid event routed correctly
- ✓ Malformed JSON in record body handled gracefully
- ✓ ARN parsing and resource type detection working
- ✓ MediaConvert submission for recording-ended events

### transcode-completed Tests (11 tests)
- ✓ Valid MediaConvert COMPLETE events trigger Transcribe job submission
- ✓ ERROR/CANCELED status handled without job submission
- ✓ Missing sessionId in userMetadata logged and handled gracefully
- ✓ ConflictException from Transcribe treated as idempotent success
- ✓ Invalid events added to batchItemFailures without SDK calls
- ✓ Multiple records with one invalid routed correctly
- ✓ Malformed JSON handled gracefully

## Validation Patterns Established

1. **Boundary validation:** Schema validation occurs immediately after JSON.parse, before any async operations or side effects
2. **Structured error logging:** Field-level errors captured with this pattern:
   ```typescript
   const fieldErrors = result.error.flatten().fieldErrors;
   logger.error('Event validation failed', {
     messageId: record.messageId,
     handler: 'handler-name',
     validationErrors: Object.entries(fieldErrors).map(([field, messages]) => ({
       field,
       issues: messages,
     })),
   });
   ```
3. **DLQ routing:** Invalid records added to batchItemFailures without throwing, preventing SQS retry loops
4. **Type safety:** Handlers receive fully typed event objects (no `as any` casts in validation paths)

## Deviations from Plan

### Schema Enum Value Correction (Rule 1 - Bug)

**Found during:** Task 1 - recording-ended schema validation test

**Issue:** recording-ended schema defined `recording_status: z.enum(['ACTIVE', 'STOPPED', 'FAILED'])` but actual IVS broadcast events use `'Recording End'` and `'Recording End Failure'`

**Fix:** Updated schema enum to `['Recording End', 'Recording End Failure']` to match real event data

**Impact:** All recording-ended tests now pass with correct enum values; prevents false validation failures in production

### Test Data Update (Rule 1 - Bug)

**Found during:** Task 1 - recording-ended test execution

**Issue:** Test "should handle multiple records with one invalid" used `recording_status: 'ACTIVE'` in valid event, which doesn't match schema

**Fix:** Changed test data to use `'Recording End'` (the actual valid enum value)

**Impact:** Test now correctly validates valid events and properly tests invalid event routing

### Test Assertion Fix (Rule 1 - Bug)

**Found during:** Task 2 - transcode-completed test execution

**Issue:** Test assertion `expect(TranscribeClient).not.toHaveBeenCalled()` was failing because handler instantiates TranscribeClient at start before processing records, which is standard practice for efficiency

**Fix:** Changed assertion to `expect(mockTranscribeSend).not.toHaveBeenCalled()` to verify the actual operation (send) wasn't called, not the constructor

**Impact:** Test correctly verifies invalid events don't trigger AWS API calls while allowing handler to instantiate client

### transcode-completed Schema Refinement (Rule 2 - Missing Validation)

**Found during:** Task 2 - schema design and test data alignment

**Issue:** Initial schema required `jobName` field and didn't match MediaConvert event structure; handler doesn't use jobName

**Fix:** Removed unused jobName; added detailed outputGroupDetails structure matching actual MediaConvert response nesting; made sessionId optional within userMetadata

**Impact:** Schema accurately reflects actual MediaConvert event structure and handler requirements

## Next Phase

Plan 03 will apply the same validation pattern to the remaining three pipeline handlers:
- **transcribe-completed:** Validates TranscribeJobDetail schema
- **on-mediaconvert-complete:** Validates MediaConvert job detail schema
- **store-summary:** Validates transcript storage detail schema

The validation boundary pattern established in this plan (parse → validate envelope → validate detail → log errors → route failures → process) will be replicated across all remaining handlers with their specific schemas.

## Architecture Notes

### Type Safety Without Generics

recording-ended handler accepts a union type from schema and uses runtime type guards rather than TypeScript discriminated unions because:
1. Recovery events don't have an event_name discriminator field
2. Broadcast events don't have an event_name discriminator field
3. Only hangout events use event_name='Recording End' as discriminator

This design allows flexible event shapes from different IVS sources while maintaining type safety through runtime checks.

### Schema vs. Handler Validation Split

- **Schema validation:** EventBridge envelope structure + detail fields (Zod safeParse)
- **Handler validation:** Business logic checks (missing sessionId, missing S3 paths, invalid status transitions)

Schema validates structure; handler validates business state. This separation keeps validation boundaries clean and testable.
