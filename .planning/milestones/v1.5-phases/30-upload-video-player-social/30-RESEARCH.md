# Phase 30: Upload Video Player Social - Research

**Researched:** 2026-03-11
**Domain:** Frontend React components, backend Lambda handlers, DynamoDB single-table design
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIDP-05 | Collapsible info panel showing AI summary and speaker-attributed (or plain) transcript | `TranscriptDisplay` + `SummaryDisplay` already exist in `web/src/features/replay/`; reuse directly. `session.diarizedTranscriptS3Path` drives diarized vs. plain fallback. |
| VIDP-06 | User can post a timestamped comment anchored to current video position | New backend handlers `create-comment.ts` + `get-comments.ts`; `useHlsPlayer` already exposes `syncTime` in ms. Comment SK: `COMMENT#{zeroPadded15DigitMs}#{uuid}`. |
| VIDP-07 | Comments fetched on page load via polling, sorted newest-first by default with position sort option | Single `GET /sessions/{sessionId}/comments` endpoint. Frontend state: `sortOrder: 'newest' | 'position'`. Default newest-first. |
| VIDP-08 | Comments within ±1500ms of current playback position are visually highlighted during playback | `useCommentHighlight` hook compares each comment's `videoPositionMs` against `syncTime` every `timeupdate` (250ms poll cadence on `syncTime`). |
| VIDP-09 | Emoji reactions (same set as broadcast/replay) stored and displayed as reaction summary counts | `useReactionSender` already works; `create-reaction.ts` accepts `reactionType: 'replay'` which bypasses the live-session check. Problem: UPLOAD sessions lack `startedAt` — must add `startedAt = createdAt` to `createUploadSession` OR fix `create-reaction.ts` to use `createdAt` as fallback. Reaction summary counts displayed with existing `ReactionSummaryPills`. |
</phase_requirements>

---

## Summary

Phase 30 adds three social layers on top of the already-built `VideoPage`: timestamped comments, emoji reactions, and an info panel. All three rely on work that is already partially in place — the frontend has `TranscriptDisplay`, `SummaryDisplay`, `ReactionSummaryPills`, `ReplayReactionPicker`, and `useReactionSender`; the backend already has the reaction infrastructure and the `COMMENT#{ts}#{uuid}` DynamoDB SK format is fully specified.

The main new backend work is two Lambda handlers (`create-comment.ts`, `get-comments.ts`) and their CDK wiring. The main new frontend work is a `CommentThread` component with a `useCommentHighlight` hook, and wiring the info panel (collapsible, reusing existing transcript/summary components) into `VideoPage`. The reactions feature is largely a wire-up — `useReactionSender` already handles `POST /sessions/{id}/reactions` with `reactionType: 'replay'`; the only blocker is that UPLOAD sessions have no `startedAt` field, which `create-reaction.ts` requires for `sessionRelativeTime` computation.

**Primary recommendation:** Add `startedAt = createdAt` in `createUploadSession` (backend session-repository) so UPLOAD sessions pass the `startedAt` guard in `create-reaction.ts`. This is a one-line fix that makes reactions work on upload sessions without touching the handler. Then build the two comment handlers, CDK wiring, and frontend components.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x (existing) | Component rendering | Project standard |
| TypeScript | 5.x (existing) | Type safety | Project standard |
| Tailwind CSS | 3.x (existing) | Styling | Project standard |
| AWS SDK v3 `@aws-sdk/lib-dynamodb` | existing | DynamoDB comment storage | Project standard |
| `uuid` v9 | existing | Comment ID generation | Already in backend package.json |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `aws-amplify/auth` | existing | Auth token extraction | Auth-gated API calls |
| `react-router-dom` | existing | `useParams` in VideoPage | Route parameterisation |

### No New Dependencies
All required libraries are already installed. Do not add new npm packages.

---

## Architecture Patterns

### Recommended Project Structure for New Files

