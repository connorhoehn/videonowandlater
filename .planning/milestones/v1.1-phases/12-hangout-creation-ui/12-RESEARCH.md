# Phase 12: Hangout Creation UI - Research

**Researched:** 2026-03-04
**Domain:** React frontend — HomePage button addition, POST /sessions API call, client-side navigation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HANG-02 | Pre-warmed Stage pool maintains ready-to-use RealTime Stages (mirrors Channel pool pattern) — the UI side: user must be able to trigger hangout session creation from the home page | Backend already supports `POST /sessions` with `sessionType: 'HANGOUT'`. Route `/hangout/:sessionId` already exists in App.tsx. HangoutPage already reads sessionId from URL params. Only the HomePage button is missing. |
</phase_requirements>

---

## Summary

Phase 12 is a narrow frontend change: add a "Start Hangout" button to `HomePage.tsx` that calls `POST /sessions` with `sessionType: 'HANGOUT'` and navigates to `/hangout/:sessionId`. The entire backend, routing, and page infrastructure already exist. This is the user-facing gap described in HANG-02 — previously, users could only reach the hangout flow if they already knew a direct `/hangout/:id` URL.

The implementation pattern is a direct copy-adapt of `handleCreateBroadcast` in `HomePage.tsx`. The existing function calls `POST /sessions` with `sessionType: 'BROADCAST'` and navigates with session state. The hangout handler does the same with `sessionType: 'HANGOUT'` and navigates to `/hangout/:sessionId`. The two buttons are presented side-by-side in the "Get Started" card.

No backend changes are required. No routing changes are required. No new libraries are required. Phase 12 is a single-file change to `web/src/pages/HomePage.tsx`.

**Primary recommendation:** Add `handleCreateHangout` function (cloned from `handleCreateBroadcast`) and a "Start Hangout" button in the action card alongside the existing "Create Broadcast" button. Share a single `isCreating` state OR use separate states to avoid button-state collision. Share the same `error` state.

---

## Standard Stack

### Core (Existing — no new installations)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.0 | Component state and event handling | Project standard |
| react-router-dom | ^7.7.1 | `useNavigate` for programmatic navigation | Project standard |
| aws-amplify | ^6.12.2 | `fetchAuthSession` for Bearer token | Project standard |

### No New Installations Required

All dependencies present. No `npm install` steps needed.

**Installation:**
```bash
# No new packages needed
```

---

## Architecture Patterns

### Recommended Project Structure

No new files needed. Single file change:

```
web/src/pages/
└── HomePage.tsx    # Add handleCreateHangout + "Start Hangout" button
```

### Pattern 1: Hangout Creation Handler (Clone of Broadcast Handler)

**What:** Async handler that calls `POST /sessions` with `sessionType: 'HANGOUT'`, guards with auth token, navigates on success.

**When to use:** When "Start Hangout" button is clicked.

**Example:**
```typescript
// Source: Adapted from existing handleCreateBroadcast in web/src/pages/HomePage.tsx

const handleCreateHangout = async () => {
  const config = getConfig();
  if (!config?.apiUrl) {
    setError('Configuration not loaded');
    return;
  }

  setIsCreatingHangout(true);
  setError('');

  try {
    const session = await fetchAuthSession();
    const authToken = session.tokens?.idToken?.toString() || '';
    const response = await fetch(`${config.apiUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionType: 'HANGOUT' }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const sessionData = await response.json();

    navigate(`/hangout/${sessionData.sessionId}`, {
      state: { session: sessionData }
    });
  } catch (err) {
    setError('Failed to create session. Try again.');
  } finally {
    setIsCreatingHangout(false);
  }
};
```

### Pattern 2: Separate Loading States for Two Buttons

**What:** Use `isCreating` (existing, for broadcast) and `isCreatingHangout` (new, for hangout) as separate boolean states. This prevents pressing "Start Hangout" from disabling "Create Broadcast" and vice versa.

**When to use:** Always — shared state creates confusing UX where one button disables the other.

**Example:**
```typescript
// Separate states — clear button-level semantics
const [isCreating, setIsCreating] = useState(false);         // broadcast
const [isCreatingHangout, setIsCreatingHangout] = useState(false);  // hangout
```

### Pattern 3: Side-by-Side Button Layout

**What:** Place "Start Hangout" button adjacent to "Create Broadcast" in the existing action card. The card already uses `textAlign: 'center'`. Use a flex row container for the two primary action buttons.

**Example:**
```typescript
// Wrap both buttons in a flex row, then place error + Log Out below
<div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem' }}>
  <button onClick={handleCreateBroadcast} disabled={isCreating || isCreatingHangout}>
    {isCreating ? 'Creating...' : 'Go Live'}
  </button>
  <button onClick={handleCreateHangout} disabled={isCreating || isCreatingHangout}>
    {isCreatingHangout ? 'Creating...' : 'Start Hangout'}
  </button>
