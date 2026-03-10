---
gsd_state_version: 1.0
milestone: v1.5
milestone_name: Pipeline Reliability, Moderation & Upload Experience
status: planning
last_updated: "2026-03-10T16:32:41.239Z"
progress:
  total_phases: 9
  completed_phases: 4
  total_plans: 14
  completed_plans: 14
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

**Current focus:** v1.5 Milestone — Pipeline Reliability, Moderation & Upload Experience

## Current Position

**Active Phase:** Phase 25 — Pipeline Observability (plans 01-02 complete)
**Active Plan:** 25-02 complete — ready for Phase 26
**Status:** Ready to plan
**Progress:** [██████████] 100%
**Last session:** 2026-03-10T16:29:05.306Z

## Performance Metrics

**Velocity:**
- Plans completed (v1.4): 9
- Tasks completed (v1.4): 18
- Phases completed (v1.4): 3/3

**Quality:**
- Test coverage: 360/360 backend tests passing
- Breaking changes: 0 (all v1.4 additions backward compatible)
- New dependencies added in v1.4: none shipped

**Milestone History:**
- v1.0 Gap Closure: 6 phases, 13 plans (shipped 2026-03-02)
- v1.1 Replay, Reactions & Hangouts: 15 phases, 27 plans (shipped 2026-03-05)
- v1.2 Activity Feed & Intelligence: 7 phases, 19 plans (shipped 2026-03-06)
- v1.4 Creator Studio & Stream Quality: 3 phases, 9 plans (shipped 2026-03-10)

## Accumulated Context

### Key Decisions

**v1.5 Architecture — Structured Logging (Phase 25):**
- Use `@aws-lambda-powertools/logger` (already installed at ^2.31.0) — NOT custom console.log wrappers
- Initialize Logger at module scope with `persistentKeys: { pipelineStage: '<handler-name>' }` per handler
- Use `logger.appendPersistentKeys({ sessionId })` inside the handler for per-invocation correlation
- Add explicit CDK `logGroup` with `RetentionDays.ONE_MONTH` to: RecordingEnded, TranscodeCompleted, TranscribeCompleted, StoreSummary, StartTranscribe
- Follow existing `ivsEventAuditFn` log group pattern in session-stack.ts

**v1.5 Architecture — Stuck Session Cron (Phase 26):**
- Query GSI1 for `STATUS#ENDING` partition — do NOT full-table scan (prevents RCU cost explosion)
- Filter threshold: `endedAt < 45 minutes ago` AND `transcriptStatus != 'processing'`
- Cap retries at 3 via `recoveryAttemptCount` field on session record
- Re-fire via EventBridge PutEvents (not direct Lambda.invoke) to preserve DLQ/retry semantics
- EventBridge Scheduler rate(15 min) — consistent with existing ReplenishPoolSchedule pattern

**v1.5 Architecture — Speaker Diarization (Phase 27):**
- Add `Settings.ShowSpeakerLabels: true, MaxSpeakerLabels: 2` to StartTranscriptionJobCommand
- Read `speaker_label` directly from each `results.items[N]` word item (not from `speaker_labels.segments`)
- Store compact `speakerSegments` array in S3 only; write `diarizedTranscriptS3Path` pointer on session
- NEVER store segment arrays inline in DynamoDB — 400KB item limit risk on long recordings
- Display labels as "Speaker 1" / "Speaker 2" — username mapping not possible from composite audio

**v1.5 Architecture — Chat Moderation (Phase 28):**
- `DisconnectUser` API call alone is insufficient — must also block token in `create-chat-token.ts`
- Moderation log uses existing single table: `PK: SESSION#{id}`, `SK: MOD#{ts}#{uuid}`
- Token blocklist check in `create-chat-token.ts`: query `MOD#` SK prefix, deny if BOUNCE record exists
- Frontend: BounceButton visible only when `authUser.userId === session.userId` (broadcaster)
- Frontend: ReportButton hidden by default on hover, appears on all non-own messages

