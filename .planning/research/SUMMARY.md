# Project Research Summary

**Project:** VideoNowAndLater v1.7 — Event Hardening & UI Polish
**Domain:** AWS SQS/Lambda event-driven pipeline hardening + React frontend polish
**Researched:** 2026-03-12
**Confidence:** HIGH

## Executive Summary

v1.7 is an instrumentation and hardening milestone, not a feature expansion. The pipeline that was built and debugged in v1.5/v1.6 (IVS → MediaConvert → Transcribe → Bedrock AI summary) is functionally correct but lacks observability, defensive validation, and operator tooling. Research confirms that all four backend tracks — X-Ray tracing, Zod schema validation, idempotency hardening, and DLQ re-drive tooling — are well-understood engineering problems with established patterns available directly from the Powertools for AWS Lambda TypeScript library and AWS SDK v3. No architectural pivots are required; all changes are additive to the existing handler structure.

The recommended approach is a phased build: enable X-Ray tracing first (purely additive, zero risk of regression), then add Zod schema validation (typing improvements that make subsequent phases safer), then apply idempotency to the two currently-unguarded handlers (`transcode-completed` and `store-summary`), and finally deliver the DLQ re-drive operator tooling. All four backend tracks can be completed before or in parallel with the UI polish track, which is entirely independent. The UI polish work is clarifying and completing what is already built: transcript status states, activity card completeness, and broadcast/hangout parity gaps.

The highest risk in this milestone is subtle configuration errors that silently fail rather than throw: X-Ray tracing wired in code but not enabled in CDK produces zero traces with no error; idempotency keys based on SQS `messageId` rather than business identifiers break idempotency on DLQ re-drives silently; and the `start-transcribe` handler was confirmed by codebase inspection to swallow transient errors, permanently losing messages without any DLQ entry. These three pitfalls require explicit attention during the implementation phases.

## Key Findings

### Recommended Stack

The existing stack requires no major new dependencies. `@aws-lambda-powertools/tracer@^2.31.0` is already installed but not wired into any handler or CDK Lambda definition. The only new npm packages needed are `@aws-lambda-powertools/parser@2.31.0` + `zod@^4.3.6` (schema validation), `@aws-lambda-powertools/idempotency@2.31.0` (idempotency — peer deps already satisfied by existing `@aws-sdk/client-dynamodb@^3.1000.0`), and `@aws-sdk/client-sqs` (DLQ re-drive via `StartMessageMoveTask`). All CDK changes use the existing `aws-cdk-lib@^2.170.0`.

**Core technologies:**
- `@aws-lambda-powertools/tracer@^2.31.0`: X-Ray distributed tracing — already installed; needs CDK `tracing: lambda.Tracing.ACTIVE` per Lambda + module-scope `captureAWSv3Client` wiring; CDK auto-grants `xray:PutTraceSegments` with no manual IAM needed
- `@aws-lambda-powertools/parser@2.31.0` + `zod@^4.3.6`: Event schema validation — Zod provides TypeScript inference from schema definitions; use `zod@4.x` not `3.x` (peer dep is explicit; do not install zod v3)
- `@aws-lambda-powertools/idempotency@2.31.0`: Full handler idempotency via `DynamoDBPersistenceLayer` — covers the three gaps the manual `ConflictException` catch in `transcode-completed` does not: concurrent deliveries, partial executions, Lambda timeouts
- `@aws-sdk/client-sqs` (new): `StartMessageMoveTask` API moves all messages from a DLQ back to its source queue asynchronously; no polling loop needed; applies to all 5 VNL DLQs which are SQS-backed (not Lambda function DLQs)
- `vnl-idempotency` DynamoDB table (new): Dedicated idempotency table with `timeToLiveAttribute: 'expiration'`; one shared table is correct — Powertools prefixes all keys by function name automatically

### Expected Features