</div>
```

**Note on disabling cross-button:** It is reasonable to disable both buttons while either creation is in-flight — prevents double-session creation. The `disabled` prop should be `isCreating || isCreatingHangout` for both buttons.

### Pattern 4: Navigate with State (Matching Broadcast Pattern)

**What:** Pass `state: { session: sessionData }` to the navigate call so HangoutPage can consume the session data without a redundant fetch.

**When to use:** Always — matches existing broadcast pattern and avoids a race condition between navigate and page load.

**Example:**
```typescript
navigate(`/hangout/${sessionData.sessionId}`, {
  state: { session: sessionData }
});
```

**Note:** Check if HangoutPage currently uses `location.state` to consume this. If not, the state is safely ignored. The navigate call itself is what matters.

### Anti-Patterns to Avoid

- **Shared isCreating state for both buttons:** Pressing "Start Hangout" disables "Create Broadcast" and vice versa — confusing UX when one succeeds and one is still pending.
- **Reusing `handleCreateBroadcast` with a sessionType param:** The success criteria requires a clearly labeled "Start Hangout" button — a single generic function with a param works but muddies intent. Keep handlers separate for clarity.
- **Adding a new route for hangout creation:** The route `/hangout/:sessionId` already exists in `App.tsx`. No routing changes needed.
- **Calling a different API endpoint:** `POST /sessions` with `sessionType: 'HANGOUT'` is correct. The `create-session.ts` handler already validates both `'BROADCAST'` and `'HANGOUT'` as valid session types (line 39).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hangout session creation | Custom session creation logic | `POST /sessions` with `sessionType: 'HANGOUT'` | Already implemented in `create-session.ts` |
| Auth token retrieval | Re-implementing token fetch | `fetchAuthSession()` from `aws-amplify/auth` | Already used in `handleCreateBroadcast` |
| Navigation to hangout | Custom routing | `useNavigate` from `react-router-dom` | Route `/hangout/:sessionId` already registered in `App.tsx` |
| Loading spinner UI | Custom animation | `disabled` state on button + text change | Matches existing pattern in the codebase |

**Key insight:** Everything is already built. Phase 12 is wiring the user action to existing infrastructure.

---

## Common Pitfalls

### Pitfall 1: HangoutPage Does Not Consume `location.state`

**What goes wrong:** Developer passes `state: { session: sessionData }` in navigate call but HangoutPage ignores it and immediately calls `POST /sessions/:id/join` (fetching session data redundantly). This is fine — no error — but worth noting.

**Why it happens:** HangoutPage was built before the "navigate with state" pattern was established as the convention. The page reads `sessionId` from `useParams` directly.

**How to avoid:** The navigate call with state is correct regardless. If HangoutPage does fetch the session separately, it's redundant but not broken. Do not change HangoutPage in this phase — it's out of scope.

**Warning sign:** Not a problem. Just awareness that state may be unused by the consumer.

### Pitfall 2: 503 Response When Stage Pool Is Empty

**What goes wrong:** User clicks "Start Hangout", backend returns 503 with `{ error: 'No HANGOUT resources available' }` (or similar). The frontend's generic error catch displays "Failed to create session. Try again."

**Why it happens:** The Stage pool (pre-warmed by Phase 11 / replenish-pool Lambda) may be empty during development or cold start.

**How to avoid:** The error message "Failed to create session. Try again." is the established project convention (same wording used for broadcast failures per `STATE.md` — "Exact wording per user decision"). This is the correct behavior. No special handling of 503 is needed for Phase 12. Pool replenishment is a backend concern.

**Warning sign:** If testing locally, the pool may be empty. Use the replenish-pool mechanism or seed test data.

### Pitfall 3: Button Label Inconsistency with Success Criteria

**What goes wrong:** Developer labels button "Create Hangout" or "Join Hangout" instead of "Start Hangout".

**Why it happens:** Natural language variation.

**How to avoid:** The success criteria explicitly states "Start Hangout" — use that exact label.

### Pitfall 4: Navigate to Wrong Path

**What goes wrong:** Developer navigates to `/hangouts/${sessionData.sessionId}` (plural) instead of `/hangout/${sessionData.sessionId}` (singular).

**Why it happens:** Simple typo — the route in App.tsx is `/hangout/:sessionId` (singular).

**How to avoid:** Verify against `App.tsx` line 110: `path="/hangout/:sessionId"`. Use singular.

---

## Code Examples

Verified patterns from project source code:

### Existing handleCreateBroadcast (Reference — Do Not Modify)

```typescript
// Source: web/src/pages/HomePage.tsx (current state)
const handleCreateBroadcast = async () => {
  const config = getConfig();
  if (!config?.apiUrl) {
    setError('Configuration not loaded');
    return;
  }

  setIsCreating(true);
  setError('');

  try {
    const session = await fetchAuthSession();
    const authToken = session.tokens?.idToken?.toString() || '';
    const response = await fetch(`${config.apiUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionType: 'BROADCAST' }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const sessionData = await response.json();

    navigate(`/broadcast/${sessionData.sessionId}`, {
      state: { session: sessionData }
    });
  } catch (err) {
    setError('Failed to create session. Try again.');
  } finally {
    setIsCreating(false);
  }
};
```

### New handleCreateHangout (Add Alongside Above)

```typescript
// Source: Adapted from handleCreateBroadcast pattern
const handleCreateHangout = async () => {
  const config = getConfig();
  if (!config?.apiUrl) {
    setError('Configuration not loaded');
    return;
  }

  setIsCreatingHangout(true);
  setError('');

  try {
    const session = await fetchAuthSession();
    const authToken = session.tokens?.idToken?.toString() || '';
    const response = await fetch(`${config.apiUrl}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionType: 'HANGOUT' }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const sessionData = await response.json();

    navigate(`/hangout/${sessionData.sessionId}`, {
      state: { session: sessionData }
    });
  } catch (err) {
    setError('Failed to create session. Try again.');
  } finally {
    setIsCreatingHangout(false);
  }
};
```

### Existing Route Verification (No Changes Needed)

```typescript
// Source: web/src/App.tsx lines 109-116 — route already registered
<Route
  path="/hangout/:sessionId"
  element={
    <ProtectedRoute>
      <HangoutPage />
    </ProtectedRoute>
  }