**v1.5 Architecture — Upload Video Player (Phases 29-30):**
- Install `hls.js@^1.6.0` in web/ — IVS Player does not expose quality level switching API
- Use `hls.currentLevel` setter for manual quality switching (flushes buffer, correct UX)
- Safari fallback: `Hls.isSupported()` returns false — use `video.src = hlsUrl` and hide quality picker
- Comment storage: `PK: SESSION#{id}`, `SK: COMMENT#{zeroPadded15DigitMs}#{uuid}`
- Comment display: poll every 250ms, highlight comments within ±1500ms of current position
- Extend `useReplayPlayer` hook to return `{ player, qualities }` — do not fork the hook

**Carried Forward from v1.4:**
- cognito:username (not sub) as userId consistently across all handlers
- Single-table DynamoDB with optional fields for backward compatibility
- Conditional writes for atomic operations (prevent race conditions)
- Non-blocking error handling — failures logged but don't block critical operations
- `removeUndefinedValues: true` in DynamoDB marshallOptions

### Known Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cron double-submits MediaConvert jobs | HIGH | Exclude `transcriptStatus = 'processing'` AND `mediaconvertJobId` set; use 45-min threshold |
| Bounced user reconnects immediately | HIGH | Token blocklist in create-chat-token.ts is mandatory — DisconnectUser alone is insufficient |
| DynamoDB 400KB item limit on diarized transcript | HIGH | Store segments in S3 only; enforce size guard before any DynamoDB write |
| HLS.js quality switch stall on Safari | MEDIUM | Use `hls.currentLevel` on Chrome/Firefox; hide quality picker on Safari (Hls.isSupported() = false) |
| CORS on HLS sub-manifests blocks quality levels | MEDIUM | Verify CloudFront cache behavior returns Access-Control-Allow-Origin on all *.m3u8 and *.ts paths |
| Cron full table scan cost | HIGH | Must use GSI1 STATUS#ENDING query — full scan is forbidden |
| Phase 25-pipeline-observability P02 | 2 | 1 tasks | 1 files |
| Phase 25-pipeline-observability P01 | 7 | 2 tasks | 7 files |

### Roadmap Evolution

- Phase 22.1 inserted after Phase 22: Pipeline Fixes & UI Enhancements (URGENT, completed)
- v1.5 roadmap defined 2026-03-10: Phases 25-30

### Pending Todos

- [ ] Phase 25: Pipeline Observability — add Powertools Logger to all 5 pipeline handlers
- [ ] Phase 26: Stuck Session Recovery — new scan-stuck-sessions.ts Lambda + EventBridge Scheduler
- [ ] Phase 27: Speaker Diarization — modify start-transcribe.ts + transcribe-completed.ts + frontend display
- [ ] Phase 28: Chat Moderation — new bounce-user.ts + report-message.ts + frontend buttons
- [ ] Phase 29: Upload Video Player Core — new VideoPage.tsx + HLS.js + quality selector + routing
- [ ] Phase 30: Upload Video Player Social — comments API + CommentThread + reactions + transcript panel

### Blockers

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 1 | Fix MediaConvert EventBridge rule | 2026-03-06 | 177aed2 | [1-fix-mediaconvert-eventbridge-rule](./quick/1-fix-mediaconvert-eventbridge-rule/) |
| 2 | Update webapp scripts to connect to user | 2026-03-06 | 5462ffd | [2-update-webapp-scripts-to-connect-to-user](./quick/2-update-webapp-scripts-to-connect-to-user/) |
| 3 | Add start-transcribe handler to complete pipeline | 2026-03-06 | 4c65427 | [3-add-start-transcribe-handler-to-complete](./quick/3-add-start-transcribe-handler-to-complete/) |

## Session Continuity

**If resuming work:**
1. Check current phase in .planning/ROADMAP.md (Phase 25 is next)
2. Run `/gsd:plan-phase 25` to generate the Phase 25 plan
3. Phase 25 requirements: PIPE-01, PIPE-02, PIPE-03, PIPE-04
4. Key file to modify: backend/src/handlers/ (recording-ended, transcode-completed, transcribe-completed, store-summary, start-transcribe) + infra/lib/stacks/session-stack.ts

**If blocked:**
- Consult .planning/research/ARCHITECTURE.md for integration point details
- Consult .planning/research/STACK.md for Powertools Logger API usage pattern
- Consult .planning/research/PITFALLS.md for known failure modes per phase

**Next action:** Roadmap complete. Run `/gsd:plan-phase 25` to begin Pipeline Observability.

---

**Milestone started:** 2026-03-10
**Expected completion:** TBD
