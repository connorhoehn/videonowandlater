# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- ✅ **v1.3 Secure Sharing** - Phases 21-22 (shipped 2026-03-06 as part of v1.2)
- ✅ **v1.4 Creator Studio & Stream Quality** - Phases 22.1, 23-24 (shipped 2026-03-10)
- ✅ **v1.5 Pipeline Reliability, Moderation & Upload Experience** - Phases 22.1, 23-30 (shipped 2026-03-11)
- ✅ **v1.6 Pipeline Durability, Cost & Debug** - Phases 31-35 (shipped 2026-03-11)
- 🚧 **v1.7 Event Hardening & UI Polish** - Phases 36-41 (in progress)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See milestones/v1.0-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.1 Replay, Reactions & Hangouts (Phases 5-15) - SHIPPED 2026-03-05</summary>

Milestone completed. See milestones/v1.1-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.2 Activity Feed & Intelligence (Phases 16-22) - SHIPPED 2026-03-06</summary>

**Milestone Goal:** Surface richer session context on the homepage — hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed — and add an automated transcription and AI summary pipeline to every recording.

**What Was Built:**
- Phase 16: Hangout Participant Tracking — Durably record participant joins in DynamoDB with participantCount field on session
- Phase 17: Reaction Summary at Session End — Pre-compute per-emoji reaction counts when sessions end
- Phase 18: Homepage Redesign & Activity Feed — Two-zone layout with recording slider and activity feed below
- Phase 19: Transcription Pipeline — Automated S3-to-Transcribe pipeline triggered by recording completion
- Phase 20: AI Summary Pipeline — Inline Bedrock call generates one-paragraph summaries for every recording
- Phase 21: Video Uploads — Users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding
- Phase 22: Live Broadcast with Secure Viewer Links — Private broadcasts with ES384 JWT tokens for access control

See milestones/v1.2-ROADMAP.md for full details.

</details>

<details>
<summary>✅ v1.4 Creator Studio & Stream Quality (Phases 22.1, 23-24) - SHIPPED 2026-03-10</summary>

**Milestone Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**What Was Built:**
- Phase 22.1: Pipeline Fixes & UI Enhancements — Urgent fixes and enhancements from v1.2 completion
- Phase 23: Stream Quality Monitoring Dashboard — Real-time metrics display (bitrate, FPS, resolution, network status, health score) for broadcasters
- Phase 24: Creator Spotlight Selection & Display — Feature another live creator during broadcast with elegant overlay UI

</details>

<details>
<summary>✅ v1.5 Pipeline Reliability, Moderation & Upload Experience (Phases 22.1, 23-30) — SHIPPED 2026-03-11</summary>

**Milestone Goal:** Harden the recording/transcription/AI pipeline with structured observability and automatic recovery, give broadcasters and users moderation tools, and build a rich dedicated player page for uploaded videos.

- [x] Phase 22.1: Pipeline Fixes & UI Enhancements (3/3 plans) — completed 2026-03-06
- [x] Phase 23: Stream Quality Monitoring Dashboard (6/6 plans) — completed 2026-03-06
- [x] Phase 24: Creator Spotlight Selection & Display (3/3 plans) — completed 2026-03-10
- [x] Phase 25: Pipeline Observability (2/2 plans) — completed 2026-03-10
- [x] Phase 26: Stuck Session Recovery Cron (2/2 plans) — completed 2026-03-10
- [x] Phase 27: Speaker-Attributed Transcripts (2/2 plans) — completed 2026-03-10
- [x] Phase 28: Chat Moderation (3/3 plans) — completed 2026-03-10
- [x] Phase 29: Upload Video Player Core (2/2 plans) — completed 2026-03-11
- [x] Phase 30: Upload Video Player Social (3/3 plans) — completed 2026-03-11

See milestones/v1.5-ROADMAP.md for full details.

</details>

<details>
<summary>✅ v1.6 Pipeline Durability, Cost & Debug (Phases 31-35) — SHIPPED 2026-03-11</summary>

**Milestone Goal:** Replace brittle fire-and-forget EventBridge→Lambda with SQS-backed durable queues for all critical pipeline steps, harden handlers to throw on failure (enabling real retries), cut AI summary costs by switching to Nova Lite, and ship CLI debug tools for pipeline introspection.

- [x] Phase 31: SQS Pipeline Buffers (2/2 plans) — completed 2026-03-11
- [x] Phase 32: Handler Hardening & Idempotency (4/4 plans) — completed 2026-03-11
- [x] Phase 33: Pipeline Alarms & Dashboard (1/1 plan) — completed 2026-03-11
- [x] Phase 34: Nova Lite for AI Summaries (1/1 plan) — completed 2026-03-11
- [x] Phase 35: Pipeline Debug CLI (1/1 plan) — completed 2026-03-11