```
backend/src/handlers/
├── create-comment.ts           # POST /sessions/{id}/comments
└── get-comments.ts             # GET /sessions/{id}/comments

backend/src/handlers/__tests__/
├── create-comment.test.ts
└── get-comments.test.ts

web/src/features/upload/
├── VideoPage.tsx               # MODIFY: add comments, reactions, info panel
├── CommentThread.tsx           # NEW: renders comment list + composer
├── useCommentHighlight.ts      # NEW: returns set of highlighted commentIds
└── VideoInfoPanel.tsx          # NEW: collapsible summary + transcript panel

web/src/features/replay/
├── TranscriptDisplay.tsx       # REUSE unchanged
└── SummaryDisplay.tsx          # REUSE unchanged

infra/lib/stacks/
└── api-stack.ts                # MODIFY: add comment Lambda constructs + routes
```

### Pattern 1: DynamoDB Comment Storage Key Design

**What:** Comments stored in the project's single table with session-scoped keys.
**Schema (confirmed in STATE.md):**
```
PK: SESSION#{sessionId}
SK: COMMENT#{zeroPadded15DigitMs}#{uuid}
entityType: 'COMMENT'
Additional fields: userId, text, videoPositionMs (number), createdAt (ISO string)
```

**Sort by position:** Query `SK` between `COMMENT#000000000000000` and `COMMENT#999999999999999` — items come back in ascending position order naturally from DynamoDB.
**Sort newest-first:** Fetch all comments, sort descending on `createdAt` in the frontend.

**Example:**
```typescript
// create-comment handler SK construction
const paddedMs = videoPositionMs.toString().padStart(15, '0');
const commentId = uuid();
const sk = `COMMENT#${paddedMs}#${commentId}`;
```

### Pattern 2: Comment Highlight Hook

**What:** Compares each comment's `videoPositionMs` to the player's `syncTime` and returns a Set of highlighted comment IDs.
**When to use:** Consumed by `CommentThread` to apply highlight CSS class.
**Key detail:** `syncTime` from `useHlsPlayer` is already in milliseconds (confirmed in 29-01-SUMMARY.md: `setSyncTime(video.currentTime * 1000)`). Use ±1500ms window.

```typescript
// web/src/features/upload/useCommentHighlight.ts
export function useCommentHighlight(comments: Comment[], syncTime: number): Set<string> {
  return useMemo(() => {
    const highlighted = new Set<string>();
    for (const c of comments) {
      if (Math.abs(c.videoPositionMs - syncTime) <= 1500) {
        highlighted.add(c.commentId);
      }
    }
    return highlighted;
  }, [comments, syncTime]);
}
```

### Pattern 3: Auth-Gated Fetch (Project Standard)

All backend calls follow this guard pattern (confirmed across VideoPage, ReplayViewer):

```typescript
// Guard with authToken presence check
useEffect(() => {
  if (!sessionId || !authToken) return;
  // ... fetch
}, [sessionId, authToken]);
```

### Pattern 4: Reaction Wire-Up for Upload Sessions

**What:** Reuse `useReactionSender` with `reactionType: 'replay'` and display summary with `ReactionSummaryPills`.

**Critical prerequisite:** UPLOAD sessions created by `createUploadSession` in `session-repository.ts` do NOT set `startedAt`. The `create-reaction.ts` handler checks `if (!session.startedAt)` and returns 400. Fix: add `startedAt: now` to the `uploadSession` object in `createUploadSession`.

```typescript
// backend/src/repositories/session-repository.ts - createUploadSession fix
const uploadSession: Session = {
  sessionId,
  userId,
  sessionType: SessionType.UPLOAD,
  status: SessionStatus.CREATING,
  claimedResources: { chatRoom: '' },
  createdAt: now,
  startedAt: now,     // ADD THIS LINE - required for reaction sessionRelativeTime
  version: 1,
  // ... rest of fields
};
```

**Reaction summary display:** `session.reactionSummary` is written at session end by the existing `updateRecordingMetadata` in session-repository. For upload sessions, reactions submitted after creation will be stored individually but `reactionSummary` will be `undefined` until a summary-compute step runs. The VideoPage should show live reaction counts by fetching `GET /sessions/{id}/reactions` (existing endpoint) and computing counts client-side — similar to how ReplayViewer fetches `allReactions` and uses `ReactionSummaryPills` with `session.reactionSummary`. For VideoPage, supplement `session.reactionSummary` with a locally computed count from `allReactions` if the session has no pre-computed summary.

### Pattern 5: Collapsible Info Panel

**What:** A `<details>` / toggle-based collapsible below the video that shows AI summary and transcript.
**Design:** Single button toggles `showInfoPanel` state in `VideoPage`; the panel contents are `SummaryDisplay` + `TranscriptDisplay` already wired to fetch their own data.

**Note:** `TranscriptDisplay` requires `currentTime` (ms) — pass `syncTime` from `useHlsPlayer`. It also requires `diarizedTranscriptS3Path` for bubble mode — pass from `session.diarizedTranscriptS3Path`.

```tsx
{/* VideoPage.tsx — info panel toggle */}
<button
  onClick={() => setShowInfoPanel(p => !p)}
  className="w-full text-left px-6 py-3 bg-white border rounded-lg shadow text-sm font-medium text-gray-700 flex justify-between items-center"
