# VideoNowAndLater

## What This Is

A live video platform powered by AWS IVS with one-to-many broadcasting, small-group hangouts, and real-time chat. Users can create sessions instantly (backed by pre-warmed IVS resource pools), go live with their camera, and interact through chat and reactions. All sessions are automatically recorded and preserved for replay with synchronized chat and reactions. Built with CDK-managed infrastructure (Cognito auth, API Gateway, DynamoDB, IVS + IVS RealTime + IVS Chat), React frontend, and developer CLI tools for local testing.

## Core Value

Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

## Latest Milestone: v1.6 Pipeline Durability, Cost & Debug (SHIPPED 2026-03-11)

**Accomplished:** Replaced brittle fire-and-forget EventBridge→Lambda with SQS-backed durable queues for all 5 critical pipeline handlers, hardened handlers to throw on failure (enabling real SQS retries), cut AI summary costs by switching to Nova Lite, and shipped CLI debug tools for pipeline introspection.

**Delivered:**
- ✅ SQS queue pairs + DLQs for all 5 pipeline handlers — at-least-once delivery with 3-retry DLQ capture (Phase 31)
- ✅ All 5 handlers refactored to SQSEvent signature with `batchItemFailures` partial-failure reporting (Phase 31)
- ✅ Handler hardening: `recording-ended`, `transcode-completed`, `on-mediaconvert-complete` throw on failure; idempotency key prevents duplicate Transcribe jobs (Phase 32)
- ✅ `scan-stuck-sessions` recovers stale `transcriptStatus='processing'` sessions with 2h staleness threshold (Phase 32)
- ✅ 10 CloudWatch alarms (5 DLQ depth + 5 Lambda error) + VNL-Pipeline dashboard (Phase 33)
- ✅ Nova Lite default Bedrock model + `BEDROCK_MODEL_ID` env override + per-invocation token logging (Phase 34)
- ✅ `debug-pipeline.js` + `replay-pipeline.js` CLI tools for pipeline state inspection and stage replay (Phase 35)

## Requirements

### Validated

- ✓ Pre-warmed pool of provisioned IVS resources — Phase 2
- ✓ CDK-defined backend infrastructure, cleanly destroyable — Phase 1-2
- ✓ Lambda + API Gateway APIs for sessions (creation/retrieval) — Phase 2
- ✓ DynamoDB models for sessions (lifecycle, resource pool) — Phase 2
- ✓ Cognito username/password auth (no email confirmation) — Phase 1
- ✓ Frontend "stack not deployed" detection with developer guidance — Phase 1
- ✓ Deployment outputs wired into web app via generated config files — Phase 1
- ✓ Logout functionality accessible from any protected route — Phase 1
- ✓ Developer CLI tools for user/token management — Phase 1
- ✓ Near real-time broadcasting (one-to-many via IVS Channel) — Phase 3
- ✓ Long-running chat attached to live sessions, persisting for replay — Phase 4
- ✓ Frontend routing for broadcast and viewer pages — Phase 4.2
- ✓ Session creation UI with loading/error states — Phase 4.2
- ✓ Centralized API configuration across frontend — Phase 4.2
- ✓ Auto-record all sessions (broadcasts + hangouts) to S3 — Phase 5
- ✓ Home feed showing recently streamed videos (Instagram-style grid) — Phase 6
- ✓ Replay viewer with video playback + synchronized chat — Phase 6
- ✓ Reaction system (live + replay, synchronized to video timeline) — Phase 7
- ✓ IVS RealTime hangouts (multi-participant video, up to 5 participants) — Phase 8
- ✓ Developer CLI: stream test media, seed data, simulate presence — Phase 9

### Active

*No active requirements — planning next milestone.*

### Just Validated (v1.6)

- ✓ SQS queue pairs + DLQs for all 5 pipeline handlers; EventBridge→SQS→Lambda with at-least-once delivery — v1.6 Phase 31
- ✓ All 5 handlers use SQSEvent signature with `batchItemFailures` for partial-failure reporting — v1.6 Phase 31
- ✓ `recording-ended` throws on MediaConvert failure; `transcode-completed` throws with idempotency key — v1.6 Phase 32
- ✓ `on-mediaconvert-complete` throws on PutEvents failure; `scan-stuck-sessions` recovers 2h-stale processing sessions — v1.6 Phase 32
- ✓ 10 CloudWatch alarms (DLQ depth + Lambda error per handler) + SNS topic + VNL-Pipeline dashboard — v1.6 Phase 33
- ✓ Nova Lite default Bedrock model with `BEDROCK_MODEL_ID` env override and token logging — v1.6 Phase 34
- ✓ `debug-pipeline.js` + `replay-pipeline.js` CLI tools for pipeline introspection and stage replay — v1.6 Phase 35

