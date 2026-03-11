# Phase 29: Upload Video Player Core - Research

**Researched:** 2026-03-10
**Domain:** HLS.js adaptive bitrate playback, React routing, quality level switching, Safari fallback
**Confidence:** HIGH

## Summary

Phase 29 creates a dedicated `/video/:sessionId` page that replaces `/upload/:sessionId` as the primary destination for uploaded videos. The page uses HLS.js (not the IVS Player SDK) to provide adaptive bitrate playback with a user-controlled resolution selector. The IVS Player SDK, which is already loaded globally via CDN script tag in `index.html`, does not expose a quality level switching API — that is why HLS.js is required here.

The existing `UploadViewer` component at `web/src/features/upload/UploadViewer.tsx` uses `useReplayPlayer` (which wraps the IVS Player SDK) and lives at route `/upload/:sessionId`. Phase 29 creates a new `VideoPage` component at `/video/:sessionId`, built around a new `useHlsPlayer` hook. The old `/upload` route can be kept for backward compatibility (redirecting to `/video`) or simply retained — the key requirement is that `UploadActivityCard` links navigate to `/video/:sessionId` going forward.

The Safari fallback is straightforward: `Hls.isSupported()` returns `false` on Safari because Safari does not expose the MediaSource Extensions API. In this case the HLS manifest URL is set directly as `video.src` and the quality picker UI is hidden entirely. All MSE-capable browsers (Chrome, Firefox, Edge) use HLS.js.

**Primary recommendation:** Install `hls.js@^1.6.0` in `web/`, create `web/src/features/upload/useHlsPlayer.ts` (extend/replace useReplayPlayer, return `{ videoRef, syncTime, isPlaying, qualities, currentQuality, setQuality }`), create `web/src/features/upload/VideoPage.tsx` as the new dedicated page, register `/video/:sessionId` route in `App.tsx`, and update `UploadActivityCard` navigate call from `/upload/` to `/video/`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIDP-01 | Dedicated `/video/:sessionId` page separate from `/replay` with own layout and back-navigation | New `VideoPage.tsx` in `web/src/features/upload/`, new route registered in `App.tsx` |
| VIDP-02 | HLS.js with ABR by default; user can override resolution via quality selector UI | HLS.js sets `hls.currentLevel = -1` by default (ABR); quality selector built from `hls.levels` |
| VIDP-03 | Quality selector reads `hls.levels` after `MANIFEST_PARSED` and shows human-readable labels ("1080p", "720p", "Auto") | `hls.levels[i].height` provides resolution height; map to label with "Auto" for level -1 |
| VIDP-04 | Quality selector uses `hls.nextLevel` (not `currentLevel`) to prevent buffer stall; hides picker on Safari | On Chrome/Firefox: `hls.nextLevel` setter switches quality without stalling; Safari: `Hls.isSupported() = false`, picker hidden |
| VIDP-10 | `UploadActivityCard` links navigate to `/video/:sessionId` | Single `navigate()` call change in `UploadActivityCard.tsx` `handleClick` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `hls.js` | `^1.6.0` | HLS adaptive bitrate playback with quality level switching API | IVS Player SDK lacks quality API; HLS.js is the industry-standard MSE-based HLS player |
| `react-router-dom` | `^7.7.1` (already installed) | Route registration and `useParams` for sessionId | Already in project; same pattern as all other page routes |
| `fetchAuthSession` (aws-amplify) | `^6.12.2` (already installed) | Auth token for session metadata fetch | Established project pattern; same as `ReplayViewer` and `UploadViewer` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `getConfig()` (internal) | local | Resolve `apiUrl` for session metadata fetch | Required per project pattern — never use `APP_CONFIG` window global |
| `useNavigate` (react-router-dom) | already installed | Back-navigation, redirect logic | Same pattern as all other page components |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `hls.js` npm package | IVS Player SDK (already loaded) | IVS SDK does not expose `currentLevel`/`nextLevel` setters — quality switching impossible with it |
| `hls.js` npm package | Video.js with HLS plugin | Video.js adds ~300KB; unnecessary for a page that only needs HLS + quality selector |
| Creating new `useHlsPlayer` hook | Extending `useReplayPlayer` | STATE.md decision: extend `useReplayPlayer` to return `{ player, qualities }` — do not fork. However, the existing hook uses the IVS SDK (`window.IVSPlayer`), not HLS.js. The practical approach: create `useHlsPlayer` as a sibling hook that returns the same `videoRef`/`syncTime` interface plus `qualities` |

