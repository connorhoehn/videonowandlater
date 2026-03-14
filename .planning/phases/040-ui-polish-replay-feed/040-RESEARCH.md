# Phase 40: UI Polish -- Replay & Feed - Research

**Researched:** 2026-03-14
**Domain:** React frontend (Vite + Tailwind), IVS Player SDK, HLS.js, activity feed UX
**Confidence:** HIGH

## Summary

Phase 40 addresses five UI polish requirements across two surface areas: the replay/video player pages (transcript click-to-seek, AI summary visual states) and the activity feed cards (thumbnail, duration, pipeline status badge with auto-refresh). All changes are frontend-only -- no new backend endpoints or infrastructure changes are needed.

The existing codebase already has the foundational components: `TranscriptDisplay` renders timestamped segments but lacks click handlers, `SummaryDisplay` handles three states but uses near-identical plain text styling for all, activity cards (`BroadcastActivityCard`, `HangoutActivityCard`, `UploadActivityCard`) display session data but lack thumbnails and pipeline status badges, and the `HomePage` fetches sessions once on mount with no polling.

**Primary recommendation:** This phase is pure UI enhancement work. Use the existing component structure, add an `onSeek` callback prop to `TranscriptDisplay`, restyle `SummaryDisplay` with distinct visual treatments per state, add thumbnail/duration/status badge to activity cards, and introduce a polling hook for non-terminal sessions on the home page.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Click transcript segment to seek video player to timestamp | TranscriptDisplay already has per-segment `startTime`; add `onSeek(ms)` callback prop, wire to IVS `player.seekTo()` or `video.currentTime` |
| UI-02 | AI summary panel shows distinct visual states (spinner/formatted text/error) | SummaryDisplay exists with 3 states but all render as plain `<p>` text; add spinner animation for pending, styled card for available, error icon/color for failed |
| UI-03 | Activity feed cards show video thumbnail when available | `ActivitySession.thumbnailUrl` field already exists in the type; RecordingSlider uses it but BroadcastActivityCard and HangoutActivityCard do not |
| UI-04 | Activity feed cards show human-readable duration | `recordingDuration` exists; current `formatDuration` outputs `M:SS` -- change to `"12 min 34 sec"` format per success criteria |
| UI-05 | Activity feed cards show pipeline status badge with auto-refresh | Session has `transcriptStatus`, `aiSummaryStatus`, `convertStatus` fields; need status badge component + polling hook on HomePage |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Purpose | Why Standard |
|---------|---------|--------------|
| React 18 | UI framework | Already in use |
| Tailwind CSS | Styling | Already in use, all components use utility classes |
| Vite | Build tool | Already in use |
| Vitest + @testing-library/react | Testing | Already in use for frontend tests |
| IVS Player SDK | Video playback (replay pages) | Already loaded via `window.IVSPlayer` |
| hls.js | Video playback (upload video pages) | Already installed and used in `useHlsPlayer` |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| react-router-dom | Navigation | Already in use for all page routing |

### No New Dependencies Needed
This phase requires zero new npm packages. All work uses existing React, Tailwind, and player APIs.

## Architecture Patterns

### Existing Component Structure (preserve this)
```
web/src/
  features/
    replay/
      TranscriptDisplay.tsx    # UI-01: add onSeek callback
      SummaryDisplay.tsx       # UI-02: restyle visual states
      ReplayViewer.tsx         # Wire onSeek to IVS player
    upload/
      VideoPage.tsx            # Wire onSeek to HLS player
      VideoInfoPanel.tsx       # Passes through to TranscriptDisplay
    activity/
      BroadcastActivityCard.tsx  # UI-03, UI-04, UI-05
      HangoutActivityCard.tsx    # UI-03, UI-04, UI-05
      UploadActivityCard.tsx     # Already has pipeline status (reference)
      RecordingSlider.tsx        # Already has thumbnailUrl rendering (reference)
      ActivityFeed.tsx           # Stateless, receives sessions from HomePage
  pages/
    HomePage.tsx               # UI-05: add polling for non-terminal sessions
```

