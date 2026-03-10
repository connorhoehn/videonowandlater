# Requirements: VideoNowAndLater

**Core Value:** Users can go live instantly and every session is automatically preserved with its full context for later replay.

---

## v1.5 Requirements: Pipeline Reliability, Moderation & Upload Experience

**Defined:** 2026-03-10

### Pipeline Observability & Recovery

- [x] **PIPE-01**: Every Lambda handler in the recording pipeline emits a structured JSON log entry at start and completion with `sessionId`, `stage`, `status`, and `durationMs`
- [x] **PIPE-02**: Pipeline log entries use a consistent correlation structure so all events for one session can be retrieved with a single CloudWatch Logs Insights query
- [x] **PIPE-03**: Lambda Powertools Logger is initialized with persistent `pipelineStage` key per handler so logs are filterable without post-processing
- [x] **PIPE-04**: All pipeline Lambda CDK definitions specify log group retention (30 days) to prevent unbounded CloudWatch log accumulation
- [x] **PIPE-05**: A recovery cron runs every 15 minutes and identifies sessions where `transcriptStatus` is `null` or `pending` and `endedAt` is more than 45 minutes ago
- [x] **PIPE-06**: Recovery cron re-fires the appropriate EventBridge event for the earliest failed stage (smart recovery, not full reset) with a `recoveryAttempt` counter on the event
- [x] **PIPE-07**: Recovery cron skips sessions with `transcriptStatus = 'processing'` (MediaConvert/Transcribe job actively running) to prevent double-execution
- [x] **PIPE-08**: Recovery cron caps retry attempts at 3 per session by writing a `recoveryAttemptCount` field to the session record and skipping sessions that have reached the cap

### Speaker-Attributed Transcripts

- [ ] **SPKR-01**: Transcription jobs are submitted with `ShowSpeakerLabels: true` and `MaxSpeakerLabels: 2` to enable diarization
- [ ] **SPKR-02**: Transcript post-processor extracts per-word speaker labels from Transcribe output and groups them into speaker-turn segments
- [ ] **SPKR-03**: Speaker segments are stored in S3 as a compact JSON file (pointer on session as `diarizedTranscriptS3Path`) — never inline in DynamoDB to respect the 400KB item limit
- [ ] **SPKR-04**: Speakers are labeled "Speaker 1" / "Speaker 2" (not usernames) since composite audio cannot map acoustic labels to identities
- [ ] **SPKR-05**: Replay and upload video player pages display attributed transcript as alternating speaker turns with timestamps
- [ ] **SPKR-06**: Diarization is applied to new recordings automatically; existing sessions without `diarizedTranscriptS3Path` fall back gracefully to plain transcript display

### Chat Moderation

- [ ] **MOD-01**: Broadcaster can bounce (kick) a user from their active stream via a button visible only to the broadcaster in the chat participant list
- [ ] **MOD-02**: Bouncing a user calls IVS Chat `DisconnectUser` to immediately terminate their WebSocket connection
- [ ] **MOD-03**: A bounce event is written to a DynamoDB moderation log (`PK: SESSION#{id}`, `SK: MOD#{timestamp}#{uuid}`) with `userId`, `actionType: 'bounce'`, and `actorId`
- [ ] **MOD-04**: `create-chat-token.ts` checks the moderation log before issuing a new token — users with an active bounce on the current session are denied a token with a 403 response
- [ ] **MOD-05**: Any user can report a chat message via an inline quick-action that appears only on other users' messages (never on own messages)
- [ ] **MOD-06**: Clicking report fires a backend request and shows a private toast confirmation — the reported message remains visible and no public label is applied
- [ ] **MOD-07**: A report event is written to the moderation log with `msgId`, `actionType: 'report'`, `reporterId`, and `reportedUserId`
- [ ] **MOD-08**: Moderation quick-action (report button) is available in all chat rooms (broadcast chat, hangout chat) not just on broadcast pages

### Upload Video Player

- [ ] **VIDP-01**: Uploaded videos open at `/video/:sessionId` — a dedicated page separate from the `/replay` path with its own navigation and layout
- [ ] **VIDP-02**: Video player uses HLS.js with adaptive bitrate enabled by default; user can manually override to a specific resolution from a quality selector UI
- [ ] **VIDP-03**: Quality selector reads available levels from `hls.levels` after `MANIFEST_PARSED` and displays them as human-readable labels (e.g., "1080p", "720p", "Auto")
- [ ] **VIDP-04**: Quality selector uses `hls.nextLevel` on Safari to prevent buffer stall errors; falls back gracefully if only one quality level is present
- [ ] **VIDP-05**: Upload video page displays the AI summary and speaker-attributed transcript (or plain transcript) in a collapsible info panel below the player
- [ ] **VIDP-06**: Upload video page supports async comments: users can leave a timestamped comment anchored to the current video position
- [ ] **VIDP-07**: Comments are fetched on page load (polling, not WebSocket) and displayed sorted newest-first with an option to sort by video position
- [ ] **VIDP-08**: Comments within ±1500ms of the current playback position are visually highlighted during playback
- [ ] **VIDP-09**: Upload video page supports emoji reactions (same emoji set as broadcast/replay) stored and displayed as reaction summary counts
- [ ] **VIDP-10**: Activity feed `UploadActivityCard` links navigate to `/video/:sessionId` instead of the previous upload path