**Must have (table stakes — P1):**
- X-Ray active tracing on all 6 pipeline Lambdas with `captureAWSv3Client` subsegments per AWS SDK call
- Zod schema validation at the top of every handler's SQS processing loop; `safeParse` for permanent failures (schema errors acknowledged without retry), `throw` for transient failures (SQS retries)
- `transcode-completed` and `store-summary` idempotency via `makeIdempotent` + `DynamoDBPersistenceLayer`
- `start-transcribe` error re-throw fix — currently swallows transient Transcribe API errors; must re-throw for SQS retry
- DLQ inspection + re-drive operator tooling (list messages, show decoded bodies, bulk re-drive via `StartMessageMoveTask`)
- UI: Transcript panel with explicit states for all four `transcriptStatus` values (`undefined`, `processing`, `available`, `failed`)
- UI: Activity feed cards with thumbnail, duration, accurate pipeline status, and polling refresh for non-terminal states
- UI: End-session confirmation dialog for broadcast/hangout; hangout reactions parity with broadcast
- Custom X-Ray sampling rule at 100% for `serviceName = 'vnl-pipeline'` — default 1 req/sec sampling misses most pipeline runs at current volume

**Should have (P2):**
- Transcript click-to-seek on replay/video pages
- Summary status distinct styling (separate visual treatment for processing vs failed vs available)
- `recording-ended` idempotency guard for MediaConvert re-submission on recovery events
- Activity feed pagination (`lastEvaluatedKey` DynamoDB pagination)

**Defer to v1.8:**
- Powertools `@aws-lambda-powertools/batch` `BatchProcessor` migration (current manual loops work correctly)
- Transcript search/filter, transcript translation
- Video download, follower/following feed, real-time feed updates via WebSocket

### Architecture Approach

The architecture after v1.7 adds three additive instrumentation layers to each pipeline Lambda: a Tracer module-scope instance with `captureAWSv3Client`-wrapped SDK clients, a Zod `safeParse` call at the SQS record entry point before `processEvent` is called, and (for `transcode-completed` and `store-summary`) a `makeIdempotent` wrapper around `processEvent` keyed on a stable business identifier from the EventBridge detail. Two new Lambdas provide operator tooling: `dlq-inspector.ts` (reads DLQ without consuming via `VisibilityTimeout=0`) and `dlq-redrive.ts` (calls `StartMessageMoveTask`). A new DynamoDB table and CDK additions for `tracing: Tracing.ACTIVE` plus API Gateway admin routes round out the infra changes. The UI polish track is entirely frontend — no new backend routes required.

**Major components:**
1. **Pipeline Lambda modifications (6 handlers)** — add Tracer, Zod schema, `captureAWSv3Client` on all AWS SDK clients; move SDK client construction from inside `processEvent` to module scope (current location in 4 of 5 handlers is incompatible with Tracer)
2. **`backend/src/schemas/` (new directory)** — per-handler Zod schema files, one per event type; co-located schemas avoid bundle bloat from a shared schema module
3. **`dlq-inspector.ts` + `dlq-redrive.ts` (new Lambdas)** — operator tooling with separate IAM from pipeline handlers (SQS management actions, not DynamoDB/Transcribe/Bedrock)
4. **`vnl-idempotency` DynamoDB table (new)** — PK=`id` STRING, TTL=`expiration`; shared by all handlers with function-name-prefixed keys
5. **CDK `session-stack.ts` modifications** — `Tracing.ACTIVE` on 6 Lambdas; IdempotencyTable; DLQ Lambda + API Gateway admin routes; DLQ ARN env vars; custom X-Ray sampling rule

### Critical Pitfalls

1. **X-Ray `tracing: lambda.Tracing.ACTIVE` not set in CDK** — Tracer code runs without error but produces zero traces; no warning is emitted. Must add to each `NodejsFunction` in `session-stack.ts` and verify in the Lambda console. CDK configuration step only, not a code change.

