# Phase 41: UI Polish — Live Session & Upload - Research

**Researched:** 2026-03-15
**Domain:** React frontend (Vite + Tailwind), confirmation dialogs, HangoutPage reactions, VideoPage pipeline polling and functional comment/transcript panels
**Confidence:** HIGH

## Summary

Phase 41 is the final UI polish phase of v1.7. It addresses four remaining requirements across three surfaces: live session pages (BroadcastPage and HangoutPage) and the upload video page (VideoPage). All work is pure frontend; no new backend endpoints, Lambda changes, or CDK infrastructure are needed.

The codebase audit reveals clearly what is missing. BroadcastPage has a "Stop Broadcast" button that calls `stopBroadcast()` directly — no guard, no confirmation. HangoutPage has a "Leave" button calling `handleLeave()` directly — same issue. HangoutPage has no reaction system: no `ReactionPicker`, no `FloatingReactions`, no `useReactionSender`, and no `useReactionListener`. All of these components exist and are fully operational in BroadcastPage, so this is a copy-and-wire task. VideoPage has `CommentThread` and `VideoInfoPanel`/`TranscriptDisplay` already rendered, but they have gaps: `CommentThread` does not expose a seek callback, `VideoInfoPanel`/`TranscriptDisplay` accept an `onSeek` prop but `VideoPage` does not wire it to `videoRef.current.currentTime`. VideoPage also has no live pipeline polling — it fetches session data once on mount and never refreshes, so a user watching a video being transcribed sees a stale "processing" state indefinitely.

**Primary recommendation:** Treat this phase as four isolated changes: (1) extract a reusable `ConfirmDialog` component and wire it to both Stop/Leave buttons, (2) copy the reaction system from BroadcastPage into HangoutPage, (3) add session polling to VideoPage using the same exponential-backoff pattern as HomePage, (4) wire `onSeek` from VideoPage through VideoInfoPanel to TranscriptDisplay, and add click-to-seek to `CommentThread`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-06 | Stop Broadcast / Leave Hangout shows confirmation dialog before ending | BroadcastPage `stopBroadcast` is called directly on button click (line 360); HangoutPage `handleLeave` is called directly on two buttons (lines 142, 194); add `showConfirmDialog` state + `ConfirmDialog` component to both pages |
| UI-07 | Hangout page has reaction picker and floating reactions (parity with broadcast) | HangoutPage has zero reaction imports; BroadcastPage already has full reaction system (ReactionPicker, FloatingReactions, useReactionSender, useReactionListener, EMOJI_MAP) — copy the pattern |
| UI-08 | Upload video page shows pipeline progress indicator while processing, updates to final state when complete | VideoPage fetches session once on mount (lines 75-128); no polling; re-use exponential-backoff polling pattern from HomePage (15s→30s→60s, stop on terminal states) |
| UI-09 | Upload video page comment thread and transcript panel are fully functional: submit comment, see it in thread, click to seek; transcript segments support click-to-seek | `CommentThread` renders comments but has no seek callback (clicking a comment does not seek); `VideoInfoPanel` passes `onSeek` to TranscriptDisplay but `VideoPage` does not pass `onSeek` to `VideoInfoPanel` (line 309-317); `useHlsPlayer` returns `videoRef` — seek via `videoRef.current.currentTime = timeMs / 1000` |
</phase_requirements>

## Standard Stack

### Core (already in project — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 18 | current | UI framework | Already in use |
| Tailwind CSS | current | Styling | All components use utility classes |
| motion/react (Framer Motion) | current | FloatingReactions animation | Already used in FloatingReactions.tsx |
| Vitest + @testing-library/react | current | Frontend tests | Already configured in web/vitest.config.ts |
| uuid (v4) | current | Unique reaction IDs for FloatingReactions | Already used in BroadcastPage |

### No New Dependencies Required
Zero new npm packages for this phase.

## Architecture Patterns

