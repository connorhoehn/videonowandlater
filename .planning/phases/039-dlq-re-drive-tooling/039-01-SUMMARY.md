---
phase: 039-dlq-re-drive-tooling
plan: 01
subsystem: cli
tags: [sqs, dlq, cli, aws-sdk, commander]

requires:
  - phase: 038-idempotency-gap-coverage
    provides: "Idempotency guards on pipeline handlers — re-driven messages are safely deduplicated"
provides:
  - "dlq-list: peek at DLQ messages with decoded sessionId and ReceiptHandle"
  - "dlq-redrive: async message move from DLQ back to source queue with pre-check"
  - "dlq-purge: delete single DLQ message by ReceiptHandle"
  - "dlq-health: report approximate message counts for all 5 pipeline DLQs"
affects: [pipeline-operations, incident-response]

tech-stack:
  added: ["@aws-sdk/client-sqs ^3.1003.0"]
  patterns: ["partial jest.mock with requireActual for AWS SDK command classes"]

key-files:
  created:
    - backend/src/cli/commands/dlq-list.ts
    - backend/src/cli/commands/dlq-redrive.ts
    - backend/src/cli/commands/dlq-purge.ts
    - backend/src/cli/commands/dlq-health.ts
    - backend/src/cli/__tests__/dlq-list.test.ts
    - backend/src/cli/__tests__/dlq-redrive.test.ts
    - backend/src/cli/__tests__/dlq-purge.test.ts
    - backend/src/cli/__tests__/dlq-health.test.ts
  modified:
    - backend/src/cli/index.ts
    - backend/src/cli/__tests__/cli-integration.test.ts
    - backend/package.json

key-decisions:
  - "Use partial jest.mock with requireActual to preserve real Command class constructors while mocking SQSClient"
  - "VisibilityTimeout=0 on dlq-list to peek without consuming messages"
  - "Hardcoded 5 DLQ names in dlq-health rather than dynamic discovery"

patterns-established:
  - "Partial AWS SDK mock pattern: jest.mock with requireActual for command classes + mockImplementation for client"

requirements-completed: [DLQ-01, DLQ-02, DLQ-03, DLQ-04]

duration: 5min
completed: 2026-03-14
---

# Phase 39 Plan 01: DLQ Re-drive Tooling Summary

**4 CLI commands (dlq-list, dlq-redrive, dlq-purge, dlq-health) for inspecting and managing pipeline dead-letter queues via vnl-cli**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T17:10:02Z
- **Completed:** 2026-03-14T17:15:30Z
- **Tasks:** 4
- **Files modified:** 11

## Accomplishments
- Full DLQ management CLI toolkit: list, redrive, purge, and health commands
- 13 tests across 4 test files covering happy paths, error cases, and edge cases
- All 496 backend tests passing (445 existing + 51 new across recent phases)
- @aws-sdk/client-sqs added as project dependency

## Task Commits

Each task was committed atomically:

1. **Task 1: Write test contracts for all 4 DLQ commands** - `763be96` (test)
2. **Task 2: Implement dlq-list and dlq-purge commands** - `aa6a083` (feat)
3. **Task 3: Implement dlq-redrive and dlq-health commands** - `47cec4c` (feat)
4. **Task 4: Register DLQ commands in CLI index** - `1038f62` (feat)

## Files Created/Modified
- `backend/src/cli/commands/dlq-list.ts` - List DLQ messages with decoded sessionId and ReceiptHandle
- `backend/src/cli/commands/dlq-redrive.ts` - Async re-drive from DLQ to source queue with active-task pre-check
- `backend/src/cli/commands/dlq-purge.ts` - Delete single message by ReceiptHandle
- `backend/src/cli/commands/dlq-health.ts` - Report message counts for all 5 pipeline DLQs
- `backend/src/cli/__tests__/dlq-list.test.ts` - 4 tests: decode sessionId, batch params, empty queue, malformed JSON
- `backend/src/cli/__tests__/dlq-redrive.test.ts` - 3 tests: pre-check, start task, active task error
- `backend/src/cli/__tests__/dlq-purge.test.ts` - 2 tests: delete message, invalid handle error
- `backend/src/cli/__tests__/dlq-health.test.ts` - 4 tests: queue URL calls, attributes, aggregation, error handling
- `backend/src/cli/index.ts` - Register 4 new DLQ commands
- `backend/src/cli/__tests__/cli-integration.test.ts` - Updated command count from 6 to 10
- `backend/package.json` - Added @aws-sdk/client-sqs dependency

## Decisions Made
- Used partial jest.mock pattern (requireActual) to preserve real AWS SDK Command constructors while mocking SQSClient — full auto-mock prevents `.input` access on command instances
- VisibilityTimeout=0 on dlq-list ReceiveMessage to peek without consuming messages
- Hardcoded 5 DLQ names in dlq-health for simplicity (matches known infrastructure)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed jest.mock pattern for @aws-sdk/client-sqs**
- **Found during:** Task 2 (dlq-list and dlq-purge implementation)
- **Issue:** Full `jest.mock('@aws-sdk/client-sqs')` auto-mocks Command constructors, making `.input` undefined in test assertions
- **Fix:** Switched to partial mock with `jest.requireActual` to preserve real Command classes
- **Files modified:** All 4 test files
- **Verification:** All 13 tests pass with correct `.input` assertions
- **Committed in:** aa6a083 (Task 2 commit)

**2. [Rule 1 - Bug] Updated CLI integration test command count**
- **Found during:** Task 4 (CLI index registration)
- **Issue:** Existing `cli-integration.test.ts` hardcoded expected command count as 6
- **Fix:** Updated to 10 (6 existing + 4 new DLQ commands)
- **Files modified:** backend/src/cli/__tests__/cli-integration.test.ts
- **Verification:** Full test suite passes (496/496)
- **Committed in:** 1038f62 (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- DLQ CLI toolkit complete, ready for operational use
- Commands follow existing vnl-cli patterns
- Example usage:
  - `vnl-cli dlq-health` - Check all 5 DLQs for stuck messages
  - `vnl-cli dlq-list <queue-url>` - Inspect messages with sessionId context
  - `vnl-cli dlq-redrive <dlq-arn>` - Re-drive messages after root cause fix
  - `vnl-cli dlq-purge <queue-url> <receipt-handle>` - Remove investigated message

---
*Phase: 039-dlq-re-drive-tooling*
*Completed: 2026-03-14*
