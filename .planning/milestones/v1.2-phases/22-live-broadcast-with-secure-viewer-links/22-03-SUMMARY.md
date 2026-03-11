---
phase: 22-live-broadcast-with-secure-viewer-links
plan: 03
subsystem: Backend Infrastructure, Activity Feed, Private Channel Pool
tags:
  - private-sessions
  - activity-feed
  - channel-pool
  - jwt-infrastructure
dependency_graph:
  requires:
    - "22-01"
  provides:
    - "Private session filtering in activity feed endpoint"
    - "Private channel pool infrastructure"
    - "IVS_PLAYBACK_PRIVATE_KEY environment variable wiring"
  affects:
    - Activity feed visibility (GET /activity)
    - Private broadcast session creation
    - Channel pool replenishment
tech_stack:
  patterns:
    - "Private session filtering with user ownership check"
    - "Private channel pool with GSI1PK=STATUS#AVAILABLE#PRIVATE_CHANNEL"
    - "Backward compatible isPrivate field (undefined treated as false)"
  tools:
    - "TDD (RED-GREEN) for activity feed filtering"
    - "Replenish-pool handler for private channel creation"
  dependencies:
    - "@aws-sdk/lib-dynamodb"
    - "@aws-sdk/client-ivs"
key_files:
  created: []
  modified:
    - backend/src/handlers/list-activity.ts
    - backend/src/handlers/__tests__/list-activity.test.ts
    - backend/src/handlers/replenish-pool.ts
    - infra/lib/stacks/session-stack.ts
    - infra/lib/stacks/api-stack.ts
metrics:
  duration: "5 min"
  completed_date: "2026-03-06"
  test_count: 321
  tasks_completed: 3
---

# Phase 22 Plan 03: Activity Feed Private Session Filtering and Private Channel Infrastructure

## Summary

Implemented private session visibility filtering in the activity feed endpoint (GET /activity) and added infrastructure for private channel pool management with JWT playback authorization support. Private sessions are now hidden from unauthorized users and only visible to their owners, maintaining privacy control. The backend infrastructure is bootstrapped to support IVS playback token generation with the ES384 private key.

## Tasks Completed

### Task 1: Update GET /activity endpoint to filter private sessions by owner

**Status:** COMPLETE

Implemented private session filtering logic in the activity feed handler with comprehensive test coverage:

- **Handler Logic:** Extract userId from Cognito token claims (`cognito:username`)
- **Filter Behavior:**
  - Public sessions (isPrivate=false or undefined) visible to all users (authenticated and unauthenticated)
  - Private sessions (isPrivate=true) only visible to their owner (userId === session.userId)
  - Filtering applied after fetching all ended sessions, before returning response
- **Backward Compatibility:** Sessions without isPrivate field treated as public (undefined is falsy)
- **Sorting:** Maintains sort order from getRecentActivity (DESC by createdAt)

**Tests Added (6 new tests):**
1. "should return public sessions to all users" - Verified unauthorized user sees only public sessions
2. "should show owner their private sessions along with public sessions" - Owner sees private + public
3. "should hide private sessions from other authenticated users" - Non-owners don't see private sessions
4. "should hide all private sessions from unauthenticated users" - No auth means only public sessions
5. "should treat sessions without isPrivate field as public" - Legacy sessions backward compatible
6. "should maintain sort order from getRecentActivity after filtering" - Sorting preserved after filter

**File Changes:**
- `backend/src/handlers/list-activity.ts` - Added userId extraction and private session filter
- `backend/src/handlers/__tests__/list-activity.test.ts` - Added 6 comprehensive filtering tests

### Task 2: Tests for private session visibility filtering

**Status:** COMPLETE

Tests were added as part of Task 1 implementation (RED-GREEN phase of TDD). All 15 tests in list-activity test suite pass:
- 9 existing tests (backward compatibility verified)
- 6 new private filtering tests (all passing)

### Task 3: Add private channel pool initialization and IVS_PLAYBACK_PRIVATE_KEY to CDK infrastructure

**Status:** COMPLETE

Implemented private channel pool management and infrastructure wiring:

