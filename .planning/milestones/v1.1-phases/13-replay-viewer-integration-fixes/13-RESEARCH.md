# Phase 13: Replay Viewer Integration Fixes - Research

**Researched:** 2026-03-04
**Domain:** Frontend React / TypeScript bug fixes — auth headers, React useEffect deps, time domain math
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPLAY-04 | Replay viewer plays HLS video from CloudFront using react-player | Fix: add `Authorization: Bearer ${authToken}` to `GET /sessions/:id` fetch in `ReplayViewer.tsx` |
| REPLAY-06 | Chat messages display alongside replay video | Fix: add `authToken` to `ReplayChat` `useEffect` deps and gate fetch on non-empty token |
| REPLAY-07 | Chat auto-scrolls as video plays, matching video.currentTime to message timestamps | Fix: convert UTC syncTime to relative ms using `syncTime - new Date(session.startedAt).getTime()` before comparing against `sessionRelativeTime` |
| REPLAY-09 | Replay viewer shows session metadata (broadcaster, duration, viewer count) | Unblocks automatically once REPLAY-04 is fixed — session fetch succeeds, state populates |
| REACT-09 | Replay viewer displays reaction timeline synchronized to video playback position | Fix: same time domain conversion as REPLAY-07; apply to `useReactionSync` and `ReactionTimeline` `isHighlighted` comparison |
</phase_requirements>

---

## Summary

Phase 13 closes five requirements (REPLAY-04, REPLAY-06, REPLAY-07, REPLAY-09, REACT-09) that were identified as broken during the v1.1 milestone audit. All bugs are confirmed frontend-only: two root-cause bugs account for four of the five failures, and the fifth (REPLAY-09) unblocks automatically when REPLAY-04 is fixed.

**Bug 1 — Missing Authorization headers (REPLAY-04, REPLAY-06, REACT-09 reactions fetch, REPLAY-09):** `ReplayViewer.tsx` calls `GET /sessions/:id` and `GET /sessions/:id/reactions` without an `Authorization` header. Both routes require Cognito auth (confirmed in `api-stack.ts` — `sessionIdResource.addMethod('GET', ..., { authorizer, authorizationType: COGNITO })`). The `authToken` is already fetched from Cognito via `fetchAuthSession()` in the same component; it just isn't passed to the fetch calls. A secondary sub-bug: `ReplayChat.tsx`'s `useEffect` dep array is `[sessionId]`, omitting `authToken`, so the initial fetch fires when `authToken` is still an empty string and never re-fires when the token arrives.

**Bug 2 — Time domain mismatch (REPLAY-07, REACT-09 sync):** `useReplayPlayer` stores `syncTime` from IVS `SYNC_TIME_UPDATE` events, which are UTC wall-clock milliseconds (~1.7 trillion). `useSynchronizedChat` and `useReactionSync` compare this directly against `sessionRelativeTime` (milliseconds since stream start, e.g. 5000 for 5 seconds in). Since `syncTime` (UTC) >> any `sessionRelativeTime`, the filter is always true — all messages/reactions appear immediately. The fix requires converting: `const relativeMs = syncTime - new Date(session.startedAt).getTime()`. The `session` object is already in `ReplayViewer` state; `startedAt` is a field on the `Session` interface.

**Primary recommendation:** Fix both root causes surgically — add auth headers to two fetches, fix one useEffect dep array, and change one line in each of `useSynchronizedChat` and `useReactionSync`. No architectural changes required. Total surface: 3 files, 5-6 line edits.

---

## Standard Stack

No new libraries required. All fixes use existing project infrastructure:

### Core (already in use)
| Library/API | Purpose in Phase 13 |
|-------------|---------------------|
| `aws-amplify/auth` (`fetchAuthSession`) | Already used in `ReplayViewer` to get `authToken` — just needs to be passed to missing fetch calls |
| `React` `useEffect` deps array | Standard React pattern — add `authToken` to deps, gate on non-empty token |
| IVS Player SDK `SYNC_TIME_UPDATE` | Already firing — `syncTime` is UTC ms, must subtract `session.startedAt` epoch ms |
| `fetch` Web API | Already used for all API calls in the replay viewer components |

**Installation:** None required.

---

## Architecture Patterns

