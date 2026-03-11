# Phase 5: Recording Foundation - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Auto-record all broadcast and hangout sessions to S3 with metadata tracking. Recording infrastructure that downstream phases (replay viewer, reactions) depend on. Includes S3 bucket, CloudFront distribution, IVS RecordingConfiguration, EventBridge handlers for recording lifecycle events, and UI states for processing/failed recordings.

</domain>

<decisions>
## Implementation Decisions

### Recording Metadata Schema
- **Structure:** Flat fields added directly to Session interface (not nested object)
- **Fields to store:**
  - `recordingS3Path`: S3 key prefix from IVS (e.g., "ivs/v1/123456/2026/3/2/...")
  - `recordingDuration`: Duration in milliseconds from IVS event
  - `thumbnailUrl`: CloudFront URL for first/representative thumbnail
  - `recordingHlsUrl`: CloudFront URL for HLS manifest (derived from S3 path)
  - `recordingStatus`: Enum tracking recording lifecycle
- **Population timing:** Two-phase approach
  - `recording-started` event: Set `recordingStatus='processing'`, `recordingS3Path`
  - `recording-ended` event: Add `recordingDuration`, `thumbnailUrl`, `recordingHlsUrl`, set `recordingStatus='available'` or `'failed'`
- **Status states:** Four states for `recordingStatus` enum
  - `pending`: Session created but recording not started yet
  - `processing`: Recording in progress or finalizing (IVS reconnect window)
  - `available`: Recording complete and ready for playback
  - `failed`: Recording encountered an error

### Error Handling & Reconnects
- **UI processing state:** Show "Processing recording..." message when `recordingStatus='processing'`
  - Display spinner/progress indicator
  - Poll or use WebSocket to detect when status becomes `'available'`
  - Success criteria: "Reconnect windows handled gracefully with 'Processing recording...' UI state during 30-60 second window"
- **Failed recordings:** Keep visible in feed with error message
  - Set `recordingStatus='failed'` on recording-ended error event
  - Display error state in UI ("Recording failed") but don't hide the session
  - User can see session happened even if recording didn't work
- **Reconnect window handling:** Rely on IVS automatic stream merging
  - No special handling for reconnects
  - Trust IVS defaults (auto-merge if reconnect < 10s per research)
  - EventBridge events delayed 2-5 minutes after stream ends due to reconnect window
- **EventBridge handlers:** Create separate `recording-started` Lambda handler
  - New handler for 'IVS Recording State Change' with `event_name='Recording Start'`
  - Sets `recordingStatus='processing'` immediately when recording begins
  - Enables earlier UI feedback than waiting for stream end
  - Existing `recording-ended.ts` handler extended to store metadata and set final status

### RecordingConfiguration Settings
- **Count:** One shared RecordingConfiguration for all sessions
  - Used by both broadcast channels and hangout stages
  - Simpler CDK stack, consistent settings across session types
  - Typical AWS pattern per research
- **Thumbnail generation:**
  - Interval: 10 seconds
  - Resolution: 720p
  - Good balance of preview quality and storage cost
- **Video renditions:** ALL (full ABR stack)
  - Record all renditions from LOWEST_RESOLUTION through FULL_HD
  - Enables adaptive quality in replay viewer based on user's network
  - IVS default, best quality per research
- **Attachment timing:** During pool replenishment
  - Attach `recordingConfigurationArn` when creating channels/stages in `replenish-pool.ts`
  - Resources are recording-ready from creation
  - Aligns with existing pool pattern (pre-warm resources with full config)

