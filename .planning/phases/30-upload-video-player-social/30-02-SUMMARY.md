---
phase: 30-upload-video-player-social
plan: "02"
subsystem: infra
tags: [cdk, api-gateway, lambda, dynamodb, comments]

# Dependency graph
requires:
  - phase: 30-upload-video-player-social
    provides: create-comment.ts and get-comments.ts Lambda handlers built in 30-01
provides:
  - POST /sessions/{id}/comments route backed by CreateCommentHandler Lambda
  - GET /sessions/{id}/comments route backed by GetCommentsHandler Lambda
  - CDK constructs for both handlers with TABLE_NAME env var and DynamoDB permissions
affects: [30-upload-video-player-social, frontend-comments, cdk-deploy]

# Tech tracking
tech-stack:
  added: []
  patterns: [NodejsFunction construct with Cognito authorizer, grantReadData for read-only GET vs grantReadWriteData for POST]

key-files:
  created: []
  modified:
    - infra/lib/stacks/api-stack.ts

key-decisions:
  - "GetCommentsHandler uses grantReadData (read-only) — POST uses grantReadWriteData"
  - "commentsResource inserted between reactions block and join block following existing CDK pattern"

patterns-established:
  - "Sub-resources from sessionIdResource use addResource('name') before other sub-resources"

requirements-completed: [VIDP-06, VIDP-07]

# Metrics
duration: 5min
completed: 2026-03-11
---

# Phase 30 Plan 02: Upload Video Player Social — CDK Comment Routes Summary

**CDK NodejsFunction constructs for CreateCommentHandler and GetCommentsHandler wired to POST/GET /sessions/{id}/comments with Cognito auth**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-11T00:00:00Z
- **Completed:** 2026-03-11T00:05:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `commentsResource` sub-resource under `sessionIdResource` in api-stack.ts
- Wired POST /sessions/{id}/comments to CreateCommentHandler (ReadWrite DynamoDB)
- Wired GET /sessions/{id}/comments to GetCommentsHandler (ReadOnly DynamoDB)
- Both endpoints protected by existing Cognito authorizer
- infra TypeScript compiles with 0 errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add comment Lambda constructs and routes to api-stack.ts** - `e0e8e44` (feat)

## Files Created/Modified
- `infra/lib/stacks/api-stack.ts` - Added commentsResource, CreateCommentHandler, GetCommentsHandler constructs and API Gateway methods

## Decisions Made
- GetCommentsHandler uses `grantReadData` (not ReadWrite) since GET endpoint only reads comments — consistent with other read-only handlers in the stack

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Comment API routes are deployed via CDK on next `cdk deploy`
- Frontend CommentThread component (30-03) can call POST/GET /sessions/{id}/comments
- No blockers

---
*Phase: 30-upload-video-player-social*
*Completed: 2026-03-11*