>
  <span>Summary & Transcript</span>
  <span>{showInfoPanel ? '▲' : '▼'}</span>
</button>
{showInfoPanel && (
  <div className="mt-2 bg-white rounded-lg shadow">
    <SummaryDisplay summary={session.aiSummary} status={session.aiSummaryStatus} truncate={false} />
    <TranscriptDisplay sessionId={sessionId!} currentTime={syncTime} authToken={authToken} diarizedTranscriptS3Path={session.diarizedTranscriptS3Path} />
  </div>
)}
```

`showTranscript` is already declared (but unused) in `VideoPage.tsx` from Phase 29. Rename to `showInfoPanel` or use the existing state variable.

### Anti-Patterns to Avoid

- **Don't fork `TranscriptDisplay` or `SummaryDisplay`**: They already handle all states (loading, error, diarized, plain). Reuse as-is.
- **Don't use WebSockets for comments**: Requirement explicitly calls for polling. No real-time infrastructure.
- **Don't store comment arrays inline in DynamoDB**: Keep them as separate items (same rule as speaker segments).
- **Don't create a new `ReactionPicker` component**: `ReplayReactionPicker` is identical to what's needed — import and reuse it.
- **Don't add a new `reactionType` value for upload**: Pass `reactionType: 'replay'` to `useReactionSender` — the backend accepts it for any non-live session.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Emoji picker UI | Custom emoji picker | `ReplayReactionPicker` from `web/src/features/replay/ReplayReactionPicker.tsx` | Already built with cooldown, correct emoji set, same styling |
| Reaction POST API call | Direct `fetch()` call | `useReactionSender` hook from `web/src/features/reactions/useReactionSender.ts` | Handles loading, error state, correct body format |
| Reaction count display | Custom pill rendering | `ReactionSummaryPills` from `web/src/features/activity/ReactionSummaryPills.tsx` | Handles empty state, maps emoji types to unicode |
| AI summary display | Inline status-checking | `SummaryDisplay` from `web/src/features/replay/SummaryDisplay.tsx` | Handles pending/available/failed states |
| Transcript display | Custom fetch + render | `TranscriptDisplay` from `web/src/features/replay/TranscriptDisplay.tsx` | Handles diarized bubble mode + plain fallback + auto-scroll |
| DynamoDB document client | Raw DynamoDB client | `getDocumentClient()` from `backend/src/lib/dynamodb-client.ts` | Project standard singleton |

**Key insight:** Every social component needed for this phase already exists in the codebase from the replay and reactions features. Phase 30 is primarily a wiring exercise with two new backend handlers.

---

## Common Pitfalls

### Pitfall 1: Upload Session Missing `startedAt`
**What goes wrong:** `POST /sessions/{id}/reactions` returns 400 "Session has no startedAt timestamp" for all upload sessions.
**Why it happens:** `createUploadSession` in `session-repository.ts` does not set `startedAt`. The `create-reaction.ts` handler requires it to compute `sessionRelativeTime`.
**How to avoid:** Add `startedAt: now` to the `uploadSession` object in `createUploadSession`. This is a one-line change to `backend/src/repositories/session-repository.ts`.
**Warning signs:** Any reaction test against an UPLOAD session fixture without `startedAt` will hit the 400 guard.

### Pitfall 2: Comment Sort — Newest vs. Position
**What goes wrong:** Using a single DynamoDB query sort order for both sort modes leads to extra logic or round-trips.
**Why it happens:** DynamoDB returns comments in SK order (ascending video position). Newest-first requires sorting by `createdAt` descending.
**How to avoid:** Fetch all comments from DynamoDB (SK prefix `COMMENT#`), return them to the frontend unsorted (position order). Frontend applies sort: position sort = use as-is, newest sort = `.sort((a,b) => b.createdAt.localeCompare(a.createdAt))`. Keep the sort in frontend state, not as a separate API call.

