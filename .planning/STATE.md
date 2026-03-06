---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Activity Feed & Intelligence
status: Implemented POST /sessions/{sessionId}/playback-token endpoint with ES384 JWT signing for private broadcast playback. Handler validates private sessions, extracts channel ARNs, generates time-limited tokens (24-hour default), and constructs playback URLs with token parameters. Comprehensive unit test coverage (8 tests) for token generation, defaults, and all error cases. Added jsonwebtoken dependency. All 331 backend tests passing.
stopped_at: Completed 22-03-PLAN.md (Activity feed private session filtering, private channel pool infrastructure, IVS playback key wiring)
last_updated: "2026-03-06T01:39:12.895Z"
last_activity: 2026-03-06 — Completed 22-02-PLAN.md (Playback token generation with ES384 JWT signing)
progress:
  total_phases: 19
  completed_phases: 17
  total_plans: 50
  completed_plans: 47
  percent: 98
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.
**Current focus:** v1.2 Phase 20 (AI Summary Pipeline) — Plan 05 complete (gap closure)

## Current Position

Phase: 22 of 22 (Live Broadcast with Secure Viewer Links) -- IN PROGRESS
Plan: 02 of 04 (Playback Token Handler) -- COMPLETE
Status: Implemented POST /sessions/{sessionId}/playback-token endpoint with ES384 JWT signing for private broadcast playback. Handler validates private sessions, extracts channel ARNs, generates time-limited tokens (24-hour default), and constructs playback URLs with token parameters. Comprehensive unit test coverage (8 tests) for token generation, defaults, and all error cases. Added jsonwebtoken dependency. All 331 backend tests passing.
Last activity: 2026-03-06 — Completed 22-02-PLAN.md (Playback token generation with ES384 JWT signing)

