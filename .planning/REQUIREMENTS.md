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
- [x] **REACT-03**: Reactions sent via IVS Chat custom events
- [x] **REACT-04**: Reactions stored in DynamoDB with sessionRelativeTime (ms since stream start)
- [x] **REACT-05**: DynamoDB GSI2 created for time-range queries of reactions (supports replay sync)
- [x] **REACT-06**: Reaction writes sharded across partitions to handle viral spikes (500+ concurrent users)
- [x] **REACT-07**: Users can send emoji reactions during replay viewing
- [x] **REACT-08**: Replay reactions stored with video timestamp and distinguished from live reactions
- [x] **REACT-09**: Replay viewer displays reaction timeline synchronized to video playback position
- [x] **REACT-10**: Lambda API endpoints for creating and querying reactions (live + replay)

### Hangouts (RealTime)

- [x] **HANG-01**: Users can create small-group hangout sessions (RealTime Stage-based)
- [x] **HANG-02**: Pre-warmed Stage pool maintains ready-to-use RealTime Stages (mirrors Channel pool pattern)
- [x] **HANG-03**: Participant tokens generated server-side via CreateParticipantTokenCommand
- [x] **HANG-04**: Participant tokens include capabilities (PUBLISH, SUBSCRIBE), user_id, 12-hour TTL
- [x] **HANG-05**: Users can join hangout via participant token exchange
- [x] **HANG-06**: Multi-participant video grid displays up to 5 participant streams (desktop)
- [x] **HANG-07**: Mobile UI limits video rendering to 3 simultaneous streams (browser constraint)
- [x] **HANG-08**: Users can mute/unmute audio in hangouts
- [x] **HANG-09**: Users can toggle camera on/off in hangouts
- [x] **HANG-10**: Active speaker visual indicator highlights current speaker's video tile
- [x] **HANG-11**: Active speaker detection uses Web Audio API for client-side audio level monitoring
- [x] **HANG-12**: Participant join/leave notifications display in hangout UI
- [x] **HANG-13**: Chat integration works in hangouts (same IVS Chat model as broadcasts)
- [x] **HANG-14**: Hangout sessions record via server-side composition to S3
- [x] **HANG-15**: Composite recording metadata processed via EventBridge (same pattern as broadcasts)
- [x] **HANG-16**: Hangout recordings appear in home feed alongside broadcast recordings

### Developer CLI

- [x] **DEV-03**: CLI command to stream test media file (MP4/MOV) into active broadcast session
- [x] **DEV-04**: CLI command to stream test media file into active hangout session
- [x] **DEV-05**: CLI command to seed sample sessions (broadcasts + hangouts) with metadata
- [x] **DEV-06**: CLI command to seed sample chat messages for testing chat replay
- [x] **DEV-08**: CLI command to seed sample reactions (live + replay) for testing reaction timeline
- [x] **DEV-09**: CLI command to simulate presence/viewer activity for testing
- [x] **DEV-10**: CLI documentation updated with v1.1 commands and usage examples

## v1.2 Requirements (Activity Feed & Intelligence)

Requirements for milestone v1.2. Each maps to roadmap phases (starting at Phase 16).

### Participant Tracking

- [x] **PTCP-01**: Each hangout participant join is persisted to DynamoDB with userId, displayName, and joinedAt timestamp
- [x] **PTCP-02**: Hangout session record stores final participant count when session ends
- [x] **PTCP-03**: Hangout participant list is retrievable by session ID via repository function

### Reaction Summary

- [x] **RSUMM-01**: Per-emoji reaction counts are pre-computed and stored on session record when session ends (Phase 17)
- [ ] **RSUMM-02**: Reaction summary counts are displayed on recording cards on the homepage
- [ ] **RSUMM-03**: Reaction summary counts are displayed in the replay info panel

### Activity Feed & Homepage

- [ ] **ACTV-01**: Homepage displays broadcast recordings in a horizontal scrollable slider (3–4 items visible with peek)
- [ ] **ACTV-02**: Homepage displays a unified activity feed below the recording slider showing all recent sessions
- [ ] **ACTV-03**: Broadcast entries in the activity feed show title, duration, reaction summary counts, and relative timestamp
- [ ] **ACTV-04**: Hangout entries in the activity feed show participant list, message count, duration, and relative timestamp
- [ ] **ACTV-05**: Hangout sessions are filtered out of the recording slider (no longer appear as "pending" spinning tiles)
- [ ] **ACTV-06**: A GET /activity API endpoint returns recent sessions (broadcasts + hangouts) with all activity metadata

### Transcription Pipeline

- [ ] **TRNS-01**: A Transcribe job is automatically started when a broadcast recording is confirmed available in S3
- [ ] **TRNS-02**: Transcription job name encodes the session ID to enable correlation without extra DynamoDB reads
- [ ] **TRNS-03**: Transcript text is stored on the session record in DynamoDB when the Transcribe job completes successfully
- [ ] **TRNS-04**: Transcription failures are recorded on the session record without blocking pool release or other session data

