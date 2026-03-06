# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- 🚧 **v1.2 Activity Feed & Intelligence** - Phases 16-20 (in progress)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See MILESTONES.md for details.

</details>

<details>
<summary>✅ v1.1 Replay, Reactions & Hangouts (Phases 5-15) - SHIPPED 2026-03-05</summary>

**Milestone Goal:** Transform live sessions into persistent, discoverable content with reactions, and expand interaction models from one-to-many broadcasts to small-group hangouts.

### Phase 5: Recording Foundation
**Goal**: All broadcast and hangout sessions automatically record to S3 with complete metadata tracking
**Depends on**: Phase 4.2 (v1.0 complete)
**Requirements**: REC-01, REC-02, REC-03, REC-04, REC-05, REC-06, REC-07, REC-08
**Success Criteria** (what must be TRUE):
  1. User creates broadcast session and it auto-records to S3 without any manual setup
  2. Recording metadata (duration, S3 path, thumbnail URL) appears in session item after stream ends
  3. EventBridge rules capture recording lifecycle events and trigger metadata processing
  4. CloudFront distribution serves recordings via signed URLs (no direct S3 access)
  5. Reconnect windows handled gracefully with "Processing recording..." UI state during 30-60 second window
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Recording Infrastructure & Domain (2 tasks, 2 commits, 5 min)
- [x] 05-02-PLAN.md — Recording Lifecycle Handlers

### Phase 6: Replay Viewer
**Goal**: Users can discover recently streamed videos and watch replays with full chat history
**Depends on**: Phase 5
**Requirements**: REPLAY-01, REPLAY-02, REPLAY-03, REPLAY-04, REPLAY-05, REPLAY-06, REPLAY-07, REPLAY-08, REPLAY-09
**Success Criteria** (what must be TRUE):
  1. Home feed displays recently streamed videos with thumbnails, titles, duration, and broadcaster names
  2. User can click any recording thumbnail to navigate to dedicated replay viewer page
  3. Replay viewer plays HLS video from CloudFront with standard controls (play/pause, seek, volume, fullscreen)
  4. Chat messages display alongside video and auto-scroll in sync with playback position
  5. Chat synchronization uses IVS Sync Time API for accurate video-relative timestamps (no drift on 60+ minute videos)
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Recording Discovery Feed (2 tasks, 2 commits, 3 min)
- [x] 06-02-PLAN.md — Replay Viewer with HLS Playback (2 tasks, 2 commits, 3 min)
- [x] 06-03-PLAN.md — Synchronized Chat Replay (3 tasks, 3 commits, 2 min)

### Phase 7: Reactions & Chat Sync
**Goal**: Users can send emoji reactions during live streams and replay viewing, synchronized to video timeline
**Depends on**: Phase 6
**Requirements**: REACT-01, REACT-02, REACT-03, REACT-04, REACT-05, REACT-06, REACT-07, REACT-08, REACT-09, REACT-10
**Success Criteria** (what must be TRUE):
  1. User can send emoji reactions (heart, fire, clap, laugh, surprised) during live broadcasts
  2. Live reactions display as floating animations on broadcaster and viewer screens
  3. Reactions stored with sessionRelativeTime (ms since stream start) for replay synchronization
  4. User can send emoji reactions during replay viewing at any video timestamp
  5. Replay viewer displays reaction timeline markers synchronized to current playback position
  6. System handles viral reaction spikes (500+ concurrent users) without DynamoDB throttling via partition sharding
**Plans**: 4 plans

Plans:
- [x] 07-01-PLAN.md — Reaction Domain & DynamoDB Infrastructure (3 tasks, backend foundation)
- [x] 07-02-PLAN.md — Live Reactions Backend (4 tasks, IVS SendEvent integration)
- [x] 07-03-PLAN.md — Live Reactions Frontend (4 tasks, Motion animations)
- [x] 07-04-PLAN.md — Replay Reactions (4 tasks, timeline & sync)

### Phase 8: RealTime Hangouts
**Goal**: Users can create and join small-group video hangouts with up to 5 participants, fully recorded for replay
**Depends on**: Phase 7
**Requirements**: HANG-01, HANG-02, HANG-03, HANG-04, HANG-05, HANG-06, HANG-07, HANG-08, HANG-09, HANG-10, HANG-11, HANG-12, HANG-13, HANG-14, HANG-15, HANG-16
**Success Criteria** (what must be TRUE):
  1. User can create small-group hangout session (abstracted as "start hangout", not "create stage")
  2. Pre-warmed Stage pool provides instant join experience (no cold-start delay)
  3. Participants join via server-generated tokens with automatic capability configuration
  4. Multi-participant video grid displays up to 5 participant streams on desktop, 3 on mobile
  5. Active speaker visual indicator highlights current speaker's video tile based on audio levels
  6. Participants can mute/unmute audio and toggle camera on/off
  7. Chat works in hangouts using same persistent model as broadcasts
  8. Hangout sessions auto-record via server-side composition and appear in home feed alongside broadcasts