### Pattern 1: Auth-gated fetch with async token dependency

The `authToken` is populated asynchronously via `fetchAuthSession()`. When a child component needs it, pass it as a prop. In `useEffect`, include `authToken` in the deps array and guard the fetch with a non-empty check.

**Current broken pattern in `ReplayChat.tsx`:**
```typescript
// Source: web/src/features/replay/ReplayChat.tsx line 22-53
useEffect(() => {
  const fetchMessages = async () => {
    // ...fetch with authToken in headers...
  };
  fetchMessages();
}, [sessionId]); // BUG: authToken missing from deps
```

**Correct pattern:**
```typescript
useEffect(() => {
  if (!authToken) return; // gate: don't fetch with empty token
  const fetchMessages = async () => {
    // ...fetch with authToken in headers...
  };
  fetchMessages();
}, [sessionId, authToken]); // authToken in deps — re-fires when token arrives
```

### Pattern 2: Authorization header on Cognito-protected fetch

`GET /sessions/:id` and `GET /sessions/:id/reactions` both use `authorizationType: apigateway.AuthorizationType.COGNITO` in `api-stack.ts`. Any fetch to these routes must include `Authorization: Bearer <token>`.

**Current broken pattern in `ReplayViewer.tsx`:**
```typescript
// Source: web/src/features/replay/ReplayViewer.tsx line 63
const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`);
// No Authorization header → 401
```

**Correct pattern (same as ReplayChat already does):**
```typescript
const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
  headers: { Authorization: `Bearer ${authToken}` },
});
```

**Important:** The session fetch also needs to be gated on `authToken` being non-empty. Add `authToken` to its `useEffect` deps and guard with `if (!authToken) return`.

### Pattern 3: Time domain conversion for IVS SYNC_TIME_UPDATE

`SYNC_TIME_UPDATE` fires UTC epoch milliseconds. `sessionRelativeTime` is milliseconds since the session's `startedAt`. To compare them:

```typescript
// Source: audit analysis, confirmed against domain model
// session.startedAt is ISO 8601 string (e.g. "2026-02-14T10:30:00.000Z")
const sessionStartEpochMs = new Date(session.startedAt).getTime();
const relativeMs = syncTime - sessionStartEpochMs;
// relativeMs now matches sessionRelativeTime domain
return msg.sessionRelativeTime <= relativeMs;
```

**Where to apply this:**
1. `useSynchronizedChat` — must receive `sessionStartedAt: string | undefined` as a new parameter
2. `useReactionSync` — same new parameter
3. `ReactionTimeline` — `isHighlighted = relativeMs >= bucketStartTime` (currently compares raw UTC syncTime against relative bucketStartTime)
4. `ReplayViewer.tsx` — thread `session.startedAt` down to all three consumers

### Pattern 4: Sequential dependency — auth before session before sync

The chain must be: `authToken` ready → session fetch → `recordingHlsUrl` → IVS Player loads → `SYNC_TIME_UPDATE` fires. The fix must respect this order:

1. `authToken` useEffect runs, sets `authToken` state
2. Session fetch useEffect is gated on `authToken` non-empty — fires, sets `session`
3. `session.startedAt` becomes available
4. `useSynchronizedChat` and `useReactionSync` receive `session.startedAt` and use it to convert `syncTime`

### Anti-Patterns to Avoid

- **Treating `syncTime === 0` as "no playback":** The existing guard `if (currentSyncTime === 0) return []` in `useSynchronizedChat` is still valid — `syncTime` starts at 0 before the player initializes. After the fix, `relativeMs` will be 0 - sessionStartEpochMs = a large negative number when syncTime is 0, so the guard remains correct and prevents messages appearing before playback.
- **Using `session.createdAt` instead of `session.startedAt`:** `createdAt` is when the session was created (before stream goes live). `startedAt` is when the stream actually started, which is when IVS begins the HLS recording. Chat messages are timestamped relative to `startedAt`. Using `createdAt` would produce an offset error.
- **Modifying backend to return relative-time `syncTime`:** The IVS SDK fires UTC ms from the player event. Converting on the frontend (subtract `startedAt`) is the correct approach — matches the audit recommendation and avoids backend changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Auth token retrieval | Custom token cache or refresh logic | `fetchAuthSession()` from `aws-amplify/auth` (already in use) | Amplify handles token refresh, expiry |
| UTC-to-relative time conversion | Complex offset calculation | One-liner: `syncTime - new Date(session.startedAt).getTime()` | The domain model stores `startedAt` as ISO 8601; `new Date().getTime()` is sufficient |

---

## Common Pitfalls

### Pitfall 1: Fetching session before authToken is ready

**What goes wrong:** `authToken` is populated asynchronously from Cognito. If session fetch fires before token arrives (e.g. on initial mount with empty `authToken` string), the request returns 401. Adding `authToken` to `useEffect` deps without also adding an `if (!authToken) return` guard causes the fetch to fire twice — once empty (401) and once with the token.

**Why it happens:** React `useEffect` fires on mount (with initial empty `authToken`) and on every dependency change. Without the guard, the first fire is always with `authToken === ''`.

**How to avoid:** Always pair dep array inclusion with an early return guard:
```typescript
useEffect(() => {
  if (!authToken) return; // guard required
  fetchSession();
}, [sessionId, authToken]);
```

**Warning signs:** Network tab shows two requests to the same endpoint — first with empty/no auth header (401), second with valid bearer token (200).

### Pitfall 2: Using `session.createdAt` instead of `session.startedAt` for time origin

**What goes wrong:** `createdAt` is set when the session record is created (the `POST /sessions` call). `startedAt` is set when the stream goes live (the `POST /sessions/:id/start` event). The gap between them can be seconds to minutes. Using `createdAt` as the epoch for `sessionRelativeTime` would show chat messages at wrong positions.

**Why it happens:** Both fields exist on the `Session` interface and are ISO 8601 strings. Easy to grab the wrong one.

**How to avoid:** Use `session.startedAt`. Handle the `undefined` case — `startedAt` may be undefined if session never went live (edge case for replay viewer: if `recordingHlsUrl` is present, `startedAt` must exist). Add a guard: `if (!session?.startedAt) return []`.

**Warning signs:** Chat messages appear slightly early or late relative to video position.

### Pitfall 3: ReactionTimeline `isHighlighted` comparison not updated

**What goes wrong:** `ReactionTimeline.tsx` computes `isHighlighted = currentTime >= bucketStartTime` where `currentTime` is raw `syncTime` (UTC ms) and `bucketStartTime` is `bucketNumber * 5000` (relative ms). With UTC ms always >> relative ms, all buckets are permanently highlighted.

**Why it happens:** `ReactionTimeline` receives `currentTime` as a prop from `ReplayViewer`. If only the hooks are fixed but `ReactionTimeline`'s prop isn't updated to receive `relativeMs` instead of raw `syncTime`, the visual timeline indicator remains broken.

**How to avoid:** Either (a) pass `relativeMs` from `ReplayViewer` to `ReactionTimeline` instead of raw `syncTime`, or (b) pass both `syncTime` and `sessionStartedAt` and compute inside `ReactionTimeline`. Option (a) is simpler — compute once in `ReplayViewer` and thread down.

**Warning signs:** All reaction timeline markers show as blue (highlighted) regardless of playback position.

### Pitfall 4: `session.startedAt` not in ReplayViewer `Session` interface

**What goes wrong:** `ReplayViewer.tsx` defines a local `Session` interface (lines 20-27) that does not include `startedAt`. Even though the backend returns `startedAt` in the JSON, TypeScript won't know about it without updating the local interface.

**How to avoid:** Add `startedAt?: string` to the local `Session` interface in `ReplayViewer.tsx`. The backend `Session` domain model already has this field.

---

## Code Examples

### Fix 1: ReplayViewer.tsx — Add auth to session fetch and gate on token

```typescript
// Source: web/src/features/replay/ReplayViewer.tsx
// Replace useEffect starting at line 55