### Pitfall 3: `videoPositionMs` Value at Comment Post Time
**What goes wrong:** Comment is anchored to wrong video position because `syncTime` is stale or 0.
**Why it happens:** `syncTime` from `useHlsPlayer` is 0 until the video has played/seeked. If user hasn't started the video, the comment gets anchored to position 0ms.
**How to avoid:** Disable the comment submit button when `syncTime === 0` (video not started). Include the current `syncTime` value in the submit form display so users see what position they're commenting at.

### Pitfall 4: `TranscriptDisplay` Height in a Collapsible Panel
**What goes wrong:** `TranscriptDisplay` renders with `h-full` and a `flex-col` container, expecting a parent with fixed height. In a collapsible panel without constrained height, it may overflow.
**Why it happens:** `TranscriptDisplay` was built for the replay 3-column layout with `lg:col-span-1 h-[600px]`.
**How to avoid:** Wrap `TranscriptDisplay` in a div with `max-h-[500px]` in the info panel. The component's `overflow-y-auto` on the scroll container handles the rest.

### Pitfall 5: Reaction Count Display Timing
**What goes wrong:** `session.reactionSummary` is `undefined` on UPLOAD sessions (it is only written at session end by existing pipeline stages for BROADCAST/HANGOUT). Displaying it as "No reactions" immediately after a user submits a reaction is confusing.
**Why it happens:** Unlike BROADCAST sessions, UPLOAD sessions have no session-end hook that computes reaction summary. The field remains undefined.
**How to avoid:** Compute local reaction counts from `allReactions` array (fetched from `GET /sessions/{id}/reactions`) for display alongside `session.reactionSummary`. Merge: `session.reactionSummary` (pre-existing historical) + counts from `allReactions`. This gives accurate counts without a new backend endpoint.

---

## Code Examples

### New Handler: `create-comment.ts`
```typescript
// backend/src/handlers/create-comment.ts
// POST /sessions/{sessionId}/comments
// Body: { text: string, videoPositionMs: number }
// Response 201: { commentId, videoPositionMs, createdAt }

// DynamoDB key:
const paddedMs = videoPositionMs.toString().padStart(15, '0');
const commentId = uuid();
const pk = `SESSION#${sessionId}`;
const sk = `COMMENT#${paddedMs}#${commentId}`;

// Item fields:
{
  PK: pk, SK: sk,
  entityType: 'COMMENT',
  commentId, sessionId, userId, text, videoPositionMs, createdAt,
}
```

### New Handler: `get-comments.ts`
```typescript
// backend/src/handlers/get-comments.ts
// GET /sessions/{sessionId}/comments
// Response 200: { comments: Comment[] } — in videoPositionMs ascending order

// DynamoDB query:
{
  TableName: tableName,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
  ExpressionAttributeValues: {
    ':pk': `SESSION#${sessionId}`,
    ':prefix': 'COMMENT#',
  },
}
```

### Frontend: `CommentThread` usage in VideoPage
```tsx
// VideoPage.tsx addition
import { CommentThread } from './CommentThread';

// In JSX after video container:
<CommentThread
  sessionId={sessionId!}
  authToken={authToken}
  syncTime={syncTime}
/>
```

### Frontend: `useCommentHighlight`
```typescript
// web/src/features/upload/useCommentHighlight.ts
import { useMemo } from 'react';

