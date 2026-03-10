# Feature Research

**Domain:** Video streaming platform — pipeline reliability, moderation, and upload experience
**Milestone:** v1.5 Pipeline Reliability, Moderation & Upload Experience
**Researched:** 2026-03-10
**Confidence:** MEDIUM-HIGH overall (HIGH on moderation UX and video player UX; MEDIUM on speaker diarization mapping)

---

## Feature Area 1: EventBridge Pipeline Observability & Dead-Letter Recovery

### Table Stakes (Users/Operators Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Structured JSON log per pipeline stage | CloudWatch Logs Insights auto-discovers JSON fields; string logs are not queryable; operators cannot debug pipeline failures without it | LOW | Add `pipelineStage`, `sessionId`, `status`, `durationMs` as top-level fields on every handler log object |
| `sessionId` propagated as correlation ID | Operators must filter ALL logs for one session in a single CloudWatch Logs Insights query | LOW | Use the existing `sessionId` as correlation ID; inject it as a log field on every invocation |
| `stage_started` / `stage_completed` / `stage_failed` events | Knowing a stage failed is not enough; need start + end to compute duration and identify hang vs crash | LOW | Emit two log lines per handler: one at entry with `status: started`, one at exit with `status: completed` or `status: failed` |
| Log retention policy set | Without explicit retention, CloudWatch accrues unbounded storage cost | LOW | 14–30 day retention is the standard; apply to all Lambda log groups in CDK |
| DLQ on EventBridge rules targeting Lambda | Without a DLQ, failed event deliveries are silently dropped; operators assume success | MEDIUM | Configure SQS DLQ on each EventBridge rule; add CloudWatch alarm on DLQ `ApproximateNumberOfMessagesVisible > 0` |
| Stuck session recovery cron | Sessions can stall mid-pipeline if Lambda times out or EventBridge delivery fails; without a cron, they stay stuck forever | MEDIUM | Scheduled Lambda (EventBridge Scheduler, every 15 min) queries DynamoDB for sessions with `transcriptStatus IN [pending, processing]` and `processingStartedAt < now - 30min`; re-fires recovery event |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-session processing timeline in existing audit UI | The SessionAuditLog component already renders stage timestamps; extending DynamoDB to store stage timestamps per session makes the UI useful as a real-time debug tool | LOW | Store `stageTimestamps: { [stage]: { startedAt, completedAt, failedAt } }` on the session record |
| CloudWatch Logs Insights saved query | Single-click debug: `filter sessionId = "X" and pipelineStage exists | sort @timestamp asc` — surfaces entire pipeline trace in seconds | LOW | Document the query as a runbook; optionally create a CloudWatch Dashboard widget |
| Idempotent cron recovery | If a recovery event is fired twice (cron fires, then EventBridge also retries), the handler must not double-process | MEDIUM | Use `processingStartedAt` field + conditional DynamoDB update as idempotency guard; Lambda Powertools Idempotency feature for TypeScript is available |

### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| AWS X-Ray full distributed tracing | "Real observability" | Adds cold-start overhead; costs $5/million traces; overkill for a 4-stage linear pipeline that can be traced with `sessionId` | Structured JSON logs + CloudWatch Logs Insights cover 95% of debug needs at near-zero cost |
| Lambda DLQ (not EventBridge rule DLQ) | Familiar Lambda pattern | Lambda DLQs fire on async Lambda invocation failures, not on EventBridge delivery failures — different failure mode; creates false sense of coverage | Configure DLQs on EventBridge rules (the delivery mechanism), not on Lambda functions |
| AWS Step Functions orchestration | "More reliable pipeline" | Major rewrite of existing event-driven architecture; adds state machine cost and complexity | Structured logs + stuck-session cron recover rare failures; Step Functions is appropriate for workflows requiring branching/parallel steps, not this linear pipeline |
| Real-time CloudWatch dashboard with widgets | "Visibility for the team" | CloudWatch dashboards are $3/dashboard/month plus $0.01/metric/month; premature at small scale | CloudWatch Logs Insights ad-hoc queries are free up to 5GB scanned/month; use those for debugging |

