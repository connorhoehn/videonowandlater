# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- ✅ **v1.3 Secure Sharing** - Phases 21-22 (shipped 2026-03-06 as part of v1.2)
- ✅ **v1.4 Creator Studio & Stream Quality** - Phases 22.1, 23-24 (shipped 2026-03-10)
- 🚧 **v1.5 Pipeline Reliability, Moderation & Upload Experience** - Phases 25-30 (in progress)

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

### v1.5 Pipeline Reliability, Moderation & Upload Experience (In Progress)

**Milestone Goal:** Harden the recording/transcription/AI pipeline with structured observability and automatic recovery, give broadcasters and users moderation tools, and build a rich dedicated player page for uploaded videos.

**Phases:**

- [x] **Phase 25: Pipeline Observability** - Structured logging across all pipeline Lambdas with consistent correlation keys and 30-day log retention (completed 2026-03-10)
- [x] **Phase 26: Stuck Session Recovery Cron** - Cron that identifies sessions stuck in the pipeline and re-fires recovery events (completed 2026-03-10)
- [ ] **Phase 27: Speaker-Attributed Transcripts** - Transcribe diarization with speaker-turn display in Replay and Upload Video pages
- [ ] **Phase 28: Chat Moderation** - Broadcaster bounce/kick + per-message report action for all chat users
- [ ] **Phase 29: Upload Video Player Core** - Dedicated /video/:sessionId route with HLS.js quality selector and navigation wiring
- [ ] **Phase 30: Upload Video Player Social** - Async comments, emoji reactions, and transcript/AI summary panel on the video page

## Phase Details

### Phase 22.1: Pipeline Fixes & UI Enhancements with all the todos (INSERTED)
**Goal:** Address urgent fixes and enhancements discovered during v1.2 milestone completion.

**Depends on:** Phase 22 (completed)

**Requirements:** None (maintenance phase)

**Success Criteria** (what must be TRUE):
  1. All identified pipeline fixes are implemented and tested
  2. UI enhancements are integrated without breaking existing functionality
  3. All todos from recent work are captured and addressed
  4. System remains stable and performant after changes

**Plans:** 3/3 plans complete

Plans:
- [x] 22.1-01-PLAN.md — Add CDK custom resource for IVS cleanup on stack deletion ✅
- [x] 22.1-02-PLAN.md — Switch AI processing from Claude to Nova Pro model ✅
- [x] 22.1-03-PLAN.md — Create upload activity card variant for activity feed ✅

### Phase 23: Stream Quality Monitoring Dashboard
**Goal:** Broadcaster can monitor stream health in real-time without disrupting broadcast experience.

**Depends on:** Phase 22 (v1.3) — WebRTC stats API patterns established

**Requirements:** QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05, QUAL-06, QUAL-07, QUAL-08

**Success Criteria** (what must be TRUE):
  1. Broadcaster can view real-time dashboard overlay showing bitrate, frame rate, resolution, and network status during live broadcast
  2. Dashboard displays health score (0-100%) that updates every 1-2 seconds with visual indicators for connection quality
  3. Dashboard shows warning badge when bitrate drops more than 30% below target, alerting broadcaster to quality degradation
  4. Dashboard overlay does not obstruct stream preview or interfere with broadcast controls (non-intrusive positioning)
  5. Metrics collection and display operates with no perceptible API latency impact on broadcast performance

**Plans:** 6/6 plans complete

Plans:
- [x] 23-00-PLAN.md — Dashboard scaffold with real-time polling requirements ✅
- [x] 23-01-PLAN.md — Stream metrics domain model and WebRTC polling hook ✅
- [x] 23-02-PLAN.md — Dashboard UI component with expand/collapse states ✅
- [x] 23-03-PLAN.md — Dashboard integration with backward compatibility ✅
- [x] 23-04-PLAN.md — Load test script for QUAL-06 validation ✅
- [ ] 23-05-PLAN.md — Gap closure: Backward compatibility tests and QUAL-06 validation

### Phase 24: Creator Spotlight Selection & Display
**Goal:** Broadcaster can feature another live creator during broadcast; viewers can discover and navigate to featured stream.

**Depends on:** Phase 23 (Stream Quality Dashboard validation gates pass)

**Requirements:** SPOT-01, SPOT-02, SPOT-03, SPOT-04, SPOT-05, SPOT-06, SPOT-07, SPOT-08

**Success Criteria** (what must be TRUE):
  1. Broadcaster can open featured creator selection modal and search/browse live broadcasters from their viewer list
  2. Featured creator appears as picture-in-picture overlay or elegant badge on broadcast page with name and avatar
  3. Viewers can see featured creator link on stream detail page and click to navigate to that broadcaster's stream
  4. Featured creator selection is restricted to public broadcasts only (private broadcasts cannot feature or be featured)
  5. When broadcast ends or broadcaster removes featured creator, spotlight is automatically cleared with no stale data persisting