export function useCommentHighlight(
  comments: { commentId: string; videoPositionMs: number }[],
  syncTime: number
): Set<string> {
  return useMemo(() => {
    const set = new Set<string>();
    for (const c of comments) {
      if (Math.abs(c.videoPositionMs - syncTime) <= 1500) {
        set.add(c.commentId);
      }
    }
    return set;
  }, [comments, syncTime]);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ReplayViewer had transcript in sidebar tab | `TranscriptDisplay` now supports diarized bubble mode | Phase 27 | Reuse for VideoPage info panel directly |
| Reactions only for BROADCAST/HANGOUT | Reactions can use `reactionType: 'replay'` for VOD | Phase 10+ | Upload page can submit reactions without new handler logic |
| `hls.currentLevel` for quality switch | `hls.nextLevel` to avoid buffer stall | Phase 29 | No change needed — already done |
| `syncTime` was absent from upload player | `useHlsPlayer` returns `syncTime` as `currentTime * 1000` | Phase 29 | Comment anchoring works without additional hook changes |

**What VideoPage already has from Phase 29 that Phase 30 can use directly:**
- `useHlsPlayer` — returns `syncTime` in ms (comment anchoring)
- `session.aiSummary` + `session.aiSummaryStatus` — already in `UploadSession` interface
- `session.diarizedTranscriptS3Path` — field exists in domain model
- `showTranscript` state variable — declared but unused, can be repurposed as `showInfoPanel`

---

## API Contract Summary

### New Endpoints (to be created)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/sessions/{id}/comments` | Cognito | `{ text: string, videoPositionMs: number }` | 201 `{ commentId, videoPositionMs, createdAt }` |
| GET | `/sessions/{id}/comments` | Cognito | — | 200 `{ comments: Comment[] }` |

### Existing Endpoints Used

| Method | Path | Used By |
|--------|------|---------|
| POST | `/sessions/{id}/reactions` | Reaction submission with `reactionType: 'replay'` |
| GET | `/sessions/{id}/reactions` | Reaction count computation |
| GET | `/sessions/{id}/transcript` | `TranscriptDisplay` (already wires itself) |
| GET | `/sessions/{id}/speaker-segments` | `TranscriptDisplay` (already wires itself) |

---

## Open Questions

1. **Should `reactionSummary` be computed for UPLOAD sessions?**
   - What we know: `reactionSummary` is written at session end by the existing pipeline for BROADCAST/HANGOUT. UPLOAD sessions have no equivalent session-end hook.
   - What's unclear: Whether the plan should add a reaction-summary computation step for UPLOAD sessions or rely on the client-side merge approach.
   - Recommendation: Use client-side merge (fetch `allReactions`, compute counts locally). This is simpler and sufficient — the data volume on VOD comments is low compared to live sessions.

2. **Comment pagination for long videos?**
   - What we know: `get-comments.ts` will query `begins_with(SK, 'COMMENT#')` — this could return many items for popular videos.
   - What's unclear: Whether the plan needs pagination.
   - Recommendation: No pagination for v1.5. Add a `Limit: 500` guard in the handler to prevent unbounded reads. This is consistent with how `get-reactions.ts` caps at 100.

3. **Should `VideoPage.UploadSession` interface be extended or a shared type used?**
   - What we know: `VideoPage.tsx` defines its own local `UploadSession` interface. `ReplayViewer.tsx` defines its own local `Session` interface. Neither imports from domain.
   - Recommendation: Extend the existing local `UploadSession` interface in `VideoPage.tsx` to add `diarizedTranscriptS3Path?: string` (needed for `TranscriptDisplay`). No shared type refactoring needed.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reads: `web/src/features/upload/useHlsPlayer.ts`, `VideoPage.tsx`, `ReplayViewer.tsx`, `TranscriptDisplay.tsx`, `SummaryDisplay.tsx`, `ReactionPicker.tsx`, `ReplayReactionPicker.tsx`, `ReactionSummaryPills.tsx`, `useReactionSender.ts`
- Direct codebase reads: `backend/src/handlers/create-reaction.ts`, `get-reactions.ts`, `backend/src/domain/reaction.ts`, `backend/src/repositories/reaction-repository.ts`, `backend/src/repositories/session-repository.ts` (createUploadSession)
- Direct codebase reads: `infra/lib/stacks/api-stack.ts` (CDK Lambda + route patterns)
- Phase 29 summaries: `29-01-SUMMARY.md` (syncTime contract), `29-02-SUMMARY.md` (VideoPage structure)

### Secondary (MEDIUM confidence)
- `STATE.md` — documented architectural decisions for Phase 30 (comment SK format, ±1500ms highlight window, poll 250ms, `reactionType='replay'`)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are in the existing codebase, no new dependencies
- Architecture: HIGH — key files read directly, patterns confirmed from working code
- Pitfalls: HIGH — startedAt gap confirmed by code inspection, other pitfalls derived from existing component contracts

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable codebase, no external library changes)
