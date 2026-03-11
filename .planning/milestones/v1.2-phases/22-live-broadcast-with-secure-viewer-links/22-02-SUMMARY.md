---
phase: 22-live-broadcast-with-secure-viewer-links
plan: 02
subsystem: auth
tags: [jwt, es384, ecdsa, ivs, playback-token, secure-links]

requires:
  - phase: 22-01
    provides: Private broadcast foundation (isPrivate field, private channel pool)

provides:
  - POST /sessions/{sessionId}/playback-token Lambda handler
  - ES384 JWT token generation for IVS playback authentication
  - Environment-based private key management (IVS_PLAYBACK_PRIVATE_KEY)
  - Comprehensive token validation and error handling

affects:
  - 22-03 (Activity feed private session filtering uses this context)
  - 22-04 (Frontend viewer link implementation)

tech-stack:
  added:
    - jsonwebtoken (v9.0.3) - JWT signing library
    - @types/jsonwebtoken (v9.0.0) - TypeScript types
  patterns:
    - ES384 asymmetric key JWT signing
    - Handler-level error handling with descriptive status codes
    - Environment-based secret management

key-files:
  created:
    - backend/src/handlers/generate-playback-token.ts
    - backend/src/handlers/__tests__/generate-playback-token.test.ts
  modified:
    - backend/package.json (added dependencies)

key-decisions:
  - "ES384 ECDSA algorithm for IVS-required JWT payload structure"
  - "24-hour default token expiration (86400 seconds)"
  - "Private key not logged; error messages only show generic 'Failed to generate token'"
  - "Playback URL fallback: fetch from pool METADATA if not on session"
  - "All origins allowed via aws:access-control-allow-origin: '*' (future: broadcaster-configurable)"

patterns-established:
  - "Handler validates session.isPrivate before token generation"
  - "JWT payload includes aws:channel-arn, aws:access-control-allow-origin, exp"
  - "Token appended as query parameter to playback URL"
  - "Proper error codes: 404 missing session, 400 public/invalid, 500 config/channel issues"

requirements-completed: []

metrics:
  duration: 15min
  started: 2026-03-06T01:35:24Z
  completed: 2026-03-06T01:50:24Z
  tasks: 2
  files_modified: 2
  tests_added: 8
  tests_total: 331
---

# Phase 22 Plan 02: Playback Token Generation Summary

**ES384-signed JWT token generation for private broadcast playback with comprehensive error handling and environment-based private key management**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-06T01:35:24Z
- **Completed:** 2026-03-06T01:50:24Z
- **Tasks:** 2 (both TDD)
- **Files created:** 2
- **Tests added:** 8
- **Total backend tests:** 331 passing

## Accomplishments

- Implemented POST /sessions/{sessionId}/playback-token Lambda handler with full ES384 JWT support
- Integrated jsonwebtoken library with ES384 asymmetric key signing
- Complete token validation: private sessions, channel ARN presence, private key availability
- Flexible token expiration: default 24 hours, configurable via request body
- Proper HTTP status codes for all error paths (404, 400, 500)
- Playback URL with token query parameter construction
- Comprehensive unit test coverage (8 tests covering all paths and error cases)
- All 331 backend tests passing (169 existing + 8 new)

## Task Commits

1. **Task 1 & 2 (Combined):** Implement generate-playback-token handler with ES384 JWT signing and comprehensive unit tests - `b4bc1a5`

## Files Created/Modified

- `backend/src/handlers/generate-playback-token.ts` - Lambda handler for token generation endpoint
- `backend/src/handlers/__tests__/generate-playback-token.test.ts` - 8 unit tests covering all error cases and token generation
- `backend/package.json` - Added jsonwebtoken and @types/jsonwebtoken dependencies

## Decisions Made

1. **ES384 Algorithm:** IVS requires ECDSA P-384 curve for asymmetric JWT signing. Other algorithms not supported.

2. **Private Key Storage:** Environment variable `IVS_PLAYBACK_PRIVATE_KEY` (bootstrapped by CDK in 22-03). Not stored in code, not logged on errors.

3. **Default Expiration:** 24 hours (86400 seconds) standard for long-lived playback links. Configurable via request body for future broadcaster-controlled TTL.

4. **Error Handling:** Private key absence returns 500 with generic message (never expose key details in logs).

5. **Playback URL Fallback:** If session.playbackUrl missing, query POOL#CHANNEL#{resourceId} for playback URL. Provides flexibility for implementation variations.

6. **Access Control:** Currently '*' (all origins). Future: per-broadcaster domain restriction via aws:access-control-allow-origin field.

## Deviations from Plan

None - plan executed exactly as written. Dependencies installed successfully, tests pass, all error cases handled.

## Issues Encountered

None - implementation straightforward. Valid ECDSA private key generated for test suite, all assertions passed on first test run.

## Next Phase Readiness

Handler is complete and tested. Ready for:
- Phase 22-03: Private session filtering in activity feed
- Phase 22-04: Frontend viewer link generation and validation

Private key environment variable wiring will be completed in CDK stack during 22-03.

---
*Phase: 22-live-broadcast-with-secure-viewer-links*
*Plan: 02*
*Completed: 2026-03-06*