Progress: [████████████████████] 98% (46/48 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 44 (v1.1 + v1.2 + v1.3 start + gap closure)
- Average duration: 3.5 min
- Total execution time: ~141 min (including all phase executions)

**By Phase:**

| Phase | Plans | Completed | Avg/Plan |
|-------|-------|-----------|----------|
| 16 | 1 | 1 | 4 min |
| 17 | 1 | 1 | 3 min |
| 18 | 3 | 3 | 3.5 min |
| 19 | 5 | 5 | 4.5 min (01-04: 4.5 min avg, 05 gap closure: 1 min) |
| 20 | 2 | 2 | 4 min (01: 4 min, 05 gap closure: 15 min) |
| 21 | 4 | 4 | 4 min avg (init: 6min, handlers: 12min, mediaconvert: 8min, ui: 16min) |
| 22 | 4 | 1 | 2 min (22-01 complete) |

*Updated after each plan completion*
| Phase 18 P04 | 3min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Key decisions carried forward from v1.1:
- Single-table DynamoDB with GSI — reaction sharding uses GSI2SK lexicographic sort
- cognito:username (not sub) as userId consistently across all handlers
- player.getPosition() * 1000 for syncTime (elapsed playback ms relative to stream start)
- CloudFront OAC for S3 origins (recording playback)
- Public /recordings endpoint with no auth (content discoverability)

v1.2 decisions from Phase 17:
- **Reaction summary as optional field** - reactionSummary is Record<string, number>? on Session to maintain backward compatibility
- **Empty map for zero reactions** - Sessions with no reactions store {} not undefined (type consistency)
- **Non-blocking error handling** - computeAndStoreReactionSummary errors never block pool release (critical invariant)
- **Parallel shard aggregation** - Promise.all used to query all 100 shards per emoji type concurrently

v1.2 decisions from Phase 16:
- **PutCommand for participant upserts** - addHangoutParticipant uses PutCommand (not UpdateCommand) so re-joins overwrite without ConditionalCheckFailedException
- **displayName = cognito:username** - No separate display name exists in auth context; field is future-proof for enhancement
- **Count-at-end strategy** - participantCount computed at session end (recording-ended) not maintained as atomic counter during joins

v1.2 decisions from Phase 18:
- **Atomic messageCount in send-message** - messageCount incremented with `if_not_exists(messageCount, 0) + 1` pattern in send-message handler (not count-at-end or queried at read time)
- **GET /activity is public** - No auth required, matching /recordings endpoint pattern (content discoverability)
- **Single API call** - All metadata (reactionSummary, participantCount, messageCount) fetched in one query (eliminates N+1 on frontend)
- **Scan + Sort** - Uses ScanCommand for ended sessions, sorts in app memory (acceptable for activity feed with ~100 sessions)
- **Vitest for web component testing** (18-03) - Chose vitest over Jest for ESM-native testing, better Vite integration, and faster test runs. Excludes test files from TypeScript build via tsconfig pattern.

v1.2 decisions from Phase 19:
- **Non-blocking transcription pipeline** - Transcription job failures logged but don't throw or block session cleanup. Pool resources always released, sessions always transition to ENDED.
- **Job naming format vnl-{sessionId}-{epochMs}** - Enables sessionId extraction without DynamoDB queries; epochMs ensures uniqueness across retries.
- **Optional transcript fields** - updateTranscriptStatus() accepts optional s3Path and plainText parameters for partial updates (follows updateRecordingMetadata pattern).
- **Graceful transcript parsing** - Missing/empty transcripts logged as warnings; session still updated to 'available' with empty plainText for Phase 20 to handle gracefully.

v1.2 decisions from Phase 19-02 (Infrastructure Wiring):
- **AWS_REGION is reserved by Lambda** - Removed from environment variables; Lambda runtime provides automatically
- **DLQ resource policy deferred** - Moved to after transcription rule declarations to avoid TypeScript forward reference errors
- **Single DLQ for all rules** - recordingEventsDlq used for recording, transcode, and transcribe failures (unified error handling)
- **MediaConvertRole in CDK stack** - Created in TypeScript for safe reference in recordingEndedFn PolicyStatement

v1.2 decisions from Phase 20-01 (Backend):
- **Bedrock non-blocking pattern** - Bedrock/DynamoDB failures set aiSummaryStatus='failed' without touching aiSummary field (transcript preservation critical)
- **Claude Sonnet 4.5 model** - Best price/performance for 1-paragraph summaries; model ID: anthropic.claude-sonnet-4-5-20250929-v1:0
- **Lambda timeout 60s** - Accommodates Bedrock latency (5-10s typical) with buffer
- **Selective UpdateExpression** - updateSessionAiSummary only touches intended fields, never modifies transcriptText
- **EventBridge trigger on Transcript Stored** - Automatic coupling of Phase 19 → Phase 20 pipeline

v1.2 decisions from Phase 20-02 (Frontend):
- **Reusable SummaryDisplay component** - Encapsulates all status-based rendering logic (pending/available/failed) in single component
- **Nullish coalescing for backward compatibility** - Undefined aiSummaryStatus treated as 'pending' via `?? 'pending'` operator
- **Truncate prop controls line-clamp** - `truncate={true}` adds `line-clamp-2` for cards, `truncate={false}` for full text in replay panel
- **Data flow unchanged** - Frontend passes summary fields as-is from backend; no transformation in getRecentActivity
- **Summary positioning** - Below reactions on activity cards, above reactions on replay viewer for logical information hierarchy

v1.3 decisions from Phase 21-01 (Backend Domain Models):
- **UPLOAD sessions use existing Session model** - Reuse DynamoDB schema and GSI pattern rather than separate collection, maintaining backward compatibility
- **Field isolation via selective UpdateExpression** - uploadStatus/uploadProgress updated together; mediaConvertJobName/convertStatus updated separately to prevent accidental overwrites
- **No IVS resource claims for UPLOAD sessions** - Skip channel/stage claiming to reduce pool contention; chatRoom initialized as empty string for future chat feature
- **Session stays in CREATING status** - UPLOAD sessions remain in status='creating' until convertStatus='available' (unlike BROADCAST/HANGOUT which transition to live→ending→ended). Prevents "session status confusion" pitfall where frontend thinks session is ready before HLS URL populated.
- **Version field incrementation on all updates** - Following Phase 16-20 pattern, all UpdateCommand calls include `#version = #version + :inc` for optimistic locking
- [Phase 18]: Mock child components as passthrough divs to isolate parent component tests

v1.3 decisions from Phase 22-01 (Private Broadcast Foundation):
- **isPrivate as optional field** - Session.isPrivate?: boolean maintains backward compatibility with existing sessions (undefined treated as false/public)
- **Private channel pool suffix pattern** - STATUS#AVAILABLE#PRIVATE_CHANNEL and STATUS#CLAIMED#PRIVATE_CHANNEL differentiate private channels from public CHANNEL resources (consistent with ResourceType pattern)
- **claimPrivateChannel return signature** - Returns { channelArn, isPrivate: true } or null on unavailability; ConditionalCheckFailedException returns null (allows caller to retry)
- **Zero coupling with existing fields** - Adding isPrivate field does not affect any other Session fields or existing update patterns

v1.3 decisions from Phase 22-03 (Activity Feed & Private Channel Infrastructure):
- **Activity feed filtering in handler** - Private session filtering applied after getRecentActivity() returns sorted results; maintains existing sort behavior without re-sorting
- **Public-default backward compatibility** - Sessions without isPrivate field treated as public (undefined is falsy); enables zero-migration for legacy sessions
- **Private channel pool replenishment** - Dedicated createPrivateChannel() function mirrors createChannel() pattern; stored with GSI1PK=STATUS#AVAILABLE#PRIVATE_CHANNEL marker
- **MIN_PRIVATE_CHANNELS configuration** - Default 5 private channels (one-fifth of public pool) assumes fewer broadcasts are private; configurable via environment variable
- **IVS_PLAYBACK_PRIVATE_KEY bootstrap** - Read from process.env during CDK synthesis; allows flexible deployment configuration without code changes (future JWT token generation)

Gap closure decisions (Phase 19-05):
- **EventBridge event Detail contract alignment** - Emit transcriptText (plaintext content) instead of transcriptS3Uri in Transcript Stored events to match Phase 20's store-summary consumer interface expectation
- **Payload minimalism principle** - Event Detail contains only fields downstream consumers use: { sessionId, transcriptText }; removed unused timestamp field
- **Empty string semantics** - When plainText is empty, emit transcriptText: '' (not omitted) to maintain consistent contract structure

Gap closure decisions (Phase 20-05):
- **S3 as authoritative transcript source** - Phase 19 emits transcriptS3Uri (S3 reference), Phase 20 fetches from S3 (not EventBridge payload). Eliminates payload size limits, keeps S3 as source of truth
- **S3 URI parsing strategy** - Regex pattern `^s3://([^/]+)/(.+)$` validates URI format before GetObjectCommand; validation errors thrown (handled by outer catch block as non-blocking)
- **Non-blocking empty transcript** - Sessions with empty S3 transcripts get aiSummaryStatus='failed' without Bedrock invocation or throwing; prevents cascading failures
- **transformToString for plaintext** - Use SDK's Body?.transformToString() method for UTF-8 extraction (not manual Buffer handling)

### Roadmap Evolution

- Phase 21 added: Video Uploads — Support uploading pre-recorded videos (mov/mp4 from phone or computer) with processing, transcription, and adaptive bitrate streaming
- Phase 22 added: Live Broadcast with Secure Viewer Links — Users can broadcast a live video stream and share a secure viewing link with others for real-time engagement

### Pending Todos

None.

### Blockers/Concerns

- Phase 19 (Transcription Pipeline): HLS/MediaConvert input format conflict is unresolved. Default assumption is MediaConvert required (FEATURES.md, backed by official AWS Transcribe docs). Run research-phase before plan-phase for Phase 19.
- Phase 20 (AI Summary): Bedrock Anthropic FTU form is a manual console step — cannot be automated via CDK. Must be documented as pre-deployment step in plan 20-01. Confirm model availability in deployment region at implementation time.

## Session Continuity

Last session: 2026-03-06T01:27:00Z
Stopped at: Completed 22-03-PLAN.md (Activity feed private session filtering, private channel pool infrastructure, IVS playback key wiring)

---
*State initialized: 2026-03-05 (v1.2 milestone)*
*Last updated: 2026-03-06 — 22-03 complete (GET /activity endpoint filters private sessions by owner; comprehensive filtering tests (6 new); private channel pool replenishment with MIN_PRIVATE_CHANNELS; countAvailablePrivateChannels() function; IVS_PLAYBACK_PRIVATE_KEY environment variable wiring in CDK; 321/321 backend tests passing; Phase 22 activity feed and channel infrastructure ready)*
