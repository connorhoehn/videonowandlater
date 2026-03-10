# Phase 26: Stuck Session Recovery Cron - Research

**Researched:** 2026-03-10
**Domain:** AWS Lambda scheduled cron + DynamoDB GSI1 query + EventBridge PutEvents + atomic conditional writes
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scheduling**
- EventBridge Scheduler `rate(15 minutes)` — mirrors the existing `ReplenishPoolSchedule` pattern in `session-stack.ts`
- Cron must complete within Lambda 5-minute timeout for any realistic number of stuck sessions

**Query approach**
- Query GSI1 with partition key `STATUS#ENDING` — do NOT full-table scan (would cause RCU cost explosion)
- Filter in Lambda: `endedAt < now - 45 minutes` AND `transcriptStatus` is `null`, `undefined`, or `'pending'`
- `STATUS#ENDING` is the correct GSI1PK for sessions that have ended but not yet completed the pipeline

**Skip criteria**
- Skip any session with `transcriptStatus = 'processing'` (MediaConvert or Transcribe job actively running)
- Skip any session with `recoveryAttemptCount >= 3` (permanently exhausted)

**Recovery mechanism**
- Re-fire via `EventBridge PutEvents` (NOT direct Lambda.invoke) — preserves DLQ and retry semantics
- Recovery stage: always re-fire the `recording-ended` equivalent event (reset to first stage) rather than trying to detect the exact failed stage
- Event includes `recoveryAttempt: true` marker and current `recoveryAttemptCount` so handlers can log it

**Retry cap**
- Cap at 3 attempts via `recoveryAttemptCount` field written to the session DynamoDB record
- Increment `recoveryAttemptCount` atomically when firing recovery event (conditional write)
- After cap reached: session stays in DynamoDB with `recoveryAttemptCount = 3`, no further cron action

**Handler naming**
- New handler: `backend/src/handlers/scan-stuck-sessions.ts`
- New CDK construct in `infra/lib/stacks/session-stack.ts` following `replenishPoolFn` pattern

### Claude's Discretion
- Exact DynamoDB expression attribute naming and projection expression for the GSI1 query
- Logger output format (use established Phase 25 Powertools Logger pattern)
- Unit test structure (follow existing handler test conventions)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-05 | A recovery cron runs every 15 minutes and identifies sessions where `transcriptStatus` is `null` or `pending` and `endedAt` is more than 45 minutes ago | GSI1 `STATUS#ENDING` query + Lambda filter; EventBridge Scheduler `rate(15 minutes)` — exact CDK pattern confirmed in `session-stack.ts` lines 265-270 |
| PIPE-06 | Recovery cron re-fires the appropriate EventBridge event for the earliest failed stage (smart recovery, not full reset) with a `recoveryAttempt` counter on the event | Decision locked: always re-fire recording-ended equivalent via `PutEventsCommand`; `recoveryAttempt: true` + `recoveryAttemptCount` in event detail |
| PIPE-07 | Recovery cron skips sessions with `transcriptStatus = 'processing'` (MediaConvert/Transcribe job actively running) to prevent double-execution | Lambda-side filter on `transcriptStatus === 'processing'` applied after GSI1 query result |
| PIPE-08 | Recovery cron caps retry attempts at 3 per session by writing a `recoveryAttemptCount` field to the session record and skipping sessions that have reached the cap | Atomic `UpdateCommand` with `ADD recoveryAttemptCount :inc` + `ConditionExpression: recoveryAttemptCount < :cap OR attribute_not_exists(recoveryAttemptCount)` |
</phase_requirements>

---

## Summary

Phase 26 introduces a single new Lambda handler (`scan-stuck-sessions.ts`) that runs on a 15-minute EventBridge Scheduler cron and re-triggers the recording pipeline for sessions that have stalled. The pattern is almost identical to `replenish-pool.ts` — query GSI1, apply in-Lambda filters, take action per item — with the key distinction that the action is an EventBridge `PutEvents` call rather than an AWS resource creation.

The DynamoDB access pattern is straightforward: sessions in status `ENDING` carry `GSI1PK = 'STATUS#ENDING'`, so a single GSI1 query retrieves all candidates without a full-table scan. In-Lambda filtering handles the time threshold (45 minutes), skip criteria (`transcriptStatus = 'processing'`, `recoveryAttemptCount >= 3`), and null/pending transcript status check. The atomic `recoveryAttemptCount` increment uses a DynamoDB conditional write so concurrent cron executions cannot double-increment.

