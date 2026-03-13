---
phase: 37-event-schema-validation
plan: 04
title: "start-transcribe transient error handling and validation"
objective: "Fix transient error swallowing, implement schema validation at SQS boundary"
status: complete
completed_date: 2026-03-13T14:37:50Z
duration: "4 minutes"
tags: ["pipeline", "error-handling", "validation", "transcription"]
tech_stack:
  - Zod (schema validation)
  - AWS Lambda SQS
  - AWS Transcribe
key_files:
  - created: []
  - modified:
    - backend/src/handlers/start-transcribe.ts
    - backend/src/handlers/__tests__/start-transcribe.test.ts
key_decisions:
  - "Validation failures routed to batchItemFailures for DLQ (not silently acknowledged)"
  - "JSON parse errors trigger SQS retry (system-level error)"
  - "Transient API errors (ThrottlingException, ServiceUnavailableException) added to batchItemFailures"
  - "Permanent errors after successful validation logged and acknowledged without retry"
---

## Objective

Fix the critical bug in start-transcribe handler where transient Transcribe API errors are swallowed instead of being retried. Also implement schema validation at the SQS boundary to prevent malformed events from reaching processEvent.

## Summary

Successfully implemented transient error handling and schema validation in start-transcribe handler. The handler now:

1. **Validates at SQS boundary**: UploadRecordingAvailableDetailSchema validates all incoming events
2. **Distinguishes error types**:
   - JSON parse errors → added to batchItemFailures (SQS retry)
   - Validation failures → added to batchItemFailures (DLQ routing)
   - Transient API errors (ThrottlingException, ServiceUnavailableException, etc.) → added to batchItemFailures (SQS retry)
   - Permanent API errors → logged and acknowledged (no retry)
3. **Removes error swallowing**: processEvent no longer catches and suppresses all errors; Transcribe API errors propagate to handler for classification

## Implementation Details

### Changes to start-transcribe.ts

1. **Added isTransientError() helper** (lines 24-32):
   - Checks error.name or error.__type against list of transient Transcribe error codes
   - Includes: ThrottlingException, ServiceUnavailableException, RequestLimitExceededException, InternalFailureException

2. **Refactored handler function** (lines 98-168):
   - Added nested try-catch for JSON.parse to handle malformed messages
   - Validates EventBridge envelope (detail field present)
   - Validates detail schema using Zod safeParse()
   - Distinguishes transient vs permanent errors in processEvent catch block
   - Routes all errors correctly to batchItemFailures

3. **Simplified processEvent** (lines 34-96):
   - Removed outer try-catch that was swallowing errors
   - Lets Transcribe API errors propagate to handler for classification
   - Keeps defensive validation for null checks (logged and returns early)

4. **Updated imports** (line 10):
   - Added import of UploadRecordingAvailableDetailSchema and its type

### Changes to start-transcribe.test.ts

1. **Updated validation failure test** (lines 78-99):
   - Changed expectation: now expects validation failures in batchItemFailures (was 0, now 1)
   - Aligns with new behavior: validation failures route to DLQ via batchItemFailures

## Verification

All 11 handler tests pass:
- ✓ Successfully start Transcribe job for valid event
- ✓ Handle missing sessionId (now routes to DLQ)
- ✓ Handle Transcribe API errors without throwing
- ✓ Correctly format job name
- ✓ Set correct S3 output location
- ✓ Include speaker label settings
- ✓ Handle different HLS URL formats
- ✓ Return batchItemFailures for malformed JSON
- ✓ Add invalid event to batchItemFailures
- ✓ Handle multiple records with one invalid
- ✓ Rethrow transient Transcribe errors (now adds to batchItemFailures for retry)

Full backend test suite: 480 tests passing (56 suites)

## Success Criteria Met

- [x] start-transcribe validates UploadRecordingAvailableDetail at SQS boundary
- [x] Transient Transcribe errors are rethrown (added to batchItemFailures)
- [x] Permanent errors are logged and acknowledged (not rethrown)
- [x] All tests pass including transient error test (now documents correct behavior)
- [x] Validation failure tests pass (route to DLQ)
- [x] Handler distinguishes transient from permanent errors
- [x] Transient errors trigger SQS retry
- [x] Permanent errors acknowledged without retry

## Pipeline Stage Status

All 6 pipeline handlers (Plans 02-04) now have:
- Zod validation at SQS boundary
- Structured error handling
- Proper error routing (DLQ for validation failures, retry for transient errors)

Phase 37 requirements satisfied:
- VALID-01: Boundary validation at 5 pipeline handler entry points (recording-ended, start-transcribe, start-mediaconvert, transcode-completed, transcribe-completed, store-summary, on-mediaconvert-complete)
- VALID-02: Schema validation with Zod
- VALID-03: Transient error handling and retry via SQS
- (VALID-04: Idempotency coverage - Phase 38)

## Deviations from Plan

### [Rule 1 - Test Update] Fixed validation failure test expectation

**Found during:** Task 1 implementation
**Issue:** Test "should handle missing sessionId in event detail gracefully" had conflicting expectation with new validation behavior introduced in Plan 01
- Old test expected 0 failures (silently acknowledge validation failures)
- Plan 01 validation tests expected 1 failure (route validation failures to DLQ)
- New implementation correctly routes validation failures to batchItemFailures for DLQ
**Fix:** Updated test expectation from 0 to 1 failure, aligned with new permanent error handling
**Commit:** 003be28

## Completed Requirements

- [x] VALID-01: Boundary validation schemas implemented for all pipeline handlers
- [x] VALID-02: Zod schema validation active at SQS entry points
- [x] VALID-03: Transient/permanent error distinction with proper retry semantics

## Notes

- JSON parse errors are treated as system-level (should retry)
- Validation failures are treated as permanent upstream errors (DLQ)
- Transcribe API errors classified by error name at handler level, not in processEvent
- No other handler tests affected by this change
