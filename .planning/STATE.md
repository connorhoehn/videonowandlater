---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Activity Feed & Intelligence
status: completed
stopped_at: Completed 18-03-PLAN.md (reaction summary in replay viewer)
last_updated: "2026-03-06T00:51:37.995Z"
last_activity: 2026-03-06 — Completed 18-03-PLAN.md (reaction summary display in ReplayViewer)
progress:
  total_phases: 18
  completed_phases: 15
  total_plans: 39
  completed_plans: 32
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-05)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.
**Current focus:** v1.2 Phase 16 complete, Phase 17 complete — next: Phase 18 (Homepage Redesign)

## Current Position

Phase: 18 of 20 (Homepage Redesign - Activity Feed) -- COMPLETE
Plan: 03 of 03 (Reaction Summary in Replay Viewer) -- COMPLETE
Status: Completed (Phase 18 all plans done)
Last activity: 2026-03-06 — Completed 18-03-PLAN.md (reaction summary display in ReplayViewer)

Progress: [██████████] 100% (32/32 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 5 (v1.2)
- Average duration: 3.4 min
- Total execution time: 25 min

**By Phase:**

| Phase | Plans | Completed | Avg/Plan |
|-------|-------|-----------|----------|
| 16 | 1 | 1 | 4 min |
| 17 | 1 | 1 | 3 min |
| 18 | 3 | 3 | 3.5 min |

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
Stopped at: Completed 18-03-PLAN.md (reaction summary in replay viewer)

---
*State initialized: 2026-03-05 (v1.2 milestone)*
*Last updated: 2026-03-06 — 18-03 complete (ReplayViewer extended with reaction summary display, vitest infrastructure added for web testing)*
