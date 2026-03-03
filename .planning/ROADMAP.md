# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- 🚧 **v1.1 Replay, Reactions & Hangouts** - Phases 5-9 (in progress)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See MILESTONES.md for details.

</details>

### 🚧 v1.1 Replay, Reactions & Hangouts (In Progress)

**Milestone Goal:** Transform live sessions into persistent, discoverable content with reactions, and expand interaction models from one-to-many broadcasts to small-group hangouts.

- [x] **Phase 5: Recording Foundation** - Auto-record all sessions to S3 with metadata tracking (completed 2026-03-03)
- [ ] **Phase 6: Replay Viewer** - Home feed and video playback with synchronized chat
- [ ] **Phase 7: Reactions & Chat Sync** - Live and replay reactions with timeline synchronization
- [ ] **Phase 8: RealTime Hangouts** - Small-group multi-participant video sessions
- [ ] **Phase 9: Developer CLI v1.1** - Test media streaming and data seeding tools

## Phase Details

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
- [ ] 05-02-PLAN.md — Recording Lifecycle Handlers

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
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD

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
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

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
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

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
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 → 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 5. Recording Foundation | 2/2 | Complete   | 2026-03-03 | - |
| 6. Replay Viewer | v1.1 | 0/TBD | Not started | - |
| 7. Reactions & Chat Sync | v1.1 | 0/TBD | Not started | - |
| 8. RealTime Hangouts | v1.1 | 0/TBD | Not started | - |
| 9. Developer CLI v1.1 | v1.1 | 0/TBD | Not started | - |

---
*Roadmap created: 2026-03-02*
*Last updated: 2026-03-02*