## v1.4 Requirements: Creator Studio & Stream Quality (COMPLETE)

### Stream Quality Monitoring

- [x] **QUAL-01**: Broadcaster can view real-time stream quality dashboard during live broadcast
- [x] **QUAL-02**: Dashboard displays current bitrate (Mbps) and target bitrate for comparison
- [x] **QUAL-03**: Dashboard displays current frame rate (FPS) and resolution (e.g., 1920x1080)
- [x] **QUAL-04**: Dashboard displays network status (Connected/Unstable/Disconnected) with visual indicator
- [x] **QUAL-05**: Dashboard displays health score (0-100%) based on bitrate stability and FPS consistency
- [x] **QUAL-06**: Dashboard alerts broadcaster when bitrate drops >30% below target (warning badge)
- [x] **QUAL-07**: Dashboard is non-intrusive overlay on broadcast page (does not block stream preview)
- [x] **QUAL-08**: Metrics update every 1-2 seconds with no API latency impact on broadcast

### Creator Spotlight

- [x] **SPOT-01**: Broadcaster can open a live session discovery modal while broadcasting
- [x] **SPOT-02**: Modal lists other live public broadcasts with broadcaster name and session age
- [x] **SPOT-03**: Broadcaster can select a creator from the list to feature as a spotlight
- [x] **SPOT-04**: Featured creator appears as a fixed badge on the broadcast page with name, live indicator, and Watch link
- [x] **SPOT-05**: Broadcaster can remove the featured creator spotlight at any time
- [x] **SPOT-06**: Viewer page displays the featured creator badge (read-only, Watch link navigates to their stream)
- [x] **SPOT-07**: Featured creator selection is persisted via `PUT /sessions/{id}/spotlight` API
- [x] **SPOT-08**: Featured creator state polls every 15s on viewer page to stay current

## Future Requirements

### Moderation Enhancements

- **MOD-F01**: Admin view to review moderation log across all sessions
- **MOD-F02**: Automatic content moderation via IVS Chat content moderation Lambda
- **MOD-F03**: User block (persistent across sessions, not just per-stream bounce)
- **MOD-F04**: Broadcaster can delete a specific chat message

### Pipeline

- **PIPE-F01**: Dead letter queue (DLQ) on EventBridge rules for guaranteed delivery
- **PIPE-F02**: CloudWatch dashboard for pipeline health metrics across all sessions

### Upload Player

- **VIDP-F01**: Comment threading (replies to comments)
- **VIDP-F02**: Comment moderation (report, delete own)
- **VIDP-F03**: Share a specific video timestamp via deep-link URL

## Out of Scope

| Feature | Reason |
|---------|--------|
| AI content moderation/filtering | v1.5 is human-driven moderation only — AI filtering deferred to v2 |
| Speaker → username mapping | Composite audio recordings cannot map acoustic labels to identities reliably |
| Per-participant IVS RealTime recording | Would enable future username mapping; out of scope for v1.5 |
| WebSocket-based comment real-time sync | Polling sufficient for VOD; WebSocket adds complexity with no meaningful UX gain |
| Comment reactions (emoji on specific comments) | Deferred to future; session-level reactions ship first |
| Permanent user ban (cross-session) | Per-stream bounce ships in v1.5; persistent ban deferred to admin tooling milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 25 | Complete |
| PIPE-02 | Phase 25 | Complete |
| PIPE-03 | Phase 25 | Complete |
| PIPE-04 | Phase 25 | Complete |
| PIPE-05 | Phase 26 | Complete |
| PIPE-06 | Phase 26 | Complete |
| PIPE-07 | Phase 26 | Complete |
| PIPE-08 | Phase 26 | Complete |
| SPKR-01 | Phase 27 | Pending |
| SPKR-02 | Phase 27 | Pending |
| SPKR-03 | Phase 27 | Pending |
| SPKR-04 | Phase 27 | Pending |
| SPKR-05 | Phase 27 | Pending |
| SPKR-06 | Phase 27 | Pending |
| MOD-01 | Phase 28 | Pending |
| MOD-02 | Phase 28 | Pending |
| MOD-03 | Phase 28 | Pending |
| MOD-04 | Phase 28 | Pending |
| MOD-05 | Phase 28 | Pending |
| MOD-06 | Phase 28 | Pending |
| MOD-07 | Phase 28 | Pending |
| MOD-08 | Phase 28 | Pending |
| VIDP-01 | Phase 29 | Pending |
| VIDP-02 | Phase 29 | Pending |
| VIDP-03 | Phase 29 | Pending |
| VIDP-04 | Phase 29 | Pending |
| VIDP-05 | Phase 30 | Pending |
| VIDP-06 | Phase 30 | Pending |
| VIDP-07 | Phase 30 | Pending |
| VIDP-08 | Phase 30 | Pending |
| VIDP-09 | Phase 30 | Pending |
| VIDP-10 | Phase 29 | Pending |

**Coverage:**
- v1.5 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-10 for milestone v1.5*