2. **AWS SDK clients constructed inside `processEvent` (current in 4 of 5 handlers)** — `captureAWSv3Client()` wraps at init time; clients created after the trace segment opens produce no subsegments. Refactor `recording-ended`, `store-summary`, `transcribe-completed`, and `on-mediaconvert-complete` to construct all SDK clients at module scope before the Tracer phase ships.

3. **Idempotency key uses SQS `messageId` instead of business identifier** — `messageId` changes on DLQ re-drive; every re-drive looks like a new event and bypasses idempotency entirely. Must key on `detail.sessionId` or `detail.userMetadata.sessionId` (stable across all deliveries of the same logical event). Verified in Powertools docs.

4. **`start-transcribe` handler swallows transient errors** — confirmed by codebase inspection at line 87-90: the catch block logs but does not rethrow, causing SQS to acknowledge and delete messages that failed due to Transcribe throttling. Sessions get stuck at `transcriptStatus = 'processing'` with no recovery path other than `scan-stuck-sessions`. Fix in the schema validation phase error-path audit.

5. **Idempotency table TTL attribute must be named `expiration` exactly** — Powertools writes to this attribute name; if the CDK `Table` is created without `timeToLiveAttribute: 'expiration'`, records accumulate permanently. Old sessions block forced reprocessing. The forced-reprocessing playbook must also document manually deleting idempotency records before re-driving when a bug fix is deployed.

## Implications for Roadmap

Research identifies a natural 4-phase backend build order with a parallel UI track. Phases A through C have a dependency chain (tracing before validation before idempotency) while Phase D (DLQ tooling) and Phase E (UI polish) are independent and can be parallelized after Phase A.

### Phase A: X-Ray Distributed Tracing
**Rationale:** Purely additive — no logic changes, no new npm packages. Ships before any core logic is touched, so subsequent phases benefit from traces during testing. The CDK change (`tracing: Tracing.ACTIVE`) is the prerequisite for all X-Ray handler work and must land before any other change.
**Delivers:** Full X-Ray service map for all 6 pipeline Lambdas; `sessionId` and `pipelineStage` annotations searchable in X-Ray console; per-AWS-call subsegments for DynamoDB, S3, Transcribe, MediaConvert, Bedrock; cold start annotations; custom 100% sampling rule for `serviceName = 'vnl-pipeline'`
**Addresses:** X-Ray table stakes features (Track A in FEATURES.md)
**Avoids:** Do not use `@tracer.captureLambdaHandler()` decorator on SQS handlers — use manual per-record subsegments; do not capture large response bodies on `transcribe-completed` or `store-summary` (X-Ray 64KB segment limit); do not apply X-Ray to non-pipeline Lambdas where it adds cost with no value
**Research flag:** Standard patterns — no additional research needed; all code patterns confirmed in official Powertools Tracer docs with HIGH confidence

### Phase B: Zod Schema Validation + Error Handling Audit
**Rationale:** Schema validation is the next layer that makes the typed event flow safe for idempotency key extraction in Phase C. The `start-transcribe` error-handling bug (confirmed by codebase inspection) is a natural fix during the error-path audit this phase requires across all 6 handlers.
**Delivers:** Zod schema per handler in `backend/src/schemas/`; `safeParse` at SQS record loop entry before `processEvent`; structured validation error logs; `start-transcribe` error re-throw fix; permanent schema failures acknowledged without retry (not pushed to DLQ); typed `parseResult.data` replacing `as any` casts
**Uses:** `@aws-lambda-powertools/parser@2.31.0` + `zod@^4.3.6` (new installs); keeps schemas per-file to avoid cold start overhead from a large shared schema module
**Avoids:** Do not use `z.any()` for unverified fields; do not use `schema.parse()` (throwing) inside `processEvent` — use `safeParse` in the SQS loop; do not push ZodErrors to `batchItemFailures` (permanent failures should be acknowledged, not retried)
**Research flag:** Standard patterns — Zod and Powertools Parser are well-documented; `recording-ended` has a recovery event path with a different shape that requires a `z.discriminatedUnion` or `z.union` schema, which should be specified in the phase plan before implementation begins

