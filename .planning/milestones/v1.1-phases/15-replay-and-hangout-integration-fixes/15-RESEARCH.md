# Phase 15: Replay & Hangout Integration Fixes - Research

**Researched:** 2026-03-04
**Domain:** Backend session service, DynamoDB session fields, IVS RealTime participant tokens, React navigation
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPLAY-04 | Replay viewer plays HLS video from CloudFront using react-player | Fix: getSession() must return recordingHlsUrl; all Session recording fields are stored in DynamoDB but stripped by session-service.ts |
| REPLAY-05 | Replay viewer shows video playback controls | Unblocked once REPLAY-04 is fixed — player initializes with URL, controls exist in the video element |
| REPLAY-07 | Chat auto-scrolls as video plays, matching timestamps | Unblocked once REPLAY-04 is fixed — sync logic in useReplayPlayer/ReplayChat is correct |
| REPLAY-09 | Replay viewer shows session metadata (broadcaster, duration, viewer count) | Fix: getSession() must return userId, createdAt, startedAt, endedAt, recordingDuration; metadata panel already renders these fields |
| HANG-11 | Active speaker detection / chat integration in hangouts | Fix: join-hangout.ts must call updateSessionStatus(LIVE) so send-message stops returning 400 |
| HANG-12 | Participant join/leave notifications in hangout UI | Fix: join-hangout.ts must add userId key to CreateParticipantTokenCommand attributes; useHangout reads attributes?.userId |
| HANG-15 | Hangout recording metadata / navigation to replay | Fix: RecordingFeed.tsx navigates HANGOUT sessions to /hangout/:id; must navigate to /replay/:id |
</phase_requirements>

## Summary

Phase 15 closes four P0/P1/P2 integration bugs identified in the v1.1 milestone audit. All bugs are surgical code-level fixes — no new infrastructure, no new dependencies, no architectural changes required.

The root cause pattern across all four bugs is the same: implementations were built in isolation (correct within their own scope) but the integration wiring between components was never connected. The session service correctly stores all recording fields in DynamoDB but strips them before returning to the caller. join-hangout generates valid tokens but never transitions the session to LIVE. RecordingFeed navigates hangout recordings to the wrong page. The participant attribute key in CreateParticipantTokenCommand doesn't match what useHangout reads.

All fixes touch a single file each and require no new AWS infrastructure or CDK changes. The total diff is estimated at under 50 lines across 3 backend files and 1 frontend file.

**Primary recommendation:** Fix `getSession()` in `session-service.ts` first (unblocks REPLAY-04/05/07/09), then fix `join-hangout.ts` (unblocks HANG-11 and HANG-12 simultaneously), then fix `RecordingFeed.tsx` (fixes HANG-15). Update or add tests for each changed backend handler.

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/lib-dynamodb | ^3.1000.0 | DynamoDB DocumentClient — already used in session-service.ts and session-repository.ts | Already installed; getSessionById returns full Session object with all fields |
| aws-lambda types | ^8.10.0 | Lambda handler typing | Already installed |
| react-router-dom | (existing) | Client-side navigation; useNavigate already in RecordingFeed.tsx | Already installed |

### Supporting

No new libraries required. This phase is entirely internal plumbing fixes.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending getSession() return type | Creating a new /sessions/:id/recording endpoint | New endpoint requires API Gateway resource, new Lambda, IAM grants, CDK change — overkill for adding 6 fields to an existing response |
| Extending getSession() return type | Having ReplayViewer call both GET /sessions/:id and GET /recordings | Two-request waterfall adds latency and complexity — one endpoint returning all needed fields is correct |

## Architecture Patterns

### Existing Session Data Flow

```
DynamoDB (SESSION# item)
  ├── sessionId, sessionType, status, userId, version
  ├── createdAt, startedAt, endedAt
  ├── claimedResources: { channel?, stage?, chatRoom }  ← MUST stay hidden (ARNs)
  └── recordingHlsUrl, recordingDuration, thumbnailUrl,
      recordingS3Path, recordingStatus               ← MUST be exposed
         ↓
getSessionById() in session-repository.ts            ← Returns full Session object (all fields)
         ↓
getSession() in session-service.ts                   ← Currently strips everything except 3 fields
         ↓
GET /sessions/:id handler (get-session.ts)           ← Passes through service return
         ↓
ReplayViewer.tsx fetch()                             ← Needs recording fields
```

