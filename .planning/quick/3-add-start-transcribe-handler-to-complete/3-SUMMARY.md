---
phase: quick-3
plan: 1
subsystem: transcription-pipeline
tags: [eventbridge, transcribe, lambda, cdk]
requires: []
provides: [start-transcribe-handler]
affects: [transcription-pipeline]
tech-stack:
  added: ["@aws-sdk/client-transcribe"]
  patterns: ["eventbridge-handler", "non-blocking-error-handling"]
key-files:
  created:
    - backend/src/handlers/start-transcribe.ts
    - backend/src/handlers/__tests__/start-transcribe.test.ts
  modified:
    - infra/lib/stacks/session-stack.ts
decisions:
  - "Non-blocking error handling pattern - log but don't throw"
  - "Job naming convention vnl-{sessionId}-{epochMs} for uniqueness"
  - "Convert HLS URL to audio MP4 URL via string replacement"
metrics:
  duration: "3 minutes"
  completed: "2026-03-06T16:18:00Z"
---

# Quick Task 3: Add Start-Transcribe Handler Summary

**One-liner:** EventBridge handler that bridges MediaConvert completion to Transcribe job submission using vnl-{sessionId}-{epochMs} naming.

## What Got Done

### Task 1: Create start-transcribe handler with tests (TDD)
- **RED Phase:** Created comprehensive test suite with 6 tests covering all scenarios
- **GREEN Phase:** Implemented handler that processes Upload Recording Available events
- **Key Features:**
  - Listens for `vnl.upload` source with `Upload Recording Available` detail type
  - Converts HLS URLs to audio MP4 URLs (s3://bucket/hls/sessionId/master.m3u8 → s3://bucket/recordings/sessionId/audio.mp4)
  - Generates unique job names using `vnl-{sessionId}-{Date.now()}` pattern
  - Submits Transcribe jobs with correct S3 output location
  - Non-blocking error handling (logs errors but doesn't throw)

### Task 2: Wire handler to EventBridge in CDK
- Added Lambda function configuration in session-stack.ts
- Configured environment variables (TABLE_NAME, TRANSCRIPTION_BUCKET)
- Granted necessary permissions:
  - Read access to recordings bucket
  - Read/write access to transcription bucket
  - StartTranscriptionJob permission for Transcribe service
- Created EventBridge rule for Upload Recording Available events
- Connected rule to Lambda function as target

## Verification Results

- ✅ Backend tests: 6/6 tests passing for start-transcribe handler
- ✅ CDK build: Successful with new infrastructure configuration
- ✅ Handler properly wired to EventBridge rule
- ✅ All permissions correctly configured

## Pipeline Completion

The transcription pipeline is now complete with all components connected:
1. **recording-ended** → Triggers MediaConvert job submission
2. **start-mediaconvert** → Submits MediaConvert job with phase=19-transcription
3. **on-mediaconvert-complete** → Publishes Upload Recording Available event
4. **start-transcribe** → Submits Transcribe job (NEW - filled the gap)
5. **transcribe-completed** → Processes transcript and triggers AI summary

## Implementation Details

### Handler Pattern
The handler follows the established non-blocking pattern seen in other handlers:
- Try-catch wrapper around entire logic
- Log errors but don't rethrow
- Early return on validation failures
- Detailed logging for debugging

### URL Conversion Logic
Simple string replacement approach:
```typescript
const audioFileUri = recordingHlsUrl
  .replace('/hls/', '/recordings/')
  .replace('/master.m3u8', '/audio.mp4');
```

### Job Naming Convention
Matches the pattern expected by transcribe-completed handler:
```typescript
const jobName = `vnl-${sessionId}-${Date.now()}`;
```

## Files Changed

| File | Lines | Type | Purpose |
|------|-------|------|---------|
| backend/src/handlers/__tests__/start-transcribe.test.ts | 218 | Created | Comprehensive test coverage |
| backend/src/handlers/start-transcribe.ts | 75 | Created | EventBridge handler implementation |
| infra/lib/stacks/session-stack.ts | +33 | Modified | CDK infrastructure configuration |

## Commits

- `23b3a19`: test(quick-3): add failing tests for start-transcribe handler
- `f28ca6c`: feat(quick-3): implement start-transcribe handler
- `4c7548c`: feat(quick-3): wire start-transcribe handler to EventBridge in CDK

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

Verifying all claims in this summary:
- FOUND: backend/src/handlers/start-transcribe.ts
- FOUND: backend/src/handlers/__tests__/start-transcribe.test.ts
- FOUND: Commit 23b3a19
- FOUND: Commit f28ca6c
- FOUND: Commit 4c7548c

## Self-Check: PASSED

<parameter name="file_path">/Users/connorhoehn/Projects/videonowandlater/.planning/quick/3-add-start-transcribe-handler-to-complete/3-SUMMARY.md