**Installation:**
```bash
cd web && npm install hls.js@^1.6.0
```

HLS.js 1.6 bundles its own TypeScript type definitions — `@types/hls.js` is NOT needed.

## Architecture Patterns

### Recommended File Structure (new files)
```
web/src/features/upload/
├── VideoPage.tsx           # New dedicated page component (VIDP-01)
├── useHlsPlayer.ts         # New hook wrapping HLS.js (VIDP-02, VIDP-03, VIDP-04)
├── QualitySelector.tsx     # New quality picker UI component (VIDP-03)
├── UploadViewer.tsx        # EXISTING — keep for redirect or legacy
└── useVideoUpload.ts       # EXISTING — unchanged
```

Changes to existing files:
```
web/src/App.tsx                               # Add /video/:sessionId route
web/src/features/activity/UploadActivityCard.tsx  # Change navigate() target
```

### Pattern 1: HLS.js Player Hook (`useHlsPlayer`)

**What:** React hook that initializes HLS.js for MSE browsers and falls back to native video.src for Safari. Returns video ref, sync time, quality list, and quality setter.

**When to use:** Any page that needs HLS playback with quality control.

```typescript
// Source: https://nochev.github.io/hls.js/docs/API.html
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

export interface Quality {
  level: number;   // -1 = Auto, 0+ = specific level index
  label: string;   // "Auto", "1080p", "720p", etc.
  height: number;  // 0 for Auto
}

export function useHlsPlayer(hlsUrl: string | undefined) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [currentQuality, setCurrentQualityState] = useState<number>(-1);
  const [syncTime, setSyncTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    if (!hlsUrl || !videoRef.current) return;

    if (Hls.isSupported()) {
      // MSE path: Chrome, Firefox, Edge
      const hls = new Hls();
      hlsRef.current = hls;
      hls.attachMedia(videoRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        // Build quality list from hls.levels (each has .height property)
        const levels: Quality[] = [{ level: -1, label: 'Auto', height: 0 }];
        data.levels.forEach((lvl, idx) => {
          levels.push({
            level: idx,
            label: lvl.height ? `${lvl.height}p` : `Level ${idx}`,
            height: lvl.height || 0,
          });
        });
        setQualities(levels);
      });

      hls.loadSource(hlsUrl);

      const video = videoRef.current;
      video.addEventListener('timeupdate', () => {
        setSyncTime(video.currentTime * 1000);
      });
      video.addEventListener('play', () => setIsPlaying(true));
      video.addEventListener('pause', () => setIsPlaying(false));

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS path — no quality switching available
      videoRef.current.src = hlsUrl;
      setIsSafari(true);
      // No quality levels exposed on native Safari
    }
  }, [hlsUrl]);

  const setQuality = (level: number) => {
    if (!hlsRef.current) return;
    // Use nextLevel (not currentLevel) to avoid buffer stall on mid-stream switch
    hlsRef.current.nextLevel = level;
    setCurrentQualityState(level);
  };

  return {
    videoRef,
    syncTime,
    isPlaying,
    qualities,
    currentQuality,
    setQuality,
    isSafari,
  };
}
```

### Pattern 2: Quality Selector UI Component

**What:** A dropdown or button group showing "Auto", "1080p", "720p", etc. Hidden on Safari.

**When to use:** Alongside the video player in VideoPage.tsx.

```typescript
// Only rendered when !isSafari && qualities.length > 1
interface QualitySelectorProps {
  qualities: Quality[];
  currentQuality: number;
  onSelect: (level: number) => void;
}

export function QualitySelector({ qualities, currentQuality, onSelect }: QualitySelectorProps) {
  if (qualities.length <= 1) return null; // Hide if only "Auto" or no levels loaded yet

  return (
    <select
      value={currentQuality}
      onChange={(e) => onSelect(Number(e.target.value))}
      className="text-sm bg-black/60 text-white border border-white/20 rounded px-2 py-1"
    >
      {qualities.map((q) => (
        <option key={q.level} value={q.level}>
          {q.label}
        </option>
      ))}
    </select>
  );
}
```