### Fix 1: Extend getSession() Return Object

**What:** `session-service.ts` `getSession()` currently returns `{ sessionId, sessionType, status }`. It must also return recording fields and non-sensitive session fields.

**Fields to expose (already on Session domain object, just not returned):**
- `userId` — broadcaster display in metadata panel
- `createdAt` — "Recorded" date in metadata panel
- `startedAt` — available, may be undefined
- `endedAt` — "Ended" date in metadata panel
- `recordingHlsUrl` — required for IVS player initialization
- `recordingDuration` — required for reaction timeline and metadata panel
- `thumbnailUrl` — useful for OG metadata (bonus)
- `recordingStatus` — tells ReplayViewer whether recording is available

**Fields to keep hidden (ARNs — security boundary per SESS-04):**
- `claimedResources.channel`
- `claimedResources.stage`
- `claimedResources.chatRoom`
- `recordingS3Path` (internal S3 path)
- `version` (internal optimistic locking field)

**Pattern:**
```typescript
// Source: backend/src/services/session-service.ts (existing pattern, to be extended)
// Current return type — too narrow:
interface CreateSessionResponse {
  sessionId: string;
  sessionType: SessionType;
  status: SessionStatus;
  error?: string;
}

// Extended return type for getSession():
interface GetSessionResponse {
  sessionId: string;
  sessionType: SessionType;
  status: SessionStatus;
  userId: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  recordingHlsUrl?: string;
  recordingDuration?: number;
  thumbnailUrl?: string;
  recordingStatus?: RecordingStatus;
}
```

**Important:** The `CreateSessionResponse` type is used by `createNewSession()` (which returns a limited object on purpose — session just created, no recording fields yet). Do NOT change that type. Define a separate `GetSessionResponse` type for `getSession()`.

### Fix 2: HANGOUT Session LIVE Transition in join-hangout.ts

**What:** After `CreateParticipantTokenCommand` succeeds, call `updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt')`.

**Why here:** This mirrors how `start-broadcast.ts` does it — `updateSessionStatus` with `'startedAt'` timestamp field sets `startedAt` and transitions status to LIVE. The `send-message` handler checks `session.status !== SessionStatus.LIVE` and returns 400 if not LIVE.

**Idempotency:** `updateSessionStatus` uses `canTransition(from, to)` validation. On second join attempt the session is already LIVE. `canTransition(LIVE, LIVE)` returns `false` — it will throw. Wrap in try/catch and log warning (same pattern as `start-broadcast.ts` line 94-96):

```typescript
// Source: backend/src/handlers/start-broadcast.ts lines 91-97 (reference pattern)
if (goLive && session.status === SessionStatus.CREATING) {
  try {
    await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
  } catch (err: any) {
    console.warn('Could not transition session to LIVE (may already be LIVE):', err.message);
  }
}
```

For join-hangout, simplify: always try to transition after successful token generation, swallow the error if already LIVE:

```typescript
// After successful ivsRealTimeClient.send():
try {
  await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
} catch (err: any) {
  // Session may already be LIVE (second participant joining) — expected
  console.info('[join-hangout] Status transition skipped:', err.message);
}
```

**IAM note:** `join-hangout.ts` Lambda currently has `grantReadData` only (line 304 in api-stack.ts). To call `updateSessionStatus` (which calls `docClient.send(UpdateCommand)`) it needs `grantReadWriteData`. The infra/api-stack.ts must be updated from `grantReadData` to `grantReadWriteData` for `joinHangoutHandler`.

### Fix 3: Participant Attribute Key — userId not username

**What:** `join-hangout.ts` line 79 passes `attributes: { username }` to `CreateParticipantTokenCommand`. `useHangout.ts` line 101 reads `participant.attributes?.userId`.

**Fix:** Add `userId: username` to attributes alongside `username`:

```typescript
// Current (backend/src/handlers/join-hangout.ts lines 79-81):
attributes: {
  username,
},

// Fixed:
attributes: {
  username,
  userId: username,
},
```

This is one line added. Both keys use the same value (cognito:username) so no new data is needed.

**Note:** The test `join-hangout.test.ts` line 134 asserts `attributes: { username: USERNAME }`. The test must be updated to also include `userId: USERNAME` in the expected attributes.