### Phase C: Idempotency Gap Coverage
**Rationale:** Depends on Phase B — typed and validated events from Zod make JMESPath key extraction reliable. Targets the two handlers with confirmed idempotency gaps: `transcode-completed` (manual `ConflictException` catch is fragile and covers only one scenario) and `store-summary` (no guard; Bedrock is not idempotent).
**Delivers:** `makeIdempotent` wrapping `processEvent` for `transcode-completed` and `store-summary`; new `vnl-idempotency` DynamoDB table with `timeToLiveAttribute: 'expiration'`; `registerLambdaContext` in both handlers for Lambda timeout protection; idempotency keys on stable business identifiers (`detail.userMetadata.sessionId` for transcode, `detail.sessionId` for store-summary)
**Implements:** ARCHITECTURE.md Pattern 3 (Powertools Idempotency with JMESPath key on SQS events)
**Avoids:** Do not use SQS `messageId` as the idempotency key; do not share the main `vnl-sessions` DynamoDB table for idempotency records; do not omit `registerLambdaContext` — without it, INPROGRESS records block retries after Lambda timeouts; keep the `ConflictException` catch in `transcode-completed` as a belt-and-suspenders backstop
**Research flag:** Targeted verification needed — confirm the `recording-ended` recovery event path (`recoveryAttempt: true`) has a stable idempotency key before deciding whether to include it in Phase C scope

### Phase D: DLQ Re-drive Operator Tooling
**Rationale:** Independent of Phases B and C — can be built in parallel after Phase A observability is in place. Relies on existing SQS queue ARNs established in v1.6 Phase 31; no pipeline logic changes required.
**Delivers:** `dlq-inspector.ts` Lambda (`GET /admin/dlq/:handler` — `ReceiveMessage` with `VisibilityTimeout=0`, returns decoded message bodies with sessionId); `dlq-redrive.ts` Lambda (`POST /admin/dlq/redrive` — `StartMessageMoveTask`); API Gateway admin routes (Cognito-gated); documented forced-reprocessing playbook (delete idempotency record + re-drive); DLQ ARNs passed as env vars from CDK
**Addresses:** All DLQ Track C features from FEATURES.md
**Avoids:** Do not reuse pipeline Lambda execution roles for the re-drive Lambda (scope to SQS management actions only on specific DLQ ARNs); do not attempt `StartMessageMoveTask` on Lambda function-level DLQs (only SQS-backed DLQs are supported); check `ListMessageMoveTasks` before starting to avoid `MessageMoveTaskAlreadyRunning`; do not use AWS console for production re-drives (console viewing counts against `maxReceiveCount`)
**Research flag:** Standard patterns — `StartMessageMoveTask` API and `ReceiveMessage` peek pattern are well-documented; all IAM permissions enumerated in ARCHITECTURE.md

### Phase E: UI Polish
**Rationale:** Entirely independent of backend phases; can run in parallel with any of Phases B-D. Groups all frontend polish work together to minimize context switching between backend and frontend.
**Delivers:** Four-state transcript panel (`undefined`, `processing`, `available`, `failed`) with distinct visual treatment per state; exponential-backoff polling (15s → 30s → 60s cap) for non-terminal session states on activity feed; activity cards with thumbnail, duration, accurate pipeline status badge; hangout reactions parity with broadcast (`ReactionPicker` integration on `HangoutPage`); end-session confirmation dialog on broadcast and hangout pages; transcript click-to-seek; summary status distinct styling with AI-generated label and help tooltip
**Addresses:** FEATURES.md Tracks E (transcript display), F (upload video player), G (activity feed), H (broadcast/hangout live session)
**Avoids:** Do not implement real-time feed updates via WebSocket — 60s poll cap is sufficient; do not implement transcript translation or activity feed pagination in this milestone; do not poll for terminal states (`available` or `failed`) after the first confirmed fetch
**Research flag:** Pre-implementation audit — verify `HangoutPage.tsx` for any partial `ReactionPicker` implementation before building from scratch; verify `getConfig()?.apiUrl` (not `APP_CONFIG` window global) is used for all new polling fetch calls