### Pattern 1: Callback Prop for Cross-Component Seek (UI-01)
**What:** TranscriptDisplay accepts an `onSeek?: (timeMs: number) => void` callback. Parent (ReplayViewer or VideoInfoPanel) passes a function that calls the player seek API.
**When to use:** Any time a child component needs to control the video player without direct access to the player ref.
**Example:**
```typescript
// TranscriptDisplay.tsx - add onClick to each segment div
<div
  key={index}
  onClick={() => onSeek?.(segment.startTime)}
  className="cursor-pointer ..."
>

// ReplayViewer.tsx - pass seek handler
const handleSeek = (timeMs: number) => {
  const player = playerRef.current;
  if (player) {
    player.seekTo(timeMs / 1000); // IVS player uses seconds
  }
};
<TranscriptDisplay onSeek={handleSeek} ... />

// VideoPage.tsx - pass seek handler for HLS
const handleSeek = (timeMs: number) => {
  if (videoRef.current) {
    videoRef.current.currentTime = timeMs / 1000; // HTMLVideoElement uses seconds
  }
};
```

### Pattern 2: IVS Player Seek API
**What:** IVS Player SDK `seekTo(seconds)` method seeks the player to a specific position.
**Key detail:** The `useReplayPlayer` hook currently returns `{ videoRef, syncTime, isPlaying, player }` where `player` is `playerRef.current`. The `player` object has a `seekTo(seconds)` method.
**Caveat:** `playerRef.current` is set asynchronously -- it may be null before player initialization completes. The seek handler must guard against this.

### Pattern 3: HTMLVideoElement Seek for Upload Videos
**What:** For upload videos using `useHlsPlayer` (hls.js), seeking is done by setting `videoRef.current.currentTime = seconds`.
**Key detail:** `useHlsPlayer` does NOT currently expose the videoRef externally in a way that allows seeking from outside -- it returns `videoRef` but the parent `VideoPage` needs to access it. The hook already returns `videoRef`, so the parent can do `videoRef.current.currentTime = seconds`.

### Pattern 4: Polling Hook for Auto-Refresh (UI-05)
**What:** A `useSessionPolling` hook or inline `useEffect` with `setInterval` that re-fetches activity sessions at escalating intervals when any session is in a non-terminal state.
**When to use:** HomePage when sessions contain non-terminal statuses.
**Design from STATE.md:** "exponential backoff 15s -> 30s -> 60s cap; stop polling on terminal states (available, failed)".
```typescript
// Determine if polling is needed
const hasNonTerminalSessions = sessions.some(s =>
  (s.transcriptStatus && s.transcriptStatus !== 'available' && s.transcriptStatus !== 'failed') ||
  (s.aiSummaryStatus && s.aiSummaryStatus !== 'available' && s.aiSummaryStatus !== 'failed') ||
  (s.convertStatus && s.convertStatus !== 'available' && s.convertStatus !== 'failed')
);
```

### Anti-Patterns to Avoid
- **Do NOT create a new seek channel via context or global state.** The callback prop pattern is simpler and matches how `onReaction` already works in the codebase.
- **Do NOT poll with a fixed interval.** Use exponential backoff per STATE.md guidance.
- **Do NOT add polling to individual card components.** Keep it in HomePage and pass updated sessions down.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duration formatting | Custom parser | Simple arithmetic: `Math.floor(ms / 60000)` for minutes, `Math.floor((ms % 60000) / 1000)` for seconds | Already used everywhere in codebase; just change format string |
| Status badge colors | Custom design system | Tailwind utility classes matching existing badge patterns in UploadActivityCard | Consistency with existing UI |
| Thumbnail fallback | Complex image loading logic | CSS `bg-gray-900` container with conditional `<img>` (already done in RecordingSlider) | Copy existing pattern |

## Common Pitfalls

### Pitfall 1: IVS Player seekTo vs HTMLVideoElement currentTime
**What goes wrong:** Using `player.seekTo()` on an HLS.js player or `video.currentTime` on an IVS player.
**Why it happens:** ReplayViewer uses IVS Player SDK, VideoPage uses hls.js -- different seek APIs.
**How to avoid:** ReplayViewer uses `player.seekTo(seconds)`, VideoPage uses `videoRef.current.currentTime = seconds`. Both accept seconds, not milliseconds.
**Warning signs:** Seek jumps to wrong position (1000x off) or does nothing.

### Pitfall 2: Player Not Ready When Seek Called
**What goes wrong:** User clicks transcript segment before player has loaded, causing null reference error.
**Why it happens:** `playerRef.current` is null until IVS player initializes; `videoRef.current` is null before DOM mount.
**How to avoid:** Guard seek handler: `if (!playerRef.current) return;`

### Pitfall 3: Stale Polling After Navigation
**What goes wrong:** Polling interval continues after user navigates away from HomePage, causing state updates on unmounted component.
**Why it happens:** `setInterval` not cleaned up in useEffect return.
**How to avoid:** Always clear interval in useEffect cleanup. Use `useRef` for interval ID.