// Add startedAt to the local Session interface (line 20-27)
interface Session {
  sessionId: string;
  userId: string;
  startedAt?: string;   // ADD THIS
  recordingHlsUrl?: string;
  recordingDuration?: number;
  createdAt: string;
  endedAt?: string;
}

// Gate session fetch on authToken
useEffect(() => {
  if (!sessionId || !authToken) return; // gate on both

  const fetchSession = async () => {
    const config = getConfig();
    const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';
    try {
      const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${authToken}` }, // ADD HEADER
      });
      // ... rest unchanged
    }
  };
  fetchSession();
}, [sessionId, authToken]); // ADD authToken to deps
```

### Fix 2: ReplayViewer.tsx — Add auth to reactions fetch

```typescript
// Source: web/src/features/replay/ReplayViewer.tsx
// Replace useEffect starting at line 91

useEffect(() => {
  if (!sessionId || !authToken) return; // gate on both

  const fetchReactions = async () => {
    const config = getConfig();
    const apiBaseUrl = config?.apiUrl || 'http://localhost:3000/api';
    try {
      const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/reactions`, {
        headers: { Authorization: `Bearer ${authToken}` }, // ADD HEADER
      });
      // ... rest unchanged
    }
  };
  fetchReactions();
}, [sessionId, authToken]); // ADD authToken to deps
```

### Fix 3: ReplayChat.tsx — Add authToken to useEffect deps with gate

```typescript
// Source: web/src/features/replay/ReplayChat.tsx
// Replace useEffect starting at line 22

