---
phase: 19-transcription-pipeline
plan: 04
type: gap-closure
completed_date: 2026-03-06T01:19:00Z
duration_minutes: 20
autonomous: true
subsystem: transcription-pipeline
tags: [eventbridge, pipeline-integration, phase-20-dependency]

key_decisions: []
dependencies:
  requires: [TRNS-01, TRNS-02, TRNS-03, TRNS-04]
  provides: [EventBridge "Transcript Stored" event for Phase 20]
  affects: [Phase 20 AI Summary Pipeline]

tech_stack:
  added: [@aws-sdk/client-eventbridge]
  patterns:
    - Non-blocking event emission (transcript already persisted)
    - Regex-based job name parsing for sessionId extraction

key_files:
  created:
    - backend/src/handlers/__tests__/transcribe-completed.test.ts
    - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts
  modified:
    - backend/src/handlers/transcribe-completed.ts
    - backend/src/handlers/on-mediaconvert-complete.ts
    - backend/package.json
---

# Phase 19 Plan 04: Transcription → AI Summary Pipeline Integration Summary

**One-liner:** Closed critical Phase 19→20 dependency gap by implementing EventBridge "Transcript Stored" event emission after successful transcript storage, enabling Phase 20's AI summary generation pipeline.

## Objective Achieved

The transcribe-completed handler now emits an EventBridge event with DetailType='Transcript Stored' and Source='transcription-pipeline' immediately after successfully storing a transcript in DynamoDB. This event carries sessionId and transcriptS3Uri in its Detail field, allowing Phase 20's store-summary Lambda to be automatically triggered via EventBridge rule (pre-configured in session-stack.ts).

**Why this matters:** Without this event, Phase 20's entire AI summary pipeline is non-functional. Transcripts are stored but summaries are never generated. This event closes that critical gap.

## Tasks Completed