### Concrete Operator UX: Pipeline Audit

- Every Lambda handler emits structured JSON: `{ sessionId, pipelineStage, status, durationMs, lambdaRequestId, timestamp }`.
- `pipelineStage` values: `recording-ended`, `start-mediaconvert`, `mediaconvert-complete`, `start-transcribe`, `transcribe-complete`, `ai-summary`.
- `status` values: `started`, `completed`, `failed`, `skipped`.
- Debug query: `fields @timestamp, pipelineStage, status, durationMs | filter sessionId = "abc123" | sort @timestamp asc`.
- Stuck-session cron: runs every 15 minutes; `processingStartedAt` threshold is 30 minutes; re-fires `RecordingProcessingStuck` EventBridge event with the original `sessionId`.
- DLQ alarm: CloudWatch alarm fires when DLQ depth > 0 for > 5 minutes; operator investigates CloudWatch logs using the `sessionId` from the DLQ message body.

---

## Feature Area 2: Speaker-Attributed Transcripts

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Speaker-labeled transcript lines | Without attribution, a multi-speaker hangout transcript is an unreadable wall of text; users need "who said what" | MEDIUM | Amazon Transcribe batch `ShowSpeakerLabels: true` + `MaxSpeakerLabels: N` in `StartTranscriptionJob`; output includes `speaker_label` per segment |
| Username mapping for speaker labels | Raw `spk_0` / `spk_1` labels are meaningless; users expect actual participant names | MEDIUM | Application-level heuristic: join Transcribe segment start times against session participant join/leave timestamps stored in DynamoDB; earliest speaker = first participant to join |
| Graceful fallback when mapping fails | Diarization accuracy degrades with short utterances or overlapping speech; app must not crash or display empty labels | LOW | If `spk_N` cannot be matched to a known username, display `Speaker 1`, `Speaker 2`; never display raw `spk_0` |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Color-coded speaker blocks | Different speakers visually separated by color; standard UX in Descript, Otter.ai, Rev | LOW | Deterministic color from speaker index: `spk_0` → blue, `spk_1` → green; CSS class per speaker |
| Click-to-seek from attributed line | Each transcript line is a timestamp link; clicking jumps the video player to that moment | MEDIUM | Transcribe output includes `start_time` (seconds float) per segment; pass to `player.seekTo(startTime)` |
| Broadcast sessions: single-speaker shortcut | One-to-many broadcast has exactly one speaker (the broadcaster); skip diarization overhead | LOW | If `sessionType === 'broadcast'`, attribute all lines to `sessionOwner` without running diarization |

### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Real-time speaker diarization during live stream | "Attribution during the live broadcast" | IVS RealTime does not expose per-speaker audio tracks; Transcribe streaming diarization has significant lag; accuracy is much lower than batch | Batch diarization post-recording only; label transcript as "available after processing" |
| Manual speaker re-labeling UI | "What if the auto-mapping is wrong?" | Adds drag-and-drop relabeling UI, storage updates, and state management complexity | Defer to v2; display confidence indicator in v1.5; users can copy transcript text as workaround |

### How Amazon Transcribe Diarization Works (Implementation Notes)

- Enable via `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: N }` on `StartTranscriptionJob`. Set `N` to the hangout participant count (stored on session).
- Batch output: `results.speaker_labels.segments[]` — each has `{ start_time, end_time, speaker_label, items[] }`.
- Items in `results.items[]` also carry `speaker_label` when diarization is enabled.
- Accuracy degrades past 5 concurrent speakers per Amazon Transcribe documentation. Sessions with >5 participants should set `MaxSpeakerLabels: 5` and accept that some speakers may be merged.
- Application mapping strategy: compare `segment.start_time` against DynamoDB `participantJoinedAt` timestamps. The participant with the closest join time to the first `spk_N` appearance is the most likely match. This is a heuristic — confidence: MEDIUM.
- Broadcast sessions (one speaker): skip diarization; attribute all lines to `sessionOwnerId`.
- Confidence for overall feature: MEDIUM — timing-based matching works well for structured hangouts; degrades for overlapping speech or late joiners.

