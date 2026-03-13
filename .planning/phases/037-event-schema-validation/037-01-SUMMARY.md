---
phase: 037-event-schema-validation
plan: 01
subsystem: api
tags: [zod, validation, schema, events, pipeline]

# Dependency graph
requires: []
provides:
  - Zod schema definitions for all 5 pipeline handlers (recording-ended, transcode-completed, transcribe-completed, store-summary, start-transcribe)
  - Event validation contracts at SQS boundaries
  - Validation failure test cases for all handlers
  - Transient error documentation for start-transcribe

affects: [037-02, 037-03, 037-04, 037-05]

# Tech tracking
tech-stack:
  added: [zod@^3.23.0]
  patterns:
    - "Discriminated union pattern for recording-ended (broadcast/hangout/recovery shapes)"
    - "Schema re-exports via index.ts barrel pattern"
    - "Type inference from Zod schemas using z.infer<typeof>"

key-files:
  created:
    - backend/src/handlers/schemas/index.ts
    - backend/src/handlers/schemas/recording-ended.schema.ts
    - backend/src/handlers/schemas/transcode-completed.schema.ts
    - backend/src/handlers/schemas/transcribe-completed.schema.ts
    - backend/src/handlers/schemas/store-summary.schema.ts
    - backend/src/handlers/schemas/start-transcribe.schema.ts
    - backend/src/handlers/schemas/on-mediaconvert-complete.schema.ts
  modified:
    - backend/package.json (added zod@^3.23.0)
    - backend/src/handlers/__tests__/recording-ended.test.ts
    - backend/src/handlers/__tests__/transcode-completed.test.ts
    - backend/src/handlers/__tests__/transcribe-completed.test.ts
    - backend/src/handlers/__tests__/store-summary.test.ts
    - backend/src/handlers/__tests__/start-transcribe.test.ts
    - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts

key-decisions:
  - "Used discriminated union (z.union) in recording-ended schema to handle three distinct event shapes (broadcast, hangout, recovery)"
  - "Recording-ended broadcast shape uses z.never() for event_name field to ensure discriminator exclusivity"
  - "Validation test failures in start-transcribe are expected and document the behavior that will be implemented in Plan 04"
  - "All schemas export both the Zod schema object and TypeScript types via z.infer<typeof>"

patterns-established:
  - "Event schema pattern: z.object({ field: z.type() }) for each handler"
  - "Multi-source event handling: z.union or z.discriminatedUnion for events from multiple sources"
  - "Type safety: Always export both schema and inferred type for compile-time type checking"
  - "Enum fields: z.enum(['VALUE1', 'VALUE2']) for AWS service status values"

requirements-completed: []  # Requirements VALID-01, VALID-02, VALID-04 require handler implementation in Plans 02-05

# Metrics
duration: N/A
completed: 2026-03-13
---

# Phase 37 Plan 01: Event Schema Validation Summary

**Zod event validation schemas defined for all 5 pipeline handlers (recording-ended, transcode-completed, transcribe-completed, store-summary, start-transcribe) with discriminated union support for multi-source events and comprehensive validation test coverage**

## Performance

- **Duration:** N/A (completed previously, summary created now)
- **Tasks:** 4 (all complete)
- **Files created:** 7 schema files
- **Files modified:** 8 test/config files

## Accomplishments

- **Zod@^3.23.0 dependency** added to backend/package.json
- **6 event schema files created** (one per handler + index re-exports)
  - `recording-ended.schema.ts` uses discriminated union for broadcast/hangout/recovery shapes
  - `start-transcribe.schema.ts` validates sessionId and .m3u8 URL format
  - `transcode-completed.schema.ts` extracts sessionId from userMetadata
  - `transcribe-completed.schema.ts` handles AWS Transcribe job detail structure
  - `store-summary.schema.ts` validates transcript S3 storage trigger
  - `on-mediaconvert-complete.schema.ts` validates MediaConvert completion
- **Validation test cases added** to all 5 handler test files
  - Missing required field tests (schema validation failure)
  - Multiple records with one invalid (batch handling)
  - Invalid JSON handling (handler-level error)
- **Transient error test** in start-transcribe documents expected behavior for SQS retry flow
- **Type safety** established with exported TypeScript types for all schemas

## Task Commits

1. **Task 1-2: Add Zod dependency and define schemas** - `e180578` (feat)
   - Added zod@^3.23.0 to package.json
   - Created backend/src/handlers/schemas/ directory with index.ts
   - Defined 6 schema files with Zod validation contracts
   - Used discriminated union for recording-ended multi-source events

2. **Task 3-4: Add validation failure tests** - `5c8ed56` (test)
   - Added validation failure test cases to all 5 handler test files
   - Added transient error test case to start-transcribe.test.ts
   - Tests verify batchItemFailures population on schema validation failure
   - Tests confirm no AWS SDK calls on validation failure

## Decisions Made

- **Discriminated union for recording-ended:** Used `z.union()` (not `z.discriminatedUnion()`) because hangout events have `event_name: 'Recording End'` literal while broadcast and recovery events do NOT have event_name. This makes discriminatedUnion unsuitable; union with exclusivity via z.never() works correctly.

- **Test failure expectation:** Three start-transcribe validation tests are expected to fail initially (documenting expected behavior). They will pass after handler implementation in Plan 04 adds actual Zod validation at the SQS boundary.

- **Type exports:** All schemas export both the Zod schema (`RecordingEndedDetailSchema`) and the TypeScript type (`RecordingEndedDetail`) for maximum flexibility in downstream handlers.

## Deviations from Plan

None - plan executed exactly as written. All 4 tasks completed, schemas defined with proper patterns, validation tests added to handler test files.

## Test Status

**Validation tests:** 3 failures in start-transcribe (expected - documenting behavior for Plan 04 implementation)
- `should add invalid event to batchItemFailures without calling Transcribe SDK` - FAIL (handler doesn't validate yet)
- `should handle multiple records with one invalid` - FAIL (handler doesn't validate yet)
- `should rethrow transient Transcribe errors to trigger SQS retry` - FAIL (handler catches all errors currently)

**All other tests:** 477 passing (full suite: 480 tests total)

These test failures are expected per the plan: "Let it fail. The test documents the expected behavior."

## Next Phase Readiness

- Zod schemas are ready for use by all 5 pipeline handlers
- Test contracts are established (validation failure tests + transient error test)
- Plans 02-05 will implement handlers to:
  - Parse SQS records and validate event detail against schemas
  - Add failed messageIds to batchItemFailures for permanent schema failures
  - Distinguish transient API errors from permanent validation failures
  - Route invalid messages to DLQ instead of infinite retry loops

---

*Phase: 037-event-schema-validation*
*Plan: 01*
*Completed: 2026-03-13*