See milestones/v1.6-ROADMAP.md for full details.

</details>

### 🚧 v1.7 Event Hardening & UI Polish (In Progress)

**Milestone Goal:** Harden the event-driven backend with X-Ray distributed tracing, Zod schema validation at all handler boundaries, idempotency gap coverage for the two remaining unguarded handlers, and operator DLQ tooling — then complete every incomplete UI area across transcript display, activity feed, and live session pages.

## Phase Details

### ✅ Phase 36: X-Ray Distributed Tracing — completed 2026-03-12
**Goal**: Developer can observe every pipeline execution end-to-end in the X-Ray service map with per-stage annotations and per-call subsegments
**Depends on**: Phase 35 (SQS queue ARNs and handler structure established)
**Requirements**: TRACE-01, TRACE-02, TRACE-03, TRACE-04
**Success Criteria** (what must be TRUE):
  1. Developer can open the X-Ray console and see all 5 pipeline Lambda functions as nodes in the service map after triggering a recording
  2. Each pipeline trace shows individual subsegments for every downstream AWS SDK call (DynamoDB reads/writes, S3 gets/puts, Transcribe submissions, Bedrock invocations, MediaConvert job submissions)
  3. Developer can search X-Ray traces by sessionId or pipelineStage annotation without reading CloudWatch logs
  4. A completed pipeline run produces a connected chain of trace nodes from recording-ended through store-summary visible in a single service map view
**Plans**: 4 plans

Plans:
- [x] 036-01-PLAN.md — TDD: tracer assertions for all 5 handler test files (Wave 0 contracts)
- [x] 036-02-PLAN.md — Refactor recording-ended + transcode-completed with module-scope traced clients
- [x] 036-03-PLAN.md — Refactor transcribe-completed + store-summary + on-mediaconvert-complete with traced clients
- [x] 036-04-PLAN.md — CDK active tracing config + deploy + X-Ray service map verification

### ✅ Phase 37: Event Schema Validation — completed 2026-03-13
**Goal**: All 5 pipeline handlers reject malformed events at the boundary before executing any side effects, and the start-transcribe transient error swallowing bug is fixed
**Depends on**: Phase 36 (tracing in place so validation failures are observable in X-Ray)
**Requirements**: VALID-01, VALID-02, VALID-03, VALID-04
**Success Criteria** (what must be TRUE):
  1. A message with a missing required field (e.g., no sessionId) sent to any pipeline SQS queue is acknowledged without retry and logged with the specific field name, received value, and handler name
  2. A message with a valid schema but a transient Transcribe API error in start-transcribe is retried by SQS (not silently acknowledged), and eventually lands in the DLQ if all retries exhaust
  3. Developer can find any schema validation failure in CloudWatch Logs by searching for the field name or handler name without custom log parsing
  4. All 5 handlers receive typed event objects (no `as any` casts) downstream of the validation boundary
**Plans**: 4 plans

Plans:
- [x] 037-01-PLAN.md — TDD: Define Zod schemas + validation test cases (Wave 0 contracts) — completed 2026-03-13
- [x] 037-02-PLAN.md — Implement validation in recording-ended + transcode-completed (Wave 1) — completed 2026-03-13
- [x] 037-03-PLAN.md — Implement validation in transcribe-completed + store-summary + on-mediaconvert-complete (Wave 1) — completed 2026-03-13
- [x] 037-04-PLAN.md — Fix start-transcribe transient error bug + implement validation (Wave 2) — completed 2026-03-13

### Phase 38: Idempotency Gap Coverage
**Goal**: The two remaining pipeline handlers without idempotency guards (transcribe-completed and store-summary) safely handle duplicate SQS deliveries without re-executing expensive operations
**Depends on**: Phase 37 (typed validated events provide reliable idempotency key extraction)
**Requirements**: IDEM-01, IDEM-02, IDEM-03
**Success Criteria** (what must be TRUE):
  1. Re-driving a transcribe-completed message that already ran (transcript stored in S3) produces no second S3 write and no error — the message is acknowledged cleanly
  2. Re-driving a store-summary message that already ran (AI summary stored) produces no second Bedrock invocation and no error — the message is acknowledged cleanly
  3. Sending the same message twice concurrently (simulating SQS at-least-once delivery) to either handler results in exactly one execution completing and the duplicate being acknowledged without side effects
**Plans**: 4 plans

Plans:
- [x] 038-01-PLAN.md — TDD: Write IDEM-01, IDEM-02, IDEM-03 test cases (Wave 1) — completed 2026-03-14
- [x] 038-02-PLAN.md — Implement idempotency guards in transcribe-completed + store-summary (Wave 2) — completed 2026-03-14
- [x] 038-03-PLAN.md — Verify IDEM-03 concurrent delivery test passes (Wave 2) — completed 2026-03-14
- [x] 038-04-PLAN.md — Add vnl-idempotency DynamoDB table to CDK (Wave 3, optional infrastructure) — completed 2026-03-14