### Existing Component Structure
```
web/src/
  features/
    broadcast/
      BroadcastPage.tsx        # Has full reaction system — reference implementation
      CameraPreview.tsx        # Has FloatingReactions overlay — reference
    hangout/
      HangoutPage.tsx          # Missing reactions; has Leave button needing confirm guard
    reactions/
      ReactionPicker.tsx       # EmojiType, EMOJI_MAP, onReaction callback, cooldown
      FloatingReactions.tsx    # motion/react animation, FloatingEmoji type
      useReactionSender.ts     # POST /sessions/:id/reactions
      useReactionListener.ts   # IVS Chat 'reaction' event listener
    upload/
      VideoPage.tsx            # Has CommentThread + VideoInfoPanel; no polling; seek not wired
      VideoInfoPanel.tsx       # Passes onSeek to TranscriptDisplay; VideoPage does not pass it
      CommentThread.tsx        # Comments list + composer; no seek callback
      useHlsPlayer.ts          # Returns videoRef (HTMLVideoElement) — seek via currentTime
    replay/
      TranscriptDisplay.tsx    # onSeek prop already exists and wired to onClick
      SummaryDisplay.tsx       # Three visual states — already complete from Phase 40
```

### Pattern 1: Confirmation Dialog (UI-06)
**What:** A simple modal overlay controlled by a `showConfirm` boolean state. Clicking the destructive button (Stop/Leave) sets `showConfirm = true`. The dialog renders two buttons: "Cancel" (sets it back to false) and "Confirm" (calls the actual action + navigates).
**When to use:** Any destructive, irreversible action that can be triggered by an accidental tap.
**Example pattern:**
```typescript
// In BroadcastContent (or HangoutPage):
const [showStopConfirm, setShowStopConfirm] = React.useState(false);

// Button: replaces direct call with guard
<button onClick={() => setShowStopConfirm(true)}>Stop Broadcast</button>

// Dialog overlay (portal-style via fixed positioning):
{showStopConfirm && (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
    <div className="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-4">
      <h2>Stop broadcast?</h2>
      <p>Your stream will end and viewers will be disconnected.</p>
      <div className="flex gap-3 justify-end mt-4">
        <button onClick={() => setShowStopConfirm(false)}>Cancel</button>
        <button onClick={() => { stopBroadcast(); setShowStopConfirm(false); }}>Stop</button>
      </div>
    </div>
  </div>
)}
```
**ConfirmDialog as a shared component:** Extract to `web/src/components/ConfirmDialog.tsx` so both BroadcastPage and HangoutPage use the same component. Props: `isOpen`, `title`, `message`, `confirmLabel`, `onConfirm`, `onCancel`.

### Pattern 2: Reactions in HangoutPage (UI-07)
**What:** Copy the exact reaction wiring from BroadcastPage into HangoutPage. The IVS Stages (hangout) sessions use the same IVS Chat room as broadcast sessions — `useChatRoom` is already present in HangoutPage.
**Existing imports to add:**
```typescript
import { v4 as uuidv4 } from 'uuid';
import { ReactionPicker, EMOJI_MAP, type EmojiType } from '../reactions/ReactionPicker';
import { FloatingReactions, type FloatingEmoji } from '../reactions/FloatingReactions';
import { useReactionSender } from '../reactions/useReactionSender';
import { useReactionListener } from '../reactions/useReactionListener';
```
**State to add:**
```typescript
const [floatingReactions, setFloatingReactions] = React.useState<FloatingEmoji[]>([]);
const { sendReaction, sending } = useReactionSender(sessionId || '', authToken);
```
**Handler to add:**
```typescript
const handleReaction = async (emoji: EmojiType) => {
  await sendReaction(emoji);
  setFloatingReactions(prev => [...prev, { id: uuidv4(), emoji: EMOJI_MAP[emoji], timestamp: Date.now() }]);
};
```
**Listener to add (after useChatRoom):**
```typescript
useReactionListener(room, (reaction) => {
  const emoji = EMOJI_MAP[reaction.emojiType];
  setFloatingReactions(prev => [...prev, { id: uuidv4(), emoji, timestamp: Date.now() }]);
});
```
**FloatingReactions overlay placement:** Wrap the VideoGrid in a `relative` container and position FloatingReactions absolutely inside it (same as CameraPreview in BroadcastPage).
**ReactionPicker placement:** Add to the controls bar alongside the Mute/Camera buttons (only shown when `isJoined`).

