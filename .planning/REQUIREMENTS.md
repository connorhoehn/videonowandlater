# Requirements: VideoNowAndLater

**Defined:** 2026-03-02
**Core Value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

## v1.1 Requirements (Replay, Reactions & Hangouts)

Requirements for milestone v1.1. Each maps to roadmap phases.

### Recording (Infrastructure)

- [x] **REC-01**: All broadcast sessions auto-record to S3 using IVS RecordingConfiguration (05-01)
- [x] **REC-02**: All hangout sessions auto-record to S3 using IVS RealTime composite recording (05-01)
- [x] **REC-03**: S3 bucket and RecordingConfiguration deployed in same AWS region (05-01)
- [x] **REC-04**: CloudFront distribution with OAC serves private S3 recordings (05-01)
- [x] **REC-05**: EventBridge rules capture recording lifecycle events (started, ended, failed) (05-01)
- [x] **REC-06**: Lambda handlers process recording-ended events and extract metadata
- [x] **REC-07**: Session items in DynamoDB extended with recording metadata (duration, S3 path, thumbnail URL) (05-01)
- [x] **REC-08**: Recording reconnect windows handled (fragmented streams merged or flagged)

### Replay Viewer

- [x] **REPLAY-01**: Home feed displays recently streamed videos in chronological order
- [x] **REPLAY-02**: Home feed shows thumbnail, title, duration, broadcaster name for each recording
- [x] **REPLAY-03**: User can click thumbnail to navigate to replay viewer page
- [x] **REPLAY-04**: Replay viewer plays HLS video from CloudFront using react-player
- [x] **REPLAY-05**: Replay viewer shows video playback controls (play/pause, seek, volume, fullscreen)
- [x] **REPLAY-06**: Chat messages display alongside replay video in synchronized timeline
- [x] **REPLAY-07**: Chat auto-scrolls as video plays, matching video.currentTime to message timestamps
- [x] **REPLAY-08**: Chat synchronization uses IVS Sync Time API for accurate video-relative timestamps
- [x] **REPLAY-09**: Replay viewer shows session metadata (broadcaster, duration, viewer count)

### Reactions

- [x] **REACT-01**: Users can send emoji reactions during live broadcasts (heart, fire, clap, laugh, surprised)
- [x] **REACT-02**: Live reactions display as floating animations on broadcaster and viewer screens
- [ ] **REACT-03**: Reactions sent via IVS Chat custom events
- [x] **REACT-04**: Reactions stored in DynamoDB with sessionRelativeTime (ms since stream start)
- [x] **REACT-05**: DynamoDB GSI2 created for time-range queries of reactions (supports replay sync)
- [x] **REACT-06**: Reaction writes sharded across partitions to handle viral spikes (500+ concurrent users)
- [ ] **REACT-07**: Users can send emoji reactions during replay viewing
- [ ] **REACT-08**: Replay reactions stored with video timestamp and distinguished from live reactions
- [ ] **REACT-09**: Replay viewer displays reaction timeline synchronized to video playback position
- [ ] **REACT-10**: Lambda API endpoints for creating and querying reactions (live + replay)

### Hangouts (RealTime)

- [ ] **HANG-01**: Users can create small-group hangout sessions (RealTime Stage-based)
- [ ] **HANG-02**: Pre-warmed Stage pool maintains ready-to-use RealTime Stages (mirrors Channel pool pattern)
- [ ] **HANG-03**: Participant tokens generated server-side via CreateParticipantTokenCommand
- [ ] **HANG-04**: Participant tokens include capabilities (PUBLISH, SUBSCRIBE), user_id, 12-hour TTL
- [ ] **HANG-05**: Users can join hangout via participant token exchange
- [ ] **HANG-06**: Multi-participant video grid displays up to 5 participant streams (desktop)
- [ ] **HANG-07**: Mobile UI limits video rendering to 3 simultaneous streams (browser constraint)
- [ ] **HANG-08**: Users can mute/unmute audio in hangouts
- [ ] **HANG-09**: Users can toggle camera on/off in hangouts
- [ ] **HANG-10**: Active speaker visual indicator highlights current speaker's video tile
- [ ] **HANG-11**: Active speaker detection uses Web Audio API for client-side audio level monitoring
- [ ] **HANG-12**: Participant join/leave notifications display in hangout UI
- [ ] **HANG-13**: Chat integration works in hangouts (same IVS Chat model as broadcasts)
- [ ] **HANG-14**: Hangout sessions record via server-side composition to S3
- [ ] **HANG-15**: Composite recording metadata processed via EventBridge (same pattern as broadcasts)
- [ ] **HANG-16**: Hangout recordings appear in home feed alongside broadcast recordings

### Developer CLI

- [ ] **DEV-03**: CLI command to stream test media file (MP4/MOV) into active broadcast session
- [ ] **DEV-04**: CLI command to stream test media file into active hangout session
- [ ] **DEV-05**: CLI command to seed sample sessions (broadcasts + hangouts) with metadata
- [ ] **DEV-06**: CLI command to seed sample chat messages for testing chat replay
- [ ] **DEV-08**: CLI command to seed sample reactions (live + replay) for testing reaction timeline
- [ ] **DEV-09**: CLI command to simulate presence/viewer activity for testing
- [ ] **DEV-10**: CLI documentation updated with v1.1 commands and usage examples