**Plans**: 3 plans

Plans:
- [x] 08-01-PLAN.md — Participant Token Generation & Session Repository
- [x] 08-02-PLAN.md — Multi-Participant Hangout UI with Video Grid & Chat
- [x] 08-03-PLAN.md — Hangout Recording Integration & Home Feed

### Phase 9: Developer CLI v1.1
**Goal**: Developers can stream test media files, seed sample data, and simulate activity for testing
**Depends on**: Phase 8
**Requirements**: DEV-03, DEV-04, DEV-05, DEV-06, DEV-08, DEV-09, DEV-10
**Success Criteria** (what must be TRUE):
  1. Developer can stream MP4/MOV file into active broadcast session via CLI command
  2. Developer can stream test media into active hangout session via CLI command
  3. Developer can seed sample sessions, chat messages, and reactions with single command
  4. Developer can simulate presence/viewer activity for load testing
  5. CLI documentation updated with v1.1 commands and usage examples
**Plans**: 3 plans

Plans:
- [x] 09-01-PLAN.md — CLI Foundation & Broadcast Streaming (Commander.js, FFmpeg RTMPS) (3 tasks, 4 commits, 5 min)
- [x] 09-02-PLAN.md — Hangout Streaming & Data Seeding (WHIP protocol, session/chat/reaction seeding) (3 tasks, 4 commits, 13 min)
- [x] 09-03-PLAN.md — Presence Simulation & Documentation (IVS Chat events, CLI docs) (3 tasks, 5 commits, 2 min)

### Phase 09.1: TypeScript Build Fixes
**Goal**: Fix TypeScript compilation errors and test failures to enable clean builds
**Depends on**: Phase 9
**Requirements**: HANG-05, HANG-06, HANG-07, HANG-08, HANG-09, HANG-10, HANG-11, REACT-01, REACT-07
**Success Criteria** (what must be TRUE):
  1. Phase 8 hangout UI compiles without TypeScript errors (useHangout.ts, useActiveSpeaker.ts)
  2. Phase 7 reaction components compile without type errors (ReplayViewer.tsx EmojiType import)
  3. Phase 5 test suite passes without mock signature errors (stream-started.test.ts)
  4. `npm run build` completes successfully in both backend and web directories
  5. Hangout UI functions correctly at runtime (multi-participant video, active speaker detection)
  6. All 6 backend handler test suites exit code 0 (no real AWS calls in unit tests)
**Plans**: 4 plans

Plans:
- [x] 09.1-01-PLAN.md — Fix Phase 8 Hangout TypeScript Errors (useHangout.ts, useActiveSpeaker.ts)
- [x] 09.1-02-PLAN.md — Fix Phase 7 Reaction Type Mismatch & Phase 5 Tests (reaction.ts, ReplayViewer.tsx, stream-started.test.ts)
- [x] 09.1-03-PLAN.md — Fix Jest ESM infrastructure (NODE_OPTIONS=--experimental-vm-modules for AWS SDK v3 compatibility)
- [x] 09.1-04-PLAN.md — Add AWS SDK jest.mock to 6 handler test files (eliminate real DynamoDB/IVS calls)

### Phase 10: Integration Wiring Fixes
**Goal**: Fix three broken cross-phase wiring issues identified by milestone audit to restore synchronized chat replay, fix hangout participant display, and eliminate duplicate EventBridge invocations
**Depends on**: Phase 09.1
**Requirements**: REPLAY-06, REPLAY-07, HANG-01
**Success Criteria** (what must be TRUE):
  1. Replay viewer shows chat messages synchronized to video playback (ReplayChat.tsx fetches correct API path)
  2. Local participant in hangout displays correct username, not "undefined (You)"
  3. `recording-ended` Lambda is invoked exactly once per IVS Recording End event (legacy rule removed)
**Plans**: 2 plans

Plans:
- [x] 10-01-PLAN.md — ReplayChat path+auth fix and join-hangout userId fix (REPLAY-06, REPLAY-07, HANG-01)
- [x] 10-02-PLAN.md — Remove legacy RecordingEndRule from session-stack.ts (EventBridge dedup)