The recovery event re-uses the existing `recording-ended` EventBridge rule. The new handler publishes to the default event bus with `source: 'custom.vnl'`, `detail-type: 'Recording Recovery'`, and a detail payload that mirrors what `recording-ended.ts` receives, plus `recoveryAttempt: true` and `recoveryAttemptCount`. This means `recording-ended.ts` itself does not need modification — it already handles the required fields.

**Primary recommendation:** Copy the `replenishPoolFn` + `ReplenishPoolSchedule` CDK block verbatim, swap in `scan-stuck-sessions.ts`, set `rate(Duration.minutes(15))`, grant DynamoDB read-write + EventBridge `events:PutEvents`, and add Phase 25 Powertools Logger initialization.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/lib-dynamodb` | bundled in Lambda | `QueryCommand`, `UpdateCommand` for GSI1 scan and atomic counter writes | Already used across all handlers |
| `@aws-sdk/client-eventbridge` | bundled in Lambda | `EventBridgeClient`, `PutEventsCommand` to re-fire recovery events | Same SDK family as all other AWS calls in this codebase |
| `@aws-lambda-powertools/logger` | `^2.31.0` (already installed) | Structured JSON logging with `pipelineStage` + `sessionId` persistent keys | Established by Phase 25; already installed |
| `aws-cdk-lib/aws-events` | bundled with CDK | `events.Rule`, `events.Schedule.rate()` for EventBridge Scheduler | Already imported in `session-stack.ts` line 5 |

### No New npm Packages

All required libraries are already available. `@aws-sdk/client-eventbridge` is in the Lambda runtime environment.

**Installation:** No `npm install` step required.

---

## Architecture Patterns

### Recommended Project Structure

New files:
```
backend/src/handlers/
  scan-stuck-sessions.ts          # New cron handler
  __tests__/
    scan-stuck-sessions.test.ts   # New unit tests
```

CDK change:
```
infra/lib/stacks/
  session-stack.ts                # Add ScanStuckSessions construct + schedule