### Previously Validated (v1.5)

- ✓ EventBridge pipeline emits structured debug logs at every stage (recording → MediaConvert → Transcribe → AI summary) — Phase 25
- ✓ Cron job identifies sessions stuck in pipeline for >45 min and re-fires appropriate recovery event — Phase 26
- ✓ Transcripts include speaker diarization with labels mapped to session usernames — Phase 27
- ✓ Broadcaster can bounce (kick) a user from their active stream — Phase 28
- ✓ Any user can report a chat message via inline quick action (shown only on other users' messages) — Phase 28
- ✓ Reports and bounces are recorded in a moderation log (DynamoDB) — Phase 28
- ✓ Dedicated /video/:sessionId page for uploaded video playback with HLS adaptive bitrate — Phase 29
- ✓ Video player supports manual resolution selection (quality levels from HLS manifest) — Phase 29
- ✓ Upload video page supports async comments (timestamped, persistent, not live chat) — Phase 30
- ✓ Upload video page shows reactions, transcript, and AI summary — Phase 30

### Out of Scope

- Admin/dashboard view — deferred to future milestone
- Profile-based recording discovery — v1.1 uses home feed only, profiles later
- User choice for recording — all sessions record automatically, opt-out later
- Mobile app — deferred to future subrepo, web-first
- Email confirmation on signup — explicitly excluded for speed
- OAuth/social login — username/password only for v1
- Paid subscriptions/monetization — not in scope
- AI content moderation/filtering — defer to v2 (v1.5 adds human-driven moderation only)
- Multi-region deployment — single region for v1

## Context

- AWS IVS provides two distinct products: IVS (low-latency streaming, one-to-many) and IVS RealTime (WebRTC-based, multi-participant). Both are needed.
- IVS Chat is a separate service that integrates with both streaming modes.
- Pre-warming IVS resources (channels, stages) is important to avoid cold-start latency when users go live.
- Recording uses IVS's built-in recording configuration to route to S3.
- The developer tool suite is critical for local development since IVS requires actual AWS resources — can't mock it.
- Frontend must work gracefully when CDK stack isn't deployed (first-time developer experience).

## Constraints

- **Tech stack**: AWS IVS + IVS RealTime + IVS Chat, CDK for infrastructure, React for frontend, Lambda + API Gateway + DynamoDB for backend
- **Auth**: Cognito with username/password only, no email verification
- **UX**: No AWS concepts exposed to end users — abstract away channels, stages, rooms
- **Infrastructure**: Must be cleanly destroyable via `cdk destroy`
- **Resource management**: Pre-warmed pool of IVS resources to avoid cold starts
- **Testing**: Developer CLI must support streaming real video files (MP4/MOV) into sessions for testing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| IVS for broadcast + IVS RealTime for hangouts | Two distinct use cases require both IVS products | ✓ Broadcast shipped v1.0, hangouts pending |
| Cognito username/password only | Simplicity for v1, no email infrastructure needed | ✓ Phase 1 |
| Pre-warmed resource pool | Instant "go live" UX requires resources ready ahead of time | ✓ Phase 2 |
| CDK for infrastructure | Infrastructure as code, cleanly destroyable | ✓ Phase 1-2 |
| DynamoDB for data | Serverless, scales with usage, fits session/event data model | ✓ Phase 2 |
| REST APIs (not GraphQL) | Simpler for token exchange and session management | ✓ Phase 1-2 |
| Web-first, mobile later | Faster to ship, mobile as future subrepo | ✓ Phase 1 |
| Single-table DynamoDB design with GSI | Efficient querying, cost-effective, enables atomic pool claims | ✓ Phase 2 |
| Conditional writes for atomic operations | Prevents race conditions in concurrent resource claims | ✓ Phase 2 |
| EventBridge Scheduler for pool replenishment | Serverless, reliable, 5-minute intervals maintain pool readiness | ✓ Phase 2 |
| Retroactive Phase 01 verification | 9 requirements verified automated, 3 auth flows require manual testing | ✓ Phase 4.1 |
| Powertools Logger at module scope with appendPersistentKeys | Module-scope init pays cold-start cost once; appendPersistentKeys binds sessionId to all invocation logs | ✓ Phase 25 |
| CDK logGroup with ONE_MONTH retention on pipeline Lambdas | 30-day window balances cost vs debuggability; DESTROY removal policy keeps cdk destroy clean | ✓ Phase 25 |
| Dual GSI1 partition query (STATUS#ENDING + STATUS#ENDED) | Stuck sessions are in ENDED (not ENDING) after MediaConvert submission — must query both to catch all cases | ✓ Phase 26 |
| ConditionalCheckFailedException caught per-session in cron | Concurrent cron runs race on same session; per-session catch lets remaining sessions proceed | ✓ Phase 26 |
| EventBridge PutEvents for recovery (not Lambda.invoke) | Preserves DLQ and retry semantics; recovery events route through existing EventBridge rules | ✓ Phase 26 |
| Speaker labels as "Speaker 1"/"Speaker 2" (no username mapping) | Composite audio prevents username attribution; Transcribe diarization works on mixed audio only | ✓ Phase 27 |
| Diarized segments stored in S3 only (not DynamoDB inline) | 400KB DynamoDB item limit risk on long recordings; S3 pointer pattern avoids size constraint | ✓ Phase 27 |
| Speaker bubble mode in TranscriptDisplay | Side-by-side bubble layout distinguishes speakers visually; plain mode preserved as fallback | ✓ Phase 27 |
| DisconnectUser + token blocklist for bounce | DisconnectUser API alone is insufficient — bounced users reconnect immediately; token blocklist in create-chat-token.ts makes the ban durable | ✓ Phase 28 |
| Moderation log PK:SESSION# SK:MOD#{ts}#{uuid} | Single-table pattern; DynamoDB query by session for full audit log per session | ✓ Phase 28 |
| hls.js over IVS Player for quality switching | IVS Player SDK exposes no quality level API; hls.js 1.6 provides `nextLevel` setter and `hls.levels` array | ✓ Phase 29 |
| hls.nextLevel (not currentLevel) for quality switch | currentLevel flushes buffer causing visible stall; nextLevel transitions at next fragment boundary | ✓ Phase 29 |
| Comment SK COMMENT#{15-digit-padded-ms}#{uuid} | Zero-padded ms provides natural ascending sort via DynamoDB lexicographic ordering; uuid prevents collisions | ✓ Phase 30 |
| syncTime === 0 disables comment composer | Prevents comments anchored at position 0 before playback starts; returned from useHlsPlayer for Phase 30 use | ✓ Phase 30 |
| startedAt: now added to createUploadSession | create-reaction.ts requires startedAt for sessionRelativeTime computation — was missing on UPLOAD sessions causing 400 errors | ✓ Phase 30 |
| batchSize: 1 + reportBatchItemFailures (not bisectBatchOnFunctionError) | bisectBatchOnFunctionError doesn't exist in CDK v2.170 SqsEventSourceProps — batch size 1 + partial failure reporting is the correct pattern | ✓ Phase 31 |
| SQS queue declarations before first rule target usage | TypeScript declaration order requirement — queue pairs must precede targets.SqsQueue usage in session-stack.ts | ✓ Phase 31 |
| recordingEndedQueue serves 3 EventBridge rules | targets.SqsQueue auto-adds per-rule resource policy — no manual addToResourcePolicy needed for multi-rule shared queues | ✓ Phase 31 |
| Idempotency key = sessionId + MediaConvert jobId | Stable key prevents duplicate Transcribe submissions on SQS retry; ConflictException from Transcribe is caught and treated as success | ✓ Phase 32 |
| transcriptStatusUpdatedAt written on every updateTranscriptStatus call | Enables scan-stuck-sessions to detect truly stale processing state vs. active jobs; 2h threshold prevents false recovery | ✓ Phase 32 |
| Nova Lite over Nova Pro as default Bedrock model | Significant cost reduction for AI summaries; BEDROCK_MODEL_ID env var allows rollback or model upgrade without code deploy | ✓ Phase 34 |

## Current State

**Shipped milestones:**
- v1.0 Gap Closure (4 phases, 11 plans) — shipped 2026-03-02
- v1.1 Replay, Reactions & Hangouts (15 phases, 27 plans) — shipped 2026-03-05
- v1.2 Activity Feed & Intelligence (7 phases, 19 plans) — shipped 2026-03-06
- v1.3 Secure Sharing — shipped 2026-03-06 (as part of v1.2)
- v1.4 Creator Studio & Stream Quality (3 phases, 9 plans) — shipped 2026-03-10
- v1.5 Pipeline Reliability, Moderation & Upload Experience (9 phases, 26 plans) — shipped 2026-03-11
- v1.6 Pipeline Durability, Cost & Debug (5 phases, 9 plans) — shipped 2026-03-11

**Codebase:** ~32,100 LOC TypeScript (frontend + backend + CDK), 462/462 backend tests passing
**Next:** Planning v1.7 milestone

---
*Last updated: 2026-03-11 after v1.6 — pipeline made durable with SQS buffers + DLQs, handlers hardened to throw, CloudWatch alarms + dashboard, Nova Lite for cost, debug CLI tools*
