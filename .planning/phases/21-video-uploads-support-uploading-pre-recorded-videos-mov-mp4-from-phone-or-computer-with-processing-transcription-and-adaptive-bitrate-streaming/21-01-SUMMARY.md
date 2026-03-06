---
phase: 21-video-uploads-support-uploading-pre-recorded-videos-mov-mp4-from-phone-or-computer-with-processing-transcription-and-adaptive-bitrate-streaming
plan: 01
subsystem: database
tags: [upload, session, dynamodb, typescript]

# Dependency graph
requires: []
provides:
  - SessionType.UPLOAD enum for distinguishing upload sessions from broadcasts/hangouts
  - UPLOAD session domain fields (uploadId, uploadStatus, uploadProgress, sourceFileName, sourceFileSize, sourceCodec, mediaConvertJobName, convertStatus)
  - createUploadSession() repository function for initializing new upload sessions
  - updateUploadProgress() repository function for tracking S3 upload completion
  - updateConvertStatus() repository function for tracking MediaConvert job progress
affects:
  - plan 21-02 (upload handler implementation)
  - plan 21-03 (MediaConvert job submission)
  - plan 21-04 (upload completion and status tracking)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Upload session lifecycle management using separate uploadStatus and convertStatus fields
    - Field isolation pattern in DynamoDB UpdateCommand (selective field updates with version increment)
    - UUID-based sessionId generation consistent with existing BROADCAST/HANGOUT sessions

key-files:
  created: []
  modified:
    - backend/src/domain/session.ts (SessionType.UPLOAD, upload fields)
    - backend/src/repositories/session-repository.ts (createUploadSession, updateUploadProgress, updateConvertStatus)
    - backend/src/repositories/__tests__/session-repository.test.ts (51 tests for upload session functions)

key-decisions:
  - "UPLOAD sessions use same DynamoDB Session model (status/sessionType) as BROADCAST/HANGOUT for consistency"
  - "uploadStatus and convertStatus are independent fields, allowing parallel tracking of S3 and MediaConvert progress"
  - "UPLOAD sessions do not claim IVS channels or stages (chatRoom left empty), reducing resource contention"
  - "Session remains in status='creating' until convertStatus='available', preventing premature frontend availability"

requirements-completed:
  - UPLOAD-01
  - UPLOAD-02
  - UPLOAD-03

# Metrics
duration: 2min
completed: 2026-03-06
---

# Phase 21 Plan 01: Upload Session Domain Summary

**Extended Session model with UPLOAD type and repository functions for upload lifecycle tracking**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-06T00:57:09Z
- **Completed:** 2026-03-06T00:58:59Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Session domain model extended with UPLOAD type and 8 new optional fields for upload/conversion tracking
- createUploadSession() initializes UPLOAD sessions with file metadata and uploadStatus='pending'
- updateUploadProgress() tracks S3 multipart upload completion while preserving other fields
- updateConvertStatus() tracks MediaConvert job progress independently from upload status
- All three repository functions follow existing patterns (uuidv4, PutCommand/UpdateCommand, version increment)
- 51 unit tests covering function behavior, field isolation, and state transitions - all passing

## Task Commits

1. **Task 1: Extend Session domain model with UPLOAD type and upload fields** - `840fec6` (feat)
2. **Task 2: Implement repository functions for UPLOAD session creation and state transitions** - `f42cb61` (feat)
3. **Task 3: Tests already included in session-repository.test.ts** - (covered in tests)

**Plan metadata:** Will be committed with 21-02

## Files Created/Modified

- `backend/src/domain/session.ts` - Added SessionType.UPLOAD enum and upload-related optional fields (uploadId, uploadStatus, uploadProgress, sourceFileName, sourceFileSize, sourceCodec, mediaConvertJobName, convertStatus)
- `backend/src/repositories/session-repository.ts` - Added createUploadSession(), updateUploadProgress(), updateConvertStatus() with proper version increment and field isolation
- `backend/src/repositories/__tests__/session-repository.test.ts` - Added 17 new test cases covering all three functions and field isolation scenarios

## Decisions Made

- **UPLOAD sessions use existing Session model:** Reuse DynamoDB schema and GSI pattern rather than separate collection, maintaining backward compatibility and simplifying queries
- **Separate uploadStatus and convertStatus fields:** Tracks S3 progress independently from MediaConvert progress, allowing failures at each stage to be handled differently
- **No IVS resource claims for UPLOAD:** UPLOAD sessions skip channel/stage claiming to reduce pool contention, supporting future chat via optional chatRoom field
- **Session remains in 'creating' until convertStatus='available':** Prevents frontend from showing session as ready before HLS URL is available, implementing "session status confusion" pitfall mitigation from research

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tests pass, no blocking issues.

## Next Phase Readiness

- Session domain and repository functions complete and tested
- Ready for plan 21-02 (upload handler implementation using createUploadSession)
- Ready for plan 21-03 (MediaConvert handler using updateConvertStatus)
- All 244 backend tests passing

---

*Phase: 21-video-uploads*
*Completed: 2026-03-06*