useEffect(() => {
  if (!authToken) return; // gate — don't fire with empty token

  const fetchMessages = async () => {
    // ... headers already correct (Authorization present) ...
  };
  fetchMessages();
}, [sessionId, authToken]); // ADD authToken to deps (was [sessionId] only)
```

### Fix 4: useSynchronizedChat.ts — Time domain conversion

```typescript
// Source: web/src/features/replay/useSynchronizedChat.ts
// New signature adds sessionStartedAt parameter

export function useSynchronizedChat(
  allMessages: ChatMessage[],
  currentSyncTime: number,
  sessionStartedAt: string | undefined  // ADD parameter
): ChatMessage[] {
  return useMemo(() => {
    if (currentSyncTime === 0 || !sessionStartedAt) {
      return [];
    }

    // Convert UTC syncTime to session-relative ms
    const sessionStartEpochMs = new Date(sessionStartedAt).getTime();
    const relativeMs = currentSyncTime - sessionStartEpochMs;

    return allMessages.filter(
      msg => msg.sessionRelativeTime !== undefined &&
             msg.sessionRelativeTime <= relativeMs  // compare same domain
    );
  }, [allMessages, currentSyncTime, sessionStartedAt]);
}
```

### Fix 5: useReactionSync.ts — Time domain conversion (same pattern)

```typescript
// Source: web/src/features/replay/useReactionSync.ts
// New signature adds sessionStartedAt parameter

export function useReactionSync(
  allReactions: Reaction[],
  currentSyncTime: number,
  sessionStartedAt: string | undefined  // ADD parameter
): Reaction[] {
  return useMemo(() => {
    if (currentSyncTime === 0 || !sessionStartedAt) {
      return [];
    }

    const sessionStartEpochMs = new Date(sessionStartedAt).getTime();
    const relativeMs = currentSyncTime - sessionStartEpochMs;

    return allReactions.filter(
      reaction => reaction.sessionRelativeTime !== undefined &&
                  reaction.sessionRelativeTime <= relativeMs
    );
  }, [allReactions, currentSyncTime, sessionStartedAt]);
}
```

### Fix 6: ReplayViewer.tsx — Thread relativeMs to ReactionTimeline

```typescript
// Source: web/src/features/replay/ReplayViewer.tsx
// Compute relativeMs once; pass to ReactionTimeline and hook calls

// After session loads and syncTime updates:
const relativeMs = session?.startedAt
  ? syncTime - new Date(session.startedAt).getTime()
  : 0;

// Update hook call sites:
const visibleReactions = useReactionSync(allReactions, syncTime, session?.startedAt);

// Pass relativeMs to ReactionTimeline:
<ReactionTimeline
  reactions={allReactions}
  currentTime={relativeMs}        // was: syncTime
  duration={session.recordingDuration}
/>
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Raw `syncTime` (UTC ms) compared to `sessionRelativeTime` | `syncTime - session.startedAt` epoch ms = relative ms, then compare | Chat and reactions sync correctly to video position |
| Unauthenticated session fetch (implicit public) | Explicit `Authorization: Bearer ${authToken}` header | Session loads, video plays, metadata populates |
| `useEffect([sessionId])` in ReplayChat | `useEffect([sessionId, authToken])` with empty-token guard | Chat fetch fires with valid token, messages load |

