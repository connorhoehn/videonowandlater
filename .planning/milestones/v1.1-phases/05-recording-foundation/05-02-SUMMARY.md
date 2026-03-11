---
phase: 05-recording-foundation
plan: 02
subsystem: recording-handlers
tags: [recording, lambda, eventbridge, lifecycle, metadata]
dependency_graph:
  requires: [recording-infrastructure, recording-events, session-domain]
  provides: [recording-lifecycle-handlers, recording-metadata-extraction, recording-ready-pools]
  affects: [session-repository, replenish-pool, session-stack]
tech_stack:
  added: [eventbridge-lambda-targets, cloudfront-urls]
  patterns: [metadata-extraction, partial-updates, error-handling]
key_files:
  created:
    - backend/src/handlers/recording-started.ts
  modified:
    - backend/src/repositories/session-repository.ts
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/replenish-pool.ts
    - infra/lib/stacks/session-stack.ts
decisions:
  - title: Best-effort recording metadata updates
    rationale: Recording metadata updates should not block session state transitions or pool cleanup
    impact: Metadata extraction failures are logged but don't fail the handler
  - title: Dynamic UpdateExpression for recording fields
    rationale: Supports partial updates of recording metadata without overwriting other fields
    impact: Flexible metadata updates with optimistic locking via version increment
  - title: RecordingConfiguration attached at pool creation
    rationale: All new channels and stages are recording-ready from creation
    impact: No runtime configuration needed - sessions auto-record when streaming starts
metrics:
  tasks_completed: 3
  tasks_planned: 3
  duration_minutes: 4
  commits: 3
  files_modified: 5
  deviations: 0
  completed_at: "2026-03-03T01:06:00Z"
---

# Phase 05 Plan 02: Recording Lifecycle Handlers Summary

**One-liner:** EventBridge handlers for recording start/end events with CloudFront URL generation, dynamic metadata updates, and recording-ready resource pool creation.

## Objective Achievement

Implemented complete recording automation loop - handlers capture EventBridge events to track recording lifecycle, extract metadata, compute CloudFront URLs, and pool replenishment creates recording-ready resources with RecordingConfiguration attached.

**Status:** Complete - All tasks executed successfully with no deviations

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create Recording-Started Handler and Extend Repository | bd986ba | backend/src/handlers/recording-started.ts, backend/src/repositories/session-repository.ts |
| 2 | Extend Recording-Ended Handler with Metadata Extraction | bfdefd3 | backend/src/handlers/recording-ended.ts |
| 3 | Extend Pool Replenishment and Wire EventBridge Targets | a00c9fb | backend/src/handlers/replenish-pool.ts, infra/lib/stacks/session-stack.ts |

## Implementation Details

### Recording-Started Handler

**Purpose:** Capture IVS Recording Start events and update session recording status to 'processing'.

**Event Source:** EventBridge rule matching IVS Recording State Change events with `event_name: 'Recording Start'`

**Logic Flow:**
1. Extract resource ARN (channel_arn or stage_arn) from event detail
2. Find session by scanning DynamoDB for matching claimedResources.channel or claimedResources.stage
3. Update session with `recordingStatus: 'processing'` and `recordingS3Path` from event
4. Error handling: log failures but don't throw (EventBridge auto-retries)

**Key Code:**
```typescript
await updateRecordingMetadata(tableName, sessionId, {
  recordingStatus: 'processing',
  recordingS3Path: event.detail.recording_s3_key_prefix,
});
```

### Recording-Ended Handler Extensions

**New Functionality:** Extract metadata from IVS Recording End events and compute CloudFront URLs.

**Event Fields Used:**
- `recording_s3_key_prefix`: Base path for HLS manifest and thumbnails
- `recording_duration_ms`: Video duration in milliseconds
- `recording_status`: 'Recording End' (success) or 'Recording End Failure'

**CloudFront URL Computation:**
- **HLS Manifest:** `https://${CLOUDFRONT_DOMAIN}/${recording_s3_key_prefix}/master.m3u8`
- **Thumbnail:** `https://${CLOUDFRONT_DOMAIN}/${recording_s3_key_prefix}/thumb-0.jpg`

