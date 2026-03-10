# Project Research Summary

**Project:** VideoNowAndLater — v1.5 Pipeline Reliability, Moderation & Upload Experience
**Domain:** AWS IVS live/recorded video streaming platform — operational hardening + viewer engagement
**Researched:** 2026-03-10
**Confidence:** HIGH

## Executive Summary

v1.5 is an additive milestone with five distinct feature areas that build on a working but fragile EventBridge pipeline. Research across all four areas converges on the same core insight: the existing pipeline has known failure modes (documented in MEMORY.md hotfixes) that must be surfaced before new viewer features are added on top of them. Structured logging is the prerequisite that makes everything else debuggable. The recommended approach is to harden the pipeline first (phases 25–26), then layer viewer-facing features (phases 27–29) that depend on the pipeline being reliable.

The technology choices for v1.5 are deliberately minimal. No new backend SDK packages are needed — `@aws-sdk/client-transcribe`, `@aws-sdk/client-ivschat`, and `@aws-lambda-powertools/logger` are already installed. The only new frontend dependency is `hls.js@^1.6.0` for the upload video player. Speaker diarization is a parameter addition to an existing Transcribe API call. Chat moderation uses the IVS Chat server-side API available in the installed SDK. This keeps the milestone scope tight and the technical risk low.

The most consequential risk across the milestone is the chat bounce feature: `IVS Chat DisconnectUser` alone does not prevent reconnection. A kicked user can reconnect immediately because the existing chat token remains valid. The token blocklist check in `create-chat-token.ts` is architecturally required before the bounce feature has any real effect. Similarly, speaker label-to-username mapping is technically impossible with the current IVS RealTime composite recording format — diarization can only produce generic "Speaker 1 / Speaker 2" labels, not participant names. Both constraints are well-understood and must be explicitly scoped in phase plans to avoid rework.

## Key Findings

### Recommended Stack

The existing stack (CDK, Lambda Node 20, DynamoDB single-table, EventBridge, IVS, IVS Chat, S3/CloudFront, Transcribe, MediaConvert, Bedrock) is unchanged for v1.5. All new capabilities are additive parameters or new API calls within already-installed SDKs. The one architectural choice is logging approach: ARCHITECTURE.md recommends inline `console.log(JSON.stringify(...))` over AWS Lambda Powertools middleware (`middy`), consistent with the existing `ivs-event-audit.ts` pattern. This avoids a 400KB cold-start penalty and requires no new wiring. Both STACK.md and ARCHITECTURE.md agree on structured JSON as the output format and `sessionId` as the pipeline correlation ID.

**Core technologies:**
- `@aws-sdk/client-transcribe` (^3.1003.0, already installed) — Add `Settings.ShowSpeakerLabels: true` to existing `StartTranscriptionJobCommand`; diarization is a parameter addition, not a new service
- `@aws-sdk/client-ivschat` (^3.1000.0, already installed) — `DisconnectUserCommand` + `DeleteMessageCommand` for server-side chat moderation; no active client WebSocket connection required from Lambda
- `hls.js@^1.6.0` (new, frontend only) — HLS adaptive playback for upload video player; chosen over `amazon-ivs-player` because IVS Player does not expose a quality level switching API and MediaConvert output is plain S3/CloudFront HLS without IVS channel extensions
- `events.Schedule.rate(Duration.minutes(30))` (existing CDK pattern) — Reuse the `ReplenishPoolSchedule` pattern for the stuck session recovery cron; no new CDK construct type required
- CloudWatch Logs Insights — Free-tier ad-hoc query tool for structured pipeline logs; `sessionId` is the correlation ID across all pipeline stages

### Expected Features

