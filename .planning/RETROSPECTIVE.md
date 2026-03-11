# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

---

## Milestone: v1.5 — Pipeline Reliability, Moderation & Upload Experience

**Shipped:** 2026-03-11
**Phases:** 9 | **Plans:** 26 | **Commits:** ~81

### What Was Built

- Powertools structured logging across all 5 pipeline Lambdas with `sessionId` correlation and 30-day CloudWatch retention
- EventBridge Scheduler cron (15 min) for stuck session recovery — queries GSI1 STATUS#ENDING/ENDED partitions, caps at 3 retries, re-fires via PutEvents
- Speaker diarization via Transcribe `ShowSpeakerLabels: true`, segments stored in S3 (not DynamoDB), bubble-mode UI in ReplayViewer and VideoPage
- Chat moderation: `bounce-user.ts`, `report-message.ts`, token blocklist in `create-chat-token.ts`, DynamoDB moderation log, hover buttons in MessageRow
- Upload video player: `/video/:sessionId` with hls.js 1.6 ABR, `useHlsPlayer` hook, `QualitySelector`, Safari native fallback
- Upload video social layer: `CommentThread` (±1500ms highlight, sort toggle, polling), `VideoInfoPanel` (collapsible AI summary + transcript), reactions wiring

### What Worked

- **Research-first with architectural decisions pre-loaded in STATE.md** — researcher agents had full context on the exact DynamoDB key patterns, library choices, and known pitfalls before writing research docs. This eliminated most back-and-forth on technical fundamentals.
- **Wave parallelization** — Plans 30-02 (CDK) and 30-03 (frontend) ran in parallel since they touched zero overlapping files. Net time reduction for Phase 30 was meaningful.
- **Plan frontmatter `key_links`** — Explicitly listing critical wiring (e.g., `VideoPage → useHlsPlayer → CommentThread syncTime prop`) prevented executors from missing integration points between components.
- **`--auto` pipeline** — plan-phase → execute-phase → verification → phase complete in one invocation. Zero orchestrator interruption needed across phases 29 and 30.
- **Self-correcting executors** — Plan 30-03 executor caught a prop-name mismatch (`onReact` vs `onReaction`) and fixed it before writing VideoPage, avoiding a compile error. Deviation logged in SUMMARY.

### What Was Inefficient

- **RESEARCH.md one-liner extraction not yet automated** — accomplishments array returned empty from `milestone complete` CLI because SUMMARY.md one-liner fields weren't populated consistently. Had to derive accomplishments manually.
- **ROADMAP.md phase details section grows unboundedly** — by v1.5 the Phase Details section was 200+ lines of completed content. The collapse-to-details step at milestone close is manual and tedious. A `roadmap collapse-milestone` CLI command would save time.
- **startedAt gap not caught earlier** — The missing `startedAt: now` in `createUploadSession` was a latent bug from Phase 21 (video uploads). Research found it, but it would ideally have been caught by a phase 21 gap-closure or test. Upload session reactions returned 400 in production until Phase 30.

### Patterns Established

- **S3 pointer pattern for variable-length DynamoDB payloads** — Store path on session (`diarizedTranscriptS3Path`), never inline arrays. Used for speaker segments; applies to any data that grows with recording length.
- **Token blocklist in token issuance handlers** — For any "deny access" feature (bounce, block), the enforcement point is at token issuance (`create-chat-token.ts`), not just at the action handler. Action handler writes the record; token handler checks it.
- **`hls.nextLevel` not `hls.currentLevel`** — currentLevel causes buffer flush stall; nextLevel transitions cleanly at next fragment boundary. Applies to any HLS.js quality switching implementation.
- **useHlsPlayer exports syncTime** — Player hook should expose `syncTime` (currentTime * 1000 ms) from day one so social layer components can anchor to playback position without hook changes.
- **Comment SK zero-padded ms** — `COMMENT#{zeroPadded15DigitMs}#{uuid}` gives natural DynamoDB lexicographic sort order for free; no sort on read needed.

### Key Lessons

1. Pre-loading architectural decisions into STATE.md before researcher agents run is worth the upfront effort — it acts as a "known pitfalls" guide that prevents researchers from proposing naive implementations.
2. Phases with both backend and frontend work benefit most from wave parallelization. Identify CDK wiring as a separate wave-2 plan early in planning so it can run alongside frontend in parallel.
3. Missing `startedAt` on upload sessions was a cross-phase dependency that went unnoticed until a downstream feature needed it. Consider adding a "session completeness" check to the create-upload-session handler test suite.
4. The `--auto` flag works cleanly for frontend/infrastructure phases with no external dependencies. Use it confidently when phase scope is well-defined and research is thorough.

### Cost Observations

- Model mix: sonnet for all executors and checkers; opus not used in v1.5
- Sessions: ~4 sessions (planning + execution split across context windows)
- Notable: Phase 30 parallel wave execution (30-02 + 30-03) completed in ~4 minutes combined vs ~8 min sequential

---

## Milestone: v1.6 — Pipeline Durability, Cost & Debug

**Shipped:** 2026-03-11
**Phases:** 5 | **Plans:** 9 | **Commits:** ~30

### What Was Built