**Metadata Update:**
```typescript
await updateRecordingMetadata(tableName, sessionId, {
  recordingDuration: event.detail.recording_duration_ms,
  recordingHlsUrl,
  thumbnailUrl,
  recordingStatus: event.detail.recording_status === 'Recording End' ? 'available' : 'failed',
});
```

**Error Handling:** Metadata update wrapped in try/catch - failures logged but don't block session state transition (ENDING → ENDED) or pool resource release.

### Session Repository Extension

**New Function:** `updateRecordingMetadata(tableName, sessionId, metadata)`

**Supported Fields:**
- `recordingS3Path`: S3 key prefix from IVS
- `recordingDuration`: Duration in milliseconds
- `thumbnailUrl`: CloudFront URL for thumbnail
- `recordingHlsUrl`: CloudFront URL for HLS manifest
- `recordingStatus`: RecordingStatus enum value

**Pattern:** Dynamic UpdateExpression built from provided fields only - supports partial updates without overwriting other metadata.

**Optimistic Locking:** Increments version field to prevent concurrent modification conflicts.

**Example UpdateExpression:**
```
SET recordingDuration = :recordingDuration, recordingHlsUrl = :recordingHlsUrl,
    thumbnailUrl = :thumbnailUrl, recordingStatus = :recordingStatus,
    version = version + :inc
```

### Pool Replenishment Extensions

**Channel Creation:**
```typescript
new CreateChannelCommand({
  name: `vnl-pool-${uuidv4()}`,
  latencyMode: 'LOW',
  type: 'STANDARD',
  recordingConfigurationArn: recordingConfigArn,  // NEW
})
```

**Stage Creation:**
```typescript
new CreateStageCommand({
  name: `vnl-pool-${uuidv4()}`,
  autoParticipantRecordingConfiguration: {       // NEW
    storageConfigurationArn: recordingConfigArn,
    mediaTypes: ['AUDIO_VIDEO'],
  },
})
```

**Impact:** All broadcast channels and hangout stages in the pool are now recording-ready from creation. When claimed by a session and streaming starts, IVS automatically begins recording without additional configuration.

### EventBridge Integration

**Recording Start Rule:**
- Pattern: `{ source: ['aws.ivs'], detailType: ['IVS Recording State Change'], detail: { event_name: ['Recording Start'] } }`
- Target: recording-started Lambda function
- Created in Plan 05-01, wired to handler in this plan

**Recording End Rule V2:**
- Pattern: `{ source: ['aws.ivs'], detailType: ['IVS Recording State Change'], detail: { event_name: ['Recording End'] } }`
- Target: recording-ended Lambda function
- Note: Separate from legacy RecordingEndRule (uses recording_status field) for clean event filtering

**Environment Variables:**
- **recording-started:** `TABLE_NAME`
- **recording-ended:** `TABLE_NAME`, `CLOUDFRONT_DOMAIN`
- **replenish-pool:** `TABLE_NAME`, `MIN_CHANNELS`, `MIN_STAGES`, `MIN_ROOMS`, `RECORDING_CONFIGURATION_ARN`

**IAM Permissions:**
- All handlers: DynamoDB read/write on sessions table
- All handlers: S3 read access to recordings bucket (for future metadata file access)

## Deviations from Plan

None - plan executed exactly as written.

## Verification Results

All success criteria met:

- ✅ recording-started.ts handler exists and processes Recording Start events
- ✅ recording-ended.ts handler extracts metadata and computes CloudFront URLs
- ✅ session-repository.ts exports updateRecordingMetadata function
- ✅ replenish-pool.ts attaches recordingConfigurationArn to CreateChannel and CreateStage commands
- ✅ SessionStack wires recording-started and recording-ended handlers to EventBridge rules
- ✅ All handlers have required environment variables set
- ✅ Infra and backend packages compile successfully (TypeScript type-check passes)