### Pattern 3: VideoPage Session Polling (UI-08)
**What:** After the initial fetch, start a polling interval while any status field is non-terminal. Use the exact same exponential backoff as HomePage (15s → 30s → 60s cap). Stop polling when all relevant statuses are terminal.
**Terminal states for upload sessions:**
```typescript
function isUploadTerminal(session: UploadSession): boolean {
  const { convertStatus, transcriptStatus, aiSummaryStatus, recordingStatus } = session;
  // Processing is complete if ai summary reached a terminal state or any stage failed
  const anyFailed = [convertStatus, transcriptStatus, aiSummaryStatus, recordingStatus]
    .some(s => s === 'failed');
  return anyFailed || aiSummaryStatus === 'available';
}
```
**State additions:**
```typescript
const [pollInterval, setPollInterval] = useState(15000);
const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
```
**Polling useEffect (mirrors HomePage pattern exactly):**
```typescript
useEffect(() => {
  if (!session || isUploadTerminal(session)) {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    return;
  }
  const intervalId = setInterval(async () => {
    // re-fetch session
    setPollInterval(prev => Math.min(prev * 2, 60000));
  }, pollInterval);
  pollIntervalRef.current = intervalId;
  return () => { clearInterval(intervalId); pollIntervalRef.current = null; };
}, [session, pollInterval, sessionId, authToken]);
```
**Pipeline indicator:** The `SessionAuditLog` component already renders a processing timeline with icons — it is already rendered in VideoPage (line 279). Polling refreshes `session` state, which re-renders `SessionAuditLog` automatically. No new "pipeline progress indicator" component is needed. The existing `PipelineStatusBadge` pattern from activity cards can optionally be added to the VideoPage header as well.

### Pattern 4: Click-to-Seek in VideoPage (UI-09)
**What:** `useHlsPlayer` returns `videoRef` (a `React.RefObject<HTMLVideoElement>`). To seek: `videoRef.current.currentTime = timeMs / 1000`. This is the established pattern from Phase 40's STATE.md decision: "use `videoRef.current.currentTime = timeMs / 1000`".
**Wiring chain:**
1. `VideoPage` defines `const seekVideo = (timeMs: number) => { if (videoRef.current) videoRef.current.currentTime = timeMs / 1000; }`
2. Pass `onSeek={seekVideo}` to `VideoInfoPanel`
3. `VideoInfoPanel` already accepts `syncTime` and passes it to `TranscriptDisplay` — add `onSeek` prop and pass it through
4. `TranscriptDisplay` already has `onSeek` wired to segment clicks — already complete from Phase 40

**CommentThread seek:** `CommentThread` currently highlights comments near the current syncTime but clicking a comment row does not seek. Add a `onSeek?: (timeMs: number) => void` prop to `CommentThread` and attach `onClick={() => onSeek?.(comment.videoPositionMs)}` to each comment row div. Wire `onSeek={seekVideo}` from `VideoPage`.

### Anti-Patterns to Avoid
- **Building a custom animation library for floating reactions in HangoutPage:** FloatingReactions already uses motion/react. Reuse it exactly.
- **Adding a new polling hook:** Use `useRef` + `useState` for interval management directly in `VideoPage`, same as `HomePage`. Do not introduce a shared polling hook abstraction — premature.
- **Seeking via IVS Player SDK on VideoPage:** VideoPage uses HLS.js (not IVS Player), so seek via `videoRef.current.currentTime`, not `player.seekTo()`. The IVS Player seek pattern is correct for ReplayViewer only.
- **Making CommentThread scroll-seek to match video:** CommentThread already highlights comments near `syncTime` via `useCommentHighlight`. The task is only to add reverse click-to-seek (comment → video), not video → comment auto-scroll.
- **Polling when video is not processing:** Check terminal states before starting interval. Uploading sessions with `aiSummaryStatus === 'available'` are complete — no polling needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Confirmation dialog | Custom modal system with portals | Inline conditional `{showConfirm && <div className="fixed inset-0 ...">}` | Fixed-position overlay works without portals for this use case; SpotlightModal already uses this exact pattern |
| Reaction animations | Custom CSS keyframe animations | FloatingReactions + motion/react | Already in codebase, handles batching and GPU acceleration |
| Session polling | Generic polling hook / SWR / React Query | `useRef` + `useInterval` pattern (matches HomePage) | Consistency with HomePage; zero new dependencies |
| Seek API | IVS Player SDK seekTo on VideoPage | `videoRef.current.currentTime = timeMs / 1000` | VideoPage uses HLS.js, not IVS Player; HTMLVideoElement seek is correct |

