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

- [x] **SPKR-01**: Transcription jobs are submitted with `ShowSpeakerLabels: true` and `MaxSpeakerLabels: 2` to enable diarization
- [x] **SPKR-02**: Transcript post-processor extracts per-word speaker labels from Transcribe output and groups them into speaker-turn segments
- [x] **SPKR-03**: Speaker segments are stored in S3 as a compact JSON file (pointer on session as `diarizedTranscriptS3Path`) — never inline in DynamoDB to respect the 400KB item limit
- [x] **SPKR-04**: Speakers are labeled "Speaker 1" / "Speaker 2" (not usernames) since composite audio cannot map acoustic labels to identities
- [x] **SPKR-05**: Replay and upload video player pages display attributed transcript as alternating speaker turns with timestamps
- [x] **SPKR-06**: Diarization is applied to new recordings automatically; existing sessions without `diarizedTranscriptS3Path` fall back gracefully to plain transcript display

### Chat Moderation

- [x] **MOD-01**: Broadcaster can bounce (kick) a user from their active stream via a button visible only to the broadcaster in the chat participant list
- [x] **MOD-02**: Bouncing a user calls IVS Chat `DisconnectUser` to immediately terminate their WebSocket connection
- [x] **MOD-03**: A bounce event is written to a DynamoDB moderation log (`PK: SESSION#{id}`, `SK: MOD#{timestamp}#{uuid}`) with `userId`, `actionType: 'bounce'`, and `actorId`
- [x] **MOD-04**: `create-chat-token.ts` checks the moderation log before issuing a new token — users with an active bounce on the current session are denied a token with a 403 response
- [x] **MOD-05**: Any user can report a chat message via an inline quick-action that appears only on other users' messages (never on own messages)
- [x] **MOD-06**: Clicking report fires a backend request and shows a private toast confirmation — the reported message remains visible and no public label is applied
- [x] **MOD-07**: A report event is written to the moderation log with `msgId`, `actionType: 'report'`, `reporterId`, and `reportedUserId`
- [x] **MOD-08**: Moderation quick-action (report button) is available in all chat rooms (broadcast chat, hangout chat) not just on broadcast pages

### Upload Video Player

- [x] **VIDP-01**: Uploaded videos open at `/video/:sessionId` — a dedicated page separate from the `/replay` path with its own navigation and layout
- [x] **VIDP-02**: Video player uses HLS.js with adaptive bitrate enabled by default; user can manually override to a specific resolution from a quality selector UI
- [x] **VIDP-03**: Quality selector reads available levels from `hls.levels` after `MANIFEST_PARSED` and displays them as human-readable labels (e.g., "1080p", "720p", "Auto")
- [x] **VIDP-04**: Quality selector uses `hls.nextLevel` on Safari to prevent buffer stall errors; falls back gracefully if only one quality level is present
- [x] **VIDP-05**: Upload video page displays the AI summary and speaker-attributed transcript (or plain transcript) in a collapsible info panel below the player
- [x] **VIDP-06**: Upload video page supports async comments: users can leave a timestamped comment anchored to the current video position
- [x] **VIDP-07**: Comments are fetched on page load (polling, not WebSocket) and displayed sorted newest-first with an option to sort by video position
- [x] **VIDP-08**: Comments within ±1500ms of the current playback position are visually highlighted during playback
- [x] **VIDP-09**: Upload video page supports emoji reactions (same emoji set as broadcast/replay) stored and displayed as reaction summary counts
- [x] **VIDP-10**: Activity feed `UploadActivityCard` links navigate to `/video/:sessionId` instead of the previous upload path

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
| SPKR-01 | Phase 27 | Complete |
| SPKR-02 | Phase 27 | Complete |
| SPKR-03 | Phase 27 | Complete |
| SPKR-04 | Phase 27 | Complete |
| SPKR-05 | Phase 27 | Complete |
| SPKR-06 | Phase 27 | Complete |
| MOD-01 | Phase 28 | Complete |
| MOD-02 | Phase 28 | Complete |
| MOD-03 | Phase 28 | Complete |
| MOD-04 | Phase 28 | Complete |
| MOD-05 | Phase 28 | Complete |
| MOD-06 | Phase 28 | Complete |
| MOD-07 | Phase 28 | Complete |
| MOD-08 | Phase 28 | Complete |
| VIDP-01 | Phase 29 | Complete |
| VIDP-02 | Phase 29 | Complete |
| VIDP-03 | Phase 29 | Complete |
| VIDP-04 | Phase 29 | Complete |
| VIDP-05 | Phase 30 | Complete |
| VIDP-06 | Phase 30 | Complete |
| VIDP-07 | Phase 30 | Complete |
| VIDP-08 | Phase 30 | Complete |
| VIDP-09 | Phase 30 | Complete |
| VIDP-10 | Phase 29 | Complete |

**Coverage:**
- v1.5 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---

## v1.6 Requirements: Pipeline Durability, Cost & Debug

**Defined:** 2026-03-11

### Phase 31 — SQS Pipeline Buffers (Durability)

