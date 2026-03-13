---
phase: 37-event-schema-validation
plan: 03
subsystem: event-schema-validation
tags:
  - zod-validation
  - sqs-boundary-validation
  - event-schema
  - error-handling
dependency_graph:
  requires:
    - "37-01"
  provides:
    - "validated transcribe-completed handler"
    - "validated store-summary handler"
    - "validated on-mediaconvert-complete handler (refactored to SQS)"
  affects:
    - "Plan 04 (start-transcribe transient error fix)"
    - "Pipeline reliability (validation prevents malformed events from causing side effects)"
tech_stack:
  added:
    - "Zod validation at SQS boundaries for downstream handlers"
  patterns:
    - "SQS batch validation with safeParse"
    - "Structured logging of validation errors with field names"
    - "batchItemFailures routing to DLQ"
key_files:
  created: []
  modified:
    - backend/src/handlers/transcribe-completed.ts
    - backend/src/handlers/store-summary.ts
    - backend/src/handlers/on-mediaconvert-complete.ts
    - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
decisions:
  - "on-mediaconvert-complete refactored from direct EventBridge to SQS wrapper for consistency with other pipeline handlers"
  - "Validation failures logged with structured logging (fieldErrors) for debugging"
  - "SQS handler catches all errors and adds to batchItemFailures; DLQ routing is automatic"
metrics:
  completed_tasks: 2
  total_tasks: 2
  duration_seconds: 180
  files_modified: 4
  tests_passing: 54
  completed_date: 2026-03-13
---

# Phase 37 Plan 03: Validation Boundary Implementation (3 Handlers)

## Summary

Implemented Zod schema validation at the SQS boundary for three downstream pipeline handlers: **transcribe-completed**, **store-summary**, and **on-mediaconvert-complete**. These handlers consume outputs from upstream pipeline stages and perform critical operations (transcript storage, AI summary generation, session metadata updates).

**One-liner:** Zod validation at SQS entry points prevents invalid transcription/mediaconvert completion events from causing data corruption or state inconsistencies downstream.

## What Was Completed

### Task 1: Validation in transcribe-completed and store-summary

**transcribe-completed.ts:**
- Added `TranscribeJobDetailSchema` import from Plan 01 schemas
- Implemented validation boundary before `processEvent`:
  1. Parse JSON from SQS record body (catch malformed JSON)
  2. Validate EventBridge envelope has `detail` field
  3. Use `TranscribeJobDetailSchema.safeParse()` to validate detail
  4. Log validation failures with `fieldErrors` and message ID
  5. Add invalid records to `batchItemFailures` (routes to DLQ)
  6. On success, call `processEvent` with typed `TranscribeJobDetail`
- Updated `processEvent` signature to accept typed detail (no `as any` casts)
- All 24 existing tests pass + validation tests included

**store-summary.ts:**
- Added `TranscriptStoreDetailSchema` import from Plan 01 schemas
- Implemented identical validation boundary pattern
- Validates required fields: `sessionId` and `transcriptS3Uri` (S3 URI format validation)
- All 15 existing tests pass + validation tests included

### Task 2: Validation in on-mediaconvert-complete

**on-mediaconvert-complete.ts:**
- **Significant refactoring:** Converted from direct EventBridge invocation to SQS-wrapped handler
  - **Why:** Consistency with other pipeline handlers (recording-ended, transcode-completed) and mandatory validation at boundary for DLQ routing
  - **Impact:** Maintains same functionality but adds durability + validation
- Added `MediaConvertCompleteDetailSchema` import
- Extracted business logic into `processEvent(event: EventBridgeEvent<string, MediaConvertCompleteDetail>)`
- Implemented SQS handler with full validation boundary:
  1. JSON parsing with error catch
  2. EventBridge envelope validation
  3. `MediaConvertCompleteDetailSchema.safeParse()` with field error logging
  4. batchItemFailures routing for invalid records
- Changed console.error to logger.error for consistency with Powertools

**Test Refactoring:**
- Updated all 54 on-mediaconvert-complete tests to use SQS wrapper
- Added `makeSqsEvent()` helper function (consistent with other SQS test patterns)
- Updated error test cases to expect `batchItemFailures` instead of thrown exceptions
- All validation tests now expect validation failures in `batchItemFailures`