## Common Pitfalls

### Pitfall 1: Confirmation Dialog on Both Leave Buttons in HangoutPage
**What goes wrong:** HangoutPage has TWO "Leave" buttons — one in the header (line 142) and one in the controls bar (line 194). Only the controls-bar one gets the confirmation guard, header still navigates directly.
**Why it happens:** Search for `handleLeave` finds one definition but misses both call sites.
**How to avoid:** Grep for all `handleLeave` call sites before wiring. Both must go through the confirmation state.
**Warning signs:** Test matrix should verify both leave buttons.

### Pitfall 2: FloatingReactions Not Visible in HangoutPage
**What goes wrong:** FloatingReactions is added to HangoutPage but nothing floats — reactions are sent but the overlay is invisible.
**Why it happens:** FloatingReactions must be inside a `position: relative` container. VideoGrid renders tiles; the overlay must be positioned relative to the video section container.
**How to avoid:** Wrap the video section `div` (line 165: `className="w-full md:w-2/3 flex flex-col"`) in a `relative` wrapper and place `<FloatingReactions>` inside it.

### Pitfall 3: VideoPage Polling Starts on Every Session Re-Fetch
**What goes wrong:** The `useEffect([session, pollInterval])` starts a new interval on every state update, causing exponential interval proliferation.
**Why it happens:** `session` state reference changes on every fetch (new object), triggering the effect. Without `pollIntervalRef.current` cleanup in the effect's cleanup function, old intervals keep running.
**How to avoid:** Always `clearInterval(pollIntervalRef.current)` at effect start AND in return cleanup, same as HomePage. The `useRef` pattern is specifically designed for this.

### Pitfall 4: HangoutPage `room` May Be Undefined When `useReactionListener` Is Called
**What goes wrong:** `useReactionListener` is called with `room` before `useChatRoom` resolves, causing no-op — reactions from remote participants never appear.
**Why it happens:** `useChatRoom` is async; `room` starts as `undefined`. `useReactionListener` already handles `if (!room) return`, so this is safe, but the hook must use the live `room` value, not a stale closure.
**How to avoid:** Pass `room` directly from `useChatRoom` return (already the pattern in BroadcastPage). Do not destructure into a local const before passing to the listener.