### Phase 11: Hangout Recording Lifecycle Fix
**Goal**: Fix Stage ARN detection in recording-ended handler so hangout composite recordings get metadata written and appear in the home feed alongside broadcasts
**Depends on**: Phase 10
**Requirements**: HANG-14, HANG-15, HANG-16
**Success Criteria** (what must be TRUE):
  1. IVS RealTime Stage Recording End EventBridge event is correctly parsed (correct field used for ARN)
  2. Hangout sessions have recordingStatus='available' after recording completes
  3. Hangout recordings appear in home feed alongside broadcast recordings
**Plans**: 1 plan

Plans:
- [x] 11-01-PLAN.md — Fix Stage ARN detection, EventBridge rule, S3 paths, and recording-ended tests (HANG-14, HANG-15, HANG-16)

### Phase 12: Hangout Creation UI
**Goal**: Users can create a hangout session directly from the home page without knowing a direct URL
**Depends on**: Phase 11
**Requirements**: HANG-02
**Success Criteria** (what must be TRUE):
  1. HomePage has a "Start Hangout" button alongside the existing "Go Live" broadcast button
  2. Clicking "Start Hangout" calls POST /sessions with sessionType HANGOUT and navigates to /hangout/:id
**Plans**: 1 plan

Plans:
- [x] 12-01-PLAN.md — Add Start Hangout button and handleCreateHangout handler to HomePage.tsx (HANG-02)

### Phase 13: Replay Viewer Integration Fixes
**Goal**: Fix auth headers and time-domain mismatch in the replay viewer so video loads, chat messages display, and chat/reaction timelines synchronize correctly with playback position
**Depends on**: Phase 12
**Requirements**: REPLAY-04, REPLAY-06, REPLAY-07, REPLAY-09, REACT-09
**Success Criteria** (what must be TRUE):
  1. Replay viewer loads session and begins playing HLS video (GET /sessions/:id includes Authorization header)
  2. Chat messages appear in replay and scroll as video plays (authToken in ReplayChat useEffect deps; fetch gated on token ready)
  3. Chat messages visible at correct video positions — messages at 2:00 not visible at 0:30 (sessionRelativeTime compared against elapsed playback ms, not raw UTC ms)
  4. Reaction timeline markers appear at correct positions and advance with video playback (same fix as chat sync)
  5. Reaction timeline populates with existing reactions (GET /sessions/:id/reactions includes Authorization header)
**Plans**: 1 plan

Plans:
- [x] 13-01-PLAN.md — Fix auth headers and syncTime time domain (REPLAY-04, REPLAY-06, REPLAY-07, REPLAY-09, REACT-09)

### Phase 14: Data Quality & Hangout Identity Polish
**Goal**: Home feed shows only playable recordings, and hangout participants display their real Cognito username in chat
**Depends on**: Phase 13
**Requirements**: REPLAY-01, HANG-13
**Success Criteria** (what must be TRUE):
  1. Home feed contains only recordings with recordingStatus='available' — no "Awaiting recording..." permanent stubs
  2. Hangout participants display their authenticated username in chat (same identity as join-hangout token)
**Plans**: 1 plan

Plans:
- [x] 14-01-PLAN.md — Data quality filter and hangout identity fix (REPLAY-01, HANG-13)

### Phase 15: Replay & Hangout Integration Fixes
**Goal**: Fix get-session to expose recording fields for replay viewer, transition HANGOUT sessions to LIVE for chat persistence, and correct hangout recording navigation
**Depends on**: Phase 14
**Requirements**: REPLAY-04, REPLAY-05, REPLAY-07, REPLAY-09, HANG-11, HANG-12, HANG-15
**Success Criteria** (what must be TRUE):
  1. Replay viewer loads HLS video (get-session returns recordingHlsUrl, recordingDuration, userId, createdAt, endedAt, recordingStatus)
  2. HANGOUT chat messages persist (join-hangout sets session status=LIVE and startedAt after first participant token)
  3. Hangout recordings in RecordingFeed navigate to /replay/:id instead of /hangout/:id
  4. Remote participants in hangout show Cognito username (not UUID participantId)
**Plans**: 2 plans

Plans:
- [x] 15-01-PLAN.md — Extend getSession() with recording fields and add get-session.test.ts (REPLAY-04, REPLAY-05, REPLAY-07, REPLAY-09)
- [x] 15-02-PLAN.md — Fix join-hangout LIVE transition, userId attribute, IAM grant, and RecordingFeed navigation (HANG-11, HANG-12, HANG-15)

</details>

### v1.2 Activity Feed & Intelligence (In Progress)

**Milestone Goal:** Surface richer session context on the homepage — hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed — and add an automated transcription and AI summary pipeline to every recording.