---

## Open Questions

1. **Behavior when `startedAt` is undefined**
   - What we know: `Session.startedAt` is optional (`startedAt?: string`). For any session with a recording (`recordingHlsUrl` exists), `startedAt` must have been set by the `stream-started` event handler.
   - What's unclear: Are there edge cases (seeded test data, re-seeded sessions) where `recordingHlsUrl` is set but `startedAt` is not?
   - Recommendation: Guard with `if (!session?.startedAt) return []` in both hooks. The `ReplayViewer` already shows "recording not available" when `recordingHlsUrl` is missing — the same guard prevents sync crash if data is malformed.

2. **`SYNC_TIME_UPDATE` fires before session data loads**
   - What we know: The IVS player loads when `recordingHlsUrl` is available (via `useReplayPlayer`). `recordingHlsUrl` comes from the session fetch. The player fires `SYNC_TIME_UPDATE` only after the HLS stream starts loading.
   - What's unclear: There should be no race condition — player loads after session fetch, so `session.startedAt` is available before `syncTime` ever updates. But worth validating during implementation.
   - Recommendation: The hooks' `!sessionStartedAt` guard handles this safely — returns empty array if called before session is ready.

---

## Validation Architecture

> `workflow.nyquist_validation` is not present in `.planning/config.json` (only `workflow.research/plan_check/verifier/auto_advance` keys present). Skipping this section.

---

## Sources

### Primary (HIGH confidence)
- `/Users/connorhoehn/Projects/videonowandlater/.planning/v1.1-MILESTONE-AUDIT.md` — gap details, root cause analysis, file/line references for each bug
- `/Users/connorhoehn/Projects/videonowandlater/web/src/features/replay/ReplayViewer.tsx` — confirmed: no auth headers on lines 63 and 99; `authToken` state exists but not used in fetches
- `/Users/connorhoehn/Projects/videonowandlater/web/src/features/replay/ReplayChat.tsx` — confirmed: `useEffect` deps is `[sessionId]` only (line 53); `authToken` prop received but not in deps
- `/Users/connorhoehn/Projects/videonowandlater/web/src/features/replay/useSynchronizedChat.ts` — confirmed: `msg.sessionRelativeTime <= currentSyncTime` with no domain conversion
- `/Users/connorhoehn/Projects/videonowandlater/web/src/features/replay/useReactionSync.ts` — confirmed: identical time domain bug
- `/Users/connorhoehn/Projects/videonowandlater/web/src/features/replay/ReactionTimeline.tsx` — confirmed: `isHighlighted = currentTime >= bucketStartTime` uses raw UTC syncTime
- `/Users/connorhoehn/Projects/videonowandlater/infra/lib/stacks/api-stack.ts` — confirmed: `GET /sessions/{sessionId}` and `GET /sessions/{sessionId}/reactions` both require Cognito authorizer
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/domain/session.ts` — confirmed: `Session.startedAt?: string` exists; `createdAt` and `startedAt` are separate fields
- `/Users/connorhoehn/Projects/videonowandlater/backend/src/domain/chat-message.ts` — confirmed: `sessionRelativeTime` is `sentAt - sessionStartedAt` epoch ms (relative, not UTC)

### Secondary (MEDIUM confidence)
- React docs (standard pattern): `useEffect` with async dependencies — token-gated fetch pattern is standard React idiom
- IVS Player SDK (training knowledge): `SYNC_TIME_UPDATE` fires UTC milliseconds. Confirmed consistent with audit evidence (audit describes "UTC ms ~1.7T vs relative ms ~5000").

---

## Metadata

**Confidence breakdown:**
- Bug identification: HIGH — all bugs directly confirmed by reading source files against audit
- Fix patterns: HIGH — all fixes are standard React/TypeScript patterns; no new libraries
- Scope: HIGH — audit confirms these are all frontend-only changes; backend unchanged
- Edge cases: MEDIUM — `startedAt` undefined edge case is logically handled but not tested

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable — no fast-moving dependencies)