**Code Verification:**
```
✅ updateRecordingMetadata calls found in recording-started.ts and recording-ended.ts
✅ recording-started sets recordingStatus='processing'
✅ recording-ended computes CloudFront URLs (recordingHlsUrl, thumbnailUrl)
✅ Error handling exists (try/catch blocks)
✅ recordingConfigurationArn in CreateChannelCommand
✅ autoParticipantRecordingConfiguration in CreateStageCommand
✅ EventBridge rules have Lambda targets attached
✅ Environment variables set (RECORDING_CONFIGURATION_ARN, CLOUDFRONT_DOMAIN, TABLE_NAME)
```

## Integration Flow

**End-to-End Recording Lifecycle:**

1. **Session Creation:** User creates session → API claims pool resource (channel or stage) with recordingConfigurationArn already attached
2. **Stream Start:** User begins streaming → IVS Stream Start event → session transitions to LIVE
3. **Recording Start:** IVS begins recording → Recording Start event → recording-started handler updates session recordingStatus='processing', stores recordingS3Path
4. **Stream End:** User stops streaming → API transitions session to ENDING
5. **Recording End:** IVS finalizes recording → Recording End event → recording-ended handler:
   - Extracts duration, S3 path, status from event
   - Computes CloudFront URLs for HLS manifest and thumbnail
   - Updates session with recordingDuration, recordingHlsUrl, thumbnailUrl, recordingStatus='available'
   - Transitions session to ENDED
   - Releases pool resources back to pool
6. **Replay Ready:** Session now has recordingStatus='available' with URLs - ready for Phase 6 home feed queries

**Future Phase Dependencies:**

- **Phase 6 (Home Feed):** Can query sessions with recordingStatus='available' and display thumbnailUrl
- **Phase 7 (Chat Replay Sync):** Can use recordingHlsUrl for synchronized playback with chat messages
- **Phase 8 (Hangouts):** Stages created by pool replenishment include autoParticipantRecordingConfiguration - hangout sessions auto-record

## Known Issues / Blockers

None. All tasks completed successfully.

## Next Steps

**Phase 6 - Home Feed:**
1. Create API endpoint to query sessions with recordingStatus='available'
2. Return recording metadata (thumbnailUrl, recordingDuration, createdAt) for feed display
3. Implement pagination for large result sets
4. Add GSI for efficient time-ordered queries

**Phase 7 - Chat Replay Sync:**
1. Use recordingHlsUrl from session metadata for video playback
2. Synchronize chat messages with video timeline using sessionRelativeTime
3. Implement seek-to-timestamp for navigating chat during replay

## References

- Plan file: `.planning/phases/05-recording-foundation/05-02-PLAN.md`
- Previous plan: `.planning/phases/05-recording-foundation/05-01-SUMMARY.md`
- Context: `.planning/phases/05-recording-foundation/05-CONTEXT.md`
- AWS IVS Recording Events: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html
- CloudFront Distributions: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-overview.html

## Self-Check: PASSED

All claimed files and commits verified:

**Files Created:**
- ✅ FOUND: backend/src/handlers/recording-started.ts

**Files Modified:**
- ✅ FOUND: backend/src/repositories/session-repository.ts
- ✅ FOUND: backend/src/handlers/recording-ended.ts
- ✅ FOUND: backend/src/handlers/replenish-pool.ts
- ✅ FOUND: infra/lib/stacks/session-stack.ts

**Commits:**
- ✅ FOUND: bd986ba (Task 1: recording-started handler and repository extension)
- ✅ FOUND: bfdefd3 (Task 2: recording-ended metadata extraction)
- ✅ FOUND: a00c9fb (Task 3: pool replenishment and EventBridge wiring)

**Exports Verified:**
- ✅ EXPORT: updateRecordingMetadata from session-repository.ts
- ✅ FUNCTION: recording-started handler exports handler function
- ✅ FUNCTION: recording-ended handler updated with metadata extraction
- ✅ INTEGRATION: EventBridge rules wired to Lambda targets in SessionStack
