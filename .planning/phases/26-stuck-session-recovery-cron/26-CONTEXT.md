# Phase 26: Stuck Session Recovery Cron - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A scheduled Lambda (EventBridge Scheduler, every 15 minutes) queries DynamoDB for sessions stuck in the pipeline — `transcriptStatus` null or `pending`, `endedAt` more than 45 minutes ago — and re-fires an EventBridge event to restart the pipeline from the appropriate stage. Sessions actively processing are skipped; sessions that have failed 3+ times are permanently excluded.

</domain>

<decisions>
## Implementation Decisions

### Scheduling
- EventBridge Scheduler `rate(15 minutes)` — mirrors the existing `ReplenishPoolSchedule` pattern in `session-stack.ts`
- Cron must complete within Lambda 5-minute timeout for any realistic number of stuck sessions

### Query approach
- Query GSI1 with partition key `STATUS#ENDING` — do NOT full-table scan (would cause RCU cost explosion)
- Filter in Lambda: `endedAt < now - 45 minutes` AND `transcriptStatus` is `null`, `undefined`, or `'pending'`
- `STATUS#ENDING` is the correct GSI1PK for sessions that have ended but not yet completed the pipeline

### Skip criteria
- Skip any session with `transcriptStatus = 'processing'` (MediaConvert or Transcribe job actively running)
- Skip any session with `recoveryAttemptCount >= 3` (permanently exhausted)

### Recovery mechanism
- Re-fire via `EventBridge PutEvents` (NOT direct Lambda.invoke) — preserves DLQ and retry semantics
- Recovery stage: always re-fire the `recording-ended` equivalent event (reset to first stage) rather than trying to detect the exact failed stage — avoids complex state inference
- Event includes `recoveryAttempt: true` marker and current `recoveryAttemptCount` so handlers can log it

### Retry cap
- Cap at 3 attempts via `recoveryAttemptCount` field written to the session DynamoDB record
- Increment `recoveryAttemptCount` atomically when firing recovery event (conditional write)
- After cap reached: session stays in DynamoDB with `recoveryAttemptCount = 3`, no further cron action

### Handler naming
- New handler: `backend/src/handlers/scan-stuck-sessions.ts`
- New CDK construct in `infra/lib/stacks/session-stack.ts` following `replenishPoolFn` pattern

### Claude's Discretion
- Exact DynamoDB expression attribute naming and projection expression for the GSI1 query
- Logger output format (use established Phase 25 Powertools Logger pattern)
- Unit test structure (follow existing handler test conventions)

</decisions>

<specifics>
## Specific Ideas

- Follow the `replenishPoolFn` + `ReplenishPoolSchedule` CDK pattern exactly for the new cron Lambda and its EventBridge Scheduler rule
- The recovery event source should match the existing EventBridge bus and rules so `recording-ended.ts` receives and processes it normally
- Use `logger.appendPersistentKeys({ sessionId })` per session inside the scan loop (Phase 25 pattern)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `replenish-pool.ts` handler: GSI1 query pattern (`IndexName: 'GSI1'`, `KeyConditionExpression: 'GSI1PK = :status'`) — directly reusable for STATUS#ENDING query
- `session-repository.ts`: `updateSessionStatus()` for atomic DynamoDB writes; `endedAt` and `transcriptStatus` fields already on `Session` domain model
- EventBridge Scheduler CDK construct at line 266 of `session-stack.ts`: `events.Schedule.rate(Duration.minutes(5))` — change to 15 min for this cron
- Powertools Logger pattern from Phase 25: module-scope `Logger` init + `appendPersistentKeys({ sessionId })`

### Established Patterns
- GSI1PK format: `STATUS#<STATE>#<TYPE>` (e.g., `STATUS#AVAILABLE#CHANNEL`, `STATUS#ENDING` for sessions)
- `transcriptStatus` enum on Session: `'pending' | 'processing' | 'available' | 'failed'`
- EventBridge Rules for Lambda targets in `session-stack.ts` (see IVS recording rule pattern)
- All new Lambda constructs include `logGroup` with `RetentionDays.ONE_MONTH` (Phase 25 decision)

### Integration Points
- `session-stack.ts`: add `NodejsFunction` for `scan-stuck-sessions.ts` + EventBridge Scheduler rule (rate 15 min)
- EventBridge default bus: new rule triggers `recording-ended.ts` handler on recovery event
- DynamoDB GSI1: query `STATUS#ENDING` partition with `endedAt` filter expression

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 26-stuck-session-recovery-cron*
*Context gathered: 2026-03-10*
