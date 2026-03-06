---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Activity Feed & Intelligence
status: executing
stopped_at: Completed 19-01-PLAN.md (transcription pipeline setup)
last_updated: "2026-03-06T01:05:00.000Z"
last_activity: 2026-03-06 — Completed 19-01-PLAN.md (transcription pipeline domain, handlers, and repository)
progress:
  total_phases: 20
  completed_phases: 14
  total_plans: 40
  completed_plans: 33
  percent: 82.5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.
**Current focus:** v1.2 Phase 16 complete, Phase 17 complete — next: Phase 18 (Homepage Redesign)

## Current Position

Phase: 19 of 20 (Transcription Pipeline) -- IN PROGRESS
Plan: 01 of 02 (Transcription Pipeline Setup) -- COMPLETE
Status: Plan 19-01 complete, awaiting 19-02 (Infrastructure & EventBridge Wiring)
Last activity: 2026-03-06 — Completed 19-01-PLAN.md (transcription pipeline domain, handlers, and repository)

Progress: [████████░░] 82.5% (33/40 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 6 (v1.2)
- Average duration: 3.2 min
- Total execution time: 31 min

**By Phase:**

| Phase | Plans | Completed | Avg/Plan |
|-------|-------|-----------|----------|
| 16 | 1 | 1 | 4 min |
| 17 | 1 | 1 | 3 min |
| 18 | 3 | 3 | 3.5 min |
| 19 | 2 | 1 | 6 min (so far) |

*Updated after each plan completion*

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

v1.2 decisions pending:
- Phase 20: Bedrock model ID and regional availability confirmation

### Roadmap Evolution

- Phase 21 added: Video Uploads — Support uploading pre-recorded videos (mov/mp4 from phone or computer) with processing, transcription, and adaptive bitrate streaming

### Pending Todos

None.

### Blockers/Concerns

- Phase 19 (Transcription Pipeline): HLS/MediaConvert input format conflict is unresolved. Default assumption is MediaConvert required (FEATURES.md, backed by official AWS Transcribe docs). Run research-phase before plan-phase for Phase 19.
- Phase 20 (AI Summary): Bedrock Anthropic FTU form is a manual console step — cannot be automated via CDK. Must be documented as pre-deployment step in plan 20-01. Confirm model availability in deployment region at implementation time.

## Session Continuity

Last session: 2026-03-06
Stopped at: Completed 19-01-PLAN.md (transcription pipeline setup - domain, handlers, repository)

---
*State initialized: 2026-03-05 (v1.2 milestone)*
*Last updated: 2026-03-06 — 19-01 complete (transcription pipeline domain extended, updateTranscriptStatus() repository function, recording-ended MediaConvert submission, transcode-completed and transcribe-completed handlers)*
