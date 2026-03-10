# Pitfalls Research: v1.5 Pipeline Reliability, Moderation & Upload Experience

**Domain:** AWS Lambda + EventBridge pipeline hardening, Amazon Transcribe diarization, IVS Chat moderation, HLS.js adaptive video player, async comments on existing streaming platform
**Researched:** 2026-03-10
**Confidence:** HIGH — based on existing codebase analysis (recording-ended.ts, start-transcribe.ts, transcribe-completed.ts, useChatRoom.ts), prior hotfix history from MEMORY.md, and verified AWS service constraints

---

## Context: System-Specific Risk Profile

This codebase has already experienced production bugs in exactly the EventBridge pipeline it is now trying to harden:
- Phase mismatch in userMetadata (`'21-uploads'` vs `'19-transcription'`) broke EventBridge rule matching
- Stale condition check (`session.recordingStatus` vs computed `finalStatus`) silently blocked MediaConvert submission
- Missing `iam:PassRole` permission caused runtime failures after a clean deploy
- The trigger fix required restructuring event flow (MediaConvert completion → direct PutEvents instead of relying on EventBridge rule matching MediaConvert events)

The pitfalls below are calibrated to this specific history. They are not generic advice.

---

## Critical Pitfalls

### Pitfall 1: Audit Log CloudWatch Log Group Does Not Exist at First Invocation

**What goes wrong:**
Lambda functions auto-create their `/aws/lambda/FunctionName` log group on first invocation — but only if the execution role has `logs:CreateLogGroup`. When a new audit Lambda (e.g., a structured pipeline logger) is deployed and immediately triggered by a live event, if the log group creation fails silently the first invocation produces no logs. The Lambda still succeeds (returns 200/void) but the audit trail is empty for that event. The developer checks CloudWatch Insights, finds nothing, and assumes the event was never received.

**Why it happens:**
- CDK Lambda construct grants `logs:CreateLogStream` and `logs:PutLogEvents` by default, but NOT `logs:CreateLogGroup` in all configurations
- If `logRetention` or an explicit `logs.LogGroup` resource is specified in CDK, the log group must be created before the Lambda is invoked — but CDK uses a custom resource for log retention, and timing during first deploy can create a window where invocations arrive before the log group exists
- The existing `ivs-event-audit.ts` handler uses `console.log(JSON.stringify(...))` which goes to CloudWatch via the Lambda runtime; this works fine. But when adding a NEW Lambda that calls `CloudWatchLogsClient.PutLogEvents` directly (for cross-handler structured logging), the log group must pre-exist

**How to avoid:**
- In CDK: explicitly declare `new logs.LogGroup(this, 'PipelineAuditLogGroup', { logGroupName: '/vnl/pipeline/audit', removalPolicy: RemovalPolicy.DESTROY })` for any log group targeted by PutLogEvents calls
- Do NOT rely on Lambda auto-creation for log groups referenced in code (only safe for the default `/aws/lambda/FunctionName` group)
- Prefer `console.log(JSON.stringify({ structured: true, ... }))` over direct CloudWatch SDK calls — the Lambda runtime handles log delivery reliably
- If direct PutLogEvents is used: wrap in try/catch and fall back to console.log; never let audit log failure propagate to the caller

**Warning signs:**
- CloudWatch Insights query returns 0 results for a new audit Lambda that you know was invoked
- Lambda shows successful invocations in metrics but empty log streams
- CDK deploy log shows `Custom::LogRetention` resource creation failures or warnings

**Phase to address:**
Phase adding pipeline audit logging (v1.5 Phase 1) — pre-create all log groups in CDK before any Lambda code references them

---

### Pitfall 2: Cron Recovery Handler Re-Fires Already-Processing Sessions (Double MediaConvert Submission)

**What goes wrong:**
A cron Lambda scans DynamoDB for sessions where `transcriptStatus` is `null` or `'pending'` and `endedAt` is older than 30 minutes. It re-fires the EventBridge event to start the pipeline. If the session is ALREADY in `transcriptStatus: 'processing'` (MediaConvert job submitted, job running) but hasn't finished yet (e.g., job takes 25 minutes for a long recording), the cron fires again, submits a SECOND MediaConvert job, and both jobs complete. The second job overwrites `transcript.json` in S3 with identical content — harmless in the happy path but wastes MediaConvert cost and creates confusing audit trail entries.