**Plans:** 2/3 plans executed

Plans:
- [ ] 24-01-PLAN.md — Backend domain model, repository methods, and API handlers for spotlight
- [ ] 24-02-PLAN.md — Frontend spotlight UI components and page integration
- [ ] 24-03-PLAN.md — CDK API stack wiring for spotlight Lambda handlers

---

### Phase 25: Pipeline Observability
**Goal:** Every stage of the recording-to-transcript pipeline emits structured, correlated logs that a developer can query by sessionId to reconstruct the full pipeline timeline.

**Depends on:** Phase 24 (v1.4 complete)

**Requirements:** PIPE-01, PIPE-02, PIPE-03, PIPE-04

**Success Criteria** (what must be TRUE):
  1. A developer can run a single CloudWatch Logs Insights query filtered by `sessionId` and see log entries from every pipeline Lambda (recording-ended, transcode-completed, transcribe-completed, store-summary) in chronological order
  2. Every log entry includes `pipelineStage`, `sessionId`, `status`, and `durationMs` fields so failures are identifiable without reading handler source code
  3. All pipeline Lambda log groups have 30-day retention configured in CDK — no log group accumulates indefinitely after deployment
  4. Pipeline log entries are filterable by stage name without post-processing (Powertools `persistentKeys.pipelineStage` per handler)

**Plans:** 2/2 plans complete

Plans:
- [ ] 25-01-PLAN.md — Add Powertools Logger to all 5 pipeline handler files
- [ ] 25-02-PLAN.md — Add CDK log group retention to all 5 pipeline Lambda constructs

---

### Phase 26: Stuck Session Recovery Cron
**Goal:** Sessions that enter the pipeline but never reach a completed transcript status are automatically detected and re-triggered without developer intervention.

**Depends on:** Phase 25 (pipeline logs make cron recovery verifiable in CloudWatch)

**Requirements:** PIPE-05, PIPE-06, PIPE-07, PIPE-08

**Success Criteria** (what must be TRUE):
  1. A session with `transcriptStatus` null or `pending` and `endedAt` more than 45 minutes ago is identified by the cron and a recovery EventBridge event is emitted to re-enter the pipeline at the appropriate stage
  2. A session with `transcriptStatus = 'processing'` (MediaConvert or Transcribe job actively running) is skipped by the cron — no double-submission occurs
  3. A session that has already been recovered 3 times has `recoveryAttemptCount = 3` on its DynamoDB record and is excluded from further cron recovery attempts
  4. The recovery cron fires every 15 minutes via EventBridge Scheduler and completes within the Lambda 5-minute timeout for any realistic number of stuck sessions

**Plans:** 2/2 plans complete

Plans:
- [ ] 26-01-PLAN.md — scan-stuck-sessions handler + unit tests (detection, filtering, atomic counter, PutEvents)
- [ ] 26-02-PLAN.md — recording-ended.ts recovery guard + CDK Lambda/Scheduler/Rule wiring

---

### Phase 27: Speaker-Attributed Transcripts
**Goal:** Recordings produce a speaker-turn transcript where each segment is attributed to a labeled speaker, displayed in Replay and Upload Video pages as alternating turns with timestamps.

**Depends on:** Phase 25 (pipeline logging must be in place before modifying transcription handlers, so debug output is captured)

**Requirements:** SPKR-01, SPKR-02, SPKR-03, SPKR-04, SPKR-05, SPKR-06

**Success Criteria** (what must be TRUE):
  1. New transcription jobs are submitted with `ShowSpeakerLabels: true` — Transcribe output JSON contains a `speaker_labels` section with per-segment attribution
  2. The `transcribe-completed.ts` handler parses speaker segments and stores them in S3 with the path written to `diarizedTranscriptS3Path` on the session — no segment arrays are stored inline in DynamoDB
  3. Replay page and Upload Video page display the transcript as alternating speaker turns with "Speaker 1" / "Speaker 2" labels and segment start timestamps
  4. Sessions recorded before this phase (without `diarizedTranscriptS3Path`) continue to display their plain transcript without any error or missing state
  5. A speaker label size guard prevents DynamoDB item size errors on long recordings — segments exceeding the inline size threshold are stored exclusively in S3

**Plans:** 2 plans

Plans:
- [ ] 27-01-PLAN.md — To be planned
- [ ] 27-02-PLAN.md — To be planned

---

### Phase 28: Chat Moderation
**Goal:** Broadcasters can remove disruptive users from their active chat session, and any user can privately report a message — all actions are recorded in a durable moderation log.

**Depends on:** Phase 24 (v1.4 complete; no dependency on Phases 25-27)