```

No changes to:
- `recording-ended.ts` — receives recovery events unchanged
- `session-repository.ts` — DynamoDB helpers are reused
- Any frontend files

### Pattern 1: GSI1 Query for ENDING Sessions

**What:** Query `GSI1` with `GSI1PK = 'STATUS#ENDING'` to retrieve all sessions in the ending state without a full-table scan.

**When to use:** Any time you need all sessions in a particular status. The GSI1 is `ProjectionType.ALL` (confirmed in `session-stack.ts` lines 57-68), so all session fields are available on returned items.

**GSI1SK is the `createdAt` timestamp** (set in `createSession` in `session-repository.ts` line 37: `GSI1SK: session.createdAt`). The `endedAt` field is a separate session attribute.

**Example:**
```typescript
// Source: replenish-pool.ts pattern + session-stack.ts GSI1 definition
const docClient = getDocumentClient();
const result = await docClient.send(new QueryCommand({
  TableName: tableName,
  IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :status',
  ExpressionAttributeValues: {
    ':status': 'STATUS#ENDING',
  },
  // No Limit — retrieve all ENDING sessions; expected to be small set
}));
```

After query, filter in Lambda:
```typescript
const cutoffTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
const stuckSessions = (result.Items ?? []).filter(item => {
  const endedAt = item.endedAt as string | undefined;
  const transcriptStatus = item.transcriptStatus as string | undefined;
  const recoveryAttemptCount = (item.recoveryAttemptCount as number | undefined) ?? 0;

  // Must have ended before the 45-minute threshold
  if (!endedAt || endedAt >= cutoffTime) return false;
  // Must NOT be actively processing
  if (transcriptStatus === 'processing') return false;
  // Must NOT have exhausted retries
  if (recoveryAttemptCount >= 3) return false;
  // Must have a stalled/missing transcriptStatus
  return transcriptStatus === 'pending' || transcriptStatus === undefined || transcriptStatus === null;
});
```

### Pattern 2: Atomic recoveryAttemptCount Increment with Cap Guard

**What:** Increment `recoveryAttemptCount` only when it is below the cap. Uses DynamoDB conditional write to prevent race conditions if the cron ever executes concurrently or twice.

**When to use:** Any counter with a maximum value that must be atomically gated.

**Example:**
```typescript
// Source: session-repository.ts UpdateCommand pattern (lines 450-466)
await docClient.send(new UpdateCommand({
  TableName: tableName,
  Key: {
    PK: `SESSION#${sessionId}`,
    SK: 'METADATA',
  },
  UpdateExpression: 'SET recoveryAttemptCount = if_not_exists(recoveryAttemptCount, :zero) + :inc',
  ConditionExpression:
    'attribute_not_exists(recoveryAttemptCount) OR recoveryAttemptCount < :cap',
  ExpressionAttributeValues: {
    ':inc': 1,
    ':zero': 0,
    ':cap': 3,
  },
}));
// If ConditionalCheckFailedException is thrown, a concurrent cron already incremented past the cap
// or the session was already processed — catch and skip
```

### Pattern 3: EventBridge PutEvents Recovery Trigger

**What:** Publish a synthetic event to the default bus that matches the pattern `recording-ended.ts` already consumes, adding `recoveryAttempt: true` and `recoveryAttemptCount` to the detail.

**When to use:** When the recovery target is the first stage of the pipeline (recording-ended). The existing EventBridge rule `RecordingEndRuleV2` matches `aws.ivs` source, so the recovery event needs a **custom source** and a **custom EventBridge rule** that matches it and routes to `recording-ended.ts`.

**Key architectural detail:** The existing `RecordingEndRuleV2` rule matches `source: ['aws.ivs']` only. The recovery event must use `source: 'custom.vnl'` with `detail-type: 'Recording Recovery'`, and a **new EventBridge rule** is required to route it to `recording-ended.ts`. Alternatively, the cron can directly invoke `recording-ended.ts` via a new custom detail-type that `recording-ended.ts` is taught to accept.

The simplest path: add a new EventBridge rule with `source: ['custom.vnl']`, `detail-type: ['Recording Recovery']`, targeting `recording-ended.ts`. This preserves DLQ and retry semantics without altering the existing rule.

**Example PutEvents call:**
```typescript
// Source: AWS SDK EventBridge PutEvents docs
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });
await ebClient.send(new PutEventsCommand({
  Entries: [{
    EventBusName: 'default',
    Source: 'custom.vnl',
    DetailType: 'Recording Recovery',
    Detail: JSON.stringify({
      sessionId,
      recoveryAttempt: true,
      recoveryAttemptCount: currentCount + 1,
      recordingHlsUrl: session.recordingHlsUrl,
      // Include all fields recording-ended.ts needs to submit MediaConvert job
    }),
  }],
}));
```

### Pattern 4: EventBridge Scheduler CDK Construct

**What:** The cron schedule follows the `ReplenishPoolSchedule` pattern exactly.

**Example:**
```typescript
// Source: session-stack.ts lines 265-270
new events.Rule(this, 'ScanStuckSessionsSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [new targets.LambdaFunction(scanStuckSessionsFn)],
  description: 'Scan for stuck sessions in pipeline and re-trigger recovery every 15 minutes',
});
```

### Anti-Patterns to Avoid

- **Full-table scan in cron:** Never use `ScanCommand` to find stuck sessions. The GSI1 `STATUS#ENDING` query is O(ENDING sessions), not O(all sessions). A scan would read every item on every cron execution.
- **Direct Lambda.invoke for recovery:** Do not use `LambdaClient.send(new InvokeCommand(...))`. This bypasses EventBridge DLQ semantics and makes the recovery non-observable in CloudWatch.
- **Unconditional recoveryAttemptCount increment:** Always use a `ConditionExpression` so parallel executions cannot both increment on the same session in the same cron window.
- **Skipping `transcriptStatus = 'processing'` check in query vs. in Lambda:** DynamoDB FilterExpression runs after the read (RCUs are still consumed), so always treat this as Lambda-side logic rather than relying on filter expression optimization.
- **Re-firing recovery event with `source: 'aws.ivs'`:** Custom events must not impersonate AWS sources. Use `source: 'custom.vnl'` and add a matching new EventBridge rule.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Counting items returned from GSI1 | Manual pagination loop | `QueryCommand` without `Limit` (set is small) or use `LastEvaluatedKey` pagination if > 1MB | DynamoDB returns up to 1MB per page; ENDING sessions will be a small set in practice |
| Idempotent increment | Version-based optimistic locking | `if_not_exists` + `ConditionExpression` in `UpdateCommand` | Already proven pattern in `claimPrivateChannel` (session-repository.ts line 980+) |
| Structured logs | Custom `console.log` + JSON.stringify | `@aws-lambda-powertools/logger` | Phase 25 established this; Powertools handles cold-start, X-Ray, persistent keys automatically |