### Pattern 3: Route Registration (`App.tsx`)

**What:** Add `/video/:sessionId` as a protected route beside the existing `/upload/:sessionId` route.

```typescript
// Source: existing App.tsx pattern
<Route
  path="/video/:sessionId"
  element={
    <ProtectedRoute>
      <VideoPage />
    </ProtectedRoute>
  }
/>
```

Keep the `/upload/:sessionId` route intact — `UploadViewer` can remain as-is or issue a redirect to `/video/:sessionId`. The REQUIREMENTS.md VIDP-01 only mandates that `/video/:sessionId` exists and is deep-linkable; it does not mandate removing `/upload`.

### Pattern 4: UploadActivityCard Navigation Change

**What:** Single line change in `handleClick` to navigate to `/video/` instead of `/upload/`.

```typescript
// Before:
navigate(`/upload/${session.sessionId}`);

// After:
navigate(`/video/${session.sessionId}`);
```

### Pattern 5: Session Metadata Fetch in VideoPage

Copy the established pattern from `UploadViewer.tsx`:
1. `fetchAuthSession()` in a `useEffect` to get `authToken`
2. `GET /sessions/${sessionId}` with `Authorization: Bearer ${authToken}` header
3. Guard: `if (!sessionId || !authToken) return` before fetch
4. Use `getConfig()?.apiUrl` — never `APP_CONFIG` window global

### Anti-Patterns to Avoid

- **Using `hls.currentLevel` instead of `hls.nextLevel` for quality switching:** `currentLevel` flushes the buffer immediately, causing a visible stall. `nextLevel` switches at the next fragment boundary for smooth transitions.
- **Forking `useReplayPlayer`:** STATE.md says extend, not fork. However, since `useReplayPlayer` wraps IVS SDK (`window.IVSPlayer`), a separate `useHlsPlayer` hook is the correct approach — the two SDKs are incompatible. The "do not fork" constraint means do not copy-paste the IVS hook and modify it; create a purpose-built hook instead.
- **Showing quality selector before `MANIFEST_PARSED`:** `hls.levels` is empty until the manifest loads. Always populate quality state from the `MANIFEST_PARSED` callback.
- **Skipping the `canPlayType` check on Safari:** `Hls.isSupported()` returns `false` on Safari. Without the `canPlayType` fallback, the video will not play at all on Safari.
- **Importing IVS Player types via `amazon-ivs-player` package:** The IVS Player SDK is loaded via CDN script tag in `index.html`, not the npm package. Do not add `amazon-ivs-player` imports to VideoPage — it's already in `devDependencies` only via the CDN for the existing `useReplayPlayer`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HLS manifest parsing | Custom fetch + M3U8 parser | `hls.js` `loadSource()` | M3U8 parsing is complex (variant playlists, segment fetch, ABR algorithm); HLS.js handles all of it |
| Quality level detection | Parse manifest text manually | `hls.levels` array after `MANIFEST_PARSED` | HLS.js exposes parsed levels with `height`, `bitrate`, `width` — no manual parsing needed |
| Buffer stall recovery | Custom timeout + reload logic | `hls.js` error recovery built-in | HLS.js has `FATAL`/`NON_FATAL` error classification and automatic buffer recovery |
| Safari HLS compatibility | `fetch` + blob URL streaming | `video.src = hlsUrl` (native) | Safari's native HLS engine handles CORS, segment fetching, and adaptation without MSE |

**Key insight:** HLS adaptive bitrate streaming involves hundreds of edge cases (segment timing, bandwidth estimation, error recovery, seek across discontinuities). HLS.js encodes years of battle-tested handling. The only thing to build is the quality selector UI and the `hls.nextLevel` setter.

## Common Pitfalls

### Pitfall 1: Using `hls.currentLevel` Instead of `hls.nextLevel`
**What goes wrong:** Setting `hls.currentLevel` on a playing stream immediately flushes the entire buffer, causing a 1-3 second black screen while the new quality fragments load.
**Why it happens:** `currentLevel` is designed for "force-switch now" scenarios; `nextLevel` switches at the next natural segment boundary.
**How to avoid:** Always use `hls.nextLevel = level` in the quality setter. Set to `-1` for ABR auto mode.
**Warning signs:** User sees video stall/freeze on every quality change.