### Pitfall 5: CommentThread `syncTime === 0` Guard Blocks Seek
**What goes wrong:** The entire composer section is disabled when `syncTime === 0`. If the seek callback is also gated on this, clicking a past comment when paused does nothing.
**Why it happens:** The `syncTime === 0` guard is correct for the composer (can't stamp a comment at position 0 when not playing), but a click-to-seek action should work regardless of whether the video is playing.
**How to avoid:** The `onSeek` click handler on comment rows should NOT be gated by `syncTime === 0`. Only the submit button needs that guard.

### Pitfall 6: VideoInfoPanel Missing `onSeek` Prop
**What goes wrong:** VideoPage passes `onSeek` to `VideoInfoPanel`, but `VideoInfoPanel` interface does not declare it, causing TypeScript error.
**Why it happens:** `VideoInfoPanel` was built before seek was needed; its interface only declares `sessionId`, `authToken`, `syncTime`, `aiSummary`, `aiSummaryStatus`, `diarizedTranscriptS3Path`.
**How to avoid:** Add `onSeek?: (timeMs: number) => void` to `VideoInfoPanelProps` interface and pass it through to `TranscriptDisplay`.

## Code Examples

Verified patterns from existing codebase:

### HLS Seek (VideoPage)
```typescript
// Source: web/src/features/upload/useHlsPlayer.ts + Phase 40 STATE.md decision
// videoRef is returned by useHlsPlayer; use currentTime for seeking
const seekVideo = (timeMs: number) => {
  if (videoRef.current) {
    videoRef.current.currentTime = timeMs / 1000;
  }
};
```

### Reaction System in HangoutPage (copy from BroadcastPage)
```typescript
// Source: web/src/features/broadcast/BroadcastPage.tsx lines 173-207
const { sendReaction, sending } = useReactionSender(sessionId || '', authToken);
const [floatingReactions, setFloatingReactions] = React.useState<FloatingEmoji[]>([]);

const handleReaction = async (emoji: EmojiType) => {
  await sendReaction(emoji);
  setFloatingReactions(prev => [
    ...prev,
    { id: uuidv4(), emoji: EMOJI_MAP[emoji], timestamp: Date.now() },
  ]);
};

useReactionListener(room, (reaction) => {
  const emoji = EMOJI_MAP[reaction.emojiType];
  setFloatingReactions(prev => [
    ...prev,
    { id: uuidv4(), emoji, timestamp: Date.now() },
  ]);
});
```

### Exponential Backoff Polling (VideoPage mirrors HomePage)
```typescript
// Source: web/src/pages/HomePage.tsx lines 57-94
useEffect(() => {
  if (!session || isUploadTerminal(session)) {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    return;
  }
  const intervalId = setInterval(async () => {
    // refetch session and setSessions
    setPollInterval(prev => Math.min(prev * 2, 60000));
  }, pollInterval);
  pollIntervalRef.current = intervalId;
  return () => { clearInterval(intervalId); pollIntervalRef.current = null; };
}, [session, pollInterval]);
```

### ConfirmDialog Component (shared)
```typescript
// Source: Pattern from SpotlightModal (uses fixed positioning + z-index)
// web/src/components/ConfirmDialog.tsx (new file)
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConfirmDialog({ isOpen, title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: ConfirmDialogProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 shadow-xl max-w-sm w-full mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct `stopBroadcast()` on button click | Guard with `ConfirmDialog` state | Phase 41 | Prevents accidental session termination |
| HangoutPage: no reactions | Reaction system copied from BroadcastPage | Phase 41 | Parity with broadcast experience |
| VideoPage: single fetch on mount | Polling with exponential backoff | Phase 41 | Shows live pipeline state; stops when terminal |
| VideoPage: seek not wired | `videoRef.current.currentTime` wired through VideoInfoPanel and CommentThread | Phase 41 | Full comment+transcript click-to-seek |
| seek via IVS Player SDK (ReplayViewer) | HTMLVideoElement.currentTime (HLS.js pages) | Phase 40 | Established; VideoPage uses HLS.js not IVS |

## Open Questions

1. **Should ConfirmDialog be used on the header "Leave" button in HangoutPage?**
   - What we know: Two Leave buttons exist (header line 142, controls bar line 194). Both call `handleLeave`.
   - What's unclear: Success criteria says "accidental taps do not terminate live sessions" — both buttons qualify.
   - Recommendation: Guard both. Single `showLeaveConfirm` state covers both call sites.

2. **Does VideoPage need to show PipelineStatusBadge in addition to SessionAuditLog?**
   - What we know: `SessionAuditLog` already renders the full timeline with status icons in VideoPage. `PipelineStatusBadge` is a compact badge used in activity feed cards.
   - What's unclear: Success criteria says "shows a pipeline progress indicator while the video is still transcribing or being summarized" — SessionAuditLog already does this.
   - Recommendation: Polling to refresh `session` data + existing `SessionAuditLog` is sufficient. No new badge component needed in VideoPage. If a compact badge is desired at the top of the page, reuse `PipelineStatusBadge` — it already handles UPLOAD session status fields.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react |
| Config file | `web/vitest.config.ts` |
| Quick run command | `cd web && npx vitest run --reporter=verbose 2>&1 \| tail -20` |
| Full suite command | `cd web && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-06 | Clicking Stop Broadcast shows ConfirmDialog (not stopBroadcast) | unit | `cd web && npx vitest run src/features/broadcast/__tests__/BroadcastPage.test.tsx` | Exists (add tests) |
| UI-06 | Clicking Leave Hangout (both buttons) shows ConfirmDialog | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | Wave 0 gap |
| UI-06 | ConfirmDialog cancel does not call stopBroadcast/handleLeave | unit | `cd web && npx vitest run src/features/broadcast/__tests__/BroadcastPage.test.tsx` | Exists (add tests) |
| UI-06 | ConfirmDialog confirm calls stopBroadcast/handleLeave | unit | `cd web && npx vitest run src/components/__tests__/ConfirmDialog.test.tsx` | Wave 0 gap |
| UI-07 | ReactionPicker renders in HangoutPage when isJoined | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | Wave 0 gap |
| UI-07 | Clicking emoji calls sendReaction | unit | `cd web && npx vitest run src/features/hangout/__tests__/HangoutPage.test.tsx` | Wave 0 gap |
| UI-08 | VideoPage starts polling when session not terminal | unit | `cd web && npx vitest run src/features/upload/__tests__/VideoPage.test.tsx` | Wave 0 gap |
| UI-08 | VideoPage stops polling when session becomes terminal | unit | `cd web && npx vitest run src/features/upload/__tests__/VideoPage.test.tsx` | Wave 0 gap |
| UI-09 | Clicking transcript segment calls seekVideo | unit | `cd web && npx vitest run src/features/replay/TranscriptDisplay.test.tsx` | Exists (passing) |
| UI-09 | Clicking comment row calls onSeek with videoPositionMs | unit | `cd web && npx vitest run src/features/upload/__tests__/CommentThread.test.tsx` | Wave 0 gap |
| UI-09 | Comment submission succeeds when video has played | unit | `cd web && npx vitest run src/features/upload/__tests__/CommentThread.test.tsx` | Wave 0 gap |

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run --reporter=verbose 2>&1 | tail -20`
- **Per wave merge:** `cd web && npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `web/src/components/__tests__/ConfirmDialog.test.tsx` — covers UI-06 ConfirmDialog component behavior
- [ ] `web/src/features/hangout/__tests__/HangoutPage.test.tsx` — covers UI-06 leave confirm guard, UI-07 reaction parity
- [ ] `web/src/features/upload/__tests__/VideoPage.test.tsx` — covers UI-08 polling behavior
- [ ] `web/src/features/upload/__tests__/CommentThread.test.tsx` — covers UI-09 comment seek + submission

Note: `web/src/features/replay/TranscriptDisplay.test.tsx` covers UI-09 transcript seek and is already passing.
Note: `web/src/features/broadcast/__tests__/BroadcastPage.test.tsx` exists and should receive new tests for the confirmation dialog.

## Sources

### Primary (HIGH confidence)
- Direct file reads: `BroadcastPage.tsx`, `HangoutPage.tsx`, `VideoPage.tsx`, `CommentThread.tsx`, `VideoInfoPanel.tsx`, `TranscriptDisplay.tsx`, `ReactionPicker.tsx`, `FloatingReactions.tsx`, `useReactionSender.ts`, `useReactionListener.ts`, `useHlsPlayer.ts`, `useCommentHighlight.ts`, `PipelineStatusBadge.tsx`, `SessionAuditLog.tsx`, `HomePage.tsx`, `SummaryDisplay.tsx` — all read directly for this research
- `.planning/STATE.md` — accumulated key decisions (seek via `videoRef.current.currentTime`, polling pattern, reaction wiring)
- `.planning/phases/040-ui-polish-replay-feed/040-RESEARCH.md` — Phase 40 research (verified TranscriptDisplay onSeek is complete)

### Secondary (MEDIUM confidence)
- `web/vitest.config.ts` — confirmed test framework setup (Vitest + jsdom + @testing-library/react)
- `web/src/features/broadcast/__tests__/BroadcastPage.test.tsx` — confirmed test pattern (vi.mock, MemoryRouter, waitFor)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components read directly from source
- Architecture: HIGH — all patterns traced to working code in BroadcastPage/HomePage
- Pitfalls: HIGH — all derived from direct code inspection (two Leave buttons, syncTime gate, missing VideoInfoPanel prop)

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable React/Tailwind stack, no external API changes)