**Must have (table stakes — P1):**
- Structured JSON logs on all pipeline Lambdas with `sessionId`, `pipelineStage`, `status`, `durationMs`
- Stuck session recovery cron: 30-minute schedule, 45-minute staleness threshold, re-fires `Upload Recording Available` EventBridge event
- SQS DLQ on EventBridge pipeline rules + CloudWatch alarm on DLQ depth > 0
- `processingStartedAt` field on session record as cron staleness indicator
- Speaker-attributed transcript lines with generic `Speaker 1 / Speaker 2` labels and graceful fallback
- Broadcaster bounce: IVS Chat `DisconnectUser` + DynamoDB token blocklist + reconnect block in `create-chat-token.ts`
- Report action: inline flag on other-users' messages + DynamoDB MODLOG record + toast confirmation
- `/video/:sessionId` page with HLS.js player, ABR, manual quality selector (hidden on Safari), playback rate controls
- Transcript + AI summary collapsible side panel on video page
- Async comments: DynamoDB storage, video timestamp anchor, click-to-seek, two-level threading, dual sort modes
- Seek bar comment position markers

**Should have (P2):**
- Bounce notice IVS Chat event sent to bounced user before disconnect
- Color-coded speaker blocks (deterministic color per `spk_N` index)
- Broadcaster view showing report count on flagged messages
- Per-session stage timestamps in existing SessionAuditLog UI

**Defer to v2+:**
- AI auto-moderation / keyword filters
- Platform-wide bans + admin moderation dashboard
- Manual speaker re-labeling UI (username mapping requires per-participant audio tracks)
- Real-time comment WebSocket sync
- Video chapters from AI summary
- Download button (S3 pre-signed URL)
- Comment popularity sort as default

### Architecture Approach

The architecture is an extension of the existing single-table DynamoDB + EventBridge event-driven pattern. New Lambda handlers follow established conventions: `cognito:username` as userId, `pathParameters: { sessionId }`, `removeUndefinedValues: true` in marshall options, and auth-gated API Gateway routes under the `/sessions/{sessionId}` resource hierarchy. New DynamoDB entity types (`MODERATION_EVENT`, `VIDEO_COMMENT`) colocate with session data under session-scoped PKs. No new tables or GSIs are required for v1.5 scope. The stuck session cron avoids a full table scan by querying `GSI1 STATUS#ENDING`, which is a small, bounded partition in practice.

**Major components:**
1. **Pipeline audit layer** — Inline structured JSON logging added to `recording-ended.ts`, `transcode-completed.ts`, `transcribe-completed.ts`, `store-summary.ts`; explicit CDK `LogGroup` resources on each pipeline Lambda for 30-day retention; TTL on `ProcessingEvent` DynamoDB items (30 days)
2. **Stuck session cron** (`scan-stuck-sessions.ts`) — EventBridge Scheduler rate(30 min); queries `GSI1 STATUS#ENDING` partition; filters Lambda-side on `processingStartedAt` and `transcriptStatus`; emits `Upload Recording Available` or `Session Recording Recovery` custom events; guarded by `transcriptStatus` + `mediaconvertJobId` check to prevent double-submission
3. **Speaker diarization** — `start-transcribe.ts` adds `ShowSpeakerLabels: true`, `MaxSpeakerLabels: 10`; `transcribe-completed.ts` parses `speaker_labels.segments`, constructs compact `speakerSegments[]`, stores in DynamoDB with 50KB size guard (remainder in S3 only); generic `spk_N → "Speaker N"` labels only
4. **Chat moderation** (`bounce-user.ts`, `report-message.ts`) — broadcaster-only gating; `DisconnectUserCommand`; DynamoDB blocklist write in same transaction; `create-chat-token.ts` blocklist check; `MODLOG#{sessionId}` PK for all moderation events
5. **Upload video player** (`VideoPage.tsx` at `/video/:sessionId`) — HLS.js ABR + quality selector; extends `useReplayPlayer` hook non-breakingly (adds `player` + `qualities` to return value); `COMMENT#{sessionId}` DynamoDB PK; `useVideoComments` polls every 250ms, filters within ±1.5s of current position
6. **New API routes** — `POST /sessions/{id}/bounce`, `POST /sessions/{id}/chat/{msgId}/report`, `GET /sessions/{id}/comments`, `POST /sessions/{id}/comments`; all Cognito-gated