/>
```

### Existing create-session.ts — HANGOUT Already Supported

```typescript
// Source: backend/src/handlers/create-session.ts line 39
if (!body.sessionType || !['BROADCAST', 'HANGOUT'].includes(body.sessionType)) {
  return {
    statusCode: 400,
    body: JSON.stringify({ error: 'sessionType required (BROADCAST or HANGOUT)' }),
  };
}
```

### Button Layout (Inline Style Approach — Matches Project Conventions)

```typescript
// Matches existing HomePage.tsx inline-style approach
// Both buttons in a flex row, error and Log Out below

// State declarations at top of component:
const [isCreating, setIsCreating] = useState(false);
const [isCreatingHangout, setIsCreatingHangout] = useState(false);
const [error, setError] = useState('');

// JSX inside the "Get Started" card:
<div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '1rem' }}>
  <button
    onClick={handleCreateBroadcast}
    disabled={isCreating || isCreatingHangout}
    style={{
      padding: '0.75rem 2rem',
      backgroundColor: isCreating ? '#9e9e9e' : '#1976d2',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '1rem',
      fontWeight: 500,
      cursor: (isCreating || isCreatingHangout) ? 'not-allowed' : 'pointer',
    }}
  >
    {isCreating ? 'Creating...' : 'Go Live'}
  </button>

  <button
    onClick={handleCreateHangout}
    disabled={isCreating || isCreatingHangout}
    style={{
      padding: '0.75rem 2rem',
      backgroundColor: isCreatingHangout ? '#9e9e9e' : '#7b1fa2',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '1rem',
      fontWeight: 500,
      cursor: (isCreating || isCreatingHangout) ? 'not-allowed' : 'pointer',
    }}
  >
    {isCreatingHangout ? 'Creating...' : 'Start Hangout'}
  </button>
