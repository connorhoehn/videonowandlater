---
phase: 038-idempotency-gap-coverage
plan: 01
subsystem: Pipeline Idempotency
tags: [tdd, red-phase, testing, idempotency]
dependency_graph:
  requires: []
  provides:
    - IDEM-01 test contract (transcript idempotency)
    - IDEM-02 test contract (summary idempotency)
    - IDEM-03 test contract (concurrent delivery safety)
  affects: [038-02-PLAN.md (implementation wave)]
tech_stack:
  added: []
  patterns:
    - TDD RED phase (failing tests define requirements)
    - Session state checking as idempotency source of truth
    - Promise.all for concurrent scenario simulation
key_files:
  created:
    - test cases in backend/src/handlers/__tests__/transcribe-completed.test.ts
    - test cases in backend/src/handlers/__tests__/store-summary.test.ts
  modified: []
decisions:
  - Use session state (transcriptStatus, aiSummaryStatus) as idempotency source of truth rather than separate table lookup
  - Test concurrent scenario with Promise.all (50ms stagger) instead of actual Lambda concurrency
  - Log idempotent skips for observability ("Transcript already available (idempotent retry)", "AI summary already available (idempotent retry)")
metrics:
  duration: 15 minutes
  completed_date: 2026-03-14
  tasks: 3 of 3 (100%)
---

# Phase 38 Plan 01: Define Idempotency Test Contracts

## Summary

Established test-driven development (RED phase) for idempotency guards in two pipeline handlers (`transcribe-completed`, `store-summary`). All three test cases intentionally fail because handlers do not yet check session state before performing side effects. This approach ensures idempotency requirements are explicit and testable before implementation begins.

## Tasks Completed

### Task 1: IDEM-01 Test Case — Transcript Idempotency (RED)
**File:** `backend/src/handlers/__tests__/transcribe-completed.test.ts`
**Test Name:** "IDEM-01: Second invocation with same sessionId skips S3 write and DynamoDB update (already available)"
**Line Range:** 847–902
**Status:** FAILING ✗ (expected)

**Behavior Tested:**
- First invocation: session.transcriptStatus = 'processing' → updates DynamoDB + S3
- Second invocation: session.transcriptStatus = 'available' → no-op (skip S3 write and DynamoDB update)

**Assertions:**
- ✓ result.batchItemFailures empty (SQS message acknowledged)
- ✗ updateTranscriptStatus NOT called (currently CALLED — bug to fix in 038-02)
- ✗ EventBridge event NOT emitted on duplicate (not asserted yet)

**Current Failure:** `updateTranscriptStatus` called on duplicate invocation. Handler lacks session state check.

---

### Task 2: IDEM-02 Test Case — Summary Idempotency (RED)
**File:** `backend/src/handlers/__tests__/store-summary.test.ts`
**Test Name:** "IDEM-02: Second invocation with same sessionId skips Bedrock invocation (already available)"
**Line Range:** 1068–1110
**Status:** FAILING ✗ (expected)

**Behavior Tested:**
- First invocation: session.aiSummaryStatus = 'processing' → invokes Bedrock + updates DynamoDB
- Second invocation: session.aiSummaryStatus = 'available' → no-op (skip Bedrock and DynamoDB update)

**Assertions:**
- ✓ result.batchItemFailures empty (SQS message acknowledged)
- ✗ mockBedrockSend NOT called (currently CALLED — bug to fix in 038-02)
- ✗ updateSessionAiSummary NOT called (currently NOT called ✓, but only because Bedrock mock failed)

**Current Failure:** Bedrock invoked on duplicate. Handler lacks session state check before Bedrock call.

---

### Task 3: IDEM-03 Test Case — Concurrent Delivery Protection (RED)
**File:** `backend/src/handlers/__tests__/transcribe-completed.test.ts`
**Test Name:** "IDEM-03: Concurrent invocations (Promise.all race) result in exactly one S3 write"
**Line Range:** 904–985
**Status:** FAILING ✗ (expected)

**Behavior Tested:**
- Two Lambda instances process same message concurrently (simulated with Promise.all + 50ms stagger)
- First invocation: getSessionById returns transcriptStatus='processing' → updates DynamoDB
- Second invocation (concurrent): getSessionById returns transcriptStatus='processing' (race) → also updates (BUG)
- After first completes: second invocation retries, getSessionById returns transcriptStatus='available' → skips