**Why it happens:**
- The cron checks `transcriptStatus` for `null` / `'pending'` but the existing code sets `transcriptStatus = 'processing'` when the MediaConvert job is submitted (see `recording-ended.ts` line ~294). A session with a slow-running job shows `transcriptStatus: 'processing'` for 20-30 minutes — which the cron should NOT retry
- If the cron threshold is set too tight (e.g., "retry after 15 minutes") it will hit sessions mid-processing
- The deeper issue: if the cron fires while the original Lambda is also running (race), two simultaneous MediaConvert jobs get submitted with different `jobName` values but the same `sessionId`. Both write to the same S3 output key (`${sessionId}/transcript.json`). The second write wins

**How to avoid:**
- Cron filter must exclude sessions with `transcriptStatus = 'processing'` AND where `mediaconvertJobId` is set — only retry sessions where `transcriptStatus` is null, `'pending'`, or `'failed'`
- Use a longer threshold: 45+ minutes before marking stuck (MediaConvert jobs for long recordings can take 20-30 minutes)
- Add a DynamoDB conditional write to set a `cronRecoveryAt` timestamp before re-firing, preventing the same session from being recovered twice within a cooldown window
- For truly stuck sessions (processing for >2 hours), set `transcriptStatus = 'failed'` rather than retrying indefinitely

**Warning signs:**
- Multiple MediaConvert jobs with the same `sessionId` prefix in the AWS console
- `transcript.json` S3 object `Last-Modified` timestamp is newer than the MediaConvert job completion time
- CloudWatch shows two `start-transcribe` Lambda invocations within minutes for the same sessionId

**Phase to address:**
Phase adding the stuck session cron (v1.5 Phase 2) — the filter expression for "stuck" must be defined precisely before implementation, not assumed

---

### Pitfall 3: Cron DynamoDB Scan Reads Every Item in the Table (Cost + Throttle)

**What goes wrong:**
The stuck session cron calls `ScanCommand` on the single-table DynamoDB table to find sessions where `status = 'ended'` AND `transcriptStatus` is not `'available'`. The table contains sessions, pool resources, chat messages, reactions, and processing events — all sharing one table. A full scan reads ALL of them. At current scale (small) this is cheap. As the table grows (each session generates 10-50 chat message items, multiple reaction items, multiple processing event items), a scan that runs every 5 minutes costs increasingly more and consumes read capacity units that could throttle other operations.

**Why it happens:**
- The existing `recording-ended.ts` handler already does a full table scan to find sessions by channel ARN (line ~74). This is a known anti-pattern already in the codebase — the cron is tempted to follow the same pattern
- The single-table design has no GSI optimized for "sessions by transcript status"
- DynamoDB Filter expressions do NOT reduce RCU consumption — you pay to read every item, then filter client-side

**How to avoid:**
- Add a GSI before implementing the cron, keyed on pipeline status. Example: `GSI_PIPELINE_PK = PIPELINE#${transcriptStatus}`, `GSI_PIPELINE_SK = ${endedAt}` — allows efficient query for all sessions with a given transcript status
- Alternatively: maintain a separate DynamoDB item as a "pipeline queue" (PK: `PIPELINE_QUEUE`, SK: `${sessionId}`) that is written when a session ends and deleted when pipeline completes — cron queries this small set only
- If adding a GSI is deferred: limit scan with `FilterExpression` on `entityType = 'SESSION'` first, scope to PK prefix `SESSION#` using a begins_with condition

**Warning signs:**
- DynamoDB `ConsumedReadCapacityUnits` metric spikes every 5 minutes in CloudWatch
- Cron Lambda duration climbs over time as table grows
- `ScanCommand` returns hundreds of non-session items before filtering

**Phase to address:**
Phase adding the stuck session cron (v1.5 Phase 2) — design the query strategy before writing cron code; do not start with a scan

---

### Pitfall 4: IVS Chat Bounce Does Not Prevent Immediate Reconnection

**What goes wrong:**
The broadcaster calls `DisconnectUser` via the IVS Chat Management API. The user is kicked from the WebSocket connection. Within 2-3 seconds, the frontend's `useChatRoom` hook detects the disconnect event (the `disconnect` listener fires with `reason: 'KICKED_BY_MODERATOR'` or similar) and — if the error handling is not explicit — automatically calls `room.connect()` again via a reconnection retry. The kicked user is back in the chat before the broadcaster notices they were removed.