- SQS queue pairs + per-handler DLQs for all 5 pipeline Lambdas; EventBridge→SQS→Lambda with `batchItemFailures` partial-failure reporting
- Handler hardening: `recording-ended`, `transcode-completed`, `on-mediaconvert-complete` throw on critical failures; idempotency key (sessionId + MediaConvert jobId) prevents duplicate Transcribe jobs
- `scan-stuck-sessions` upgraded with `transcriptStatusUpdatedAt` staleness tracking (2h threshold) to recover genuinely stale `processing` sessions without false positives
- 10 CloudWatch alarms (5 DLQ depth + 5 Lambda error rate) wired to SNS topic + VNL-Pipeline dashboard with 5 handler rows × 3 GraphWidgets
- Nova Lite as default Bedrock model with `BEDROCK_MODEL_ID` env override and per-invocation token count logging
- `debug-pipeline.js` + `replay-pipeline.js` standalone Node.js CLI tools using AWS SDK v3 credential chain

### What Worked

- **Audit-first completion** — Running `/gsd:audit-milestone` before `/gsd:complete-milestone` surfaced real documentation gaps (missing SUMMARY.md, unchecked checkboxes) that would have left the milestone in an ambiguous state. Worth the step.
- **Documentation gaps were all paperwork, not code** — Audit confirmed all code was wired and 462/462 tests passed. The gaps were SUMMARY.md files and ROADMAP checkboxes. This confirms the milestone audit has the right signal-to-noise ratio.
- **Phase 31 (SQS) as its own phase before hardening** — Separating infrastructure (SQS queues + wiring) from handler behavior changes (throw semantics) meant Phase 32 could verify handlers in isolation. Clean dependency ordering.
- **ConflictException as success signal** — Treating Transcribe `ConflictException` (job already exists) as an idempotent success rather than an error is the right model for SQS retry scenarios. Makes idempotency the default.

### What Was Inefficient

- **ROADMAP sub-plan checkboxes not auto-checked** — After phases 32-35 executed, the sub-plan-level checkboxes (32-01-PLAN.md, 33-01-PLAN.md, etc.) were all `[ ]` despite parent phase being `[x]`. This is a GSD tooling gap — plan execution should auto-check sub-plan boxes.
- **v1.5-phases move committed separately** — The cleanup `/gsd:cleanup` moved v1.5 phase dirs to the archive on disk but the git commit was never made. Required a separate commit during v1.6 closeout. The cleanup command should commit atomically.
- **MILESTONES.md accomplishments not auto-populated** — `milestone complete` CLI returned `accomplishments: []` because one-liners weren't consistently in frontmatter. Had to write them manually. A SUMMARY.md scraper would save this.

### Patterns Established

- **SQS batch size 1 + `reportBatchItemFailures: true`** — For pipeline Lambdas where partial failure semantics matter, this is the correct CDK pattern (not `bisectBatchOnFunctionError` which doesn't exist in CDK v2).
- **Idempotency key = sessionId + upstream job ID** — Stable idempotency keys for job submission should combine the session identifier with the job ID from the upstream stage. This survives Lambda restarts and SQS redelivery.
- **Timestamp on every status update** — `transcriptStatusUpdatedAt` written on every `updateTranscriptStatus` call gives recovery logic a staleness signal. Any status that can get "stuck" should have an `updatedAt` companion field.
- **CLI tools as standalone Node.js scripts** — For developer debugging tools, standalone `.js` scripts with no build step are strictly better than TypeScript CLIs. They work immediately without compilation and the AWS SDK v3 credential chain handles auth.

### Key Lessons

1. The SQS migration was straightforward once CDK docs for `SqsEventSource` were read carefully — `bisectBatchOnFunctionError` doesn't exist. Always check the actual CDK API surface against documentation assumptions.
2. Handler hardening (throwing instead of catching) is the correct primitive for SQS retry semantics. Silent catches were actively harmful — they consumed messages without retrying, causing pipeline stalls with no visibility.
3. `transcriptStatusUpdatedAt` could have been added in Phase 26 (stuck session cron). The gap between "processing" detection and staleness detection was a latent design hole that Phase 32 closed retroactively.
4. Splitting DUR (infrastructure) and HARD (behavior) into separate phases made both easier to verify and reduced risk of a combined CDK + TypeScript change breaking tests.

### Cost Observations

- Model mix: sonnet for all executors; opus not used in v1.6
- Sessions: 2 sessions (planning/execution + audit/completion)
- Notable: 5 phases in a single day — SQS infrastructure phases are faster than frontend phases (no visual feedback loop)

---

## Cross-Milestone Trends

| Milestone | Phases | Plans | Days | Tests at Ship | Notes |
|-----------|--------|-------|------|---------------|-------|
| v1.0 | 4 | 11 | 1 | ~200 | Initial foundation |
| v1.1 | 15 | 27 | 3 | 343 | Largest milestone |
| v1.2 | 7 | 19 | 1 | 360 | Pipeline introduced |
| v1.4 | 3 | 9 | 1 | 360 | Creator features |
| v1.5 | 9 | 26 | 2 | 445 | Pipeline hardening + social layer |
| v1.6 | 5 | 9 | 1 | 462 | SQS durability + handler hardening |

**Trend:** Plan count per phase averaging ~2.3 in v1.6 (tight, focused plans). Test count growing steadily: +17 tests in v1.6 (from 445 → 462). Infrastructure-heavy milestones (SQS, CDK alarms) ship faster than frontend milestones.
