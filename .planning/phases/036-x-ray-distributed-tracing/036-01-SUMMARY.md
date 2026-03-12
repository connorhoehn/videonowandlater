---
phase: 036-x-ray-distributed-tracing
plan: "01"
subsystem: backend-tests
tags: [tracing, tdd, powertools, x-ray]
dependency_graph:
  requires: []
  provides: [036-01-tracer-test-contracts]
  affects: [recording-ended, transcode-completed, transcribe-completed, store-summary, on-mediaconvert-complete]
tech_stack:
  added: []
  patterns: [tracer-mock-factory, captureAWSv3Client-assertion, putAnnotation-assertion]
key_files:
  created: []
  modified:
    - backend/src/handlers/__tests__/recording-ended.test.ts
    - backend/src/handlers/__tests__/transcode-completed.test.ts
    - backend/src/handlers/__tests__/transcribe-completed.test.ts
    - backend/src/handlers/__tests__/store-summary.test.ts
    - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
decisions:
  - "Used expect.any(ClientClass) for clients already imported in test; expect.objectContaining({}) for DynamoDBClient not directly imported in recording-ended test"
  - "Added tracer assertions to single representative happy-path test per file to minimize noise while defining the contract"
  - "jest.clearAllMocks() + individual mockClear() on tracer mocks in beforeEach to prevent cross-test interference"
metrics:
  duration: "5 minutes"
  completed_date: "2026-03-12"
  tasks_completed: 2
  files_modified: 5
requirements:
  - TRACE-02
  - TRACE-03
---

# Phase 36 Plan 01: TDD Red — Tracer Contract Tests Summary

**One-liner:** Added failing @aws-lambda-powertools/tracer mock with captureAWSv3Client and putAnnotation assertions to all 5 pipeline handler test files, establishing the TDD contract for Plans 02/03.

## What Was Built

Extended all 5 pipeline handler test files with a standard tracer mock factory pattern and tracer assertions. These tests define the implementation contract that Plans 02/03 must satisfy:

- `recording-ended`: assert `captureAWSv3Client` called with `DynamoDBClient` + `MediaConvertClient`; `putAnnotation('sessionId', ...)` + `putAnnotation('pipelineStage', 'recording-ended')`
- `transcode-completed`: assert `captureAWSv3Client` called with `TranscribeClient`; `putAnnotation('pipelineStage', 'transcode-completed')`
- `transcribe-completed`: assert `captureAWSv3Client` called with `S3Client` + `EventBridgeClient`; `putAnnotation('pipelineStage', 'transcribe-completed')`
- `store-summary`: assert `captureAWSv3Client` called with `S3Client` + `BedrockRuntimeClient`; `putAnnotation('pipelineStage', 'store-summary')`
- `on-mediaconvert-complete`: assert `captureAWSv3Client` called with `EventBridgeClient`; `putAnnotation('pipelineStage', 'on-mediaconvert-complete')`

## Test State

**RED (correct):** 5 new tracer assertions FAIL across 5 test files. 65 pre-existing assertions PASS. The only failures are the new `captureAWSv3Client` and `putAnnotation` expects, confirming no production code has been touched.

```
Test Suites: 5 failed, 5 total
Tests:       5 failed, 65 passed, 70 total
```

## Commits

| Hash | Message |
|------|---------|
| c2f6113 | test(036-01): add failing tracer assertions to recording-ended and transcode-completed tests |
| fbdfb58 | test(036-01): add failing tracer assertions to transcribe-completed, store-summary, and on-mediaconvert-complete tests |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files verified
- `backend/src/handlers/__tests__/recording-ended.test.ts` — contains `mockCaptureAWSv3Client`, `mockPutAnnotation`, `jest.mock('@aws-lambda-powertools/tracer')`
- `backend/src/handlers/__tests__/transcode-completed.test.ts` — same
- `backend/src/handlers/__tests__/transcribe-completed.test.ts` — same
- `backend/src/handlers/__tests__/store-summary.test.ts` — same
- `backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts` — same

### Commits verified
- c2f6113 in git log
- fbdfb58 in git log

## Self-Check: PASSED