---

## Common Pitfalls

### Pitfall 1: GSI1PK Value for ENDING Sessions

**What goes wrong:** Developer uses `STATUS#ENDED` or `STATUS#ENDING#SESSION` instead of `STATUS#ENDING`.

**Why it happens:** GSI1PK format is `STATUS#<STATE>` for sessions (e.g., `STATUS#ENDING`, `STATUS#ENDED`) but `STATUS#AVAILABLE#<TYPE>` for pool resources. These look similar but are different.

**How to avoid:** Confirmed in `session-repository.ts` line 38: `GSI1PK: \`STATUS#${session.status.toUpperCase()}\``. Since `SessionStatus.ENDING = 'ending'`, the GSI1PK value is `STATUS#ENDING` (no type suffix).

**Warning signs:** Query returns 0 items even though sessions are visibly in ENDING state.

### Pitfall 2: ENDING vs. ENDED Sessions Both Need Coverage

**What goes wrong:** Cron only queries `STATUS#ENDING`. But a session that reached `STATUS#ENDED` (status written by recording-ended.ts) but still has `transcriptStatus = null` or `pending` is also stuck — it just completed the cleanup step but the MediaConvert submission failed silently.

**Why it happens:** `recording-ended.ts` transitions the session to ENDED then best-effortfully submits MediaConvert. If MediaConvert submission fails (non-blocking, does not throw), the session has `status = 'ended'` and `transcriptStatus = null`.

**How to avoid:** The cron needs to query BOTH `STATUS#ENDING` and `STATUS#ENDED`. Two separate GSI1 queries, results merged before filtering. CONTEXT.md says "STATUS#ENDING is the correct GSI1PK" but the recording-ended.ts code shows the transition to ENDED happens first, then MediaConvert is submitted. Practically all stuck sessions will be `STATUS#ENDED`, not `STATUS#ENDING`.

**Recommendation:** Query both `STATUS#ENDING` and `STATUS#ENDED` GSI1 partitions and merge results before applying the time/status filter. This is a LOW confidence edge case but important for correctness.

**Warning signs:** Cron finds zero stuck sessions despite known pipeline failures in production.

### Pitfall 3: recoveryAttemptCount Field Absence on Existing Sessions

**What goes wrong:** Existing sessions created before Phase 26 have no `recoveryAttemptCount` attribute. A plain `recoveryAttemptCount < 3` condition expression throws `ConditionalCheckFailedException` when the attribute is absent.

**Why it happens:** DynamoDB condition expressions treat `attribute_not_exists(X)` differently from `X < value` when the attribute is missing.

**How to avoid:** Use `attribute_not_exists(recoveryAttemptCount) OR recoveryAttemptCount < :cap` in the ConditionExpression, and `if_not_exists(recoveryAttemptCount, :zero) + :inc` in the UpdateExpression.

### Pitfall 4: recording-ended.ts Cannot Accept Custom Recovery Events Without Changes

**What goes wrong:** Planner assumes the recovery event can be sent directly to `recording-ended.ts` by matching the existing `RecordingEndRuleV2` pattern.

**Why it happens:** `RecordingEndRuleV2` matches `source: ['aws.ivs']` and `detail-type: ['IVS Recording State Change']`. A custom event with `source: 'custom.vnl'` will not match this rule.