---

## Feature Area 3: Chat Moderation

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Broadcaster bounce/kick (disconnect user from chat) | Every live streaming platform gives broadcasters authority over their own stream; missing this = platform feels unsafe | MEDIUM | IVS Chat `DisconnectUser` API disconnects the WebSocket; backend must also block reconnect for the session duration |
| Reconnect block after bounce | Without a reconnect block, the bounced user can refresh and rejoin immediately; bounce is meaningless | LOW | Check bounce record in `POST /chat-token`; return `403 Forbidden` if user is bounced for this session |
| Per-message report action (inline, other-users' messages only) | Standard UX on YouTube, Discord, Twitch; users expect a quick "flag this" gesture | LOW | Three-dot or flag icon on hover; only shown on messages not sent by the current user; never on own messages |
| Moderation actions logged to DynamoDB | Audit trail required; operators must be able to answer "who was bounced when and by whom" | LOW | `MODLOG#${sessionId}#${timestamp}` record with `actionType`, `targetUserId`, `reportedMessageId`, `actorUserId` |
| Bounce is chat-scoped (not stream disconnect) | Bouncing someone from chat should not end their ability to watch the video | LOW | IVS Chat disconnect is separate from IVS stream playback; bounced user continues watching, just cannot send messages |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bounce notice sent to the bounced user before disconnect | Industry-standard UX; without a notice, user sees chat stop working with no explanation — confusing and frustrating | LOW | Send a targeted IVS Chat `SendEvent` to the bounced user's connection immediately before calling `DisconnectUser`; frontend handles `BOUNCE_NOTICE` event type |
| Report fires silently (not visible to other chat participants) | Users want to flag content without making it a public spectacle; public "reported" labels encourage pile-ons | LOW | Report POST goes to backend only; no visible change in chat UI for other participants |
| Broadcaster sees report count on flagged messages | Helps broadcaster prioritize: "3 reports on this message" is more urgent than 1 | LOW | Return report count via existing session/chat API or a new `GET /sessions/{sessionId}/moderation/reports` endpoint |

### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| AI auto-moderation / keyword filter | "Automate moderation" | Scope-expanding; false positive rate for casual streams is high; PROJECT.md explicitly defers AI content moderation to v2 | Human-driven moderation only (bounce + report) for v1.5 |
| Platform-wide ban | "Prevent repeat offenders" | Requires admin tooling, appeal process, policy documentation; out of scope | Session-scoped bounce in v1.5; platform ban deferred to admin dashboard milestone |
| Message deletion visible to all users (tombstone) | "Show that a message was removed" | Complicates IVS Chat message state; deleted messages must be broadcast as tombstones to all clients | Log deletion server-side; the message remains visible in the reporter's UI; no public broadcast |
| Slow mode / rate limiting | "Prevent spam" | Per-user rate tracking requires additional state; significant backend complexity | Bounce is the spam defense for v1.5; slow mode deferred to v2 |
| Moderator roles (non-broadcaster users with mod powers) | "Delegate moderation" | Requires permission model and role management; contradicts simplicity goal | Broadcaster is the sole moderator for v1.5 |

### Concrete UX Behavior: Bounce (Kick)

1. Broadcaster sees a three-dot action menu on each chat message or a per-user action button.
2. Selecting "Remove from chat" triggers `POST /sessions/{sessionId}/moderation/bounce` with `{ targetUserId }`.
3. Backend: sends `BOUNCE_NOTICE` IVS Chat event to the target user's connection → calls `IVSChat.DisconnectUser` → writes `MODLOG` record → marks user as bounced in DynamoDB for this `sessionId`.
4. Bounced user's client receives `BOUNCE_NOTICE` event: chat input is disabled; a banner appears: "You have been removed from this chat by the host." The video stream continues playing.
5. If the bounced user refreshes and attempts to reconnect: `POST /chat-token` checks the bounce record for this `sessionId` and returns `403 Forbidden`. Frontend shows the banner again.
6. Other chat participants see no visible change. No public "user was kicked" message.

### Concrete UX Behavior: Report Message

1. A flag or three-dot icon appears on hover on any message not sent by the current user. Own messages never show this icon.
2. Clicking opens a brief confirmation: "Report this message?" with a "Report" button and a "Cancel" button. An optional free-text `reason` field may be included (optional for v1.5).
3. `POST /sessions/{sessionId}/moderation/report` with `{ messageId, reason? }`.
4. Backend writes `MODLOG` record with `actionType: 'report'`; returns `200 OK`.
5. Frontend shows a transient "Message reported" toast (2–3 seconds). No other visible change in the chat.
6. The reported message remains visible to the reporter to avoid confusion about what was said.
7. Broadcaster moderation view (if implemented) shows a report count badge on flagged messages.

---

## Feature Area 4: Upload Video Player Page (`/video/:sessionId`)

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| HLS adaptive bitrate playback | MediaConvert output is a multi-rendition HLS manifest; browser must handle adaptive streaming | LOW | HLS.js handles ABR automatically after initialization; the IVS Player SDK also supports HLS |
| Manual quality selector | Users expect to choose resolution (Auto / 1080p / 720p / 480p / 360p); missing = frustration when ABR chooses wrong rendition on a fast connection | LOW | Parse `hls.levels[]` after `MANIFEST_PARSED` event; render a quality menu; `hls.currentLevel = N` locks quality; `hls.currentLevel = -1` restores ABR |
| Playback rate controls (0.5x – 2x) | Standard expectation for VOD content | LOW | HTML5 `videoElement.playbackRate` property; wrap in a UI control |
| Play/pause, seek bar, volume, fullscreen | Absolute baseline for any video player | LOW | Use HLS.js with a thin custom controls layer rather than rolling native player logic |
| Buffering/loading indicator | Users need visual feedback during seeks or slow connections | LOW | Listen to HLS.js `BUFFER_STALLED_ERROR` and `FRAG_BUFFERED` events; show/hide a spinner overlay |
| Session title, owner, duration, upload date | Users expect context without playing the video | LOW | Pull from existing session DynamoDB record; render in page header |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Transcript + AI summary side panel | Exclusive to this platform; lets users skim the content before committing to watch | LOW | Transcript and AI summary already exist on the session record; render in a collapsible side panel |
| Click-to-seek from transcript line | Turns static transcript text into interactive navigation | MEDIUM | Requires player time position coordination with transcript segment `start_time` fields |
| Async timestamped comments | Comments anchored to a video position; distinct engagement model from live chat | MEDIUM | See Feature Area 5 |
| Reactions displayed on upload | Consistent with existing replay experience | LOW | Reuse existing reactions rendering; reactions stored per-session already |
| "Quality locked" indicator | Tells user that ABR is disabled and they are watching a specific rendition | LOW | Toggle label next to quality selector showing current rendition |

### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Custom video player from scratch | "Full control over the UI" | HLS requires segment fetching, buffer management, ABR logic, error recovery — months of work to reinvent HLS.js | Use HLS.js directly with a thin custom React controls layer on top |
| Autoplay with sound | "Feels modern and immediate" | Browsers block autoplay with sound by default; results in silent or failed playback; confusing UX | Autoplay muted is browser-permissible; require a user gesture to unmute |
| Video chapters from AI summary | "Smart segmentation" | AI summary is a single paragraph; chapter generation requires a different Bedrock prompt and output schema | Transcript click-to-seek covers chapter-navigation needs; chapters deferred to v2 |
| Download button | "Users want offline access" | S3 pre-signed URL generation adds complexity; introduces copyright/abuse concerns | Out of scope for v1.5; log as v2 requirement |

### HLS Quality Selector: Implementation Notes

- `hls.levels` array is populated after the `MANIFEST_PARSED` event: `[{ height: 1080, bitrate: 5000000 }, { height: 720, bitrate: 2500000 }, ...]`.
- Render options as: `Auto`, `1080p`, `720p`, `480p`, `360p` (map from `level.height`).
- `hls.currentLevel = -1` re-enables ABR (Auto mode).
- `hls.currentLevel = N` locks to rendition index `N` — disables ABR until changed.
- When quality is locked, show a lock icon or "1080p (locked)" label so users understand ABR is off.
- MediaConvert existing output renditions: 1080p, 720p, 480p, 360p — all four should appear in the menu.
- Confidence: HIGH — well-documented HLS.js pattern with extensive community usage.

---

## Feature Area 5: Async Comments on Video

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Comments persist after page reload | Users expect permanence; live chat is ephemeral; VOD comments are permanent | LOW | Store in DynamoDB: `COMMENT#${sessionId}#${commentId}` record with `videoPositionMs`, `text`, `authorId`, `createdAt` |
| Comments anchored to a video timestamp | Core differentiator of video comments vs. generic post comments; YouTube established this expectation | MEDIUM | Store `videoPositionMs` on each comment; display as `[0:04]` prefix; clicking seeks player to that position |
| Display anchored timestamp as clickable seek link | Users expect to click a timestamp and jump to that moment | LOW | `onClick={() => player.seekTo(comment.videoPositionMs / 1000)}` |
| Comment count shown on page | Social signal; users want to know engagement before scrolling | LOW | Aggregate count on session record or via `COUNT` DynamoDB query |
| Threaded replies (one level deep) | Flat threads become unreadable; users expect to respond to a comment | MEDIUM | `parentCommentId` field; render as two-level tree (comment + indented replies); no deeper nesting |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Seek bar comment markers | Visual density map showing where conversation happened; YouTube-style dot markers on progress bar | MEDIUM | Render `div` overlays at `(positionMs / durationMs * 100)%` on the seek bar track |
| Dual sort modes: by position vs. by recency | "Position" mode: watch comments appear as you reach them; "Recency" mode: see newest discussion first | LOW | Client-side re-sort of fetched comments; two radio buttons or a toggle |
| Comment reactions (like/heart) | Lightweight engagement without requiring text; standard on YouTube | LOW | Single emoji count per comment stored in DynamoDB; `POST /comments/{commentId}/react` |

### Anti-Features

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| Real-time comment sync via WebSocket | "See new comments without refresh" | Upload video page is async-first; live sync adds WebSocket infrastructure complexity without clear UX value; VOD viewers are not in synchronous sessions | Periodic polling (30s) or a manual "Load new comments" button is sufficient for VOD |
| Inline video frame annotations / drawing overlays | "Mark a specific frame visually" | Canvas overlay + frame-accurate sync is very high complexity; no evidence users demand this at this stage | Timestamped text comments cover the annotation use case adequately |
| Nested replies beyond two levels | "Rich threaded discussion" | Deep threads are hard to read on a video page; Reddit-style nesting is the wrong model | One reply level; encourage new top-level comments rather than deep threading |
| Comment popularity sort as default | "Surface best comments first" | Premature; adds upvote infrastructure before there are enough comments to need sorting | Newest-first as default; position-sort as alternative; popularity sort deferred to v2 |

### Key UX Differences: Async Comments vs Live Chat

| Dimension | Live Chat (existing) | Async Comments (v1.5) |
|-----------|---------------------|----------------------|
| Persistence | Read-only archive after session ends | Primary artifact; permanent, editable/deletable |
| Timestamp | Wall-clock time during the event | Video position (`0:04`, `1:23`, etc.) |
| Default ordering | Chronological, newest at bottom (live scroll) | Newest-first or position-sort (user chooses) |
| Threading | Flat | Two levels (comment + replies) |
| Reading posture | During live event | Before/after watching; not during |
| Moderation | Broadcaster bounce + user report | User report (no bounce — no live session) |
| Real-time requirement | Required (live event) | Not required; periodic refresh sufficient |
| Expected volume | High (hundreds of messages per session) | Lower (tens of comments typical for VOD) |
| Seek bar integration | Not applicable | Comment position markers on seek bar |

---

## Feature Dependencies

```
Pipeline Observability (structured JSON logs)
    └──enables──> Stuck Session Recovery Cron
                  └──queries──> DynamoDB transcriptStatus GSI (already exists)
                  └──guards with──> processingStartedAt field (new field on session)

Speaker Attribution
    └──requires──> Transcribe diarization params on StartTranscriptionJob (new)
    └──requires──> Participant join/leave timestamps in DynamoDB (new fields)
    └──enhances──> Transcript panel on Upload Video Player page

Chat Moderation: Bounce
    └──requires──> IVS Chat DisconnectUser API (backend)
    └──requires──> Bounce check on POST /chat-token (backend guard)
    └──requires──> BOUNCE_NOTICE IVS Chat event handling (frontend)

Chat Moderation: Report
    └──independent of Bounce (separate DynamoDB record type)
    └──shares──> MODLOG DynamoDB record structure with Bounce

Upload Video Player Page
    └──requires──> session.recordingHlsUrl (already stored)
    └──requires──> Async Comments backend (new)
    └──enhances with──> Speaker-attributed transcript (click-to-seek shares same player API)

Async Comments
    └──requires──> Upload Video Player Page (no standalone comments outside player context)
    └──uses──> same player seekTo API as transcript click-to-seek
```

### Dependency Notes

- **Structured logs and stuck-session cron are parallel, not sequential:** Logs inform human debugging; the cron queries DynamoDB fields, not CloudWatch. Build both in the same phase but treat them as independent concerns.
- **Speaker attribution requires participant join timestamps:** Without them, the `spk_N` → username mapping degrades to `Speaker N` fallback. Add `participantJoinedAt` fields to the session's hangout participant list in the same phase as diarization.
- **Bounce requires a reconnect block:** `DisconnectUser` alone is insufficient; without the `POST /chat-token` guard, the bounced user refreshes and rejoins. These are part of the same feature unit.
- **Async comments are scoped to the upload video player page:** Build the player page shell first; add comments as a component. Do not ship comments without the player page.
- **Quality selector is part of the player page:** It is not a separate phase; implement it as part of the initial player build using HLS.js `hls.levels`.

---

## MVP Definition (v1.5 Scope)

### Launch With (all 5 feature areas in scope for v1.5)

- [ ] Structured JSON pipeline logs: `sessionId`, `pipelineStage`, `status`, `durationMs` on all pipeline Lambdas
- [ ] Stuck-session recovery cron: 15-minute schedule, 30-minute threshold, re-fires recovery EventBridge event
- [ ] SQS DLQ on EventBridge pipeline rules + CloudWatch alarm on DLQ depth > 0
- [ ] `processingStartedAt` field on session record for cron to query
- [ ] Speaker-attributed transcript lines with username mapping; fallback to `Speaker N`
- [ ] Participant join/leave timestamps in DynamoDB (prerequisite for speaker mapping)
- [ ] Bounce action: broadcaster UI button + IVS Chat DisconnectUser + reconnect block on `/chat-token` + `BOUNCE_NOTICE` event to user
- [ ] Report action: inline flag on other-users' messages + DynamoDB MODLOG record + "Message reported" toast
- [ ] `/video/:sessionId` page with HLS.js player, ABR, manual quality selector, playback rate controls
- [ ] Transcript + AI summary collapsible side panel on video page
- [ ] Async comments: DynamoDB storage, video timestamp anchor, click-to-seek, two-level threading, dual sort modes
- [ ] Seek bar comment position markers

### Defer After v1.5 Launch

- [ ] DLQ auto-replay cron — manual via stuck-session cron is sufficient; auto-replay adds idempotency complexity
- [ ] Active comment highlighting during playback — UX polish; not blocking
- [ ] Broadcaster moderation panel showing report counts — useful but not on critical path for launch
- [ ] Manual speaker re-labeling UI — `Speaker N` fallback covers failure case
- [ ] Comment reactions (like/heart) — not blocking initial async comments launch

### Future Consideration (v2+)

- [ ] AI auto-moderation / keyword filters
- [ ] Platform-wide bans + admin moderation dashboard
- [ ] Video chapters from AI summary
- [ ] Comment popularity sorting
- [ ] Download button (S3 pre-signed URL generation)
- [ ] Nested replies beyond two levels
- [ ] Real-time comment WebSocket sync

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Structured pipeline logs | HIGH (operator) | LOW | P1 |
| Stuck session recovery cron | HIGH (operator reliability) | MEDIUM | P1 |
| EventBridge DLQ + CloudWatch alarm | HIGH (operator visibility) | LOW | P1 |
| Speaker-attributed transcripts | HIGH (viewer UX) | MEDIUM | P1 |
| Broadcaster bounce | HIGH (broadcaster safety) | MEDIUM | P1 |
| Report message (inline) | MEDIUM (user safety) | LOW | P1 |
| Upload video player + quality selector | HIGH (viewer engagement) | MEDIUM | P1 |
| Async comments with timestamps | MEDIUM (engagement) | MEDIUM | P1 |
| Transcript + AI panel on video page | HIGH (platform differentiator) | LOW | P1 |
| Seek bar comment markers | MEDIUM (UX polish) | MEDIUM | P2 |
| Bounce notice sent to kicked user | MEDIUM (UX clarity) | LOW | P2 |
| Broadcaster report count view | LOW (moderator utility) | LOW | P2 |
| Color-coded speaker blocks | LOW (UX polish) | LOW | P2 |
| Active comment highlighting during playback | LOW (UX polish) | MEDIUM | P3 |
| DLQ auto-replay cron | MEDIUM (ops automation) | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.5 launch
- P2: Should have, add in same milestone if time allows
- P3: Nice to have, defer to v1.6 or later

---

## Sources

- [Amazon EventBridge DLQ documentation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)
- [Improved failure recovery for Amazon EventBridge (AWS blog)](https://aws.amazon.com/blogs/compute/improved-failure-recovery-for-amazon-eventbridge/)
- [AWS Lambda Powertools (TypeScript) — npm](https://www.npmjs.com/package/@aws-lambda-powertools/logger)
- [AWS Serverless Observability best practices](https://aws-observability.github.io/observability-best-practices/guides/serverless/aws-native/lambda-based-observability/)
- [Amazon Transcribe speaker diarization — batch](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html)
- [Amazon Transcribe diarization batch output example](https://docs.aws.amazon.com/transcribe/latest/dg/diarization-output-batch.html)
- [Amazon IVS Chat moderation — DisconnectUser (DEV.to/AWS)](https://dev.to/aws/manually-moderating-amazon-ivs-chat-messages-5646)
- [GetStream: 7 UX Best Practices for Livestream Chat](https://getstream.io/blog/7-ux-best-practices-for-livestream-chat/)
- [GetStream: Live Stream Chat Moderation](https://getstream.io/blog/live-stream-chat-moderation/)
- [HLS.js 2025 guide — VideoSDK](https://www.videosdk.live/developer-hub/hls/hls-js)
- [Mux: Best Practices for Video Playback 2025](https://www.mux.com/articles/best-practices-for-video-playback-a-complete-guide-2025)
- [Mux: Adaptive Bitrate Streaming explained](https://www.mux.com/articles/adaptive-bitrate-streaming-how-it-works-and-how-to-get-it-right)
- [EventBridge Archive + Replay with Circuit Breaker pattern](https://sbrisals.medium.com/amazon-eventbridge-archive-replay-events-in-tandem-with-a-circuit-breaker-c049a4c6857f)
- [AssemblyAI: What is speaker diarization (2026)](https://www.assemblyai.com/blog/what-is-speaker-diarization-and-how-does-it-work)
- [Vidizmo: Speaker diarization in enterprise video](https://vidizmo.ai/blog/speaker-diarization-enterprise-video)

---

*Feature research for: v1.5 Pipeline Reliability, Moderation & Upload Experience*
*Researched: 2026-03-10*