- [x] **DUR-01**: Add an SQS standard queue as the EventBridge target (instead of Lambda direct) for each of the 5 critical pipeline handlers: `recording-ended`, `transcode-completed`, `transcribe-completed`, `store-summary`, `start-transcribe`
- [x] **DUR-02**: Configure Lambda SQS event source mappings (batch size 1) so each Lambda polls its queue; remove direct EventBridge→Lambda permissions for these handlers
- [x] **DUR-03**: Each pipeline SQS queue has a DLQ with 14-day retention and maxReceiveCount of 3 so permanently failing events are captured for inspection
- [x] **DUR-04**: SQS visibility timeout on each queue is set to 6× the Lambda function timeout to prevent premature re-delivery during processing
- [x] **DUR-05**: EventBridge rules grant `sqs:SendMessage` to each pipeline queue so events are accepted; existing DLQs for direct invocation are replaced or repurposed

### Phase 32 — Handler Hardening & Idempotency (Correctness)

- [ ] **HARD-01**: `recording-ended.ts` throws (does not silently catch) on MediaConvert job submission failure so SQS retries the event instead of the pipeline silently stalling
- [ ] **HARD-02**: `transcode-completed.ts` throws on Transcribe job submission failure; idempotency key (sessionId + mediaconvert jobId) prevents duplicate Transcribe jobs on retry
- [ ] **HARD-03**: `on-mediaconvert-complete.ts` throws on EventBridge PutEvents failure so the upload flow event is guaranteed to be published
- [ ] **HARD-04**: `scan-stuck-sessions.ts` recovers sessions where `transcriptStatus = 'processing'` and `updatedAt > 2h ago` (fixes PIPE-06 trap where stale 'processing' sessions were permanently excluded)
- [ ] **HARD-05**: `transcribe-completed.ts` job name parsing falls back gracefully: if regex fails, logs a structured error with the raw job name and skips without silently corrupting session state

### Phase 33 — Pipeline Alarms & Dashboard (Observability)

- [ ] **OBS-01**: CloudWatch alarm fires when any pipeline SQS DLQ has `ApproximateNumberOfMessagesVisible > 0`; alarm state is ALARM within 1 evaluation period
- [ ] **OBS-02**: CloudWatch alarm fires when any pipeline Lambda has `Errors > 0` in a 5-minute period (error rate alarm per handler)
- [ ] **OBS-03**: An SNS topic receives all alarm state-change notifications; CDK accepts an optional `alertEmail` context variable to subscribe an email endpoint
- [ ] **OBS-04**: A CloudWatch dashboard (`VNL-Pipeline`) shows invocation count, error count, and DLQ depth for each of the 5 pipeline Lambdas in a single view

### Phase 34 — Nova Lite for AI Summaries (Cost)

- [x] **COST-01**: `store-summary.ts` uses `amazon.nova-lite-v1:0` as the default Bedrock model for AI summary generation (replacing Nova Pro / Claude)
- [x] **COST-02**: The Bedrock model ID is read from a `BEDROCK_MODEL_ID` Lambda environment variable so it can be changed via CDK without a code deploy
- [x] **COST-03**: `store-summary.ts` logs `inputTokens`, `outputTokens`, and the model ID used with every summarization for cost tracking in CloudWatch Logs

### Phase 35 — Pipeline Debug CLI (DevEx)

- [x] **DEVEX-01**: `tools/debug-pipeline.js --sessionId <id>` reads the DynamoDB session record and prints a human-readable pipeline status report (all pipeline fields: transcriptStatus, aiSummaryStatus, mediaconvertJobId, etc.)
- [x] **DEVEX-02**: `tools/replay-pipeline.js --sessionId <id> --from <stage>` publishes the correct EventBridge event to the default bus to resume pipeline from a given stage (`recording-ended`, `mediaconvert`, `transcribe`, `summary`)
- [x] **DEVEX-03**: Both CLI tools use the AWS SDK credential chain (environment variables, `~/.aws/credentials`, or EC2/Lambda role) and read `AWS_REGION` from environment or fall back to `us-east-1`

## Traceability (v1.6)

| Requirement | Phase | Status |
|-------------|-------|--------|
| DUR-01 | Phase 31 | Planned |
| DUR-02 | Phase 31 | Planned |
| DUR-03 | Phase 31 | Planned |
| DUR-04 | Phase 31 | Planned |
| DUR-05 | Phase 31 | Planned |
| HARD-01 | Phase 32 | Planned |
| HARD-02 | Phase 32 | Planned |
| HARD-03 | Phase 32 | Planned |
| HARD-04 | Phase 32 | Planned |
| HARD-05 | Phase 32 | Planned |
| OBS-01 | Phase 33 | Planned |
| OBS-02 | Phase 33 | Planned |
| OBS-03 | Phase 33 | Planned |
| OBS-04 | Phase 33 | Planned |
| COST-01 | Phase 34 | Planned |
| COST-02 | Phase 34 | Planned |
| COST-03 | Phase 34 | Planned |
| DEVEX-01 | Phase 35 | Planned |
| DEVEX-02 | Phase 35 | Planned |
| DEVEX-03 | Phase 35 | Planned |

---
*Requirements defined: 2026-03-10 for milestone v1.5*
*v1.6 requirements added: 2026-03-11*