**Why it happens:**
- `useChatRoom.ts` has a `disconnect` listener that sets `connectionState = 'disconnected'` and logs the reason — but it does NOT suppress reconnection attempts
- The `amazon-ivs-chat-messaging` SDK does not implement automatic reconnection itself, but frontend code that wraps the SDK in a useEffect might re-invoke `room.connect()` if `connectionState === 'disconnected'`
- More critically: `DisconnectUser` does not invalidate the existing chat token. The frontend still holds a valid token. Calling `tokenProvider()` again returns a new valid token (since `create-chat-token.ts` has no ban check), and the user reconnects with full permissions

**How to avoid:**
- Backend: `create-chat-token.ts` must check a moderation blocklist (DynamoDB) before issuing tokens. If `userId` is on the blocklist for `sessionId`, return `403 Forbidden`. This is the only reliable reconnection barrier
- Backend: Store bounced users in DynamoDB: `PK: MODERATION#${sessionId}`, `SK: BAN#${userId}`, with a TTL for temporary bans or no TTL for session-duration bans
- Frontend: On receiving a disconnect event with reason `KICKED_BY_MODERATOR`, set a `wasBounced` state flag and display a "You have been removed from this session" message — do NOT attempt reconnection
- The `DisconnectUser` API call alone is a display action only (removes user from current viewers' perspective) — the token block is what prevents re-entry

**Warning signs:**
- User reappears in chat within seconds of being kicked
- `useChatRoom.ts` disconnect handler does not branch on disconnect reason
- `create-chat-token.ts` has no moderation check before calling `CreateChatToken`

**Phase to address:**
Phase adding broadcaster bounce controls (v1.5 Phase 3) — implement the DynamoDB moderation store and token check before wiring the disconnect API call; the API call alone is insufficient

---

### Pitfall 5: Transcribe Diarization Stores Oversized JSON in DynamoDB (400KB Limit)

**What goes wrong:**
When `ShowSpeakerLabels: true` is added to the Transcribe job config, the JSON output grows substantially. A 1-hour session with active multi-speaker conversation produces a transcript JSON with the full `speaker_labels` section: per-utterance speaker assignments, each with `start_time`, `end_time`, `speaker_label`, and nested `items` arrays. A 60-minute 4-speaker session can produce 150KB–400KB of JSON. The existing `transcribe-completed.ts` handler reads the full JSON from S3, parses it, extracts `results.transcripts[0].transcript`, and stores the plain text directly on the session DynamoDB item (`transcript` field). If the plain text is large, or if the handler is changed to store the full diarized JSON on the session item, it will hit the 400KB DynamoDB item limit.

**Why it happens:**
- The current handler extracts plain text only (line ~76-77: `transcribeOutput.results.transcripts[0].transcript`) — this is safe for text-only transcripts
- When adding diarization, there is pressure to also store the speaker-attributed segment array on the session item for frontend display
- Each diarized segment looks like: `{ speakerLabel: 'spk_0', startTime: 1.2, endTime: 4.5, text: '...' }` — a 60-minute session at 1 segment/3 seconds = 1200 segments × ~80 bytes each = ~96KB just for segments
- If stored inline on the `SESSION#${sessionId} | METADATA` item alongside all other session fields (aiSummary, transcript, streamMetrics, etc.), the combined item size can exceed 400KB

**How to avoid:**
- Store diarized segments in S3 only — keep the existing `transcriptS3Path` pointer on the session item and add a `diarizedTranscriptS3Path` field pointing to the full diarized JSON
- Store a speaker attribution summary on the session item only: `speakerMap: { spk_0: 'alice', spk_1: 'bob' }` (small, bounded)
- Never store per-segment arrays directly on a DynamoDB session item — always reference via S3 URI
- The `TranscriptDisplay` frontend component already fetches from S3 via the `GET /sessions/{id}/transcript` endpoint — extend this endpoint to serve diarized data from S3, not DynamoDB

**Warning signs:**
- DynamoDB `UpdateCommand` returns `ValidationException: Item size has exceeded the maximum allowed size`
- Transcribe completion handler sets `transcriptStatus = 'failed'` silently after a large recording
- `get-transcript.ts` returns truncated or partial transcript for long sessions

**Phase to address:**
Phase adding speaker diarization (v1.5 Phase 4) — establish the S3 storage contract for diarized data before any code is written; never put segment arrays in DynamoDB

---

### Pitfall 6: Speaker Labels Cannot Be Reliably Mapped to Usernames Without Enrollment Data

**What goes wrong:**
Amazon Transcribe assigns labels `spk_0`, `spk_1`, etc. in the order speakers are first detected in the audio. These labels are NOT stable across jobs (a second Transcribe job on the same audio may assign `spk_0` to a different speaker), and they carry no metadata about who was speaking. The goal of "map speaker labels to session usernames" requires external context: you need to know which participant was speaking when, and that information is not in the Transcribe output. For hangout sessions (IVS RealTime, up to 5 participants), there is no audio track-to-participant mapping in the IVS RealTime recording structure. For broadcast sessions, there is only one broadcaster — diarization is straightforward (one labeled speaker = broadcaster). For hangouts, the composite recording does not expose per-participant audio tracks.

**Why it happens:**
- IVS RealTime stage recording produces a composite video file that mixes all participant audio into a single audio track — there are no separate audio channels per participant
- Transcribe receives the composite audio and assigns speaker labels purely based on voice acoustics — it has no knowledge of who each voice belongs to
- The assumption "Transcribe will tell me speaker 0 is Alice and speaker 1 is Bob" is incorrect — Transcribe produces `spk_0` and `spk_1` only; the mapping to names requires voice enrollment (Amazon Transcribe has no enrollment feature) or manual labeling

**How to avoid:**
- Scope diarization to: "show turn-by-turn transcript with consistent speaker labels" — NOT "show Alice: / Bob:" headers
- For broadcast sessions: since there is only one voice (the broadcaster), `spk_0 = session.userId` is a valid assumption — but only if the recording is a single-speaker broadcast
- For hangout sessions with multiple speakers: display `Speaker 1 / Speaker 2` labels, not usernames — this is honest about what the data actually provides
- Optionally: if hangout sessions used IVS RealTime with per-participant recording enabled, individual participant recordings exist in S3 and could be transcribed separately. This is a significant architecture change; scope carefully
- Document the limitation explicitly in the frontend: "Speakers are labeled by voice, not by name"

**Warning signs:**
- Phase plan includes "map spk_0 to first speaker in participants list" — this is unreliable (order in participants list != order of first utterance in audio)
- Requirement says "show username next to each transcript segment" without a defined mapping source

**Phase to address:**
Phase adding speaker diarization (v1.5 Phase 4) — scope the feature to turn-by-turn display with generic labels; explicitly defer username mapping to a future phase requiring per-participant audio tracks

---

## Moderate Pitfalls

### Pitfall 7: HLS.js Quality Level Switch Causes Buffering Stall on Mobile Safari

**What goes wrong:**
Adding a manual resolution selector (quality level picker) to the upload video player creates a known HLS.js failure mode on Safari (desktop and iOS): when `hls.currentLevel` is set manually to a higher quality, Safari's Media Source Extensions implementation sometimes stalls the SourceBuffer append operation during the quality transition. The player freezes for 2-10 seconds. On iOS 18, this is exacerbated by a `bufferStalledError` bug. Users see a spinner; they assume the video is broken.

**Why it happens:**
- HLS.js uses `startFragPrefetch` and segment pre-fetching to smooth quality transitions — but Safari has historically had partial MSE support
- When switching to a higher quality level, HLS.js must decode a fragment at the new bitrate that does not have a PTS overlap with the currently buffered content — in Safari, if the PTS intersection is not found, the buffer enters a stall state
- The existing `useReplayPlayer.ts` (used by `UploadViewer.tsx`) does not configure any HLS.js quality-switching parameters — default values may be aggressive for Safari

**How to avoid:**
- Set `hls.config.startLevel = -1` (auto) and `hls.config.capLevelToPlayerSize = true` — never force a specific level on first load
- For the manual quality picker, use `hls.nextLevel` (sets level at next segment boundary) rather than `hls.currentLevel` (immediate switch) — `nextLevel` is dramatically more stable
- Add a 500ms debounce on quality selector changes — rapid clicking crashes Safari
- Detect Safari: `navigator.vendor.includes('Apple')` — for Safari, hide the quality picker and let ABR run automatically
- Test on real iOS devices (not simulator) — HLS.js bugs in Safari are device-specific and not reproducible in simulators

**Warning signs:**
- Quality selector works in Chrome but hangs in Safari
- Console shows `bufferStalledError` or `No PTS intersection found` immediately after quality switch
- Video freezes and never recovers without page refresh

**Phase to address:**
Phase building the upload video player (v1.5 Phase 5) — implement quality switching with Safari detection from the first iteration; do not add it as an afterthought

---

### Pitfall 8: CORS on HLS Manifests Blocks Quality Level Fetching on UploadViewer

**What goes wrong:**
The upload video player loads a CloudFront-served HLS manifest (`recordingHlsUrl`). The manifest references sub-manifests for each quality level (e.g., `1080p/index.m3u8`, `720p/index.m3u8`) using relative paths. If CloudFront's CORS configuration returns the `Access-Control-Allow-Origin` header only for the manifest request but not for the quality-level sub-manifest or segment requests, HLS.js fails to load segments at levels other than the first. The player appears to work at the lowest quality but the quality picker does nothing.

**Why it happens:**
- CloudFront CORS configuration is set on S3 bucket origin policies and CloudFront cache behaviors. The existing setup was tested for the replay player (which loads `master.m3u8` at a single quality). The new upload player needs CloudFront to return CORS headers on ALL paths: `*.m3u8`, `*.ts`, `*.mp4`
- MediaConvert (used for upload encoding) produces an ABR output group with multiple quality tiers — the CloudFront distribution must have CORS enabled for all `recordings/*` path prefixes, not just the master manifest

**How to avoid:**
- Verify CloudFront cache behavior for `recordings/*` includes `Access-Control-Allow-Origin: *` (or origin allowlist) on all responses
- In CDK `session-stack.ts`, the CloudFront distribution should add CORS response headers policy to the recordings origin
- Test with browser DevTools Network tab: every `.m3u8` and `.ts` request must return `Access-Control-Allow-Origin` header
- HLS.js `xhrSetup` callback can add headers for debugging but is not a CORS fix — CORS must be configured server-side

**Warning signs:**
- Chrome DevTools shows `CORS policy: No 'Access-Control-Allow-Origin' header` on `720p/index.m3u8` but not on `master.m3u8`
- Quality level list shows multiple levels in `hls.levels` array but switching to any non-default level produces an error
- Only the first quality level works; all others fail silently

**Phase to address:**
Phase building the upload video player (v1.5 Phase 5) — verify CORS on all manifest paths during CDK stack update, not as a follow-up fix

---

### Pitfall 9: Async Comments Timestamp Drift Relative to Playback Position

**What goes wrong:**
Async comments (timestamped to a video position) are stored with `videoPositionMs` recorded at submission time using `player.currentTime * 1000`. When the comment is displayed during playback, the frontend must highlight or scroll-to comments within a ±500ms window of the current playback position. If the player's `currentTime` drifts (e.g., seek, buffering recovery, quality switch), the comment appears to be out of sync. This manifests as comments appearing a few seconds before or after the relevant moment, or comments never appearing because the playback position never exactly matches the window.

**Why it happens:**
- `player.currentTime` on an HLS.js player during a quality switch may jump forward (when the buffer is consumed during the switch and ABR recalculates the position)
- The existing `useReplayPlayer.ts` uses `player.getPosition() * 1000` for reaction sync — this is the correct pattern. Comments that use `videoElement.currentTime` directly (without the IVS player abstraction) will drift on quality switches
- Seek operations compound the issue: a comment stored at 2:34.500 should appear whether the user seeks to 2:34.000 or 2:34.800 — the display window must be wide enough

**How to avoid:**
- Use a display window of ±1500ms (not ±500ms) for comment highlighting — provides tolerant matching across seek and buffer events
- Store `videoPositionMs` in seconds (float), not milliseconds — reduces precision mismatch on truncation
- For comment display: use a polling approach (poll every 250ms, show comments within ±1.5s of current position) rather than event-driven (subscribe to exact timecodes)
- When user seeks: clear the currently-displayed comment immediately and allow the polling to re-match after seek settles (add a 500ms debounce after seek events)

**Warning signs:**
- Comments are visible in the list but don't highlight during playback
- Comments appear consistently N seconds late or early (suggests a unit mismatch — ms vs seconds)
- Comments never appear after a quality switch

**Phase to address:**
Phase adding async comments (v1.5 Phase 6) — define the timestamp storage format and display window tolerance before implementing the frontend polling hook

---

### Pitfall 10: EventBridge Pipeline Audit Logging Adds Per-Event DynamoDB Writes That Inflate Costs

**What goes wrong:**
The `ProcessingEvent` domain model is already defined in `session.ts` (lines 122-171) with a full entity structure including `eventId`, `eventType`, `eventStatus`, `timestamp`, `details`. If the audit logging phase writes a `ProcessingEvent` item to DynamoDB for EVERY pipeline stage (MediaConvert submitted, MediaConvert complete, Transcribe submitted, Transcribe complete, AI started, AI complete), that is 6 DynamoDB writes per session, per pipeline run. At scale with the stuck session cron retrying sessions, these writes multiply. More importantly, these items accumulate in the table permanently (no TTL) and inflate the table size, increasing scan costs for all operations that scan the table.

**Why it happens:**
- `ProcessingEvent` items have `PK: SESSION#${sessionId}` and `SK: EVENT#${timestamp}#${eventId}` — they are session-scoped and never deleted
- The cron scan reads ALL items under `SESSION#*` prefix — processing event items are returned alongside session metadata items, increasing scan cost without benefit
- The `recording-ended.ts` handler already writes `transcriptStatus = 'processing'` to the session metadata item — a separate `ProcessingEvent` item is additive cost for the same information

**How to avoid:**
- Add `TTL` attribute to `ProcessingEvent` items: set to `now + 30 days` — keeps the audit trail available for debugging but cleans up automatically
- Scope audit events to CloudWatch Logs (structured `console.log`) for real-time debugging, and to DynamoDB only for replay/support investigation
- The cron scan filter should explicitly exclude `entityType = 'PROCESSING_EVENT'` items — add `entityType = :session` to the FilterExpression so scan does not return event items
- Alternatively: store audit events in a separate DynamoDB table with its own TTL — keeps the session table clean

**Warning signs:**
- DynamoDB table item count grows much faster than session count (10-15x)
- Cron scan duration increases over weeks even with no growth in active sessions
- CloudWatch cost report shows unexpected DynamoDB read charges

**Phase to address:**
Phase adding EventBridge pipeline audit logging (v1.5 Phase 1) — define TTL policy for `ProcessingEvent` items before writing the first one

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Full table DynamoDB scan in cron handler | No GSI change needed | Unbounded cost growth as table grows | Never — add GSI or queue pattern before shipping cron |
| Store plain-text `transcript` directly on session item | Simple, no extra S3 fetch | 400KB item limit hit on long recordings with diarization | Only for short sessions (<30 min); add S3-only path for diarized output |
| `DisconnectUser` without token blocklist | Kick is instant and visible | User reconnects in seconds | Never — token blocklist is required for bounce to be meaningful |
| Use `hls.currentLevel` (immediate) instead of `hls.nextLevel` (graceful) | Simpler API | Buffering stall on Safari | Never for production quality switcher |
| Logging to CloudWatch only (no DynamoDB) for pipeline events | No DynamoDB cost | No audit trail for manual recovery investigation | Acceptable for phase 1 if DynamoDB audit added later |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| IVS Chat `DisconnectUser` | Calling it without backing token blocklist | Block token issuance in `create-chat-token.ts` first; disconnect is cosmetic only |
| Amazon Transcribe diarization | Setting `MaxSpeakerLabels` to actual participant count | Set to the MAXIMUM possible count (e.g., 5 for hangouts) to avoid misattribution when count is under-specified |
| Amazon Transcribe diarization | Mapping `spk_0` to first participant in roster | Impossible without per-participant audio tracks; only safe for single-speaker broadcasts |
| HLS.js quality switching | Calling `hls.currentLevel = N` directly | Use `hls.nextLevel = N` (switches at next segment) or `hls.loadLevel = N` for preloading |
| HLS.js on Safari | Assuming DevTools CORS errors are a code bug | CORS must be configured on CloudFront; HLS.js cannot work around missing CORS headers |
| EventBridge `PutEvents` | Publishing without `EventBusName` field | Without `EventBusName`, events go to the default bus; custom rules on custom bus never trigger |
| DynamoDB cron scan | Using `FilterExpression` to reduce cost | Filter expressions reduce ITEMS returned but NOT RCU consumed — full table is still read |
| CloudWatch structured logging | Calling `CloudWatchLogsClient.PutLogEvents` from inside Lambda | Prefer `console.log(JSON.stringify(...))` — Lambda runtime handles delivery without SDK calls or log group pre-creation |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Cron scanning full DynamoDB table every 5 min | DynamoDB read costs spike; cron duration grows weekly | Add GSI keyed on pipeline status before shipping cron | 10K+ session items (~100K total items including messages/reactions) |
| Comment fan-out query (all comments for a video, every 250ms) | API rate limit hit; DynamoDB reads spike during playback | Fetch all comments once on load; filter by position client-side | More than 500 comments on a single video |
| Full diarized JSON stored inline on session item | DynamoDB write failures on recordings >30 min | Store in S3; store only S3 URI on session item | Session with 60-min multi-speaker content |
| HLS.js downloading all quality levels in parallel (preloading) | High CloudFront egress cost on upload player | Set `hls.config.maxMaxBufferLength` and `hls.config.maxBufferLength` appropriately | Videos longer than 60 min with many quality levels |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Chat bounce without token blocklist | Kicked user reconnects immediately; moderation is cosmetic | Block token issuance per sessionId+userId in `create-chat-token.ts` |
| Moderation log without userId validation | Broadcaster can log moderation actions against arbitrary userIds not in the session | Validate `targetUserId` is an actual session participant before writing moderation record |
| S3 path for diarized transcript constructed from user input | Path traversal if sessionId contains `../` | Existing `recording-ended.ts` already validates against path traversal — apply same validation pattern |
| Cron Lambda with DynamoDB read-all permissions | Over-privileged; can read all session data including private session metadata | Scope IAM permissions to specific GSI or table prefix |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Quality picker visible on Safari but broken | User selects 1080p, video freezes, user thinks platform is broken | Detect Safari and hide manual quality picker; show "Auto" only |
| Transcript shows `spk_0` / `spk_1` without explanation | Users don't understand why their name isn't shown | Label as "Speaker 1 / Speaker 2" with tooltip: "Speaker names are identified by voice pattern" |
| Bounce shows no feedback to broadcaster | Broadcaster doesn't know if kick worked | Show toast: "User removed from chat" after `DisconnectUser` API returns 200 |
| Async comments not visible during buffering | User posts a comment, buffering occurs, timestamp offset by buffer duration | Show comment in list immediately; timestamp assignment uses player position at submit time, not wall clock |
| Upload player loads at lowest quality (240p) by default | Video looks blurry on first load, user adjusts manually | Set `hls.config.startLevel = -1` (ABR auto) with `capLevelToPlayerSize: true` for sensible default |

---

## "Looks Done But Isn't" Checklist

- [ ] **EventBridge audit logging:** Lambda logs appear in CloudWatch — verify the log group was pre-created in CDK, not auto-created on first invocation
- [ ] **Cron recovery:** Cron fires and re-submits stuck sessions — verify it excludes sessions with `transcriptStatus = 'processing'` AND `mediaconvertJobId` set
- [ ] **IVS Chat bounce:** `DisconnectUser` API call returns 200 — verify `create-chat-token.ts` blocks token issuance for bounced users before confirming bounce is "done"
- [ ] **Speaker diarization:** Transcribe job completes and `speaker_labels` section exists in JSON — verify pipeline stores diarized data in S3 only and does NOT inline segment arrays in DynamoDB
- [ ] **Quality switching:** Resolution picker changes quality in Chrome — verify Safari is handled separately and does not stall
- [ ] **Async comments:** Comments appear in list view — verify they highlight correctly at the right playback position including after a seek operation
- [ ] **Moderation log:** Reports and bounces write to DynamoDB — verify `TTL` attribute is set or the table has a TTL cleanup policy to prevent unbounded growth

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Audit log group missing; first invocations have no logs | LOW | Create log group manually in AWS console; add explicit CDK resource; re-run affected EventBridge events via SNS or manual Lambda invoke |
| Cron double-submits MediaConvert jobs | LOW | Identify duplicate jobs in MediaConvert console; cancel the second job; update session `transcriptStatus` manually if second job completed first |
| Bounced user reconnects (token blocklist missing) | MEDIUM | Add token blocklist check, redeploy `create-chat-token` Lambda; no data recovery needed |
| Diarized JSON stored in DynamoDB causes item size errors | HIGH | Migration required: move transcript data to S3, update session items with S3 URI, update all read paths; expensive if many sessions affected |
| Quality switcher stalls Safari; users report broken video | LOW | Deploy Safari detection to hide quality picker; no data recovery needed |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CloudWatch log group auto-creation race | v1.5 Phase 1 (pipeline audit) | CDK resource list includes explicit `LogGroup` before any Lambda references it |
| Cron double-execution (re-fires processing sessions) | v1.5 Phase 2 (stuck session cron) | Unit test: session with `transcriptStatus = 'processing'` is excluded from cron candidate set |
| Cron full table scan cost | v1.5 Phase 2 (stuck session cron) | Query plan documented; GSI or queue mechanism used; scan forbidden |
| IVS Chat bounce without token blocklist | v1.5 Phase 3 (chat moderation) | Integration test: disconnect user → attempt reconnect → token endpoint returns 403 |
| Diarized JSON exceeds DynamoDB 400KB limit | v1.5 Phase 4 (speaker diarization) | Test with synthesized 60-min multi-speaker transcript; verify S3-only storage path |
| Speaker label-to-username mapping impossible | v1.5 Phase 4 (speaker diarization) | Feature spec explicitly says "Speaker 1 / Speaker 2" labels only; no username mapping in scope |
| HLS.js quality switch stalls Safari | v1.5 Phase 5 (upload video player) | Test on real iOS device or Safari; verify `nextLevel` used; Safari detection hides manual picker |
| CORS on HLS sub-manifests | v1.5 Phase 5 (upload video player) | Network tab shows `Access-Control-Allow-Origin` on all `.m3u8` and `.ts` requests |
| Async comment timestamp drift | v1.5 Phase 6 (async comments) | Test: seek to 2:00, verify comment at 2:01 appears; seek rapidly, verify no duplicate display |
| ProcessingEvent items inflate table without TTL | v1.5 Phase 1 (pipeline audit) | DynamoDB TTL enabled on `ProcessingEvent` items; item count checked 7 days after deploy |

---

## Sources

**HIGH confidence (codebase analysis):**
- `/backend/src/handlers/recording-ended.ts` — existing scan pattern, MediaConvert submission, `transcriptStatus = 'processing'` set on job submission
- `/backend/src/handlers/start-transcribe.ts` — current transcript-only (no diarization) Transcribe job config
- `/backend/src/handlers/transcribe-completed.ts` — plain text extraction from `results.transcripts[0].transcript`; speaker_labels section not currently parsed
- `/backend/src/handlers/on-mediaconvert-complete.ts` — EventBridge `PutEvents` without `EventBusName` being the original bug that was hotfixed
- `/backend/src/domain/session.ts` — `ProcessingEvent` entity defined with all pipeline stages; `transcript` field is a string stored inline
- `/web/src/features/chat/useChatRoom.ts` — `disconnect` listener does not branch on reason; no bounce detection
- `MEMORY.md` hotfix history — phase mismatch, stale condition check, missing PassRole, MediaConvert EventBridge matching bug

**HIGH confidence (verified AWS docs):**
- [IVS Chat DisconnectUser API](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_DisconnectUser.html) — confirmed: disconnect does not invalidate existing token; backend must block token creation to prevent reconnection
- [Amazon Transcribe diarization output](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html) — confirmed: labels are `spk_0`/`spk_1`, no username mapping, overlap utterances are serialized by start time
- [Amazon Transcribe Settings API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_Settings.html) — confirmed: `MaxSpeakerLabels` range 2-30; accuracy degrades beyond 5 speakers
- [CloudWatch Logs PutLogEvents](https://docs.aws.amazon.com/AmazonCloudWatchLogs/latest/APIReference/API_PutLogEvents.html) — confirmed: log group must exist; `logs:CreateLogGroup` required for auto-creation
- [Lambda log group configuration](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html) — confirmed: auto-creation only for `/aws/lambda/FunctionName` default group

**MEDIUM confidence (HLS.js community):**
- [HLS.js GitHub: LL-HLS quality switching Safari issue #7165](https://github.com/video-dev/hls.js/issues/7165) — Safari quality switching stall documented
- [HLS.js GitHub: bufferStalledError iOS 18 #6890](https://github.com/video-dev/hls.js/issues/6890) — iOS 18 specific buffering bug
- [HLS.js stopLoad/startLoad causes regression to lowest level #5230](https://github.com/video-dev/hls.js/issues/5230) — `currentLevel` immediate switch is problematic

**MEDIUM confidence (AWS patterns):**
- [Lambda idempotency with DynamoDB conditional writes](https://aws.amazon.com/blogs/compute/handling-lambda-functions-idempotency-with-aws-lambda-powertools/) — at-least-once delivery; cron must be idempotent
- [Serverless scheduling with EventBridge + DynamoDB](https://aws.amazon.com/blogs/architecture/serverless-scheduling-with-amazon-eventbridge-aws-lambda-and-amazon-dynamodb/) — queue pattern for cron-driven recovery

---

*Pitfalls research for: v1.5 Pipeline Reliability, Moderation & Upload Experience*
*Researched: 2026-03-10*
*Supersedes: Previous PITFALLS.md (v1.4 Stream Quality & Creator Spotlight)*