### Claude's Discretion
- CloudFront distribution configuration (OAC vs signed URLs, cache settings, regional distribution)
- S3 bucket lifecycle policies (retention, storage class transitions)
- Error message text and UI design for processing/failed states
- DynamoDB attribute names (recordingS3Path vs recording_s3_path vs recordingS3Key)
- EventBridge rule retry policies and dead letter queue setup

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Session domain model** (`backend/src/domain/session.ts`): Lifecycle states (creating → live → ending → ended), SessionType enum (BROADCAST, HANGOUT), canTransition validation function. Extend with recording metadata fields.
- **recording-ended.ts handler** (`backend/src/handlers/recording-ended.ts`): Already listens for 'IVS Recording State Change' events, transitions session ENDING → ENDED, releases pool resources. Needs extension to store recording metadata (currently ignores `recording_s3_bucket_name`, `recording_s3_key_prefix`, `recording_duration_ms` from event detail).
- **session-repository.ts** (`backend/src/repositories/session-repository.ts`): DynamoDB access patterns for sessions. Add methods to update recording metadata.
- **SessionStack CDK** (`infra/lib/stacks/session-stack.ts`): EventBridge rules for IVS events, Lambda functions with DynamoDB/IVS permissions. Add S3 bucket, CloudFront distribution, RecordingConfiguration constructs.

### Established Patterns
- **DynamoDB single-table design:** PK/SK for primary access, GSI1 for status-based queries. Recording metadata stored as flat fields on session items. GSI2 for time-series queries planned for Phase 7 (reactions).
- **EventBridge integration:** Existing rules for stream-started and recording-ended events. Add recording-started rule. Event handlers use NodejsFunction with 30s-5min timeouts.
- **CDK patterns:** NodejsFunction for Lambdas, IAM policies for AWS SDK clients, EventBridge Rule → LambdaFunction targets. RemovalPolicy.DESTROY for dev/test resources.
- **Pool replenishment:** Scheduled every 5 minutes via EventBridge, creates IVS channels/stages/chat rooms with MIN_CHANNELS/STAGES/ROOMS env vars. Attach recordingConfigurationArn during creation.

### Integration Points
- **SessionStack (`infra/lib/stacks/session-stack.ts`):** Add S3 bucket construct, CloudFront distribution (OAC for private bucket), IVS RecordingConfiguration (CfnRecordingConfiguration + CfnStorageConfiguration from aws-cdk-lib). Export recordingConfigurationArn for pool replenishment.
- **replenish-pool.ts handler:** Modify CreateChannelCommand and CreateStageCommand calls to include `recordingConfigurationArn` parameter.
- **recording-ended.ts handler:** Parse event detail to extract `recording_s3_bucket_name`, `recording_s3_key_prefix`, `recording_duration_ms`. Compute CloudFront URLs (hlsUrl, thumbnailUrl). Update session item with recording metadata. Handle success vs failure event status.
- **New recording-started.ts handler:** Listen for 'IVS Recording State Change' with `event_name='Recording Start'`. Find session by channel/stage ARN. Update `recordingStatus='processing'` and `recordingS3Path`.
- **Session interface:** Add optional fields for recording metadata (all fields optional since sessions don't have recordings until stream starts).
- **Frontend (future Phase 6):** Query sessions, display "Processing recording..." if `recordingStatus='processing'`, show error if `'failed'`, link to replay if `'available'`.

</code_context>

<specifics>
## Specific Ideas

- Research shows EventBridge events delayed 2-5 minutes due to IVS reconnect windows — UI must reflect this with clear "processing" state
- IVS RecordingConfiguration is regional — S3 bucket must be in same region (us-east-1 per PROJECT.md)
- CloudFront with OAC required for private S3 bucket access (research: standard pattern for IVS recordings)
- Thumbnail interval must be less than encoder IDR/Keyframe interval or thumbnails won't generate correctly (IVS constraint from research)
- recording-ended.json metadata file in S3 includes duration_ms, renditions, thumbnails array — parse this for comprehensive metadata
- Success criteria: "User creates broadcast session and it auto-records to S3 without any manual setup" + "Recording metadata appears in session item after stream ends" + "CloudFront distribution serves recordings via signed URLs" + "Reconnect windows handled gracefully with 'Processing recording...' UI state"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-recording-foundation*
*Context gathered: 2026-03-02*