### Critical Pitfalls

1. **IVS Chat bounce without token blocklist is cosmetic** — `DisconnectUser` severs the WebSocket but the existing chat token remains valid; the frontend reconnects within seconds unless `create-chat-token.ts` blocks token issuance for bounced `sessionId+userId` pairs. The blocklist write must be atomic with the disconnect call. Prevention: implement the DynamoDB token check before wiring the disconnect API; integration test must verify the reconnect path returns 403.

2. **Cron re-fires already-processing sessions causing double MediaConvert submission** — A session with `transcriptStatus: 'processing'` and a slow MediaConvert job (20–30 min for a long recording) looks "stuck" if the threshold is too tight. Cron must exclude sessions where `mediaconvertJobId` is set AND `transcriptStatus = 'processing'`. Use a 45-minute threshold. Add a `cronRecoveryAt` conditional write to prevent the same session from being recovered twice within a cooldown window.

3. **Speaker label-to-username mapping is architecturally impossible with composite IVS RealTime recordings** — IVS RealTime produces a single composite audio track; Transcribe assigns `spk_N` labels based on voice acoustics alone with no participant metadata. For broadcast (single speaker), `spk_0 = session.userId` is a safe shortcut. For hangout sessions, the only correct approach is generic "Speaker 1 / Speaker 2" labels. Any phase plan that says "map spk_0 to first participant in the roster" is incorrect.

4. **DynamoDB scan in the stuck session cron is a cost trap** — `FilterExpression` does not reduce RCU consumption; every item is read regardless. The cron must query `GSI1` with `KeyConditionExpression: 'GSI1PK = :status'` using `STATUS#ENDING`, then filter by timestamp in Lambda. The `STATUS#ENDING` partition stays small because sessions cycle through ENDING quickly when the pipeline is healthy. A scan-based approach would become a cost driver as chat messages and reactions accumulate.

5. **Storing full diarized transcript JSON in DynamoDB hits the 400KB item limit** — A 60-minute multi-speaker session produces speaker segment arrays of 96KB+ which, combined with other session fields (aiSummary, transcript, streamMetrics), can exceed the DynamoDB item limit. The `speakerSegments` array must be stored in S3 only; the session item stores only a pointer (`diarizedTranscriptS3Path`) and a compact summary (`speakerCount`). Never inline segment arrays in DynamoDB.

6. **HLS.js quality switching stalls on Safari / iOS** — `hls.currentLevel` (immediate switch with buffer flush) triggers `bufferStalledError` on Safari. Use `hls.nextLevel` (switches at next segment boundary) for the quality selector. Detect Safari via `navigator.vendor.includes('Apple')` and hide the manual quality picker entirely on Apple browsers. Test on a real iOS device — simulators do not reproduce this bug class.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 25: Structured Pipeline Logging + DLQ Setup
**Rationale:** All subsequent debugging depends on being able to trace pipeline failures by `sessionId` in CloudWatch. This is the lowest-risk change (log statements + CDK resource additions) and the highest operational leverage. DLQs on EventBridge rules belong here because they are infrastructure additions with no code dependencies. Setting TTL on `ProcessingEvent` items here prevents unbounded table growth before new pipeline stages add more items.
**Delivers:** Observable pipeline; CloudWatch Logs Insights queryable by `sessionId`; DLQ alarm for silent delivery failures; explicit log group retention on all pipeline Lambdas; TTL policy on `ProcessingEvent` items
**Addresses:** Structured JSON pipeline logs (P1); EventBridge DLQ + CloudWatch alarm (P1)
**Avoids:** Pitfall 1 (log group auto-creation race — pre-create all log groups in CDK); Pitfall 10 (ProcessingEvent items without TTL inflating the table)
**Research flag:** No additional research needed — inline JSON logging follows the existing `ivs-event-audit.ts` pattern exactly