### Pitfall 4: Duration Format Inconsistency
**What goes wrong:** Success criteria says "12 min 34 sec" but existing code uses "12:34" format.
**Why it happens:** Three separate `formatDuration` functions exist (BroadcastActivityCard, HangoutActivityCard, UploadActivityCard) all using M:SS format.
**How to avoid:** Create ONE shared `formatHumanDuration(ms)` function returning "X min Y sec" format. Use it in all activity cards. Keep the M:SS format for RecordingSlider and ReplayViewer (those aren't in scope).

### Pitfall 5: SummaryDisplay Backward Compatibility
**What goes wrong:** Changing SummaryDisplay styling breaks existing tests or activity card layouts.
**Why it happens:** SummaryDisplay is used in 5 places (BroadcastActivityCard, HangoutActivityCard, UploadActivityCard, ReplayViewer, VideoPage). Tests check for specific text content.
**How to avoid:** Keep existing text content strings ("Summary coming soon...", "Summary unavailable") so test assertions still pass. Only change the visual wrapper/styling, not the text.

### Pitfall 6: Transcript Click on Speaker Segment Mode
**What goes wrong:** Click-to-seek only works in plain segment mode, not in speaker bubble mode.
**Why it happens:** TranscriptDisplay has TWO render paths: plain segments and speaker segments (bubbles). Both need onClick handlers.
**How to avoid:** Add onClick to BOTH render paths in TranscriptDisplay.

## Code Examples

### UI-01: TranscriptDisplay with onSeek callback
```typescript
// Add to TranscriptDisplayProps
interface TranscriptDisplayProps {
  sessionId: string;
  currentTime: number;
  authToken: string;
  diarizedTranscriptS3Path?: string;
  onSeek?: (timeMs: number) => void; // NEW
}

// Plain segment render - add onClick and cursor-pointer
<div
  key={index}
  ref={isActive ? activeSegmentRef : null}
  onClick={() => onSeek?.(segment.startTime)}
  className={`
    p-3 rounded-lg transition-all duration-200 cursor-pointer
    ${isActive ? 'bg-blue-50 ...' : isPast ? '...' : '...'}
  `}
>

// Speaker bubble render - add onClick and cursor-pointer
<div
  key={index}
  ref={isActive ? activeSpeakerSegmentRef : null}
  onClick={() => onSeek?.(seg.startTime)}
  className={`flex ${isSpeaker1 ? 'justify-start' : 'justify-end'} cursor-pointer`}
>
```

### UI-02: SummaryDisplay with distinct visual states
```typescript
// Pending state - spinner instead of plain text
if (displayStatus === 'pending') {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-200 border-t-blue-600" />
      <span className="text-sm text-gray-500">Generating summary...</span>
    </div>
  );
}

// Available state - styled card with icon
if (displayStatus === 'available' && summary) {
  return (
    <div className={`bg-blue-50 border border-blue-100 rounded-lg p-3 ${className}`}>
      <p className={`text-sm text-gray-800 ${truncate ? 'line-clamp-2' : ''}`}>
        {summary}
      </p>
    </div>
  );
}

// Failed state - error styling with icon
if (displayStatus === 'failed') {
  return (
    <div className={`flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg p-3 ${className}`}>
      <svg className="w-4 h-4 text-red-400 flex-shrink-0" ...>...</svg>
      <span className="text-sm text-red-600">Summary generation failed</span>
    </div>
  );
}
```

### UI-04: Human-readable duration format
```typescript
function formatHumanDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  if (seconds === 0) return `${minutes} min`;
  return `${minutes} min ${seconds} sec`;
}
```

### UI-05: Pipeline status badge component
```typescript
function PipelineStatusBadge({ session }: { session: ActivitySession }) {
  // Determine current pipeline stage
  if (session.convertStatus === 'processing') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Converting</span>;
  }
  if (session.transcriptStatus === 'processing') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Transcribing</span>;
  }
  if (session.aiSummaryStatus === 'pending' && session.transcriptStatus === 'available') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Summarizing</span>;
  }
  if (session.aiSummaryStatus === 'available') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Complete</span>;
  }
  if (session.aiSummaryStatus === 'failed' || session.transcriptStatus === 'failed') {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Failed</span>;
  }
  return null;
}
```

### UI-05: Polling hook in HomePage
```typescript
// Inside HomePage component
const [pollInterval, setPollInterval] = useState(15000); // Start at 15s
const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

useEffect(() => {
  const hasNonTerminal = sessions.some(s =>
    (s.transcriptStatus === 'processing' || s.transcriptStatus === 'pending') ||
    (s.aiSummaryStatus === 'pending') ||
    (s.convertStatus === 'processing' || s.convertStatus === 'pending')
  );

  if (!hasNonTerminal) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    return;
  }

  pollIntervalRef.current = setInterval(async () => {
    const config = getConfig();
    if (!config?.apiUrl) return;
    try {
      const response = await fetch(`${config.apiUrl}/activity`);
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Poll error:', err);
    }
    // Escalate interval: 15s -> 30s -> 60s cap
    setPollInterval(prev => Math.min(prev * 2, 60000));
  }, pollInterval);

  return () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
  };
}, [sessions, pollInterval]);
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Single `formatDuration` returning `M:SS` | Keep `M:SS` for player UIs, add `formatHumanDuration` for feed cards | Success criteria explicitly requires "12 min 34 sec" |
| SummaryDisplay: same `<p>` for all states | Distinct containers with spinner/card/error styling | UI-02 requires visually distinct states |
| One-shot activity fetch | Polling with exponential backoff for non-terminal sessions | UI-05 requires auto-refresh |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest + @testing-library/react |
| Config file | `web/vitest.config.ts` |
| Quick run command | `cd web && npx vitest run --reporter=verbose` |
| Full suite command | `cd web && npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Clicking transcript segment calls onSeek with startTime | unit | `cd web && npx vitest run src/features/replay/TranscriptDisplay.test.tsx` | Wave 0 |
| UI-02 | SummaryDisplay renders spinner for pending, styled card for available, error for failed | unit | `cd web && npx vitest run src/features/replay/SummaryDisplay.test.tsx` | Exists (needs update) |
| UI-03 | BroadcastActivityCard renders thumbnail img when thumbnailUrl present | unit | `cd web && npx vitest run src/features/activity/__tests__/BroadcastActivityCard.test.tsx` | Exists (needs update) |
| UI-04 | formatHumanDuration returns "X min Y sec" format | unit | `cd web && npx vitest run src/features/activity/__tests__/BroadcastActivityCard.test.tsx` | Exists (needs update) |
| UI-05 | PipelineStatusBadge renders correct badge text per status | unit | `cd web && npx vitest run src/features/activity/__tests__/PipelineStatusBadge.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd web && npx vitest run && cd ../backend && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `web/src/features/replay/TranscriptDisplay.test.tsx` -- covers UI-01 (click-to-seek)
- [ ] `web/src/features/activity/__tests__/PipelineStatusBadge.test.tsx` -- covers UI-05 (status badge)
- [ ] Update `SummaryDisplay.test.tsx` -- covers UI-02 (verify distinct visual elements, not just text)
- [ ] Update `BroadcastActivityCard.test.tsx` -- covers UI-03, UI-04 (thumbnail, human duration)

## Open Questions

1. **Thumbnail availability**
   - What we know: `ActivitySession.thumbnailUrl` field exists in the type and is used in `RecordingSlider`. The backend must already be returning this field for sessions that have thumbnails.
   - What's unclear: How many sessions actually have thumbnailUrl populated? Is it generated from IVS recording or from MediaConvert output?
   - Recommendation: Render thumbnail when available, show dark placeholder when not. No backend changes needed.

2. **IVS Player seekTo method name**
   - What we know: The IVS Player SDK is loaded globally. The replay hook uses `player.seekTo` or `player.seek` or similar.
   - What's unclear: The exact method name without checking the IVS Player SDK docs at runtime.
   - Recommendation: Test with `player.seekTo(seconds)` first; if that fails, try `player.seek(seconds)`. Guard with `if (typeof player.seekTo === 'function')`.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: TranscriptDisplay.tsx, SummaryDisplay.tsx, BroadcastActivityCard.tsx, HangoutActivityCard.tsx, UploadActivityCard.tsx, RecordingSlider.tsx, ReplayViewer.tsx, VideoPage.tsx, HomePage.tsx, useReplayPlayer.ts, useHlsPlayer.ts
- STATE.md: Polling backoff guidance (15s -> 30s -> 60s cap)
- REQUIREMENTS.md: UI-01 through UI-05 definitions

### Secondary (MEDIUM confidence)
- IVS Player SDK seekTo API (inferred from codebase usage patterns)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all existing libraries, no new deps
- Architecture: HIGH - well-understood callback prop pattern, existing component structure
- Pitfalls: HIGH - identified from direct code inspection of both player hooks and all render paths
- Seek API: MEDIUM - IVS Player seekTo method name needs runtime verification

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable frontend patterns, no fast-moving dependencies)