### Pitfall 2: CORS on HLS Sub-Manifests
**What goes wrong:** The HLS master manifest loads fine, but switching quality levels fails because CloudFront does not return `Access-Control-Allow-Origin` on `.m3u8` sub-manifests or `.ts` segment files.
**Why it happens:** CloudFront cache behaviors may not have CORS headers configured for all path patterns.
**How to avoid:** Before implementing, verify CloudFront returns `Access-Control-Allow-Origin: *` (or the app origin) on:
  - The master `.m3u8` manifest URL
  - Sub-manifest `.m3u8` files (often at a different path)
  - `.ts` segment files
**Warning signs:** `hls.js` fires `FRAG_LOAD_ERROR` events after `MANIFEST_PARSED`; Network tab shows OPTIONS preflight failures on `.ts` requests.

### Pitfall 3: Quality Levels Empty After Manifest Parsed
**What goes wrong:** The quality selector renders but is empty or shows only "Auto".
**Why it happens:** MediaConvert may have encoded only a single rendition (common for short clips), or the HLS manifest is a single-bitrate stream rather than a master playlist.
**How to avoid:** Handle the single-quality case — if `hls.levels.length <= 1` after `MANIFEST_PARSED`, hide the quality selector entirely (render `null`). VIDP-04 requirement mentions this: "falls back gracefully if only one quality level is present."
**Warning signs:** Quality selector always shows only "Auto".

### Pitfall 4: HLS.js Destroyed Before React Cleanup Runs
**What goes wrong:** Page navigation during playback causes `Cannot read properties of null (reading 'destroy')` errors.
**Why it happens:** HLS.js attaches to the DOM video element; if the component unmounts before cleanup, HLS.js may try to access the detached element.
**How to avoid:** Always call `hls.destroy()` in the `useEffect` cleanup function. Store the HLS instance in a `useRef`, not `useState`.
**Warning signs:** Console errors on page navigation; memory leaks in long sessions.

### Pitfall 5: VIDP-04 Wording Ambiguity (`hls.nextLevel` on "Safari")
**What goes wrong:** The REQUIREMENTS.md VIDP-04 text mentions "hls.nextLevel on Safari" but Safari never runs HLS.js (`Hls.isSupported() = false`).
**Why it happens:** VIDP-04 requirement text was drafted with imprecise wording.
**Correct interpretation** (from STATE.md, which is authoritative): Use `hls.nextLevel` setter for quality switching on ALL MSE browsers (Chrome/Firefox/Edge) to avoid buffer stall. On Safari, `Hls.isSupported()` returns `false`, so the app uses `video.src = hlsUrl` and hides the quality picker entirely. There is no case where hls.js runs on Safari.
**Warning signs:** n/a — this is a documentation issue, not a runtime issue.

## Code Examples

Verified patterns from official sources:

### HLS.js Initialization and MANIFEST_PARSED
```typescript
// Source: https://nochev.github.io/hls.js/docs/API.html
import Hls from 'hls.js';

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource('https://example.com/master.m3u8');
  hls.attachMedia(videoElement);

  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
    // data.levels: Array of Level objects, each with .height, .bitrate, .width
    console.log('Quality levels:', data.levels.map(l => l.height + 'p'));
    videoElement.play();
  });
}
```

### Quality Switching with nextLevel
```typescript
// Source: https://nochev.github.io/hls.js/docs/API.html
// Smooth switch at next fragment boundary (no buffer stall)
hls.nextLevel = 2;    // Switch to level index 2

// Force ABR auto mode
hls.nextLevel = -1;

// Avoid: this flushes buffer immediately
// hls.currentLevel = 2;
```

### Safari Native Fallback
```typescript
// Source: https://nochev.github.io/hls.js/docs/API.html
const video = document.getElementById('video') as HTMLVideoElement;

if (Hls.isSupported()) {
  // MSE path (Chrome, Firefox, Edge)
  const hls = new Hls();
  hls.loadSource(hlsUrl);
  hls.attachMedia(video);
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Safari native path — no quality switching
  video.src = hlsUrl;
}
```