## v2 Requirements (Future)

Deferred to future release. Tracked but not in current roadmap.

### Admin & Analytics

- **ADMIN-01**: Admin dashboard shows active sessions with participant counts
- **ADMIN-02**: Admin dashboard shows recent replays with view counts
- **ADMIN-03**: Admin dashboard shows real-time reaction counts per session
- **ADMIN-04**: Reaction analytics aggregate top reactions per session/segment

### Discovery Enhancements

- **DISC-01**: Profile-based recording discovery (user's recording history on their profile)
- **DISC-02**: Interest-based algorithmic ranking in home feed (beyond chronological)
- **DISC-03**: Thumbnail hover preview (video preview on thumbnail hover)
- **DISC-04**: Reaction aggregation markers on replay timeline ("142 fire emojis at 2:34")

### Presence & Social

- **PRES-01**: Presence system shows "X is watching" indicators during live sessions
- **PRES-02**: Viewer avatars/names displayed on sessions
- **PRES-03**: Heartbeat API for presence tracking (POST every 30s, DynamoDB TTL auto-expiry)

### Privacy & Moderation

- **MOD-01**: Users can delete their own recordings
- **MOD-02**: Recording deletion also removes metadata, chat, reactions
- **MOD-03**: User opt-out for auto-recording (privacy control)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom emoji upload for reactions | Requires moderation infrastructure, storage bloat, brand consistency issues |
| Real-time reaction counts (exact numbers) | WebSocket performance bottleneck at scale, distracts from content |
| Unlimited hangout participants (>12) | IVS RealTime max 12 publishers; beyond that requires MCU complexity |
| Screen sharing in hangouts | Adds complexity to grid layout, bandwidth management; defer to v2 |
| Video clipping/highlights | Complex UX (timeline selection, transcoding); nice-to-have but not core |
| Email/push notifications | Notification infrastructure tangential to core value; in-app only for v1.1 |
| Mobile native app | Separate codebase, app store deployment; web-first per PROJECT.md |
| OAuth/social login | Additional identity provider complexity; username/password sufficient |
| Paid subscriptions/monetization | Payment processing orthogonal to core video platform |
| Content moderation/AI filtering | Massive scope (profanity, NSFW, harassment); defer to v2 |
| Multi-region deployment | Cross-region IVS resource management; single region for v1.1 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| REC-01 | Phase 5 | Complete |
| REC-02 | Phase 5 | Complete |
| REC-03 | Phase 5 | Pending |
| REC-04 | Phase 5 | Pending |
| REC-05 | Phase 5 | Pending |
| REC-06 | Phase 5 | Complete |
| REC-07 | Phase 5 | Pending |
| REC-08 | Phase 5 | Complete |
| REPLAY-01 | Phase 6 | Complete |
| REPLAY-02 | Phase 6 | Complete |
| REPLAY-03 | Phase 6 | Complete |
| REPLAY-04 | Phase 6 | Complete |
| REPLAY-05 | Phase 6 | Complete |
| REPLAY-06 | Phase 6 | Complete |
| REPLAY-07 | Phase 6 | Complete |
| REPLAY-08 | Phase 6 | Complete |
| REPLAY-09 | Phase 6 | Complete |
| REACT-01 | Phase 7 | Complete |
| REACT-02 | Phase 7 | Complete |
| REACT-03 | Phase 7 | Pending |
| REACT-04 | Phase 7 | Complete |
| REACT-05 | Phase 7 | Complete |
| REACT-06 | Phase 7 | Complete |
| REACT-07 | Phase 7 | Pending |
| REACT-08 | Phase 7 | Pending |
| REACT-09 | Phase 7 | Pending |
| REACT-10 | Phase 7 | Pending |
| HANG-01 | Phase 8 | Pending |
| HANG-02 | Phase 8 | Pending |
| HANG-03 | Phase 8 | Pending |
| HANG-04 | Phase 8 | Pending |
| HANG-05 | Phase 8 | Pending |
| HANG-06 | Phase 8 | Pending |
| HANG-07 | Phase 8 | Pending |
| HANG-08 | Phase 8 | Pending |
| HANG-09 | Phase 8 | Pending |
| HANG-10 | Phase 8 | Pending |
| HANG-11 | Phase 8 | Pending |
| HANG-12 | Phase 8 | Pending |
| HANG-13 | Phase 8 | Pending |
| HANG-14 | Phase 8 | Pending |
| HANG-15 | Phase 8 | Pending |
| HANG-16 | Phase 8 | Pending |
| DEV-03 | Phase 9 | Pending |
| DEV-04 | Phase 9 | Pending |
| DEV-05 | Phase 9 | Pending |
| DEV-06 | Phase 9 | Pending |
| DEV-08 | Phase 9 | Pending |
| DEV-09 | Phase 9 | Pending |
| DEV-10 | Phase 9 | Pending |

**Coverage:**
- v1.1 requirements: 50 total
- Mapped to phases: 50/50 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-02 after roadmap creation*