### Phase 39: DLQ Re-drive Tooling
**Goal**: Developer can inspect, re-drive, and purge messages from any of the 5 pipeline DLQs via CLI without touching the AWS console
**Depends on**: Phase 36 (X-Ray tracing makes re-driven messages traceable end-to-end)
**Requirements**: DLQ-01, DLQ-02, DLQ-03, DLQ-04
**Success Criteria** (what must be TRUE):
  1. Developer runs a single CLI command and sees a decoded list of all messages in a named DLQ with sessionId, event type, and error context — without consuming the messages from the queue
  2. Developer can re-drive all messages from a named DLQ back to its source queue with one command, and verify the messages flow through the pipeline by watching X-Ray traces appear
  3. Developer can permanently delete a specific DLQ message by receipt handle after investigation
  4. Developer can run a health-check command that prints the approximate message count for all 5 DLQs in one output
**Plans**: 1 plan

Plans:
- [ ] 039-01-PLAN.md — Four DLQ CLI commands: list, redrive, purge, health (Wave 1-2)

### Phase 40: UI Polish — Replay & Feed
**Goal**: The replay viewer transcript panel is fully interactive, the AI summary panel has distinct visual states, and the activity feed cards are complete with thumbnail, duration, and accurate pipeline status
**Depends on**: Phase 36 (independent of backend hardening phases; depends only on existing pipeline state fields)
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. User clicks a transcript segment on the replay or video page and the video player immediately seeks to that timestamp
  2. The AI summary panel on the replay and video pages displays three visually distinct states: a spinner or progress indicator while processing, formatted summary text when available, and an explicit error message when failed — not the same plain text style for all three states
  3. Activity feed cards on the home page show a video thumbnail image when one is available for the session
  4. Activity feed cards display the recording duration in human-readable format (e.g., "12 min 34 sec")
  5. Activity feed cards show the current pipeline processing stage (transcribing, summarizing, complete, failed) as a status badge, and cards in non-terminal states refresh automatically without a full page reload
**Plans**: 2 plans

Plans:
- [x] 040-01-PLAN.md — Transcript click-to-seek + SummaryDisplay distinct visual states (Wave 1)
- [x] 040-02-PLAN.md — Activity card thumbnail, duration format, pipeline status badge, polling (Wave 1)

### Phase 41: UI Polish — Live Session & Upload
**Goal**: Broadcast and hangout live pages are complete with confirmation dialogs, hangout has reaction parity with broadcast, and the upload video page is fully functional with accurate pipeline state and working comment/transcript panels
**Depends on**: Phase 40 (UI patterns established; these are independent of backend phases)
**Requirements**: UI-06, UI-07, UI-08, UI-09
**Success Criteria** (what must be TRUE):
  1. Clicking "Stop Broadcast" or "Leave Hangout" shows a confirmation dialog before ending the session — accidental taps do not terminate live sessions
  2. Hangout participants can open a reaction picker and send floating reactions during a live session, matching the reaction experience on the broadcast page
  3. The upload video page shows a pipeline progress indicator while the video is still transcribing or being summarized, and updates to the final state when processing completes
  4. Users can submit a timestamped comment on the upload video page, see it appear in the thread, and click it to seek the video to the correct position; the transcript panel displays all segments and supports click-to-seek
**Plans**: 3 plans

Plans:
- [ ] 041-01-PLAN.md — Wave 0 TDD: failing test scaffolds for ConfirmDialog, HangoutPage, VideoPage, CommentThread (UI-06, UI-07, UI-08, UI-09)
- [ ] 041-02-PLAN.md — ConfirmDialog component + BroadcastPage/HangoutPage confirmation guards + HangoutPage reactions (UI-06, UI-07)
- [ ] 041-03-PLAN.md — VideoPage pipeline polling + seekVideo wiring through VideoInfoPanel and CommentThread (UI-08, UI-09)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 36. X-Ray Distributed Tracing | v1.7 | 4/4 | Complete | 2026-03-12 |
| 37. Event Schema Validation | v1.7 | 4/4 | Complete | 2026-03-13 |
| 38. Idempotency Gap Coverage | v1.7 | 3/4 | In Progress | - |
| 39. DLQ Re-drive Tooling | v1.7 | 0/TBD | Not started | - |
| 40. UI Polish — Replay & Feed | v1.7 | 2/2 | Complete | 2026-03-15 |
| 41. UI Polish — Live Session & Upload | v1.7 | 0/3 | Not started | - |