### Phase 26: Stuck Session Recovery Cron
**Rationale:** With Phase 25 logging in place, the cron's recovery actions are immediately verifiable in CloudWatch. Implementing before speaker diarization ensures there is a recovery path for the new, more complex Transcribe diarization jobs this milestone introduces. The `processingStartedAt` field added here is a prerequisite for the cron's staleness filter.
**Delivers:** Automated recovery for sessions stuck in `STATUS#ENDING` for >45 minutes; `processingStartedAt` field on session record; both recovery branches (with and without `recordingHlsUrl`)
**Addresses:** Stuck session recovery cron (P1); `processingStartedAt` prerequisite
**Avoids:** Pitfall 2 (double MediaConvert — precise status filter excludes `transcriptStatus = 'processing'` with `mediaconvertJobId` set); Pitfall 3 (full table scan — query GSI1 `STATUS#ENDING` partition, never scan)
**Research flag:** No additional research needed — EventBridge Scheduler rate pattern directly reuses `ReplenishPoolSchedule` CDK construct

### Phase 27: Speaker-Attributed Transcripts
**Rationale:** Independent of Phase 26 (can be developed in parallel). The pipeline change (`ShowSpeakerLabels: true`) is additive; existing sessions are unaffected. Must establish the S3 storage contract for diarized segments as the first task — code must not be written until the storage boundary is defined. Broadcast sessions (single speaker) are handled as a shortcut, skipping diarization overhead entirely.
**Delivers:** Turn-by-turn `Speaker 1 / Speaker 2` transcript display; color-coded speaker blocks; click-to-seek from transcript line on the video page; diarized segments stored in S3 with pointer on session item; graceful fallback to plain transcript when diarization data is absent
**Addresses:** Speaker-attributed transcripts (P1); graceful fallback (P1); color-coded blocks (P2)
**Avoids:** Pitfall 5 (DynamoDB 400KB limit — segments in S3 only, never inlined); Pitfall 6 (username mapping impossibility — explicitly scoped to generic labels; broadcast shortcut is the only safe attribution)
**Research flag:** No additional research needed — diarization API parameters and JSON output schema verified against official AWS Transcribe docs (HIGH confidence)

### Phase 28: Chat Moderation (Bounce + Report)
**Rationale:** Independent of Phase 27 (can be developed in parallel). The bounce feature requires the DynamoDB token blocklist to be implemented atomically with the `DisconnectUser` call — they are one feature unit, not two. Report is simpler (DynamoDB write only) and can follow in the same phase. Frontend changes are scoped to `MessageRow.tsx` with two new components in `web/src/features/moderation/`.
**Delivers:** Broadcaster bounce (disconnect + token blocklist + `BOUNCE_NOTICE` event); user report (inline flag + MODLOG record + toast); moderation event DynamoDB schema with `MODLOG#{sessionId}` PK
**Addresses:** Broadcaster bounce (P1); report message (P1); bounce notice to kicked user (P2)
**Avoids:** Pitfall 4 (bounce without token blocklist — the `create-chat-token.ts` guard is non-optional; `DisconnectUser` alone is a display action); security mistake (validate `targetUserId` is an actual session participant before writing moderation record)
**Research flag:** No additional research needed — `DisconnectUserCommand` IAM action and parameters verified against AWS IVS Chat API reference (HIGH confidence)