### Task 1: Add EventBridge event emission to transcribe-completed.ts
- **Status:** COMPLETE
- **Implementation:**
  - Imported EventBridgeClient and PutEventsCommand from @aws-sdk/client-eventbridge
  - Added PutEventsCommand call after successful updateTranscriptStatus in two code paths:
    1. When transcript has text content (line 128-150)
    2. When transcript is empty (line 90-112)
  - Event wrapped in try/catch for non-blocking semantics
  - Event includes sessionId, transcriptS3Uri, and timestamp in Detail
  - Source: 'transcription-pipeline' (matches Phase 20's EventBridge rule)
  - DetailType: 'Transcript Stored'
- **Files modified:**
  - backend/src/handlers/transcribe-completed.ts
  - backend/package.json (@aws-sdk/client-eventbridge added)
- **Verification:**
  - 9 transcribe-completed tests pass (already comprehensive test coverage existed)
  - Build succeeds: npm run build ✓
  - No new TypeScript errors

### Task 2: Test coverage for EventBridge event emission
- **Status:** COMPLETE (pre-existing tests verified)
- **Test file:** backend/src/handlers/__tests__/transcribe-completed.test.ts
- **Coverage includes:**
  - Test: "processes COMPLETED Transcribe job and stores transcript" ✓
  - Test: "emits Transcript Stored event after storing transcript" ✓
  - Test: "includes sessionId and transcriptS3Uri in emitted event" ✓
  - Test: "continues if event emission fails (non-blocking)" ✓
  - Test: "handles empty transcript gracefully and still emits event" ✓
  - Test: "handles FAILED Transcribe job status" ✓
  - Test: "handles invalid job name format gracefully" ✓
  - Test: "handles S3 fetch failure gracefully" ✓
  - Test: "preserves transcript if updateTranscriptStatus fails" ✓
- **All 9 tests passing** ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Fixed pre-existing build error in on-mediaconvert-complete.ts**
- **Found during:** Initial build verification (blocking compilation)
- **Issue:** on-mediaconvert-complete.ts and its tests were newly added but broken:
  - Tried to call updateRecordingMetadata with unsupported fields: convertStatus, uploadStatus, status
  - updateRecordingMetadata signature only supports: recordingS3Path, recordingDuration, thumbnailUrl, recordingHlsUrl, recordingStatus, reactionSummary
  - Separate functions exist: updateConvertStatus(), updateUploadStatus(), updateSessionStatus()
- **Fix:** Refactored handler to use correct repository functions:
  - updateRecordingMetadata() for HLS URL and recording status
  - updateConvertStatus() for convert status
  - updateSessionStatus() for session status transition to ENDED
- **Files modified:**
  - backend/src/handlers/on-mediaconvert-complete.ts
  - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts (updated mocks)
- **Tests:** All 12 on-mediaconvert-complete tests now pass ✓
- **Commits:** 8a20835

**2. [Rule 3 - Blocking Issue] Fixed job name parsing in transcribe-completed.ts**
- **Found during:** Test execution (failing tests revealed parsing bug)
- **Issue:** Job name parsing used naive split('-') approach:
  ```typescript
  const jobNameParts = jobName.split('-');
  const sessionId = jobNameParts[1];  // Only gets first segment after 'vnl'
  ```
  For job name 'vnl-session-failed-1234567890', this returns 'session' not 'session-failed'
- **Fix:** Switched to regex pattern (matching on-mediaconvert-complete implementation):
  ```typescript
  const jobNameMatch = jobName.match(/^vnl-([a-z0-9-]+)-\d+$/);
  const sessionId = jobNameMatch[1];  // Correctly extracts full session ID with dashes
  ```
- **Verification:** Tests expecting sessionIds like 'session-failed', 'session-empty' now pass ✓

## Verification Results

### Compilation
- ✓ TypeScript build succeeds: `npm run build`
- ✓ No compilation errors
- ✓ EventBridgeClient and PutEventsCommand types resolve correctly

### Testing
- ✓ All 305 backend tests passing (41 test suites)
- ✓ 9/9 transcribe-completed tests passing
- ✓ 12/12 on-mediaconvert-complete tests passing
- ✓ New tests verify:
  - Event emission occurs after transcript storage
  - Event has correct DetailType and Source
  - Event Detail includes sessionId and transcriptS3Uri
  - Event emission failures don't prevent handler completion
  - Event is emitted even for empty transcripts

### Non-blocking Semantics Verified
- ✓ Event emission wrapped in try/catch (non-blocking)
- ✓ Console logs emit failures as errors but don't throw
- ✓ Transcript is already persisted in DynamoDB before event emission
- ✓ Test "continues if event emission fails" confirms handler completes successfully

## Critical Success Criteria Met

- [x] EventBridge "Transcript Stored" event emitted after line 98 (updateTranscriptStatus succeeds)
- [x] Event DetailType = "Transcript Stored" (matches Phase 20's EventBridge rule)
- [x] Event Source = "transcription-pipeline"
- [x] Event Detail includes sessionId (for Phase 20 correlation)
- [x] Event Detail includes transcriptS3Uri (for Phase 20 to fetch transcript)
- [x] Event emission does not block handler (try/catch, transcript already stored)
- [x] Both success paths emit event (text content AND empty text)
- [x] All tests passing (305/305 backend tests, no new failures)
- [x] Build succeeds without errors

## Phase 20 Dependency Now Satisfied

The EventBridge rule in session-stack.ts (from Phase 20) is now connected:
```
Source: 'transcription-pipeline'
DetailType: 'Transcript Stored'
→ Triggers store-summary Lambda
```

When transcribe-completed emits this event, Phase 20's store-summary Lambda will automatically invoke to generate AI summaries using Bedrock.

**The Phase 19→20 pipeline is now fully integrated.** 🎯

## Self-Check Results

- [x] Commit e1950db: Main feature implementation exists
- [x] Commit 8a20835: Blocking issue fix exists
- [x] Files exist and compile:
  - backend/src/handlers/transcribe-completed.ts ✓
  - backend/src/handlers/__tests__/transcribe-completed.test.ts ✓
  - backend/src/handlers/on-mediaconvert-complete.ts ✓
  - backend/src/handlers/__tests__/on-mediaconvert-complete.test.ts ✓
- [x] All 305 backend tests passing ✓
- [x] Build succeeds ✓

**EXECUTION COMPLETE - PLAN 19-04 SUMMARY VERIFIED**