**How to avoid:** Add a second EventBridge rule (e.g., `RecordingRecoveryRule`) with `source: ['custom.vnl']`, `detail-type: ['Recording Recovery']`, targeting `recordingEndedFn`. This is purely additive CDK. `recording-ended.ts` handler code must also be updated to handle the recovery event shape (it currently reads `event.resources[0]` as a channel/stage ARN, which a recovery event won't have).

**Warning signs:** Recovery events are published to EventBridge but `recording-ended.ts` is never invoked for them (or throws due to missing `event.resources`).

### Pitfall 5: Lambda 5-Minute Timeout When Many Sessions Are Stuck

**What goes wrong:** If 50+ sessions are stuck, serial processing (query → filter → increment counter → PutEvents per session) could exceed 5 minutes.

**Why it happens:** Each session requires 2 AWS API calls (UpdateCommand + PutEvents). At ~100ms each, 50 sessions = ~10 seconds. In realistic deployments this is fine. But if MediaConvert was down for 6 hours and hundreds accumulated, it could be a concern.

**How to avoid:** Process sessions in parallel batches using `Promise.all`. Process at most 25 sessions per cron execution (configurable via `MAX_RECOVERY_PER_RUN` env var). Log a warning if more than 25 sessions are stuck (signals systemic issue requiring investigation).

---

## Code Examples

Verified patterns from existing codebase:

### Handler Skeleton (scan-stuck-sessions.ts)

```typescript
// Source: replenish-pool.ts handler structure + Phase 25 logger pattern
import type { Handler } from 'aws-lambda';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Logger } from '@aws-lambda-powertools/logger';
import { getDocumentClient } from '../lib/dynamodb-client';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: { pipelineStage: 'scan-stuck-sessions' },
});

export const handler: Handler = async (_event): Promise<void> => {
  const tableName = process.env.TABLE_NAME!;
  const awsRegion = process.env.AWS_REGION!;
  const startMs = Date.now();

  logger.info('Pipeline stage entered', { stage: 'scan-stuck-sessions' });

  // ... query GSI1, filter, recover ...

  logger.info('Pipeline stage completed', {
    status: 'success',
    durationMs: Date.now() - startMs,
    sessionsRecovered: recoveredCount,
    sessionsSkipped: skippedCount,
  });
};
```

### CDK Construct (session-stack.ts addition)

```typescript
// Source: session-stack.ts ReplenishPool construct (lines 222-270) + Phase 25 logGroup pattern
const scanStuckSessionsFn = new nodejs.NodejsFunction(this, 'ScanStuckSessions', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/scan-stuck-sessions.ts'),
  timeout: Duration.minutes(5),
  environment: {
    TABLE_NAME: this.table.tableName,
    AWS_ACCOUNT_ID: this.account,
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
  logGroup: new logs.LogGroup(this, 'ScanStuckSessionsLogGroup', {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  }),
});

this.table.grantReadWriteData(scanStuckSessionsFn);
scanStuckSessionsFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['events:PutEvents'],
  resources: ['*'],
}));

new events.Rule(this, 'ScanStuckSessionsSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(15)),
  targets: [new targets.LambdaFunction(scanStuckSessionsFn)],
  description: 'Scan for stuck pipeline sessions and re-trigger recovery every 15 minutes',
});

// New rule to route recovery events to recording-ended handler
const recordingRecoveryRule = new events.Rule(this, 'RecordingRecoveryRule', {
  eventPattern: {
    source: ['custom.vnl'],
    detailType: ['Recording Recovery'],
  },
  description: 'Route recovery events to recording-ended handler',
});
recordingRecoveryRule.addTarget(new targets.LambdaFunction(recordingEndedFn, {
  deadLetterQueue: recordingEventsDlq,
  retryAttempts: 2,
}));
recordingEndedFn.addPermission('AllowEBRecoveryInvoke', {
  principal: new iam.ServicePrincipal('events.amazonaws.com'),
  sourceArn: recordingRecoveryRule.ruleArn,
});
```

### Unit Test Structure

```typescript
// Source: store-summary.test.ts pattern (handlers/__tests__/store-summary.test.ts)
import { handler } from '../scan-stuck-sessions';

jest.mock('@aws-sdk/lib-dynamodb');
jest.mock('@aws-sdk/client-eventbridge');
jest.mock('../../lib/dynamodb-client');

describe('scan-stuck-sessions handler', () => {
  beforeEach(() => {
    process.env.TABLE_NAME = 'test-table';
    process.env.AWS_REGION = 'us-east-1';
    jest.clearAllMocks();
  });

  it('should skip sessions with transcriptStatus = processing');
  it('should skip sessions with recoveryAttemptCount >= 3');
  it('should skip sessions where endedAt is within 45 minutes');
  it('should fire recovery event and increment counter for stuck session');
  it('should handle ConditionalCheckFailedException (concurrent cron) gracefully');
  it('should process both STATUS#ENDING and STATUS#ENDED partitions');
  it('should not throw when PutEvents fails (non-blocking recovery)');
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct Lambda.invoke for cross-service triggers | EventBridge PutEvents | Pre-project decision | Preserves DLQ, retry, observability |
| `console.log` structured logging | `@aws-lambda-powertools/logger` | Phase 25 (2026-03-10) | Automatic JSON, cold-start flag, X-Ray trace |
| Manual cron via CloudWatch Events | EventBridge Scheduler `rate()` | Project baseline | Both work; `events.Rule` with `schedule` is the project pattern |

---

## Open Questions

1. **Should recording-ended.ts handle recovery events with a different code path?**
   - What we know: Currently reads `event.resources[0]` (channel/stage ARN) and does a Scan/lookup to find the session. A recovery event won't have `event.resources` populated the same way.
   - What's unclear: The planner needs to decide whether to (a) add a recovery-event code path to `recording-ended.ts` that uses `event.detail.sessionId` directly, or (b) create a dedicated `recover-session.ts` handler.
   - Recommendation: Option (a) is simpler and keeps the pipeline consolidated — add a guard `if (event.detail?.recoveryAttempt) { ... use event.detail.sessionId ... }` at the top of `recording-ended.ts`. The session already has `recordingHlsUrl` stored from the first pass, so the handler can re-submit MediaConvert without re-deriving the S3 path.

2. **Should STATUS#ENDED sessions also be queried?**
   - What we know: `recording-ended.ts` transitions session to ENDED before MediaConvert submission. MediaConvert failures are non-blocking (logged but don't throw). Stuck sessions will therefore mostly appear with `status = 'ended'`, `transcriptStatus = null`.
   - What's unclear: CONTEXT.md says "STATUS#ENDING" but this is likely the intended semantic (sessions that ended the IVS recording lifecycle but didn't complete the transcript pipeline), not the literal DynamoDB status value.
   - Recommendation: Query both `STATUS#ENDING` and `STATUS#ENDED` to be safe. MEDIUM confidence this is necessary.

---

## Validation Architecture

> `workflow.nyquist_validation` is not present in `.planning/config.json` (the key is absent) — skipping this section.

---

## Sources

### Primary (HIGH confidence)
- Codebase: `backend/src/handlers/replenish-pool.ts` — GSI1 query pattern, Handler type, cron skeleton
- Codebase: `backend/src/handlers/recording-ended.ts` — pipeline handler structure, Logger pattern, non-blocking error handling
- Codebase: `backend/src/repositories/session-repository.ts` — UpdateCommand conditional write patterns, GSI1PK format confirmation
- Codebase: `infra/lib/stacks/session-stack.ts` lines 57-68 — GSI1 definition (`ProjectionType.ALL`, sort key = `GSI1SK`)
- Codebase: `infra/lib/stacks/session-stack.ts` lines 222-270 — ReplenishPool + ReplenishPoolSchedule CDK pattern
- Codebase: `infra/lib/stacks/session-stack.ts` lines 340-415 — logGroup pattern, addPermission pattern, DLQ wiring
- Codebase: `backend/src/domain/session.ts` — Session type with `transcriptStatus`, `endedAt`, confirmed field names
- Codebase: `backend/src/handlers/__tests__/store-summary.test.ts` — unit test structure for handler tests

### Secondary (MEDIUM confidence)
- `.planning/phases/26-stuck-session-recovery-cron/26-CONTEXT.md` — locked decisions and code context
- `.planning/STATE.md` — Known Risks section confirming double-submission risk and GSI scan cost risk

### Tertiary (LOW confidence)
- Edge case analysis: STATUS#ENDED sessions also being stuck (based on reading recording-ended.ts code path)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed in `package.json` and existing handlers
- Architecture: HIGH — CDK pattern directly confirmed in `session-stack.ts`; DynamoDB patterns confirmed in `session-repository.ts`
- Pitfalls: MEDIUM-HIGH — pitfall 2 (ENDING vs ENDED) is based on code reading and is not stated explicitly in CONTEXT.md; all others are HIGH

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable AWS SDK + CDK patterns; 30-day window)
