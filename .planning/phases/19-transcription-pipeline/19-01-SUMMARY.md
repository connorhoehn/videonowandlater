---
phase: 19-transcription-pipeline
plan: 01
status: complete
completed_at: "2026-03-06T00:48:57Z"
subsystem: transcription-pipeline
tags:
  - backend
  - aws-sdk
  - mediaconvert
  - transcribe
  - domain-model
  - repository
  - event-handlers
dependency_graph:
  requires: []
  provides:
    - transcriptStatus, transcriptS3Path, transcript Session domain fields
    - updateTranscriptStatus() repository function
    - MediaConvert job submission in recording-ended handler
    - transcode-completed EventBridge handler
    - transcribe-completed EventBridge handler
  affects:
    - Phase 20 (AI Summary) — will use transcript field as input for Bedrock
    - EventBridge routing — transcode-completed and transcribe-completed handlers must be wired to EventBridge rules
tech_stack:
  added:
    - "@aws-sdk/client-mediaconvert": Convert HLS recordings to MP4
    - "@aws-sdk/client-transcribe": Submit transcription jobs
    - "@aws-sdk/client-s3": Fetch transcribed output from S3
  patterns:
    - Non-blocking best-effort error handling (don't block pool release)
    - Job naming format vnl-{sessionId}-{epochMs} for correlation
    - UpdateCommand with dynamic expression building for partial updates
key_files:
  created:
    - backend/src/handlers/transcode-completed.ts (109 lines)
    - backend/src/handlers/transcribe-completed.ts (109 lines)
  modified:
    - backend/src/domain/session.ts
    - backend/src/repositories/session-repository.ts
    - backend/src/handlers/recording-ended.ts
    - backend/src/repositories/__tests__/session-repository.test.ts
    - backend/package.json
decisions:
  - Job naming uses `vnl-{sessionId}-{epochMs}` format across MediaConvert and Transcribe for sessionId extraction without DynamoDB queries
  - Transcription pipeline is non-blocking: failures logged but don't throw or block session cleanup/pool release
  - All transcription operations (status updates, S3 fetches) wrapped in try/catch with graceful degradation
  - Session domain extended with three optional fields following RecordingStatus pattern
metrics:
  duration_minutes: 0
  tasks_completed: 5
  files_created: 2
  files_modified: 5
  tests_added: 4 (updateTranscriptStatus test cases)
  tests_passing: 214/214
---

# Phase 19 Plan 01: Transcription Pipeline Setup — SUMMARY

**One-liner:** Transcription pipeline layer that converts IVS HLS recordings to MP4 via MediaConvert, transcribes via AWS Transcribe, and stores transcripts on session records.

## Overview

This plan implements the complete transcription pipeline, enabling Phase 20 (AI Summary) to access transcripts for generating AI-powered summaries. The pipeline operates in three stages:

1. **recording-ended handler**: Submits MediaConvert job to convert HLS → MP4 (non-blocking)
2. **transcode-completed handler**: Processes MediaConvert completion, submits Transcribe job
3. **transcribe-completed handler**: Fetches transcript from S3, stores on session record

All operations are non-blocking best-effort; transcription failures do not block session cleanup or pool release.

## Tasks Completed

### Task 1: Extend Session domain model with transcription fields ✓
- **Status:** Complete
- **Changes:** Added three optional fields to Session interface:
  - `transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed'` — lifecycle state
  - `transcriptS3Path?: string` — S3 location of transcript JSON (s3://bucket/sessionId/transcript.json)
  - `transcript?: string` — plain text transcript for immediate display
- **Files:** `backend/src/domain/session.ts`
- **Commit:** `58bd113`

### Task 2: Add updateTranscriptStatus repository function ✓
- **Status:** Complete
- **Changes:** New async function for atomically updating transcript fields:
  - Accepts status, optional s3Path, optional plainText
  - Uses UpdateCommand with dynamic expression building
  - Increments version field for optimistic locking
  - Follows existing session-repository patterns
- **Files:** `backend/src/repositories/session-repository.ts`
- **Tests:** Added 4 test cases covering all parameter combinations
- **Commit:** `6a62103`

### Task 3: Extend recording-ended handler to submit MediaConvert job ✓
- **Status:** Complete
- **Changes:** Added non-blocking MediaConvert job submission:
  - Only submits if `session.recordingStatus === 'available'`
  - Uses job naming format `vnl-{sessionId}-{epochMs}` for correlation
  - Converts HLS master.m3u8 to MP4 with H.264/AAC codecs
  - Tags job with sessionId and phase for audit
  - Wrapped in try/catch (errors logged, don't throw)
- **Files:** `backend/src/handlers/recording-ended.ts`
- **Commit:** `ee4fd8c`, `cd6df15`

### Task 4: Create transcode-completed handler (MediaConvert → Transcribe) ✓
- **Status:** Complete
- **Changes:** New EventBridge handler that:
  - Parses sessionId from MediaConvert job name (format: vnl-{sessionId}-{epochMs})
  - Handles job failures (ERROR/CANCELED) by setting transcriptStatus='failed'
  - Extracts MP4 output path from outputGroupDetails
  - Submits Transcribe job with explicit OutputBucketName
  - Updates session to transcriptStatus='processing' after submission
  - Full error handling with fallback to 'failed' status
- **Files:** `backend/src/handlers/transcode-completed.ts` (109 lines)
- **Commit:** `8ff076a`

### Task 5: Create transcribe-completed handler (Transcribe → session storage) ✓
- **Status:** Complete
- **Changes:** New EventBridge handler that:
  - Parses sessionId from Transcribe job name
  - Handles job failures (FAILED) by setting transcriptStatus='failed'
  - Fetches transcript JSON from S3 (s3://bucket/sessionId/transcript.json)
  - Extracts plain text from results.transcripts[0].transcript
  - Updates session with status='available', s3Path, and plainText
  - Gracefully handles missing/empty transcripts (logs warning, sets plainText='')
  - Logs transcript quality metrics (text length, word count)
- **Files:** `backend/src/handlers/transcribe-completed.ts` (109 lines)
- **Commit:** `2c9e9df`

## Dependencies & Prerequisites

**Environment variables required (set in Phase 19-02 CDK stack):**
- `AWS_REGION`: AWS region for SDK clients
- `AWS_ACCOUNT_ID`: AWS account ID for MediaConvert queue ARN
- `TABLE_NAME`: DynamoDB table name for session storage
- `TRANSCRIPTION_BUCKET`: S3 bucket for MediaConvert MP4 outputs and Transcribe transcript outputs
- `MEDIACONVERT_ROLE_ARN`: IAM role ARN for MediaConvert job execution

**AWS SDK modules installed:**
- `@aws-sdk/client-mediaconvert@^3.700.0`
- `@aws-sdk/client-transcribe@^3.700.0`
- `@aws-sdk/client-s3@^3.700.0`

## Verification Results

**Build verification:**
```
npm run build
> tsc
(success - no TypeScript errors)
```

**Test results:**
```
Test Suites: 34 passed, 34 total
Tests:       214 passed, 214 total (includes 4 new updateTranscriptStatus tests)
```

**Handler compilation:** All three handlers compile successfully with correct imports and logic.

**Domain model validation:** Session interface compiles with new transcript fields; existing code unaffected.

## Deviations from Plan

**[Rule 2 - Missing critical functionality] AWS SDK modules not pre-installed**
- **Found during:** Task 3 build
- **Issue:** TypeScript build failed with "Cannot find module '@aws-sdk/client-mediaconvert'" errors
- **Fix:** Installed missing AWS SDK client modules:
  - `npm install @aws-sdk/client-mediaconvert @aws-sdk/client-transcribe @aws-sdk/client-s3`
- **Files modified:** `backend/package.json`
- **Commit:** `cd6df15`

**[Rule 1 - Bug fix] MediaConvert Settings structure invalid**
- **Found during:** Task 3 build
- **Issue:** TypeScript error "No overload matches this call... 'VideoSelectors' does not exist in type 'Input'"
- **Fix:** Removed invalid VideoSelector field; audio/video inputs selected by default when not specified
- **Files modified:** `backend/src/handlers/recording-ended.ts`
- **Commit:** `cd6df15`

## Key Architectural Decisions

1. **Non-blocking pipeline:** Transcription job failures are logged but do NOT throw or block session cleanup. This preserves session lifecycle invariants — pool resources are always released, sessions always transition to ENDED.

2. **Job naming correlation:** All jobs use format `vnl-{sessionId}-{epochMs}` allowing handlers to extract sessionId without DynamoDB queries. The epochMs timestamp ensures job name uniqueness across retries.

3. **Optional S3 paths in transcript updates:** The `updateTranscriptStatus()` function accepts optional s3Path and plainText parameters, enabling partial updates. This pattern matches existing `updateRecordingMetadata()` design.

4. **Graceful transcript parsing:** If transcript JSON is missing or transcript text is empty, the handler logs warnings and still updates session to 'available' with empty plainText. Phase 20 will handle empty transcripts gracefully.

## Integration Points

**Upstream (recording-ended handler):**
- MediaConvert job submission triggered after recording metadata is finalized
- Job naming uses sessionId extracted from event detail

**Downstream (EventBridge routing - Phase 19-02):**
- EventBridge rules must route MediaConvert completion events to transcode-completed handler
- EventBridge rules must route Transcribe completion events to transcribe-completed handler
- Both rules require service-linked roles for Lambda invocation

## Next Steps (Phase 19-02)

Plan 19-02 will:
1. Wire MediaConvert and Transcribe completion events via EventBridge rules
2. Set environment variables in Lambda handler configuration
3. Create S3 bucket for transcription outputs with lifecycle policies
4. Configure IAM roles for MediaConvert and Transcribe execution
5. Create Lambda execution role policies granting S3, DynamoDB, and service permissions

## Self-Check: PASSED

- ✓ All 5 tasks executed
- ✓ All handlers compile without errors (npm run build succeeds)
- ✓ Domain model extends with transcriptStatus, transcriptS3Path, transcript fields
- ✓ Repository function updateTranscriptStatus() exists and tested (4 test cases)
- ✓ Recording-ended handler submits MediaConvert jobs non-blocking
- ✓ Transcode-completed handler created with job name parsing and Transcribe submission
- ✓ Transcribe-completed handler created with S3 fetch and session storage
- ✓ All 214 backend tests pass (no regressions)
- ✓ Task commits present in git history
