# Roadmap: VideoNowAndLater

## Milestones

- ✅ **v1.0 Gap Closure** - Phases 1-4.2 (shipped 2026-03-02)
- ✅ **v1.1 Replay, Reactions & Hangouts** - Phases 5-15 (shipped 2026-03-05)
- ✅ **v1.2 Activity Feed & Intelligence** - Phases 16-22 (shipped 2026-03-06)
- ✅ **v1.3 Secure Sharing** - Phases 21-22 (shipped 2026-03-06 as part of v1.2)
- ✅ **v1.4 Creator Studio & Stream Quality** - Phases 22.1, 23-24 (shipped 2026-03-10)
- ✅ **v1.5 Pipeline Reliability, Moderation & Upload Experience** - Phases 22.1, 23-30 (shipped 2026-03-11)

## Phases

<details>
<summary>✅ v1.0 Gap Closure (Phases 1-4.2) - SHIPPED 2026-03-02</summary>

Milestone completed. See milestones/v1.0-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.1 Replay, Reactions & Hangouts (Phases 5-15) - SHIPPED 2026-03-05</summary>

Milestone completed. See milestones/v1.1-ROADMAP.md for details.

</details>

<details>
<summary>✅ v1.2 Activity Feed & Intelligence (Phases 16-22) - SHIPPED 2026-03-06</summary>

**Milestone Goal:** Surface richer session context on the homepage — hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed — and add an automated transcription and AI summary pipeline to every recording.

**What Was Built:**
- Phase 16: Hangout Participant Tracking — Durably record participant joins in DynamoDB with participantCount field on session
- Phase 17: Reaction Summary at Session End — Pre-compute per-emoji reaction counts when sessions end
- Phase 18: Homepage Redesign & Activity Feed — Two-zone layout with recording slider and activity feed below
- Phase 19: Transcription Pipeline — Automated S3-to-Transcribe pipeline triggered by recording completion
- Phase 20: AI Summary Pipeline — Inline Bedrock call generates one-paragraph summaries for every recording
- Phase 21: Video Uploads — Users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding
- Phase 22: Live Broadcast with Secure Viewer Links — Private broadcasts with ES384 JWT tokens for access control

See milestones/v1.2-ROADMAP.md for full details.

</details>

<details>
<summary>✅ v1.4 Creator Studio & Stream Quality (Phases 22.1, 23-24) - SHIPPED 2026-03-10</summary>

**Milestone Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**What Was Built:**
- Phase 22.1: Pipeline Fixes & UI Enhancements — Urgent fixes and enhancements from v1.2 completion
- Phase 23: Stream Quality Monitoring Dashboard — Real-time metrics display (bitrate, FPS, resolution, network status, health score) for broadcasters
- Phase 24: Creator Spotlight Selection & Display — Feature another live creator during broadcast with elegant overlay UI

</details>

<details>
<summary>✅ v1.5 Pipeline Reliability, Moderation & Upload Experience (Phases 22.1, 23-30) — SHIPPED 2026-03-11</summary>

**Milestone Goal:** Harden the recording/transcription/AI pipeline with structured observability and automatic recovery, give broadcasters and users moderation tools, and build a rich dedicated player page for uploaded videos.

- [x] Phase 22.1: Pipeline Fixes & UI Enhancements (3/3 plans) — completed 2026-03-06
- [x] Phase 23: Stream Quality Monitoring Dashboard (6/6 plans) — completed 2026-03-06
- [x] Phase 24: Creator Spotlight Selection & Display (3/3 plans) — completed 2026-03-10
- [x] Phase 25: Pipeline Observability (2/2 plans) — completed 2026-03-10
- [x] Phase 26: Stuck Session Recovery Cron (2/2 plans) — completed 2026-03-10
- [x] Phase 27: Speaker-Attributed Transcripts (2/2 plans) — completed 2026-03-10
- [x] Phase 28: Chat Moderation (3/3 plans) — completed 2026-03-10
- [x] Phase 29: Upload Video Player Core (2/2 plans) — completed 2026-03-11
- [x] Phase 30: Upload Video Player Social (3/3 plans) — completed 2026-03-11

See milestones/v1.5-ROADMAP.md for full details.

</details>

## v1.6 — Pipeline Durability, Cost & Debug

**Milestone Goal:** Replace brittle fire-and-forget EventBridge→Lambda with SQS-backed durable queues for all critical pipeline steps, harden handlers to throw on failure (enabling real retries), cut AI summary costs by switching to Nova Lite, and ship a CLI debug tool for pipeline introspection.

**Phases:**

| Phase | Name | Goal |
|-------|------|------|
| 31 | 1/2 | In Progress|  | 32 | Handler Hardening & Idempotency | Remove broad error suppression in pipeline handlers, add idempotency keys for job submission, fix PIPE-06 processing trap for stuck sessions |
| 33 | Pipeline Alarms & Dashboard | CloudWatch alarms on DLQ depth and Lambda error rate, SNS email alerts, and a CloudWatch dashboard for pipeline health at a glance |
| 34 | Nova Lite for AI Summaries | Switch store-summary.ts from Nova Pro/Claude to amazon.nova-lite-v1:0, make model configurable via env var, add token cost logging |
| 35 | Pipeline Debug CLI | Developer tools: debug-pipeline.js (show full session pipeline state) and replay-pipeline.js (re-trigger pipeline from any stage) |