### Fix 4: RecordingFeed Navigation for HANGOUT Recordings

**What:** `RecordingFeed.tsx` lines 70-72:

```typescript
// Current:
const destination = isHangout
  ? `/hangout/${recording.sessionId}`
  : `/replay/${recording.sessionId}`;

// Fixed:
const destination = `/replay/${recording.sessionId}`;
```

**Why this works:** Once Fix 1 is deployed, GET /sessions/:id returns `recordingHlsUrl` for HANGOUT sessions too (hangout recordings go through the same recording lifecycle as broadcasts). ReplayViewer works for both session types. The `/hangout/:id` route is for joining an active Stage — not for playback.

### Anti-Patterns to Avoid

- **Do not** create a new API endpoint for recording data — all needed fields are already on the session item in DynamoDB.
- **Do not** modify `createNewSession()` return type — it intentionally returns a minimal response since no recording fields exist at session creation time.
- **Do not** change the `canTransition` state machine — CREATING → LIVE is already a valid transition.
- **Do not** remove `claimedResources` from DynamoDB — they are needed by other handlers (start-broadcast, join-hangout itself). Only strip them from the HTTP response.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session status transition | Custom DynamoDB UpdateCommand | `updateSessionStatus()` from session-repository.ts | Already handles optimistic locking, GSI1PK update, canTransition validation |
| DynamoDB field projection | Custom attribute projection | Just map the Session object in getSession() | getSessionById() already returns the full typed Session; just pick fields to expose |
| Navigation logic | Custom routing | react-router-dom `useNavigate` (already imported in RecordingFeed) | Already in use; just change the destination string |

**Key insight:** Every building block for these fixes already exists. The work is wiring, not building.

## Common Pitfalls

### Pitfall 1: Forgetting IAM Grant for join-hangout Write Access
**What goes wrong:** join-hangout Lambda throws AccessDeniedException when calling DynamoDB UpdateCommand because it only has `grantReadData`.
**Why it happens:** api-stack.ts line 304 uses `grantReadData` — sufficient for the original read-only operation, insufficient after adding `updateSessionStatus`.
**How to avoid:** Change `props.sessionsTable.grantReadData(joinHangoutHandler)` to `props.sessionsTable.grantReadWriteData(joinHangoutHandler)` in api-stack.ts.
**Warning signs:** CloudWatch logs show `AccessDeniedException: User is not authorized to perform: dynamodb:UpdateItem` from join-hangout Lambda.

### Pitfall 2: Type Mismatch in getSession() Return
**What goes wrong:** TypeScript error `Type 'Session' is not assignable to type 'CreateSessionResponse'` if you try to reuse the same response type.
**Why it happens:** `CreateSessionResponse` is narrower than what `getSession()` now needs to return.
**How to avoid:** Define a new `GetSessionResponse` interface in session-service.ts for the `getSession()` function. Keep `CreateSessionResponse` for `createNewSession()`.

### Pitfall 3: join-hangout Status Check — Session May Already Be LIVE
**What goes wrong:** Second participant joining throws an error because `canTransition(LIVE, LIVE)` returns false.
**Why it happens:** First participant already transitioned the session to LIVE.
**How to avoid:** Wrap `updateSessionStatus` in try/catch. Log the caught error at info/warn level but continue returning the token.

### Pitfall 4: send-message Also Requires startedAt
**What goes wrong:** Even after status is LIVE, send-message returns 400 "Session has no startedAt timestamp" (line 89-97 of send-message.ts).
**Why it happens:** `updateSessionStatus` with `'startedAt'` sets the timestamp. If only status is set without the timestamp field, the second check fails.
**How to avoid:** Always call `updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt')` with the timestamp field argument. Do not call without `'startedAt'`.

### Pitfall 5: Test for join-hangout Asserts Old Attribute Shape
**What goes wrong:** Existing `join-hangout.test.ts` line 134 asserts `attributes: { username: USERNAME }`. After Fix 3, the test fails because actual call passes `{ username: USERNAME, userId: USERNAME }`.
**Why it happens:** The test was written to match the original (incorrect) implementation.
**How to avoid:** Update the test assertion to expect `attributes: { username: USERNAME, userId: USERNAME }`.

## Code Examples

Verified patterns from project source files:

