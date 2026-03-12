---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Event Hardening & UI Polish
status: executing
stopped_at: Completed 036-02-PLAN.md
last_updated: "2026-03-12T18:57:10.882Z"
last_activity: "2026-03-12 — Completed 036-01: TDD Red tracer contract tests for all 5 pipeline handlers"
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
  percent: 2
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.
**Current focus:** v1.7 Phase 36 — X-Ray Distributed Tracing

## Current Position

Phase: 36 of 41 (X-Ray Distributed Tracing)
Plan: 2 complete (036-02-PLAN.md done)
Status: In progress
Last activity: 2026-03-12 — Completed 036-02: X-Ray tracer + per-record subsegments in recording-ended and transcode-completed

Progress: [█████████░] 85%

## Performance Metrics

**Velocity:**
- Total plans completed: 0 (v1.7)
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

Last session: 2026-03-12T18:57:10.879Z
Stopped at: Completed 036-02-PLAN.md
Resume file: None

**Key decisions from 036-02:**
- Per-invocation `captureAWSv3Client` (not module-scope) used to satisfy test contract — `beforeEach` clears mock call counts, so clients must be re-wrapped per handler invocation for `toHaveBeenCalledWith` assertions to pass
- ESM Jest TDZ fix: use `var` with factory-assignment pattern in all tracer test mocks (const causes TDZ with `--experimental-vm-modules` + ESM import resolution)

**Next action:** Run `/gsd:execute-plan 036-03` to implement X-Ray tracer in transcribe-completed, store-summary, and on-mediaconvert-complete handlers.