- [x] **Phase 16: Hangout Participant Tracking** - Persist join events and participant count to DynamoDB with zero new AWS services (completed 2026-03-06)
- [x] **Phase 17: Reaction Summary at Session End** - Pre-compute per-emoji reaction counts when a session ends
- [ ] **Phase 18: Homepage Redesign & Activity Feed** - Two-zone homepage with recording slider, activity feed, and GET /activity endpoint
- [ ] **Phase 19: Transcription Pipeline** - Automated S3-to-Transcribe pipeline triggered by recording completion events
- [ ] **Phase 20: AI Summary Pipeline** - Inline Bedrock call in store-transcript generates and stores one-paragraph session summaries

## Phase Details

### Phase 16: Hangout Participant Tracking
**Goal**: Each hangout participant join is durably recorded in DynamoDB so activity cards can display who was in a session
**Depends on**: Phase 15
**Requirements**: PTCP-01, PTCP-02, PTCP-03
**Success Criteria** (what must be TRUE):
  1. When a user joins a hangout, a PARTICIPANT item is written to DynamoDB with their userId, displayName, and joinedAt timestamp
  2. After a hangout session ends, the session record includes a participantCount field reflecting the total number of unique participants
  3. Given a session ID, the participant list is retrievable via a repository function (used by GET /activity in Phase 18)
  4. Two participants joining within the same second do not cause a ConditionalCheckFailedException — each participant is stored as a separate item, not appended to the version-locked session METADATA item
**Plans**: 1 plan

Plans:
- [ ] 16-01-PLAN.md — Domain model + repository functions + handler integration for participant tracking (PTCP-01, PTCP-02, PTCP-03)

### Phase 17: Reaction Summary at Session End
**Goal**: Per-emoji reaction counts are pre-computed and stored on the session record when a session ends, so the homepage never needs to aggregate counts at read time
**Depends on**: Phase 16
**Requirements**: RSUMM-01
**Success Criteria** (what must be TRUE):
  1. After a broadcast or hangout session ends, the session record in DynamoDB contains a reactionSummary map with per-type counts (e.g., { heart: 42, fire: 17, clap: 8 })
  2. Pool release always completes even when reaction aggregation fails — reaction summary computation is wrapped in try/catch and never gates pool resource availability
  3. Sessions with no reactions store an empty reactionSummary map (not undefined) so downstream consumers can always read the field without null checks
**Plans**: 1 plan

Plans:
- [x] 17-01-PLAN.md — Reaction Summary at Session End (3 tasks, domain + repository + handler integration)

### Phase 18: Homepage Redesign & Activity Feed
**Goal**: The homepage is redesigned with a two-zone layout — a horizontal scrollable recording slider and an activity feed below it — and a GET /activity API endpoint returns all session types with full activity metadata
**Depends on**: Phase 17
**Requirements**: RSUMM-02, RSUMM-03, ACTV-01, ACTV-02, ACTV-03, ACTV-04, ACTV-05, ACTV-06
**Success Criteria** (what must be TRUE):
  1. The homepage displays broadcast recordings in a horizontal slider with 3-4 cards visible and peek-scrolling to the next — hangout sessions do not appear in this slider
  2. Below the slider, a unified activity feed lists all recent sessions (broadcasts and hangouts) in reverse chronological order
  3. Broadcast entries in the activity feed show title, duration, reaction summary counts by emoji type, and a relative timestamp ("2 hours ago")
  4. Hangout entries in the activity feed show participant list, message count, duration, and a relative timestamp
  5. Reaction summary counts (per emoji type) are visible on recording cards in the slider
  6. Reaction summary counts are displayed in the replay info panel when viewing a recording
  7. GET /activity returns recent sessions with all activity metadata in a single API call — the frontend does not aggregate counts at read time
**Plans**: 3 plans

Plans:
- [ ] 18-01-PLAN.md — GET /activity endpoint, messageCount tracking, CDK wiring (ACTV-06, RSUMM-02, RSUMM-03)
- [ ] 18-02-PLAN.md — Homepage layout redesign, activity feed, recording slider (ACTV-01, ACTV-02, ACTV-03, ACTV-04, ACTV-05)
- [ ] 18-03-PLAN.md — ReplayViewer reaction summary display (RSUMM-03)

### Phase 19: Transcription Pipeline
**Goal**: When a recording becomes available in S3, a transcription job is automatically started and the resulting transcript is stored on the session record
**Depends on**: Phase 18
**Requirements**: TRNS-01, TRNS-02, TRNS-03, TRNS-04
**Success Criteria** (what must be TRUE):
  1. Within seconds of a recording completing, a Transcribe job is automatically started with no manual intervention
  2. The Transcribe job name encodes the session ID (format: vnl-{sessionId}-{epochMs}) so job completion events can be correlated to sessions without additional DynamoDB reads
  3. When a Transcribe job completes successfully, the transcript text is stored on the session record in DynamoDB
  4. When a Transcribe job fails, a transcriptStatus field on the session record is set to "failed" and no other session data is affected — pool release and recording metadata are unaffected
