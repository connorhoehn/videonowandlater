---
phase: 25-pipeline-observability
plan: 02
subsystem: infra
tags: [cdk, cloudwatch, lambda, logs, retention]

# Dependency graph
requires:
  - phase: 25-pipeline-observability/25-01
    provides: Powertools Logger structured logging in 5 pipeline Lambda handlers
provides:
  - Explicit CDK log group with 30-day retention on RecordingEnded, TranscodeCompleted, TranscribeCompleted, StoreSummary, StartTranscribe Lambdas
affects: [26-stuck-session-recovery, 27-speaker-diarization, 28-chat-moderation]

# Tech tracking
tech-stack:
  added: []
  patterns: [CDK logGroup property on NodejsFunction constructs with RetentionDays.ONE_MONTH and RemovalPolicy.DESTROY]

key-files:
  created: []
  modified:
    - infra/lib/stacks/session-stack.ts

key-decisions:
  - "Used ONE_MONTH retention (same pattern as IvsEventAuditLogGroup but longer than its ONE_WEEK) — balances cost vs debuggability for pipeline handlers"
  - "Placed logGroup as last property in each NodejsFunction options object — consistent with existing IvsEventAudit pattern"
  - "StartTranscribe construct intentionally has no depsLockFilePath — left unchanged per plan spec"

patterns-established:
  - "Pipeline Lambda constructs: logGroup with RetentionDays.ONE_MONTH and RemovalPolicy.DESTROY"

requirements-completed: [PIPE-04]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 25 Plan 02: CDK Log Group Retention Summary

**Explicit CDK CloudWatch log groups with 30-day retention added to all 5 pipeline Lambda constructs, preventing unbounded log accumulation and eliminating log-loss race condition on new deployments**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T16:23:43Z
- **Completed:** 2026-03-10T16:25:31Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `logGroup` property with `RetentionDays.ONE_MONTH` and `RemovalPolicy.DESTROY` to RecordingEnded, TranscodeCompleted, TranscribeCompleted, StoreSummary, and StartTranscribe Lambda constructs
- CDK now creates log groups before first Lambda invocation — eliminates the log-loss race condition on fresh deployments
- Stack teardown will not fail due to retained log groups (RemovalPolicy.DESTROY ensures cleanup)
- TypeScript compilation passes with no errors
- IvsEventAuditLogGroup (ONE_WEEK) and StartTranscribe's absent depsLockFilePath both left untouched as required

## Task Commits

Each task was committed atomically:

1. **Task 1: Add logGroup retention to all 5 pipeline Lambda constructs** - `d01a27c` (feat)

## Files Created/Modified
- `infra/lib/stacks/session-stack.ts` - Added logGroup property to RecordingEnded, TranscodeCompleted, TranscribeCompleted, StoreSummary, StartTranscribe constructs

## Decisions Made
- Used `ONE_MONTH` retention consistent with pipeline observability needs — longer than `IvsEventAudit` (`ONE_WEEK`) because pipeline failures may take longer to detect and diagnose
- `RemovalPolicy.DESTROY` on all log groups ensures `cdk destroy` completes cleanly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. CDK changes will take effect on next `cdk deploy`.

## Next Phase Readiness
- Phase 25 plan 02 complete. All 5 pipeline Lambda constructs now have explicit log group retention.
- Phase 25 is now complete (plans 01 and 02 done): structured logging + log retention fully configured.
- Ready for Phase 26: Stuck Session Recovery.

---
*Phase: 25-pipeline-observability*
*Completed: 2026-03-10*
