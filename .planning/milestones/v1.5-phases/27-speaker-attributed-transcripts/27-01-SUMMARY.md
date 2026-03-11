---
phase: 27-speaker-attributed-transcripts
plan: "01"
subsystem: transcription-pipeline
tags:
  - transcription
  - speaker-diarization
  - aws-transcribe
  - s3
  - dynamodb
  - lambda
dependency_graph:
  requires:
    - Phase 19 transcription pipeline (start-transcribe, transcribe-completed)
    - Phase 20 AI summary pipeline (EventBridge Transcript Stored event)
  provides:
    - Speaker-attributed SpeakerSegment[] stored in S3 per session
    - diarizedTranscriptS3Path pointer on session DynamoDB record
    - GET /sessions/{id}/speaker-segments API endpoint
  affects:
    - start-transcribe.ts (new Settings field sent to AWS Transcribe)
    - transcribe-completed.ts (new speaker segment grouping + S3 write)
    - session-stack.ts (grantReadWrite on transcription bucket)
tech_stack:
  added: []
  patterns:
    - Non-blocking inner try-catch for speaker segment S3 write
    - Word-level speaker_label grouping with gap-based flush (>1000ms)
    - SPEAKER_MAP normalization (spk_0 -> Speaker 1, spk_1 -> Speaker 2)
    - S3 key pattern: {sessionId}/speaker-segments.json
key_files:
  created:
    - backend/src/handlers/get-speaker-segments.ts
    - backend/src/handlers/__tests__/get-speaker-segments.test.ts
  modified:
    - backend/src/domain/session.ts
    - backend/src/repositories/session-repository.ts
    - backend/src/handlers/start-transcribe.ts
    - backend/src/handlers/transcribe-completed.ts
    - backend/src/handlers/__tests__/start-transcribe.test.ts
    - backend/src/handlers/__tests__/transcribe-completed.test.ts
    - infra/lib/stacks/session-stack.ts
decisions:
  - "Store speaker segments in S3 only (never inline DynamoDB) to avoid 400KB item limit on long recordings"
  - "Speaker S3 write is wrapped in separate try-catch so failures are non-blocking"
  - "Gap threshold of 1000ms between same-speaker words triggers a segment flush"
  - "SPEAKER_MAP normalizes AWS labels (spk_0/spk_1) to user-friendly (Speaker 1/Speaker 2)"
metrics:
  duration_seconds: 258
  completed_date: "2026-03-10"
  tasks_completed: 3
  files_changed: 9
---

# Phase 27 Plan 01: Speaker-Attributed Transcript Pipeline Summary

Speaker diarization added to the transcription pipeline: StartTranscriptionJobCommand now requests ShowSpeakerLabels + MaxSpeakerLabels: 2, word-level labels are grouped into SpeakerSegment[] and written to S3, and a new GET endpoint returns the segments array.

## Objective

Add speaker diarization to the transcription pipeline: request speaker labels from AWS Transcribe, parse them into turn segments, store in S3, and expose via a new API endpoint.

## What Was Built

### Task 1: Domain + Repository Changes
- Added `diarizedTranscriptS3Path?: string` to Session interface in `session.ts` (after `transcriptS3Path`)
- Added `updateDiarizedTranscriptPath(tableName, sessionId, path)` to `session-repository.ts` following existing UpdateCommand pattern with `ExpressionAttributeNames` aliasing and version increment

### Task 2: Pipeline Handler Changes + New API Handler + Tests
- **start-transcribe.ts**: Added `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 }` to `transcribeParams`
- **transcribe-completed.ts**:
  - Extended `TranscribeOutput` interface with `items` array including `speaker_label` per word
  - Added `buildSpeakerSegments()` helper: iterates word-level items, groups consecutive same-speaker words into `SpeakerSegment[]`, flushes on speaker change or gap > 1000ms, appends punctuation to current segment
  - After extracting `plainText`, builds speaker segments in a separate try-catch block
  - Writes `speaker-segments.json` via `PutObjectCommand` then calls `updateDiarizedTranscriptPath`
  - Failures in the speaker segment block are logged but do NOT block `transcriptStatus = available` or EventBridge emission
- **get-speaker-segments.ts** (new): APIGatewayProxyHandler following `get-transcript.ts` pattern
  - Returns 400 if sessionId missing
  - Returns 404 if session not found
  - Returns 404 with "Speaker segments not available" if `diarizedTranscriptS3Path` absent
  - Reads segments from S3 using `GetObjectCommand` with `Key = session.diarizedTranscriptS3Path`
  - Returns 200 with `{ sessionId, segments: SpeakerSegment[] }`
  - Returns 500 on S3 error
  - All responses include `Access-Control-Allow-Origin: *`
- **Tests**: 24 targeted tests pass (7 new speaker tests in transcribe-completed, 5 new get-speaker-segments tests, 1 new start-transcribe test)

### Task 3: CDK S3 Write Permission
- Changed `transcriptionBucket.grantRead(transcribeCompletedFn)` to `transcriptionBucket.grantReadWrite(transcribeCompletedFn)` to allow PutObject for `speaker-segments.json`

## Verification

- Full test suite: 411/411 backend tests pass (no regressions)
- `npx tsc --noEmit` in both `backend/` and `infra/`: zero TypeScript errors
- Session interface has `diarizedTranscriptS3Path?: string`
- `updateDiarizedTranscriptPath` exported from session-repository.ts
- `start-transcribe.ts` sends `ShowSpeakerLabels: true` and `MaxSpeakerLabels: 2`
- `transcribe-completed.ts` writes `speaker-segments.json` and calls `updateDiarizedTranscriptPath`
- `get-speaker-segments.ts` exports `handler` returning SpeakerSegment[]
- `session-stack.ts` has `grantReadWrite` on `transcribeCompletedFn`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1    | 8aa6867 | feat(27-01): add diarizedTranscriptS3Path to Session and repository |
| 2    | 5d5f1bd | feat(27-01): speaker diarization pipeline handlers and get-speaker-segments API |
| 3    | a7c9b2f | feat(27-01): grant readWrite on transcriptionBucket to transcribeCompletedFn |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