### AI Summary Pipeline

- [ ] **AI-01**: An AI-generated one-paragraph summary is automatically produced from the session transcript via Bedrock/Claude
- [ ] **AI-02**: AI summary text is stored on the session record in DynamoDB
- [ ] **AI-03**: AI summary (truncated to 2 lines) is displayed on recording cards on the homepage
- [ ] **AI-04**: Full AI summary is displayed in the replay info panel
- [ ] **AI-05**: "Summary coming soon" placeholder is shown on cards while the AI pipeline is still processing

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
| Real-time transcription during live sessions | Requires separate SDK and separate streaming infrastructure; fundamentally different from batch transcription |
| Full transcript text viewer in replay | 5,000+ words inline overwhelms the UI; AI summary + S3 URI sufficient for v1.2 |
| Per-user reaction breakdown | Violates the anonymous-by-design reaction system; do not implement |
| Speaker diarization on hangout transcripts | IVS Chat lacks speaker fidelity; hallucination risk with Bedrock |
| Keyword search on transcripts | Requires transcript corpus to exist first (deferred until v1.2 has populated data) |
| AI topic chapters | Requires NLP topic modeling on top of transcription; v2+ |

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
| REPLAY-01 | Phase 14 | Complete |
| REPLAY-02 | Phase 6 | Complete |
| REPLAY-03 | Phase 6 | Complete |
| REPLAY-04 | Phase 13 | Complete |
| REPLAY-05 | Phase 6 | Complete |
| REPLAY-06 | Phase 13 | Complete |
| REPLAY-07 | Phase 13 | Complete |
| REPLAY-08 | Phase 6 | Complete |
| REPLAY-09 | Phase 13 | Complete |
| REACT-01 | Phase 7 | Complete |
| REACT-02 | Phase 7 | Complete |
| REACT-03 | Phase 7 | Complete |
| REACT-04 | Phase 7 | Complete |
| REACT-05 | Phase 7 | Complete |
| REACT-06 | Phase 7 | Complete |
| REACT-07 | Phase 7 | Complete |
| REACT-08 | Phase 7 | Complete |
| REACT-09 | Phase 13 | Complete |
| REACT-10 | Phase 7 | Complete |
| HANG-01 | Phase 10 | Complete |
| HANG-02 | Phase 12 | Complete |
| HANG-03 | Phase 8 | Complete |
| HANG-04 | Phase 8 | Complete |
| HANG-05 | Phase 8 | Complete |
| HANG-06 | Phase 8 | Complete |
| HANG-07 | Phase 8 | Complete |
| HANG-08 | Phase 8 | Complete |
| HANG-09 | Phase 8 | Complete |
| HANG-10 | Phase 8 | Complete |
| HANG-11 | Phase 8 | Complete |
| HANG-12 | Phase 8 | Complete |
| HANG-13 | Phase 14 | Complete |
| HANG-14 | Phase 11 | Complete |
| HANG-15 | Phase 11 | Complete |
| HANG-16 | Phase 11 | Complete |
| DEV-03 | Phase 9 | Complete |
| DEV-04 | Phase 9 | Complete |
| DEV-05 | Phase 9 | Complete |
| DEV-06 | Phase 9 | Complete |
| DEV-08 | Phase 9 | Complete |
| DEV-09 | Phase 9 | Complete |
| DEV-10 | Phase 9 | Complete |

| PTCP-01 | Phase 16 | Complete |
| PTCP-02 | Phase 16 | Complete |
| PTCP-03 | Phase 16 | Complete |
| RSUMM-01 | Phase 17 | Complete (2026-03-06) |
| RSUMM-02 | Phase 18 | Pending |
| RSUMM-03 | Phase 18 | Pending |
| ACTV-01 | Phase 18 | Pending |
| ACTV-02 | Phase 18 | Pending |
| ACTV-03 | Phase 18 | Pending |
| ACTV-04 | Phase 18 | Pending |
| ACTV-05 | Phase 18 | Pending |
| ACTV-06 | Phase 18 | Pending |
| TRNS-01 | Phase 19 | Pending |
| TRNS-02 | Phase 19 | Pending |
| TRNS-03 | Phase 19 | Pending |
| TRNS-04 | Phase 19 | Pending |
| AI-01 | Phase 20 | Pending |
| AI-02 | Phase 20 | Pending |
| AI-03 | Phase 20 | Pending |
| AI-04 | Phase 20 | Pending |
| AI-05 | Phase 20 | Pending |

**Coverage:**
- v1.1 requirements: 50 total (all complete)
- v1.2 requirements: 21 total
- Mapped to phases: 21/21 (100%)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-05 — v1.2 roadmap created, phases 16-20 assigned*