### Phase Ordering Rationale

- **X-Ray before everything:** `tracing: Tracing.ACTIVE` in CDK is a prerequisite for any traces to appear. Shipping it first means Phases B-D benefit from observability during development and testing. It is the lowest-risk change with the highest leverage.
- **Schema validation before idempotency:** Zod schemas produce typed `parseResult.data` values; `IdempotencyConfig.eventKeyJmesPath` expressions point into that typed structure. Reliable key extraction requires the schema to be in place first.
- **Idempotency after validation:** Phase C wraps `processEvent` which receives typed input from Phase B. JMESPath key extraction on unvalidated `as any` casts (the current state) risks silent failures if event shape changes.
- **DLQ tooling is independent:** Phase D has no code dependency on Phases B or C. It requires only the existing DLQ ARNs (v1.6) and the X-Ray observability from Phase A to be useful diagnostically. It can be built in parallel with Phases B and C.
- **UI is fully decoupled:** Phase E touches only `web/src/`; backend phases touch only `backend/src/handlers/`, `backend/src/schemas/`, and `infra/lib/stacks/`. No coordination required between the two tracks.

### Research Flags

Phases with well-documented patterns — standard implementation, skip additional research:
- **Phase A (X-Ray):** Established Powertools Tracer patterns; CDK `Tracing.ACTIVE` is a one-line addition per Lambda; all code patterns confirmed in official docs with HIGH confidence
- **Phase B (Schema Validation):** Zod + Powertools Parser are well-documented; the per-handler schema structure is straightforward given the known event shapes from codebase inspection; `start-transcribe` fix is a one-line rethrow change
- **Phase D (DLQ Tooling):** `StartMessageMoveTask` API is fully documented; `ReceiveMessage` with `VisibilityTimeout=0` is a standard peek pattern; all IAM permissions enumerated in ARCHITECTURE.md

Phases that benefit from targeted pre-implementation verification:
- **Phase C (Idempotency):** The interaction between `makeIdempotent` at `processEvent` scope and the existing `ConflictException` catch in `transcode-completed` should be verified — decide whether to keep both or remove the manual guard once Powertools is in place. The `recording-ended` recovery event has a different shape; confirm the idempotency key is stable across normal and recovery paths before including it in scope.
- **Phase E (UI Polish):** Inspect `HangoutPage.tsx` for existing partial `ReactionPicker` implementation before building; inspect `VideoPage.tsx` to confirm the transcript panel toggle currently renders correctly before adding state variants.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified via npm registry; peer deps confirmed against local `backend/package.json`; `@aws-lambda-powertools/tracer` already installed — no surprises; CDK API confirmed against v2 docs |
| Features | HIGH | Based on direct codebase analysis of all 5 pipeline handlers and all relevant frontend components; all gaps confirmed by code inspection, not inference |
| Architecture | HIGH | All patterns verified against official Powertools docs and AWS SQS API reference; build order derived from confirmed code dependencies; anti-patterns documented with specific failure modes |
| Pitfalls | HIGH | Critical pitfalls 1-3 confirmed against official docs; Pitfall 4 (`start-transcribe` error swallowing) confirmed by direct codebase inspection at specific line numbers; idempotency pitfalls verified against Powertools idempotency docs |

**Overall confidence:** HIGH

### Gaps to Address

