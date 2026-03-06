# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- ✅ **v1.3 Secure Sharing** - Phases 21-22 (shipped 2026-03-06 as part of v1.2)
- 🚧 **v1.4 Creator Studio & Stream Quality** - Phases 22.1, 23-24 (in progress)

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

### v1.4 Creator Studio & Stream Quality (In Progress)

**Milestone Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**Phases:**

- ✅ **Phase 22.1: Pipeline Fixes & UI Enhancements** - Urgent fixes and enhancements from v1.2 completion [3/3 plans complete]
- 🚧 **Phase 23: Stream Quality Monitoring Dashboard** - Real-time metrics display (bitrate, FPS, resolution, network status, health score) for broadcasters [1/3 plans complete]
- [ ] **Phase 24: Creator Spotlight Selection & Display** - Feature another live creator during broadcast with elegant overlay UI

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

**Plans:** TBD

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

**Plans:** TBD

---

## Progress

**Latest Milestone:** v1.4 Creator Studio & Stream Quality
- **Status:** 🚧 Phase 23 in progress
- **Phases:** 3 (22.1 ✅, 23, 24)
- **Plans:** 3/3 complete (Phase 22.1), 2/3 complete (Phase 23)
- **Tests:** 343/343 backend tests passing (from v1.3)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 22.1 - Pipeline Fixes & UI Enhancements | 3/3 | Complete    | 2026-03-06 |
| 23 - Stream Quality Monitoring Dashboard | 2/3 | In Progress | - |
| 24 - Creator Spotlight Selection & Display | 0/? | Not started | - |