### Current getSession() — the problem (session-service.ts lines 135-147)
```typescript
// Source: backend/src/services/session-service.ts
export async function getSession(tableName: string, sessionId: string): Promise<CreateSessionResponse | null> {
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return null;
  }
  // Return user-safe object (per SESS-04: no AWS ARNs exposed)
  return {
    sessionId: session.sessionId,
    sessionType: session.sessionType,
    status: session.status,
    // BUG: recordingHlsUrl, userId, createdAt, endedAt, recordingDuration all dropped here
  };
}
```

### Fixed getSession() — the solution
```typescript
// Source: backend/src/services/session-service.ts (after fix)
interface GetSessionResponse {
  sessionId: string;
  sessionType: SessionType;
  status: SessionStatus;
  userId: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  recordingHlsUrl?: string;
  recordingDuration?: number;
  thumbnailUrl?: string;
  recordingStatus?: RecordingStatus;
}

export async function getSession(tableName: string, sessionId: string): Promise<GetSessionResponse | null> {
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return null;
  }
  // Return user-safe object — expose recording fields, hide ARNs (SESS-04)
  return {
    sessionId: session.sessionId,
    sessionType: session.sessionType,
    status: session.status,
    userId: session.userId,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    recordingHlsUrl: session.recordingHlsUrl,
    recordingDuration: session.recordingDuration,
    thumbnailUrl: session.thumbnailUrl,
    recordingStatus: session.recordingStatus,
  };
}
```

### join-hangout LIVE transition — after token generation
```typescript
// Source: backend/src/handlers/join-hangout.ts (after fix)
// After: const response = await ivsRealTimeClient.send(command);

// Transition session to LIVE so send-message accepts messages
try {
  await updateSessionStatus(tableName, sessionId, SessionStatus.LIVE, 'startedAt');
} catch (err: any) {
  // Already LIVE (second+ participant joining) — expected
  console.info('[join-hangout] Status transition skipped (likely already LIVE):', err.message);
}
```

### join-hangout attributes — add userId key
```typescript
// Source: backend/src/handlers/join-hangout.ts (after fix)
attributes: {
  username,
  userId: username,   // added: useHangout.ts reads participant.attributes?.userId
},
```

### RecordingFeed navigation — remove HANGOUT branch
```typescript
// Source: web/src/features/replay/RecordingFeed.tsx (after fix)
// Remove the ternary, always use /replay/:id
const destination = `/replay/${recording.sessionId}`;
```

### Required import addition for join-hangout.ts
```typescript
// join-hangout.ts needs these imports added:
import { updateSessionStatus } from '../repositories/session-repository';
import { SessionStatus } from '../domain/session';  // already imported
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | All fixes are bug closures on existing implementation | Phase 15 | Brings v1.1 to full requirements satisfaction |

**Deprecated/outdated:**
- None. No APIs or patterns being replaced — only gaps being closed.

## Open Questions

1. **Is there a get-session.test.ts?**
   - What we know: The handler exists at `backend/src/handlers/get-session.ts`. The test directory has tests for other handlers. No get-session.test.ts was found in `__tests__/`.
   - What's unclear: Whether a test file needs to be created or if a service-level test for `session-service.ts` is more appropriate.
   - Recommendation: Create `get-session.test.ts` that mocks `session-service.getSession` and asserts the extended fields are present in the 200 response body.

2. **Does join-hangout need a status guard to not transition if session is ENDED?**
   - What we know: `canTransition(ENDED, LIVE)` returns `false` — would throw. The catch block handles it.
   - What's unclear: Should the handler return an error when the session is ENDED (instead of silently continuing)?
   - Recommendation: Keep the catch-and-continue pattern consistent with start-broadcast.ts. The session being ENDED while someone joins is an edge case that doesn't need special UI treatment in v1.1.

3. **Does the ReplayViewer Session interface need updating?**
   - What we know: `ReplayViewer.tsx` line 20-27 declares `interface Session` with `sessionId`, `userId`, `recordingHlsUrl?`, `recordingDuration?`, `createdAt`, `endedAt?`. This already covers what getSession() will return.
   - What's unclear: Nothing. The frontend interface already matches the fix.
   - Recommendation: No frontend Session interface change needed — it already declares the right shape.

## Validation Architecture

> nyquist_validation is not present in .planning/config.json (workflow.nyquist_validation not set), so this section uses the project's existing test infrastructure.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest with ts-jest |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=get-session` |
| Full suite command | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPLAY-04/09 | getSession() returns recording fields + metadata | unit | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=get-session` | Wave 0 |
| HANG-11 | join-hangout calls updateSessionStatus after token gen | unit | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=join-hangout` | Exists — update needed |
| HANG-12 | join-hangout passes userId in attributes | unit | `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern=join-hangout` | Exists — update needed |
| HANG-15 | RecordingFeed navigates HANGOUT to /replay/:id | manual | n/a — React component test; verify visually | N/A |