- **`start-transcribe` transient vs permanent error boundary:** The fix direction is clear (re-throw transient errors, acknowledge permanent failures), but the specific Transcribe SDK exception types that qualify as transient (`ThrottlingException`, `ServiceUnavailableException`) vs permanent (missing `sessionId`, missing `recordingHlsUrl`) should be enumerated explicitly in the Phase B plan before implementation.
- **`recording-ended` idempotency scope:** Research rates this MEDIUM priority. The MediaConvert re-submission on recovery events is the specific gap. Confirm whether `scan-stuck-sessions` recovery events already guard against double-submission before deciding whether to include `recording-ended` in Phase C scope.
- **Hangout reactions implementation baseline:** FEATURES.md notes this as a parity gap with broadcast. Verify in `HangoutPage.tsx` whether `ReactionPicker` is missing entirely or exists but is not wired, as these have different implementation costs.
- **SQS-to-Lambda X-Ray trace disconnection:** Pipeline stages appear as disconnected nodes in the X-Ray service map. This is a confirmed AWS platform constraint (SQS does not propagate X-Ray trace context to Lambda triggers), not a configuration bug. Document this in Phase A acceptance criteria so future debugging sessions do not incorrectly diagnose a configuration problem.

## Sources

### Primary (HIGH confidence)
- [Powertools Tracer docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/tracer/) — module scope pattern, `captureAWSv3Client`, active tracing prerequisites, POWERTOOLS_TRACER_CAPTURE_RESPONSE env var
- [Powertools Parser docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/parser/) — SqsEnvelope, EventBridgeEnvelope, `safeParse` usage
- [Powertools Idempotency docs](https://docs.aws.amazon.com/powertools/typescript/2.1.1/utilities/idempotency/) — `makeIdempotent`, SQS handler pattern, DynamoDB table setup, TTL attribute naming (`expiration`), `registerLambdaContext` requirement
- [SQS StartMessageMoveTask API reference](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_StartMessageMoveTask.html) — native DLQ re-drive API, SQS-only source limitation, parameter names
- [CDK NodejsFunction API](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunctionProps.html) — `tracing: Tracing` property, CDK auto-IAM behavior with `Tracing.ACTIVE`
- [Amazon SQS and AWS X-Ray](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-sqs.html) — SQS trace topology and disconnected node behavior (platform constraint, not a bug)
- npm registry — confirmed `@aws-lambda-powertools/{parser,idempotency,tracer}@2.31.0`, `zod@4.3.6`, peer dep `zod: '4.x'` for parser, `@aws-sdk/client-dynamodb: >=3.x` for idempotency
- Direct codebase inspection: all 5 pipeline handler files, `backend/package.json`, `infra/lib/stacks/session-stack.ts` — confirmed SDK client construction locations, error-handling patterns, existing DLQ queue constructs, `start-transcribe` error-swallowing bug at line 87-90

### Secondary (MEDIUM confidence)
- [AWS blog: Implementing idempotent Lambda functions with Powertools](https://aws.amazon.com/blogs/compute/implementing-idempotent-aws-lambda-functions-with-powertools-for-aws-lambda-typescript/) — idempotency patterns, SQS integration
- [AWS blog: New SQS DLQ Redrive APIs](https://aws.amazon.com/blogs/aws/a-new-set-of-apis-for-amazon-sqs-dead-letter-queue-redrive/) — launch announcement, re-drive to original queue behavior
- [Yan Cui: How to reprocess Lambda DLQ messages on-demand](https://theburningmonk.com/2024/01/how-would-you-reprocess-lambda-dead-letter-queue-messages-on-demand/) — `StartMessageMoveTask` limitation for Lambda function DLQs (community, verified against AWS API docs)
- [AWS X-Ray pricing](https://aws.amazon.com/xray/pricing/) — 100K free traces/month; 500 traces/day at VNL volume is well within free tier
- [Zod v4 release notes](https://zod.dev/v4) — bundle size, peer dep requirements for Powertools Parser

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