- [ ] Phase 31: SQS Pipeline Buffers (2/2 plans)
  - [ ] 31-01-PLAN.md — CDK infrastructure: 5 SQS queue pairs, event source mappings, rule target changes
  - [ ] 31-02-PLAN.md — Handler refactor: SQSEvent wrapper for all 5 handlers, update unit tests
- [ ] Phase 32: Handler Hardening & Idempotency (0/? plans)
- [ ] Phase 33: Pipeline Alarms & Dashboard (0/? plans)
- [ ] Phase 34: Nova Lite for AI Summaries (0/? plans)
- [ ] Phase 35: Pipeline Debug CLI (0/? plans)

### Phase 31: SQS Pipeline Buffers

**Goal:** Replace the brittle EventBridge→Lambda direct invocation pattern with EventBridge→SQS→Lambda for all 5 critical pipeline handlers (recording-ended, transcode-completed, transcribe-completed, store-summary, start-transcribe), achieving at-least-once delivery with automatic SQS-driven retries and per-queue DLQs.

**Requirements:** DUR-01, DUR-02, DUR-03, DUR-04, DUR-05

**Plans:** 1/2 plans executed

**Success Criteria:**
1. All 5 pipeline Lambdas are triggered via SQS event source mappings (not direct EventBridge invocation)
2. Each pipeline SQS queue has a DLQ configured with 14-day retention and maxReceiveCount=3
3. SQS visibility timeout on each queue is set to 6× the Lambda timeout
4. EventBridge rules target SQS queues (not Lambdas) with sqs:SendMessage grants
5. Existing Lambda direct invocation permissions removed for replaced handlers
6. All existing backend tests pass

### Phase 32: Handler Hardening & Idempotency

**Goal:** Remove broad error suppression in the 5 pipeline Lambda handlers so they throw on critical failures (enabling SQS retry semantics), add idempotency guards to prevent duplicate job submissions on retry, and fix the PIPE-06 trap where sessions stuck with transcriptStatus='processing' for >2h are permanently excluded from recovery.

**Requirements:** HARD-01, HARD-02, HARD-03, HARD-04, HARD-05

**Success Criteria:**
1. recording-ended.ts throws on MediaConvert submission failure
2. transcode-completed.ts throws on Transcribe submission failure; idempotency key prevents duplicate Transcribe jobs
3. on-mediaconvert-complete.ts throws on EventBridge PutEvents failure
4. scan-stuck-sessions.ts recovers sessions where transcriptStatus='processing' and updatedAt >2h ago
5. transcribe-completed.ts logs structured error with raw job name when parsing fails (no silent return)
6. All backend tests pass (updated to cover new throw behavior)

### Phase 33: Pipeline Alarms & Dashboard

**Goal:** Add CloudWatch alarms for pipeline DLQ depth and Lambda error rates, wire them to an SNS topic for email notification, and create a CloudWatch dashboard that shows the health of all 5 pipeline handlers in a single view.

**Requirements:** OBS-01, OBS-02, OBS-03, OBS-04

**Success Criteria:**
1. CloudWatch alarm fires when any pipeline SQS DLQ has ApproximateNumberOfMessagesVisible > 0
2. CloudWatch alarm fires when any pipeline Lambda has Errors > 0 in a 5-minute window
3. SNS topic receives all alarm notifications; alertEmail CDK context variable subscribes email endpoint
4. CloudWatch dashboard VNL-Pipeline shows invocation count, error count, DLQ depth per handler

### Phase 34: Nova Lite for AI Summaries

**Goal:** Switch store-summary.ts from amazon.nova-pro-v1:0 / Anthropic Claude to amazon.nova-lite-v1:0 as the default Bedrock model for AI summaries, make the model ID configurable via a Lambda environment variable, and add token count logging for cost tracking.

**Requirements:** COST-01, COST-02, COST-03

**Success Criteria:**
1. store-summary.ts uses amazon.nova-lite-v1:0 as the default model
2. BEDROCK_MODEL_ID env var overrides the model at runtime (CDK passes the value)
3. store-summary.ts logs inputTokens, outputTokens, and modelId with every summarization
4. Bedrock IAM policy updated to grant access to nova-lite model ARN
5. All backend tests pass

### Phase 35: Pipeline Debug CLI

**Goal:** Ship two developer CLI tools: debug-pipeline.js reads DynamoDB and prints a full human-readable pipeline status report for a session; replay-pipeline.js publishes the correct EventBridge event to resume the pipeline from any stage for a given sessionId.

**Requirements:** DEVEX-01, DEVEX-02, DEVEX-03

**Success Criteria:**
1. tools/debug-pipeline.js --sessionId <id> prints all pipeline fields from DynamoDB (transcriptStatus, aiSummaryStatus, mediaconvertJobId, recoveryAttemptCount, etc.)
2. tools/replay-pipeline.js --sessionId <id> --from <stage> publishes the correct EventBridge event for stages: recording-ended, mediaconvert, transcribe, summary
3. Both tools use AWS SDK v3 credential chain; AWS_REGION env var or us-east-1 default
4. Both tools handle missing sessions and invalid stage names with clear error messages

## Progress

v1.5 shipped. v1.6 in progress — Phase 31 planned (2 plans).