### Sampling Rate
- **Per task commit:** `cd backend && NODE_OPTIONS=--experimental-vm-modules jest --testPathPattern="get-session|join-hangout"`
- **Per wave merge:** `cd backend && NODE_OPTIONS=--experimental-vm-modules jest`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `backend/src/handlers/__tests__/get-session.test.ts` — covers REPLAY-04/09; test that getSession returns recordingHlsUrl, userId, createdAt, endedAt, recordingDuration fields
- [ ] `backend/src/handlers/__tests__/join-hangout.test.ts` — update existing test: assert `attributes: { username: USERNAME, userId: USERNAME }` and assert updateSessionStatus is called with LIVE + 'startedAt'

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `backend/src/services/session-service.ts` — confirmed getSession() strips recording fields
- Direct code inspection: `backend/src/handlers/join-hangout.ts` — confirmed no updateSessionStatus call, confirmed `attributes: { username }` only
- Direct code inspection: `web/src/features/replay/RecordingFeed.tsx` — confirmed HANGOUT → `/hangout/:id` navigation
- Direct code inspection: `web/src/features/hangout/useHangout.ts` — confirmed reads `participant.attributes?.userId`
- Direct code inspection: `backend/src/domain/session.ts` — confirmed Session interface has all recording fields
- Direct code inspection: `backend/src/repositories/session-repository.ts` — confirmed getSessionById returns full Session object
- Direct code inspection: `backend/src/handlers/send-message.ts` — confirmed checks `session.status !== SessionStatus.LIVE`
- Direct code inspection: `infra/lib/stacks/api-stack.ts` — confirmed joinHangoutHandler has `grantReadData` only
- Direct code inspection: `backend/src/handlers/start-broadcast.ts` — confirmed updateSessionStatus call pattern with try/catch

### Secondary (MEDIUM confidence)
- v1.1-MILESTONE-AUDIT.md — provides severity classification and exact line references for all four gaps

### Tertiary (LOW confidence)
- None required. All findings are verified against actual source files.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; verified against package.json and existing handlers
- Architecture: HIGH — all patterns verified directly from existing source code
- Pitfalls: HIGH — derived from exact line-level code inspection of the affected files
- Fix scope: HIGH — all four fixes are single-file surgical edits with no cascading dependencies

**Research date:** 2026-03-04
**Valid until:** Stable indefinitely — these are codebase-specific bug fixes, not ecosystem research

---

## Fix Summary (for Planner Reference)

| # | File | Change | Lines Affected | Req ID |
|---|------|--------|---------------|--------|
| 1 | `backend/src/services/session-service.ts` | Add `GetSessionResponse` interface; extend `getSession()` return to include recording fields and session metadata; keep ARNs hidden | ~20 lines added/changed | REPLAY-04, REPLAY-05, REPLAY-07, REPLAY-09 |
| 2 | `backend/src/handlers/join-hangout.ts` | Add `updateSessionStatus` call after token generation; add import; add `userId` to attributes | ~8 lines added | HANG-11, HANG-12 |
| 3 | `backend/src/handlers/__tests__/join-hangout.test.ts` | Update attribute assertion to include `userId`; add assertion that updateSessionStatus is called | ~10 lines changed | HANG-11, HANG-12 |
| 4 | `infra/lib/stacks/api-stack.ts` | Change `grantReadData` → `grantReadWriteData` for joinHangoutHandler | 1 line | HANG-11 |
| 5 | `web/src/features/replay/RecordingFeed.tsx` | Remove HANGOUT ternary; always use `/replay/:id` destination | 3 lines changed | HANG-15 |
| 6 | `backend/src/handlers/__tests__/get-session.test.ts` | NEW: test that getSession returns extended fields | ~60 lines new | REPLAY-04, REPLAY-09 |