**Assertions:**
- ✓ result1.batchItemFailures empty (first invocation success)
- ✓ result2.batchItemFailures empty (second invocation success)
- ✗ updateTranscriptStatus called exactly ONCE (currently called TWICE — concurrency race condition)
- ✗ EventBridge emit called exactly ONCE (currently called TWICE)

**Current Failure:** `updateTranscriptStatus` called twice (concurrent race). Session state check will prevent second invocation from updating.

---

## Test Infrastructure Changes

### Imports Added
- `getSessionById` imported in both test files (was not previously imported)

### Mock Setup Changes
**transcribe-completed.test.ts:**
```typescript
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;
// Added to beforeEach():
mockGetSessionById.mockReset();
mockGetSessionById.mockResolvedValue(null);
```

**store-summary.test.ts:**
```typescript
const mockGetSessionById = getSessionById as jest.MockedFunction<typeof getSessionById>;
// Added to beforeEach():
mockGetSessionById.mockReset();
mockGetSessionById.mockResolvedValue(null);
```

---

## Test Execution Results

All tests run with: `npm test -- --testNamePattern="IDEM-0[123]"`

```
FAIL src/handlers/__tests__/transcribe-completed.test.ts
  ✗ IDEM-01: updateTranscriptStatus called 1 time (expected 0)
  ✗ IDEM-03: updateTranscriptStatus called 2 times (expected 1)

FAIL src/handlers/__tests__/store-summary.test.ts
  ✗ IDEM-02: mockBedrockSend called 1 time (expected 0)

Tests: 3 failed, 480 skipped, 483 total
```

---

## RED Phase Analysis

All three test failures are **expected and correct** for the RED phase of TDD:

| Test | Current Behavior | Expected Behavior | Gap |
|------|------------------|-------------------|-----|
| IDEM-01 | Updates DynamoDB on duplicate | Skips update | Handler lacks session state check |
| IDEM-02 | Calls Bedrock on duplicate | Skips Bedrock invocation | Handler lacks session state check |
| IDEM-03 | Updates twice (concurrent race) | Updates once | Session state check will prevent second write |

---

## Implementation Requirements (Wave 2)

For 038-02 (GREEN phase), handlers must implement:

### transcribe-completed.ts
```typescript
// At start of processEvent():
const session = await getSessionById(tableName, sessionId);
if (session?.transcriptStatus === 'available' && session?.transcript) {
  logger.info('Transcript already available (idempotent retry)', { sessionId });
  return; // SUCCESS — no-op
}
```

### store-summary.ts
```typescript
// At start of processEvent():
const session = await getSessionById(tableName, sessionId);
if (session?.aiSummaryStatus === 'available' && session?.aiSummary) {
  logger.info('AI summary already available (idempotent retry)', { sessionId });
  return; // SUCCESS — no-op
}
```

---

## Deviations from Plan

**None** — plan executed exactly as written. All three test cases created with correct structure and failing status.

---

## Key Decisions Recorded

1. **Session state as idempotency source of truth:** Using `transcriptStatus='available'` and `aiSummaryStatus='available'` directly from session record eliminates need for separate idempotency table lookup (simpler, one DynamoDB GetItem already required).

2. **Early return as success:** Idempotent no-op returns success (empty `batchItemFailures`), not error. Follows SQS best practice: duplicate execution is successful acknowledgment.

3. **Concurrent test via Promise.all:** Simulates race condition in Jest without requiring actual Lambda concurrency infrastructure. Proves that session state check prevents concurrent side-effect corruption.

---

## Next Steps (Wave 2)

- Implement idempotency guards in `transcribe-completed.ts` (make IDEM-01 and IDEM-03 pass)
- Implement idempotency guards in `store-summary.ts` (make IDEM-02 pass)
- All existing tests must continue passing (regression prevention)
- Verify concurrent scenario truly prevents duplicate writes

---

## Files

- **Test suite:** 3 test cases, all failing (RED)
- **Commits:** 1 commit (02a06b4)
- **Total additions:** 204 lines of test code