### Level Object Structure
```typescript
// Source: https://nochev.github.io/hls.js/docs/API.html
interface Level {
  url: string[];
  bitrate: number;     // e.g. 1500000 (1.5 Mbps)
  width: number;       // e.g. 1920
  height: number;      // e.g. 1080  <-- use this for "1080p" label
  name: string;        // MediaConvert-assigned name, may be empty
  codecs: string;      // e.g. "avc1.640028,mp4a.40.2"
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IVS Player SDK for all HLS playback | HLS.js for uploaded content needing quality switching | Phase 29 | IVS SDK has no `currentLevel`/`nextLevel` API |
| `/upload/:sessionId` as primary viewer route | `/video/:sessionId` as primary viewer route | Phase 29 | Cleaner URL; avoids conflation with upload form flow |
| `UploadViewer` using `useReplayPlayer` (IVS SDK) | `VideoPage` using `useHlsPlayer` (HLS.js) | Phase 29 | Quality selector is the core new UX capability |

**Deprecated/outdated:**
- `/upload/:sessionId` as primary destination: replaced by `/video/:sessionId`. The existing `UploadViewer` may be kept as a redirect target for backward compat but is no longer linked from the activity feed.

## Open Questions

1. **Should `/upload/:sessionId` redirect to `/video/:sessionId` or coexist?**
   - What we know: VIDP-01 requires `/video/:sessionId` to be the primary destination; VIDP-10 requires `UploadActivityCard` to link to `/video/`
   - What's unclear: Whether any existing bookmarks/links use `/upload/` that need continued support
   - Recommendation: Keep `/upload/:sessionId` route registered but have `UploadViewer` render a `<Navigate to={`/video/${sessionId}`} replace />` to avoid 404s on old links

2. **CloudFront CORS configuration for quality level sub-manifests**
   - What we know: The master `.m3u8` URL (stored as `recordingHlsUrl` on session) loads fine in existing `UploadViewer`
   - What's unclear: Whether CloudFront cache behaviors cover sub-manifest paths for quality level switching (HLS.js fetches per-rendition `.m3u8` and `.ts` files, which may be at different CloudFront paths)
   - Recommendation: Verify CORS headers on a real upload session's HLS manifest sub-paths before shipping; document as a manual test step in the plan

3. **syncTime needed for VideoPage in Phase 29?**
   - What we know: Phase 30 will use `syncTime` for comment timestamp anchoring (±1500ms window)
   - What's unclear: Phase 29 doesn't require comment highlighting, so `syncTime` could be omitted from the hook return in Phase 29
   - Recommendation: Include `syncTime` in `useHlsPlayer` return value from the start (via `video.timeupdate` → `currentTime * 1000`) so Phase 30 can use it without modifying the hook interface

## Validation Architecture

> workflow.nyquist_validation is not enabled (not present in config.json) — skipping this section.

## Sources

### Primary (HIGH confidence)
- [HLS.js API Documentation](https://nochev.github.io/hls.js/docs/API.html) — quality level API, MANIFEST_PARSED event, Safari fallback pattern, level object structure
- Codebase inspection (direct file reads) — App.tsx routing patterns, useReplayPlayer hook interface, UploadActivityCard navigate target, UploadViewer session fetch pattern

### Secondary (MEDIUM confidence)
- [WebSearch: hls.js quality levels 2025](https://github.com/video-dev/hls.js/blob/master/docs/API.md) — confirmed `currentLevel` vs `nextLevel` distinction
- [WebSearch: HLS.js Safari fallback 2025](https://github.com/video-dev/hls.js/) — confirmed `Hls.isSupported()` returns false on Safari, `canPlayType` fallback pattern
- [WebSearch: hls.js TypeScript types](https://github.com/video-dev/hls.js/issues/1985) — confirmed bundled types, `@types/hls.js` not needed

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — HLS.js API verified via official docs, dependencies verified in package.json
- Architecture: HIGH — patterns derived from direct codebase inspection of existing page components (ReplayViewer, UploadViewer) and confirmed against STATE.md architectural decisions
- Pitfalls: HIGH for CORS (known infrastructure risk from STATE.md), HIGH for `currentLevel` vs `nextLevel` (confirmed by API docs), MEDIUM for quality levels edge cases (single-rendition)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (hls.js API is stable; React Router 7 patterns stable)