**Plans**: TBD

Plans:
- [ ] 19-01: Resolve HLS/MediaConvert input format question (research-phase required — see notes)
- [ ] 19-02: start-transcription.ts Lambda, TranscribeJobCompleteRule EventBridge rule, CDK IAM wiring
- [ ] 19-03: store-transcript.ts Lambda — transcript fetch and DynamoDB write

**CRITICAL: Research-phase required before plan-phase.** The HLS/MediaConvert conflict (whether Amazon Transcribe accepts IVS HLS M3U8 directly) must be resolved before writing the Phase 19 implementation plan. Default assumption per SUMMARY.md: MediaConvert conversion is required before Transcribe. If true, scope expands to include a MediaConvert job Lambda, MediaConvertCompleteRule EventBridge rule, and MediaConvert IAM role. Run `/gsd:research phase-19` before `/gsd:plan-phase 19`.

### Phase 20: AI Summary Pipeline
**Goal**: Every session with a stored transcript automatically receives an AI-generated one-paragraph summary via Bedrock/Claude, displayed on recording cards and the replay info panel
**Depends on**: Phase 19
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05
**Success Criteria** (what must be TRUE):
  1. After a transcript is stored, an AI-generated one-paragraph summary is automatically produced and stored on the session record with no manual intervention
  2. Recording cards on the homepage display a 2-line truncated AI summary (or "Summary coming soon" placeholder while the pipeline is still running)
  3. The full AI summary is displayed in the replay info panel when viewing a recording
  4. If Bedrock fails, the transcript that was already stored is preserved — the failure sets aiSummaryStatus to "failed" but does not overwrite or lose the transcriptText field
  5. "Summary coming soon" placeholder is shown on cards for sessions where the pipeline has not yet completed, rather than a blank or broken state
**Plans**: TBD

Plans:
- [ ] 20-01: Bedrock client, store-transcript.ts AI extension, and CDK IAM wiring
- [ ] 20-02: AI summary display on recording cards and replay info panel

**Manual prerequisite:** Anthropic models require a one-time First Time Use (FTU) form in the Bedrock console before InvokeModel succeeds. This cannot be automated via CDK. Document as a pre-deployment step in plan 20-01. Confirm model availability in deployment region and whether the FTU form is still required at implementation time.

## Progress

**Execution Order:**
Phases execute in numeric order: 16 → 17 → 18 → 19 → 20

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Recording Foundation | v1.1 | 2/2 | Complete | 2026-03-03 |
| 6. Replay Viewer | v1.1 | 3/3 | Complete | 2026-03-03 |
| 7. Reactions & Chat Sync | v1.1 | 4/4 | Complete | 2026-03-03 |
| 8. RealTime Hangouts | v1.1 | 3/3 | Complete | 2026-03-03 |
| 9. Developer CLI v1.1 | v1.1 | 3/3 | Complete | 2026-03-03 |
| 09.1. TypeScript Build Fixes | v1.1 | 4/4 | Complete | 2026-03-03 |
| 10. Integration Wiring Fixes | v1.1 | 2/2 | Complete | 2026-03-04 |
| 11. Hangout Recording Lifecycle Fix | v1.1 | 1/1 | Complete | 2026-03-04 |
| 12. Hangout Creation UI | v1.1 | 1/1 | Complete | 2026-03-04 |
| 13. Replay Viewer Integration Fixes | v1.1 | 1/1 | Complete | 2026-03-04 |
| 14. Data Quality & Hangout Identity Polish | v1.1 | 1/1 | Complete | 2026-03-04 |
| 15. Replay & Hangout Integration Fixes | v1.1 | 2/2 | Complete | 2026-03-05 |
| 16. Hangout Participant Tracking | 1/1 | Complete   | 2026-03-06 | - |
| 17. Reaction Summary at Session End | v1.2 | Complete    | 2026-03-06 | - |
| 18. Homepage Redesign & Activity Feed | v1.2 | 0/3 | Planned | - |
| 19. Transcription Pipeline | v1.2 | 0/3 | Not started | - |
| 20. AI Summary Pipeline | v1.2 | 0/2 | Not started | - |

---
*Roadmap created: 2026-03-02*
*Last updated: 2026-03-05 — Phase 18 planned*
