---
phase: 10-integration-wiring-fixes
plan: 02
subsystem: infra
tags: [cdk, eventbridge, ivs, lambda, deduplication]

# Dependency graph
requires:
  - phase: 05-recording-foundation
    provides: RecordingEndRuleV2 EventBridge rule created; recording-ended Lambda defined
provides:
  - Single EventBridge rule (RecordingEndRuleV2) targeting recording-ended Lambda
  - Legacy RecordingEndRule (recording_status filter) removed from session-stack.ts
affects: [recording-ended Lambda invocation frequency, DynamoDB version-conflict rate]

# Tech tracking
tech-stack:
  added: []
  patterns: [Single EventBridge rule per event type — no duplicate targets]

key-files:
  created: []
  modified:
    - infra/lib/stacks/session-stack.ts

key-decisions:
  - "Remove legacy RecordingEndRule entirely — backward compatibility comment was misleading; rule was causing harm via duplicate Lambda invocations"
  - "cdk deploy VNL-Session required in live AWS environment to apply rule deletion; CloudFormation will delete the EventBridge resource on next deploy"

patterns-established:
  - "Single rule per event type: each EventBridge rule should map to exactly one target Lambda to prevent race conditions in DynamoDB writes"

requirements-completed: [REPLAY-06, REPLAY-07, HANG-01]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Phase 10 Plan 02: Remove Legacy RecordingEndRule Summary

**Deleted legacy EventBridge rule `RecordingEndRule` (recording_status filter) from session-stack.ts, leaving only `RecordingEndRuleV2` (event_name filter) as the sole trigger for recording-ended Lambda — eliminates duplicate invocations and DynamoDB version-conflict errors**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T21:31:27Z
- **Completed:** 2026-03-03T21:32:57Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Removed 13-line legacy EventBridge rule block (`RecordingEndRule` with `recording_status` filter) from session-stack.ts
- Preserved `RecordingEndRuleV2` (assigned to `this.recordingEndRule`) with correct `event_name` filter
- Preserved `this.recordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn))` Lambda wiring
- CDK synthesizes without errors (`npx cdk synth VNL-Session` — no errors)
- `grep -c "RecordingEndRule"` returns 1 (only `RecordingEndRuleV2` string remains)
- `recording_status` field no longer present in file

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove legacy RecordingEndRule from session-stack.ts** - `5718509` (fix)

## Files Created/Modified
- `infra/lib/stacks/session-stack.ts` - Deleted legacy `RecordingEndRule` block (lines 291-302); `RecordingEndRuleV2` and addTarget wiring unchanged

## Decisions Made
- Remove legacy rule entirely rather than leaving a stub — backward compatibility comment was misleading since the rule was actively causing duplicate Lambda invocations and DynamoDB version conflicts
- `cdk deploy VNL-Session` is required in the live AWS environment to apply the CloudFormation change that deletes the `RecordingEndRule` EventBridge resource

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- CDK stack name in plan was `SessionStack` but actual stack name is `VNL-Session` — adjusted synth command accordingly. Synthesis succeeded with zero errors.

## User Setup Required

**Infrastructure deployment required.** To apply this change in the live AWS environment:

```bash
cdk deploy VNL-Session
```

This will cause CloudFormation to delete the `RecordingEndRule` EventBridge resource. The change is safe — no downtime, no Lambda code changes, no data loss. After deploy, recording-ended Lambda will be invoked exactly once per IVS Recording End event instead of twice.

## Next Phase Readiness
- Duplicate Lambda invocation bug resolved at infrastructure level
- DynamoDB version-conflict errors will cease after `cdk deploy VNL-Session` is run
- Phase 11 (Stage ARN detection) can proceed — recording-ended handler now receives single clean invocation per event

---
*Phase: 10-integration-wiring-fixes*
*Completed: 2026-03-03*