**Replenish-Pool Handler Updates:**
- Added `MIN_PRIVATE_CHANNELS` environment variable (default: 5) to session-stack Lambda configuration
- Implemented `createPrivateChannel()` function to create IVS channels with:
  - Name prefix: `vnl-pool-private-` for visibility in AWS console
  - Same channel type (STANDARD, LOW_LATENCY) as public channels
  - Recording configuration applied to private channels
  - Pool item stored with `GSI1PK=STATUS#AVAILABLE#PRIVATE_CHANNEL` marker
  - `isPrivate=true` flag on pool item for identification
- Implemented `countAvailablePrivateChannels()` function to query private channel pool health
- Updated handler to create private channels in parallel with public resources

**CDK Infrastructure Updates:**
- Session-stack: Added `MIN_PRIVATE_CHANNELS: '5'` to replenish-pool Lambda environment
- API-stack: Added environment variable reading for `IVS_PLAYBACK_PRIVATE_KEY`:
  - Read from `process.env.IVS_PLAYBACK_PRIVATE_KEY` during CDK synthesis
  - Exported CfnOutput for bootstrapping verification
  - Ready to be passed to handlers requiring JWT token generation

**Pool Item Storage Pattern:**
```
PK: POOL#CHANNEL#{resourceId}
SK: METADATA
GSI1PK: STATUS#AVAILABLE#PRIVATE_CHANNEL  (phase 22 marker)
isPrivate: true
status: available
```

**File Changes:**
- `infra/lib/stacks/session-stack.ts` - Added MIN_PRIVATE_CHANNELS env var
- `infra/lib/stacks/api-stack.ts` - Added IVS_PLAYBACK_PRIVATE_KEY wiring
- `backend/src/handlers/replenish-pool.ts` - Added private channel creation functions

## Verification Results

### Tests
- All 321 backend tests passing
- 15 list-activity tests (9 existing + 6 new private filtering)
- All filtering scenarios validated:
  - Owner visibility of private sessions
  - Non-owner hiding of private sessions
  - Unauthenticated user visibility restrictions
  - Backward compatibility for legacy sessions
  - Sort order preservation

### Success Criteria Met
- ✓ GET /activity endpoint filters private sessions by owner
- ✓ Public sessions visible to all users
- ✓ Private sessions visible only to owner
- ✓ Filter applied before sorting and pagination
- ✓ CDK creates private channel pool items with isPrivate=true
- ✓ IVS_PLAYBACK_PRIVATE_KEY environment variable support added
- ✓ All TypeScript compilation clean
- ✓ No test regressions

## Deviations from Plan

None. Plan executed exactly as written.

## Key Decisions

1. **Filter After Fetch:** Private session filtering applied in handler after getRecentActivity returns sorted results. This maintains existing sort behavior and simplifies logic.

2. **Private Channel Pool Pattern:** Used same GSI1PK pattern as public channels but with suffix `PRIVATE_CHANNEL` instead of `CHANNEL` to differentiate for querying.

3. **Min Private Channels:** Set to 5 (one-fifth of public channel pool) based on assumption that fewer broadcasts are private. Configurable via environment variable.

4. **Backward Compatibility:** undefined isPrivate treated as false (public) to ensure legacy sessions work without modification.

5. **Environment Variable Bootstrapping:** IVS_PLAYBACK_PRIVATE_KEY read from process.env during CDK synthesis, allowing flexible deployment configuration without code changes.

## Integration Points

- **Phase 22-01:** Leverages Session.isPrivate field and claimPrivateChannel() function
- **Activity Feed:** GET /activity endpoint now respects privacy rules
- **Channel Pool:** Replenish-pool handler maintains both public and private channel pools
- **Future JWT Token Generation:** IVS_PLAYBACK_PRIVATE_KEY infrastructure ready for generate-playback-token handler in subsequent phases

## Next Steps

- Phase 22-04: Can now implement JWT token generation for private playback using IVS_PLAYBACK_PRIVATE_KEY
- Frontend integration: Activity feed UI filters already handled by backend (no UI changes needed)
- Channel claiming: create-session handler can call claimPrivateChannel() when isPrivate=true

---

**Commits:**
- 9c22bf2: feat(22-03): implement private session filtering in activity feed endpoint
- ada9d2e: feat(22-03): add private channel pool initialization and IVS playback private key infrastructure
