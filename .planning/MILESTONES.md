# Milestones

## v1.6 Pipeline Durability, Cost & Debug (Shipped: 2026-03-11)

**Phases completed:** 5 phases, 9 plans

**Key accomplishments:**
- Five SQS queue pairs + per-handler DLQs for all 5 pipeline handlers — at-least-once delivery replacing fire-and-forget EventBridge→Lambda (Phase 31)
- All 5 handlers refactored to SQSEvent signature with `batchItemFailures` response (Phase 31)
- `recording-ended` + `transcode-completed` throw on failure; idempotency key prevents duplicate Transcribe jobs on SQS retry (Phase 32)
- `on-mediaconvert-complete` error suppression removed; `scan-stuck-sessions` recovers stale `transcriptStatus='processing'` sessions with 2h threshold (Phase 32)
- 10 CloudWatch alarms (5 DLQ depth + 5 Lambda error rate) + VNL-Pipeline dashboard (Phase 33)
- Nova Lite default model + `BEDROCK_MODEL_ID` override + per-invocation token logging for AI summary cost tracking (Phase 34)
- `debug-pipeline.js` + `replay-pipeline.js` CLI tools for pipeline introspection and stage replay (Phase 35)

---

## v1.5 Pipeline Reliability, Moderation & Upload Experience (Shipped: 2026-03-11)

**Phases completed:** 9 phases, 26 plans, 9 tasks

**Key accomplishments:**
- (none recorded)

---

## v1.2 Activity Feed & Intelligence (Shipped: 2026-03-06)

**Phases completed:** 25 phases, 64 plans, 57 tasks

**Key accomplishments:**
- (none recorded)

---

## v1.2 Activity Feed & Intelligence (Shipped: 2026-03-06)

**Phases completed:** 7 phases (16-22), 19 plans, 20 tasks

**Key accomplishments:**
- Hangout participant tracking — durably record participant joins with participantCount on session (Phase 16)
- Reaction summary aggregation — pre-compute per-emoji counts when sessions end (Phase 17)
- Homepage redesign with activity feed — two-zone layout with recording slider and activity list (Phase 18)
- Automatic transcription pipeline — S3 recording → Amazon Transcribe → transcript stored on session (Phase 19)
- AI summary generation — Bedrock/Claude Sonnet generates one-paragraph summaries for all recordings (Phase 20)
- Video upload support — users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding (Phase 21)
- Secure sharing — private broadcasts with ES384 JWT tokens for granular access control (Phase 22)
- Test coverage: 343/343 backend tests passing

---

## v1.1 Replay, Reactions & Hangouts (Shipped: 2026-03-05)

**Phases completed:** 15 phases (5–15 + decimal fixes), 27 plans

**Key accomplishments:**
- Auto-record all sessions (broadcasts + hangouts) to S3 via IVS recording config
- Home feed with Instagram-style recording grid (public /recordings endpoint)
- Replay viewer with HLS video playback + synchronized chat messages
- Reaction system: live reactions with Motion animations + replay-synced timeline
- IVS RealTime hangouts (multi-participant WebRTC, up to 5 participants)
- Developer CLI: stream test media via WHIP, seed data, simulate presence
- 169/169 backend tests passing

---

## v1.0 Gap Closure (Shipped: 2026-03-02)

**Phases completed:** 6 phases, 13 plans, 7 tasks

**Key accomplishments:**
- (none recorded)

---