### Phase 29: Upload Video Player Page + Async Comments
**Rationale:** Depends on Phase 27 for the diarized transcript side panel in `VideoPage`. The player page shell, quality selector, and async comments backend can begin before Phase 27 completes — the speaker segments display component is the only Phase 27 dependency. Add `/video/:sessionId` as a new route; redirect existing `/upload/:sessionId` to it. Extend `useReplayPlayer` non-breakingly to expose `player` and `qualities`.
**Delivers:** `/video/:sessionId` with HLS.js player (ABR + quality selector + rate controls); transcript + AI summary side panel; async timestamped comments with click-to-seek; two-level threading; seek bar comment position markers
**Addresses:** Upload video player + quality selector (P1); async comments (P1); transcript + AI panel (P1); seek bar markers (P2)
**Avoids:** Pitfall 7 (Safari quality switch stall — use `hls.nextLevel`; detect Safari; hide picker on Apple browsers); Pitfall 8 (CORS on HLS sub-manifests — verify CloudFront CORS on all `.m3u8` and `.ts` paths before writing player code); Pitfall 9 (comment timestamp drift — use ±1.5s display window, poll every 250ms, debounce 500ms after seek)
**Research flag:** Moderate — verify CloudFront CORS configuration covers all MediaConvert output paths before implementing the quality selector. This is a CDK configuration audit step that cannot be tested locally. Plan it as the first task in the phase.

### Phase Ordering Rationale

- Phases 25 → 26 are sequential: logging must be in place before the cron's recovery actions can be observed and verified in CloudWatch.
- Phases 27 and 28 are independent of each other and of Phase 26 and can be developed in parallel.
- Phase 29 has a soft dependency on Phase 27 for the diarized transcript panel. The player shell, quality selector, and async comments can begin before Phase 27 completes.
- This ordering ensures every new viewer-facing feature (diarization, upload player) lands on a foundation where pipeline failures are observable and recoverable.

### Research Flags

Phases needing careful execution (not additional research — the constraints are known, but the phase plans must be precise):
- **Phase 26:** The cron filter expression for "stuck" must be defined explicitly in the phase plan before implementation begins. Acceptable definition: `transcriptStatus` is null, `'pending'`, or `'failed'`, AND `processingStartedAt` is older than 45 minutes, AND `mediaconvertJobId` is NOT set. Both recovery branches (with and without `recordingHlsUrl`) must be specified before code is written.
- **Phase 29:** CloudFront CORS configuration for all MediaConvert output paths must be verified as a CDK pre-step. The quality selector cannot be tested until CORS is confirmed on sub-manifests and `.ts` segments. Plan this as the first task in the phase, not an afterthought.

Phases with standard patterns (no research-phase needed):
- **Phase 25:** Inline structured JSON logging follows the existing `ivs-event-audit.ts` pattern exactly; CDK log group construct follows existing `IvsEventAuditLogGroup` pattern.
- **Phase 27:** Diarization is a parameter addition to an existing Transcribe call; JSON output schema verified against AWS docs.
- **Phase 28:** `DisconnectUserCommand` and `DeleteMessageCommand` use the already-installed `@aws-sdk/client-ivschat`; IAM actions verified.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All backend packages confirmed against local `package.json`; `hls.js` API verified against official docs; CDK patterns reuse existing `session-stack.ts` constructs directly |
| Features | MEDIUM-HIGH | Moderation and player UX are HIGH (IVS Chat API and HLS.js verified); speaker diarization username mapping scoped down to generic labels after confirming technical impossibility — this was a research-corrected scope reduction, not an assumption |
| Architecture | HIGH | Based on direct codebase analysis of all relevant handlers, repositories, and CDK stacks; all new patterns are extensions of established ones; no speculative integrations |
| Pitfalls | HIGH | Top pitfalls are grounded in prior production hotfixes from MEMORY.md and verified AWS service constraints (IVS Chat token behavior, DynamoDB item limits, Transcribe composite audio limitation, HLS.js Safari issues documented in official GitHub tracker) |

**Overall confidence:** HIGH

### Gaps to Address

- **CloudFront CORS coverage for MediaConvert output paths:** The exact state of the current CloudFront distribution CORS configuration for `recordings/*` sub-paths is not confirmed by research. The Phase 29 plan must include a CDK audit step before any player code is written. This is the only externally-verified-but-not-locally-confirmed dependency.