**Requirements:** MOD-01, MOD-02, MOD-03, MOD-04, MOD-05, MOD-06, MOD-07, MOD-08

**Success Criteria** (what must be TRUE):
  1. Broadcaster sees a bounce button on each non-own message in the participant chat list; clicking it calls the backend which disconnects the target user's WebSocket and writes a moderation log entry
  2. A bounced user who attempts to reconnect to the chat session is denied a new chat token with a 403 response — the bounce persists for the duration of the session
  3. Any user can click a report action on any message not their own; the action fires a backend request, shows a private toast to the reporter, and the reported message stays visible to all other participants with no public label
  4. Each bounce and report event is durably stored in DynamoDB with `sessionId`, `actorId`, `targetUserId`, `actionType`, and timestamp — queryable per session
  5. Moderation quick-actions (report button) appear in both broadcast chat and hangout chat rooms

**Plans:** 2 plans

Plans:
- [ ] 28-01-PLAN.md — To be planned
- [ ] 28-02-PLAN.md — To be planned

---

### Phase 29: Upload Video Player Core
**Goal:** Uploaded videos have a dedicated page at /video/:sessionId with adaptive bitrate playback, a user-controlled resolution selector, and correct navigation wiring from the activity feed.

**Depends on:** Phase 27 (diarized transcript data must be available for the transcript panel in Phase 30; core player and navigation can ship first)

**Requirements:** VIDP-01, VIDP-02, VIDP-03, VIDP-04, VIDP-10

**Success Criteria** (what must be TRUE):
  1. Navigating to `/video/:sessionId` renders a dedicated player page separate from `/replay` with its own layout and back-navigation — the route is registered in App.tsx and deep-linkable
  2. The video player loads the HLS manifest and begins adaptive bitrate playback automatically; a quality selector UI shows available resolution levels (e.g. "1080p", "720p", "Auto") populated from `hls.levels` after `MANIFEST_PARSED`
  3. Selecting a resolution from the quality picker switches the player to that level; Safari users see only "Auto" (native HLS path) with no quality selector exposed
  4. `UploadActivityCard` links in the activity feed navigate to `/video/:sessionId` — the previous upload path is no longer the primary destination

**Plans:** 2 plans

Plans:
- [ ] 29-01-PLAN.md — To be planned
- [ ] 29-02-PLAN.md — To be planned

---

### Phase 30: Upload Video Player Social
**Goal:** The upload video page is a full social viewing experience: users can leave timestamped comments, react with emoji, and read the AI summary and speaker-attributed transcript in a collapsible panel.

**Depends on:** Phase 29 (player page must exist), Phase 27 (diarized transcript data for the info panel)

**Requirements:** VIDP-05, VIDP-06, VIDP-07, VIDP-08, VIDP-09

**Success Criteria** (what must be TRUE):
  1. User can post a comment anchored to the current video position; the comment appears in the comment list immediately and persists across page reloads — fetched via polling, not WebSocket
  2. Comments within ±1500ms of the current playback position are visually highlighted as the video plays, including after seek operations
  3. Comments are displayable sorted newest-first or by video position; the default sort shows the most recent comments at the top
  4. Emoji reactions can be submitted on the video page using the same emoji set as broadcast/replay; reaction summary counts are displayed and reflect submitted reactions
  5. A collapsible info panel below the player shows the AI summary and speaker-attributed transcript (or plain transcript fallback) for sessions without diarization data

**Plans:** 2 plans

Plans:
- [ ] 30-01-PLAN.md — To be planned
- [ ] 30-02-PLAN.md — To be planned

---

## Progress

**Latest Milestone:** v1.5 Pipeline Reliability, Moderation & Upload Experience
- **Status:** Planning — roadmap created, phases 25-30 defined
- **Phases:** 6 (25, 26, 27, 28, 29, 30)
- **Plans:** 0 complete across all phases
- **Tests:** 360/360 backend tests passing (from v1.4)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 22.1 - Pipeline Fixes & UI Enhancements | 3/3 | Complete    | 2026-03-06 |
| 23 - Stream Quality Monitoring Dashboard | 6/6 | Complete    | 2026-03-06 |
| 24 - Creator Spotlight Selection & Display | 2/3 | Complete   | 2026-03-10 |
| 25 - Pipeline Observability | 2/2 | Complete    | 2026-03-10 |
| 26 - Stuck Session Recovery Cron | 2/2 | Complete   | 2026-03-10 |
| 27 - Speaker-Attributed Transcripts | 0/? | Not started | - |
| 28 - Chat Moderation | 0/? | Not started | - |
| 29 - Upload Video Player Core | 0/? | Not started | - |
| 30 - Upload Video Player Social | 0/? | Not started | - |
