---
phase: 35-pipeline-debug-cli
plan: 01
subsystem: infra
tags: [aws-sdk-v3, dynamodb, eventbridge, cli, developer-tools, nodejs]

requires:
  - phase: 31-sqs-pipeline-buffers
    provides: SQS-buffered EventBridge routing for all 5 pipeline handlers

provides:
  - tools/debug-pipeline.js — prints all DynamoDB session pipeline fields in grouped sections
  - tools/replay-pipeline.js — publishes stage-specific EventBridge events for 4 pipeline stages
affects:
  - any future pipeline debugging, stuck-session diagnosis, or manual recovery

tech-stack:
  added: []
  patterns:
    - "Plain CJS node scripts in tools/ with shebang, DynamoDBDocumentClient, parseArgs() pattern"
    - "tools/*.js gitignore exception added alongside existing *.js exclusion rule"

key-files:
  created:
    - tools/debug-pipeline.js
    - tools/replay-pipeline.js
  modified:
    - .gitignore (added !tools/*.js exception)

key-decisions:
  - "Use tools/ (not scripts/) for developer CLI tools — new purpose-built directory separate from operational scripts"
  - "Add !tools/*.js negation to .gitignore — root *.js rule would otherwise exclude these files"
  - "Do NOT increment recoveryAttemptCount in replay tool — developer replays must not consume recovery slots"
  - "Hardcode transcription bucket as vnl-transcription-vnl-session (matches session-stack.ts literal) with no --bucket override needed per plan"

patterns-established:
  - "Pattern 1: tools/*.js CJS dev scripts — shebang, parseArgs(), DynamoDBDocumentClient.from(), no build step"
  - "Pattern 2: fmt(val) helper returning val ?? '(not set)' for clean pipeline field display"

requirements-completed: [DEVEX-01, DEVEX-02, DEVEX-03]

duration: 2min
completed: 2026-03-11
---

# Phase 35 Plan 01: Pipeline Debug CLI Summary

**Two standalone node CLI tools — debug-pipeline.js reads all DynamoDB session pipeline fields; replay-pipeline.js publishes stage-correct EventBridge events for all 4 pipeline stages without build step**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-11T21:36:09Z
- **Completed:** 2026-03-11T21:38:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created + .gitignore)

## Accomplishments

- Created `tools/debug-pipeline.js` — single DynamoDB GetCommand, prints Identity/Recording/Pipeline State/Upload Pipeline sections with fmt() helper ensuring all fields display
- Created `tools/replay-pipeline.js` — validates stage arg, fetches session, builds and publishes stage-specific EventBridge entry for recording-ended/mediaconvert/transcribe/summary
- Fixed `.gitignore` to add `!tools/*.js` negation so these CJS dev tools are tracked (root `*.js` rule would have silently excluded them)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tools/debug-pipeline.js** - `a4f4566` (feat) — includes .gitignore fix
2. **Task 2: Create tools/replay-pipeline.js** - `8969e0f` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `tools/debug-pipeline.js` — DynamoDB pipeline introspection CLI
- `tools/replay-pipeline.js` — EventBridge pipeline stage replay CLI
- `.gitignore` — added `!tools/*.js` exception

## Decisions Made

- Added `!tools/*.js` to `.gitignore` as Rule 3 auto-fix — root `*.js` rule excluded these files, making them impossible to commit without this negation
- Chose not to increment `recoveryAttemptCount` in replay tool per research recommendation: developer replays should not consume recovery slots
- `recordingS3Path` presence validated for recording-ended stage before publishing (would silently fail in handler)
- SQS latency note printed on success to set developer expectations (Phase 31 adds up to 20s delivery delay)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added !tools/*.js gitignore exception**
- **Found during:** Task 1 (debug-pipeline.js commit)
- **Issue:** Root `.gitignore` has `*.js` rule (TypeScript compilation artifacts); `git add tools/debug-pipeline.js` failed with "ignored by .gitignore"
- **Fix:** Added `!tools/*.js` negation line after `!backend/jest.config.js`
- **Files modified:** `.gitignore`
- **Verification:** `git add tools/debug-pipeline.js` succeeded; `git check-ignore` shows negation rule
- **Committed in:** a4f4566 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Required for files to be committed. No scope creep — only affects tools/ directory.

## Issues Encountered

None beyond the gitignore fix above.

## User Setup Required

None - no external service configuration required. Tools use AWS SDK default credential chain.

## Next Phase Readiness

- Both CLI tools are runnable immediately: `node tools/debug-pipeline.js --sessionId <id>` and `node tools/replay-pipeline.js --sessionId <id> --from <stage>`
- Requires AWS credentials configured (env vars, ~/.aws/credentials, or IAM role)
- Phase 35 complete — all DEVEX requirements satisfied

---
*Phase: 35-pipeline-debug-cli*
*Completed: 2026-03-11*