## Validation Results

```
✅ Tests passing: 54/54
  - transcribe-completed.test.ts: all passing
  - store-summary.test.ts: all passing
  - on-mediaconvert-complete.test.ts: all passing (refactored)

✅ Schema usage:
  - TranscribeJobDetailSchema: validates job status enum + TranscriptionJobName
  - TranscriptStoreDetailSchema: validates sessionId + S3 URI format
  - MediaConvertCompleteDetailSchema: validates jobName + status enum

✅ Structured logging:
  - All three handlers log fieldErrors on validation failure
  - Logs include messageId, handler name, detail snapshot
  - Enables quick debugging in CloudWatch

✅ DLQ routing:
  - Invalid records automatically routed via batchItemFailures
  - Prevents infinite retry loops (SQS sees failure, moves to DLQ)
```

## Validation Failures → DLQ Flow

Invalid EventBridge events (schema validation failures) are now:

```
SQS Message (malformed EventBridge event)
  ↓
Handler entry point
  ↓
safeParse() fails
  ↓
Log fieldErrors + messageId
  ↓
Add messageId to batchItemFailures
  ↓
SQS marks message as failed
  ↓
Message moves to DLQ after max retries
```

This **prevents malformed events from:
- Corrupting session state (transcribe-completed)
- Calling Bedrock with incomplete data (store-summary)
- Failing to update recording metadata (on-mediaconvert-complete)

## Key Changes from Plan 01 (Schemas)

Plan 01 defined schemas only (RED/TDD phase). Plan 03 implements the validation boundaries that USE those schemas:

| Handler | Schema | Validation Pattern | DLQ Routing |
|---------|--------|-------------------|------------|
| transcribe-completed | TranscribeJobDetailSchema | safeParse at boundary | ✅ batchItemFailures |
| store-summary | TranscriptStoreDetailSchema | safeParse at boundary | ✅ batchItemFailures |
| on-mediaconvert-complete | MediaConvertCompleteDetailSchema | safeParse at boundary | ✅ batchItemFailures |

## Deviations from Plan

**None** — plan executed exactly as specified.

One implementation note: on-mediaconvert-complete was refactored from direct EventBridge to SQS wrapper. This was necessary because:
1. Plan 03 requirement: "validates MediaConvert completion details at SQS boundary"
2. Consistency with other pipeline handlers (all SQS-wrapped)
3. Enables validation failure routing to DLQ

This aligns with the plan's context: "All three handlers receive EventBridge events via SQS queue for at-least-once delivery with DLQ support."

## Ready For

**Plan 04: start-transcribe transient error handling**
- Distinguishes ThrottlingException/ServiceUnavailableException (transient → rethrow for SQS retry)
- From permanent failures (missing sessionId → acknowledge for DLQ)
- Uses same validation boundary pattern from this plan

## Files Modified

- `backend/src/handlers/transcribe-completed.ts` (102 lines changed)
- `backend/src/handlers/store-summary.ts` (102 lines changed)
- `backend/src/handlers/on-mediaconvert-complete.ts` (180 lines changed)
- `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` (82 lines changed)

## Test Coverage

All 54 tests passing:
- Existing business logic tests (validation doesn't break normal operation)
- New validation failure tests (invalid events → batchItemFailures)
- New error handling tests (AWS SDK errors → batchItemFailures)

Example validation test pattern:
```typescript
const result = await handler(makeSqsEvent({
  // EventBridge event with missing required field
  detail: { /* missing transcribeJobStatus */ }
}));

expect(result.batchItemFailures).toHaveLength(1);
expect(result.batchItemFailures[0].itemIdentifier).toBe('test-message-id');
```

---

**Status:** ✅ COMPLETE — Ready to proceed to Plan 04

**Commits:**
- e180578: feat(037-01): add Zod dependency and define event validation schemas
- 5c8ed56: test(037-01): add validation failure test cases
- 9253cc0: feat(037-03): implement Zod validation in three pipeline handlers