- **Recovery for sessions stuck before MediaConvert (no `recordingHlsUrl`):** ARCHITECTURE.md identifies a second recovery branch for sessions that never reached MediaConvert (no `recordingHlsUrl` set). The event source (`Session Recording Recovery`) and handler wiring for this branch are not fully specified. Phase 26 plan must address both recovery branches before implementation begins.

- **Username mapping for speaker diarization is intentionally deferred:** Research confirmed this is architecturally impossible with current IVS RealTime composite recordings. The gap is not resolvable in v1.5 without switching to per-participant recording (a significant architecture change). Phase 27 plan must explicitly state "Speaker 1 / Speaker 2 only; username mapping deferred to a future milestone requiring per-participant audio tracks."

## Sources

### Primary (HIGH confidence)
- `backend/src/handlers/recording-ended.ts`, `start-transcribe.ts`, `transcribe-completed.ts`, `store-summary.ts` — direct codebase analysis; pipeline handler structure and existing patterns
- `infra/lib/stacks/session-stack.ts` — confirmed `events.Schedule.rate()` pattern, `events:PutEvents` grant, `IvsEventAuditLogGroup` LogGroup pattern
- `backend/package.json` — confirmed `@aws-lambda-powertools/logger@^2.31.0`, `@aws-sdk/client-ivschat@^3.1000.0`, `@aws-sdk/client-transcribe@^3.1003.0` all installed
- `web/src/features/chat/useChatRoom.ts` — disconnect listener does not branch on reason; no bounce detection currently present
- MEMORY.md hotfix history — production root causes confirming pipeline fragility patterns (phase mismatch, stale condition check, missing PassRole, EventBridge matching bug)
- [Amazon Transcribe diarization docs](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html) — `ShowSpeakerLabels`/`MaxSpeakerLabels` parameters; composite audio limitation confirmed
- [Amazon Transcribe batch output example](https://docs.aws.amazon.com/transcribe/latest/dg/diarization-output-batch.html) — `results.items[N].speaker_label` per-word attribution; `speaker_labels.segments` structure
- [Amazon Transcribe Settings API reference](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_Settings.html) — field names, valid range 2–30, accuracy degrades beyond 5 speakers
- [AWS IVS Chat DisconnectUser API reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_DisconnectUser.html) — parameters; token-not-invalidated behavior confirmed
- [HLS.js API.md](https://github.com/video-dev/hls.js/blob/master/docs/API.md) — `levels[]` shape; `currentLevel`/`nextLevel` setter semantics; `MANIFEST_PARSED`/`LEVEL_SWITCHED` events
- [Powertools for AWS Lambda TypeScript Logger docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/) — `appendPersistentKeys`; module-scope initialization pattern
- [CloudWatch Logs Lambda log group configuration](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-loggroups.html) — auto-creation only for default `/aws/lambda/FunctionName` group; explicit group required for others

### Secondary (MEDIUM confidence)
- [EventBridge DLQ documentation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html) — DLQ configuration on rules vs Lambda functions
- [AWS Serverless Observability best practices](https://aws-observability.github.io/observability-best-practices/guides/serverless/aws-native/lambda-based-observability/) — structured logging patterns for Lambda
- [GetStream: Live Stream Chat Moderation](https://getstream.io/blog/live-stream-chat-moderation/) — moderation UX expectations for live streaming platforms
- [Mux: Best Practices for Video Playback 2025](https://www.mux.com/articles/best-practices-for-video-playback-a-complete-guide-2025) — ABR and quality selector UX patterns
- [Lambda idempotency with DynamoDB conditional writes](https://aws.amazon.com/blogs/compute/handling-lambda-functions-idempotency-with-aws-lambda-powertools/) — cron idempotency pattern

### Tertiary (MEDIUM confidence — community-verified GitHub issues)
- [HLS.js GitHub #7165](https://github.com/video-dev/hls.js/issues/7165) — Safari quality switching stall documented
- [HLS.js GitHub #6890](https://github.com/video-dev/hls.js/issues/6890) — iOS 18 `bufferStalledError` bug

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
