---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Event Hardening & UI Polish
status: executing
stopped_at: Completed 038-01-PLAN.md
last_updated: "2026-03-14T04:09:15Z"
last_activity: "2026-03-14 — Completed 038-01: idempotency test contracts (TDD RED phase, 3 failing tests)"
progress:
  total_phases: 6
  completed_phases: 1
  total_plans: 5
  completed_plans: 5
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.
**Current focus:** v1.7 Phase 38 — Idempotency Gap Coverage (Wave 1 RED phase complete)

## Current Position

Phase: 38 of 41 (Idempotency Gap Coverage) — IN PROGRESS
Plan: 1/4 complete (038-01-PLAN.md done — RED phase tests)
Status: TDD RED phase complete — 3 failing tests define idempotency contracts
Last activity: 2026-03-14 — Completed 038-01: test contracts for IDEM-01, IDEM-02, IDEM-03 (all failing as expected)

Progress: [████████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 3 (v1.7 in progress)
- Average duration: N/A
- Total execution time: 0 hours

**Milestone History:**
- v1.0 Gap Closure: 6 phases, 13 plans (shipped 2026-03-02)
- v1.1 Replay, Reactions & Hangouts: 15 phases, 27 plans (shipped 2026-03-05)
- v1.2 Activity Feed & Intelligence: 7 phases, 19 plans (shipped 2026-03-06)
- v1.4 Creator Studio & Stream Quality: 3 phases, 9 plans (shipped 2026-03-10)
- v1.5 Pipeline Reliability, Moderation & Upload: 9 phases, 26 plans (shipped 2026-03-11)
- v1.6 Pipeline Durability, Cost & Debug: 5 phases, 9 plans (shipped 2026-03-11)

## Accumulated Context

### Key Decisions (v1.7 Planning)

**X-Ray tracing pitfall (Phase 36):**
- `tracing: lambda.Tracing.ACTIVE` must be set in CDK per Lambda — code-only wiring produces zero traces with no error
- AWS SDK clients must be constructed at module scope for `captureAWSv3Client` to produce subsegments — 4 of 5 handlers currently construct clients inside `processEvent` and must be refactored
- SQS→Lambda trace context is not propagated by AWS (platform constraint) — pipeline stages appear as disconnected nodes in service map; this is expected, not a configuration bug
- Do not use `@tracer.captureLambdaHandler()` decorator on SQS handlers — use manual per-record subsegments

**Schema validation pitfall (Phase 37):**
- `start-transcribe` handler swallows transient errors (confirmed at line 87-90) — fix: re-throw transient Transcribe exceptions (`ThrottlingException`, `ServiceUnavailableException`); acknowledge permanent failures (missing sessionId/recordingHlsUrl)
- `recording-ended` has a recovery event path with a different shape — use `z.discriminatedUnion` or `z.union` schema
- Permanent schema failures must be acknowledged (not pushed to `batchItemFailures`) to avoid infinite SQS retry loops

**Idempotency pitfall (Phase 38):**
- Idempotency key must be a stable business identifier (`detail.sessionId`) NOT the SQS `messageId` — messageId changes on DLQ re-drive, bypassing idempotency entirely
- New `vnl-idempotency` DynamoDB table required with `timeToLiveAttribute: 'expiration'` (exact name — Powertools writes to this attribute)
- `registerLambdaContext` is mandatory — without it, INPROGRESS records block retries after Lambda timeouts
- Keep the existing `ConflictException` catch in `transcode-completed` as a belt-and-suspenders backstop

**DLQ tooling (Phase 39):**
- Use `ReceiveMessage` with `VisibilityTimeout=0` to peek at DLQ messages without consuming them
- Use `StartMessageMoveTask` for bulk re-drive (not manual message copying)
- Check `ListMessageMoveTasks` before starting to avoid `MessageMoveTaskAlreadyRunning` error
- Scope DLQ Lambda IAM to SQS management actions only — do not reuse pipeline handler execution roles

**UI (Phases 40-41):**
- Use `getConfig()?.apiUrl` (not `APP_CONFIG` window global) for all new fetch calls
- Activity feed polling: exponential backoff 15s → 30s → 60s cap; stop polling on terminal states (available, failed)
- Verify `HangoutPage.tsx` for existing partial `ReactionPicker` implementation before building from scratch

### Pending Todos

None yet.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-03-12T19:08:44.943Z
Stopped at: Completed 036-04-PLAN.md
Resume file: None

**Key decisions from 036-02:**
- Per-invocation `captureAWSv3Client` (not module-scope) used to satisfy test contract — `beforeEach` clears mock call counts, so clients must be re-wrapped per handler invocation for `toHaveBeenCalledWith` assertions to pass
- ESM Jest TDZ fix: use `var` with factory-assignment pattern in all tracer test mocks (const causes TDZ with `--experimental-vm-modules` + ESM import resolution)

**Key decisions from 036-03:**
- Module-scope client tests require direct send assignment in beforeEach (not mockImplementation) — capture instance before clearAllMocks() then instance.send = mockFn
- captureAWSv3Client calls happen at module load — do NOT clear that mock in beforeEach; keep calls for TRACE-02 assertions
- setupEbSend() helper pattern for redirecting module-scope EventBridgeClient send in on-mediaconvert-complete tests

**Key decisions from 036-04:**
- `lambda.Tracing.ACTIVE` added only to the 5 pipeline handlers in CDK; non-pipeline functions excluded to keep X-Ray service map focused
- Pipeline stages appear as disconnected nodes in X-Ray service map due to SQS trace context not propagated by AWS — platform constraint, not a configuration bug
- CDK automatically injects xray:PutTraceSegments + xray:PutTelemetryRecords permissions when Tracing.ACTIVE is set — no manual IAM changes required

**Next action:** Run `/gsd:plan-phase 37` to plan Event Schema Validation (Zod boundary validation at all 5 pipeline handler SQS entry points).