</div>
```

**Color rationale:** Purple (`#7b1fa2`) matches the existing "Hangout" badge color used in `RecordingFeed.tsx` for visual consistency. Broadcast uses blue (`#1976d2`). Both are Material Design palette colors already implicit in the codebase.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct URL navigation to hangout | Home page button creates session, navigates with ID | Phase 12 | Users can start hangouts without knowing a direct URL |
| `handleCreateBroadcast` only | `handleCreateBroadcast` + `handleCreateHangout` | Phase 12 | Both session types initiatable from home page |

**No deprecated patterns in this phase.**

---

## Open Questions

1. **Does HangoutPage consume `location.state`?**
   - What we know: `handleCreateBroadcast` navigates with `state: { session: sessionData }`. `HangoutPage` reads `sessionId` from `useParams`, sets up auth token and userId via separate effects. It does NOT appear to read `location.state`.
   - What's unclear: Whether passing state matters for HangoutPage performance.
   - Recommendation: Pass state in `navigate()` call for consistency with the broadcast pattern. HangoutPage ignoring it is fine.

2. **Should "Go Live" or "Create Broadcast" be the broadcast button label?**
   - What we know: Current label in `HomePage.tsx` is `'Create Broadcast'`. The success criteria says "alongside the existing 'Go Live' broadcast button".
   - What's unclear: The success criteria says "Go Live" but the current code says "Create Broadcast". These differ.
   - Recommendation: The success criteria for Phase 12 explicitly says "Go Live" — rename the existing broadcast button from "Create Broadcast" to "Go Live" as part of this phase. This is a one-word change to the existing button label. Doing so satisfies the criteria exactly as written.

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — this section is included based on the existing project test infrastructure.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest + ts-jest (backend); no frontend unit test framework detected |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd /Users/connorhoehn/Projects/videonowandlater/backend && NODE_OPTIONS=--experimental-vm-modules npx jest` |
| Full suite command | `cd /Users/connorhoehn/Projects/videonowandlater/backend && NODE_OPTIONS=--experimental-vm-modules npx jest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HANG-02 | "Start Hangout" button visible on HomePage | manual-only | Visual verification in browser | N/A — no frontend test framework |
| HANG-02 | Clicking button POSTs to `/sessions` with `sessionType: 'HANGOUT'` | manual-only | Browser devtools network tab | N/A |
| HANG-02 | Navigation to `/hangout/:id` after success | manual-only | Browser URL bar | N/A |

**Note:** The web frontend has no automated test framework (no vitest/jest config detected for `web/`). Manual browser testing is the validation approach for this phase.

### Wave 0 Gaps

None — no test framework changes needed. Phase 12 is a frontend-only change verified manually.

---

## Sources

### Primary (HIGH confidence)

- Project source: `web/src/pages/HomePage.tsx` — full current state read; `handleCreateBroadcast` pattern is the direct model
- Project source: `web/src/App.tsx` — `/hangout/:sessionId` route already registered with `ProtectedRoute` and `HangoutPage`
- Project source: `backend/src/handlers/create-session.ts` line 39 — `HANGOUT` already a valid `sessionType` in the validation check
- Project source: `web/src/features/hangout/HangoutPage.tsx` — reads `sessionId` from `useParams`, expects authenticated user, navigates via `/` on leave
- Project source: `web/package.json` — React 19.2, react-router-dom 7.7.1, aws-amplify 6.12.2 confirmed

### Secondary (MEDIUM confidence)

- REQUIREMENTS.md `HANG-02` description: "Pre-warmed Stage pool maintains ready-to-use RealTime Stages (mirrors Channel pool pattern)" — the UI gap is the missing user-facing trigger; backend pool is addressed in Phase 11
- Phase 11 RESEARCH.md — confirms Stage pool, session creation, and HangoutPage infrastructure is complete; Phase 12 is purely the UI entry point

### Tertiary (LOW confidence)

- None required — all findings verified directly from project source.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from package.json and existing source files
- Architecture: HIGH — pattern is a direct clone of existing `handleCreateBroadcast`; route and backend already verified
- Pitfalls: HIGH — verified by reading App.tsx, HomePage.tsx, create-session.ts, HangoutPage.tsx
- Open question (button label rename): MEDIUM — success criteria says "Go Live" but current code says "Create Broadcast"; recommendation to rename is reasonable but the user should confirm

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable project; no external API changes in scope)
