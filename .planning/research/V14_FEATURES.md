# Feature Landscape: Stream Quality Monitoring & Creator Spotlight (v1.4)

**Domain:** Live streaming platform — broadcaster dashboard metrics and creator cross-promotion
**Researched:** 2026-03-05
**Confidence:** MEDIUM (AWS IVS/CloudWatch HIGH, WebRTC stats HIGH, industry patterns MEDIUM, implementation specifics LOW)

---

## Context: What v1.3 Already Ships

The following features are complete and form the foundation for v1.4:

- Live broadcasting (IVS one-to-many) with auto-recording
- Multi-participant hangouts (IVS RealTime, up to 5 participants)
- Real-time chat (IVS Chat) with persistence and synchronized replay
- Reactions (live + replay, synchronized to timeline)
- Replay viewer with HLS playback, synchronized chat, reactions
- Homepage with horizontal recording slider + activity feed
- Hangout participant tracking, message counts, AI summaries
- Transcription pipeline (automatic Transcribe for all recordings)
- Private broadcasts with ES384 JWT token-based access control
- Video uploads with automatic MediaConvert adaptive bitrate encoding

**v1.4 adds:** Stream quality monitoring (broadcaster dashboard) and creator spotlight features (cross-promotion UI).

---

## Table Stakes

Features broadcasters expect when streaming professionally. Missing these = no credibility with creators.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Bitrate indicator** | OBS/every encoder shows real-time bitrate; broadcasters expect this in the platform | Low | Current ingest bitrate (Kbps) vs. configured target |
| **Network status signal** | Twitch/YouTube/Discord all show connection health; critical for diagnostics | Low | Connected / Unstable / Dropped visual indicator |
| **Frame rate display** | Pro streamers target 30 or 60 FPS; need confirmation it's matching | Low | Current FPS vs. target FPS |
| **Resolution confirmation** | "Is my 1080p stream actually ingesting at 1080p?" — broadcasters verify constantly | Low | Current resolution (e.g., 1920x1080) being received |
| **Stream duration timer** | Basic broadcast UX; viewers need to see how long they've been live | Low | Elapsed time since broadcast started (HH:MM:SS) |
| **Dropped frames or packet loss alert** | Professional signal that something is wrong before viewers complain | Low | Warn if frame loss detected OR network quality drops significantly |

## Differentiators

Features that set apart a platform as creator-focused. Not expected, but highly valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Broadcast health score (0-100)** | Single KPI combining bitrate stability, packet loss, resolution consistency | Low | Dashboard at-a-glance metric; easier than reading raw stats |
| **Live metrics heatmap / sparkline** | Visual trend of stream stability over time (last 10 min shown as mini chart) | Medium | Shows bitrate trend, detects drift patterns |
| **Creator spotlight overlay (PiP)** | Embed another creator's stream as picture-in-picture during your broadcast | Medium | Requires video embed + permission model + viewer navigation |
| **Featured creator selector with search** | Browse live broadcasters to feature; quick discovery + one-click selection | Low | Searchable list of public broadcasts currently live |
| **"Now featuring" badge for viewers** | Viewers see who's being featured; click to jump to featured broadcast | Low | Badge on broadcast page + clickable link |
| **Cross-promotion viewer journey** | Viewer watches featured broadcast, notices another creator being featured, follows chain | Medium | Depends on spotlight overlay + viewer engagement tracking |

## Anti-Features

What NOT to build initially.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Automatic encoder bitrate adjustment** | Can't control viewer's encoder remotely; only they can adjust OBS settings | Provide clear "Try 3000 Kbps for better stability" recommendations; let user decide |
| **Geo-latency optimization** | Out of scope for single-region AWS deployment; requires multi-region failover logic | Document that multi-region is post-v1 work; focus on getting single-region metrics right |
| **ML-based quality prediction** | "Your stream will drop in 30 seconds" requires training data we don't have yet | Use simple rules: if bitrate drops >30% or frame loss >5%, trigger yellow warning |
| **Automatic quality downgrade** | Users expect to see/control their own ingest quality, not platform auto-reducing | Show warnings and recommendations; let broadcaster decide if they want lower quality |
| **Admin/global metrics dashboard** | Not a creator feature; platform ops can use CloudWatch directly | Focus on per-broadcaster dashboard for v1 |
| **Recommended creators list (algorithmic)** | Requires engagement/follow data and ML ranking | Use simple "currently live" alphabetical list for v1; recommendation engine in v2 |
| **Creator analytics (follower growth, watch time)** | No monetization or follower model yet; premature | Focus on broadcast quality metrics only, not creator success metrics |

## Feature Dependencies

```
Stream Quality Dashboard
├── Requires: Ingest telemetry source (CloudWatch or custom logging)
├── Requires: Real-time UI polling (React component + WebSocket or HTTP polling)
├── Requires: Display layer on Broadcast page
└── Enables: Broadcast health score calculation

Creator Spotlight Directory / Selector
├── Requires: Active session list API (already exists: GET /sessions?status=live)
├── Requires: Private session filtering (already exists: isPrivate flag from v1.3)
├── Requires: Search UI component (React)
└── Enables: Spotlight selection

Creator Spotlight Overlay (PiP)
├── Requires: Featured session selection (from Spotlight Directory)
├── Requires: Playback token generation (already built in v1.3: ES384 JWT tokens)
├── Requires: Video embed capability (iframe HLS player or separate video element)
├── Requires: Permission model (who can feature whom)
├── Requires: Broadcast page modifications (layout for PiP placement)
└── Integrates: Viewer can click to navigate

Featured Broadcast Badge & Link
├── Requires: Featured broadcast ID stored on session
├── Requires: Playback token for featured broadcast
├── Requires: Link routing to featured broadcast viewer page
└── Depends on: Broadcast page has featured broadcast UI space
```

---

## MVP Definition for v1.4

### Phase 1: Stream Quality Dashboard (Core)

**What broadcaster sees during live broadcast:**
- Bitrate (current Kbps / target Kbps, e.g., "4200 / 4500 Kbps")
- Resolution (current, e.g., "1920x1080")
- Frame rate (current FPS, e.g., "30 FPS")
- Network status (Connected / Unstable / Disconnected)
- Broadcast health score (0-100)
- Duration timer (elapsed time since broadcast started)

**UI placement:** Floating panel on Broadcast page (top-right corner, collapsible/minimize)

**Data source:** AWS CloudWatch metrics for IVS channel (available from broadcasting ingest)

**Refresh rate:** 1-2 seconds (trades real-time fidelity for API load)

**Why ship first:**
- Directly addresses broadcaster anxiety ("Is my stream working?")
- No external dependencies beyond CloudWatch
- Foundation for other dashboard features
- Low risk: display-only, no state changes

**Technical approach:**
1. Add metrics retrieval endpoint: `GET /sessions/{sessionId}/metrics`
   - Queries CloudWatch for channel metrics (bitrate, resolution, FPS)
   - Returns current values + health score calculation
2. React component: `BroadcasterQualityDashboard.tsx`
   - Polling interval: 1-2 seconds
   - Displays metrics with color-coded warnings (green / yellow / red)
3. Integration on Broadcast page (top-right floating panel)
   - Can be minimized; state persisted to localStorage

### Phase 2: Creator Spotlight Selector & Directory

**What broadcaster sees:**
- Button on Broadcast/Dashboard page: "Feature another creator"
- Modal/drawer with searchable list of currently live broadcasts
- Filters: public sessions only (or user's own private sessions)
- One-click selection to feature

**What this stores:**
- New field on session: `featuredBroadcastId` (session ID of the featured broadcaster)
- Optional: `featuredByBroadcastId` array for analytics (who's featuring this broadcast)

**Why ship second:**
- Builds on existing session list API
- Introduces permission logic
- Doesn't require video embedding yet
- Allows later phases to use this selection

**Technical approach:**
1. Extend `GET /sessions` API or create `GET /sessions?status=live&isPrivate=false`
   - Returns list of currently active public broadcasts
2. React component: `CreatorSpotlightSelector.tsx`
   - Search by username or session title
   - Shows "Currently live: N" count
   - One-click select → calls `PUT /sessions/{sessionId}/featured-broadcast { featuredBroadcastId: ... }`
3. Storage: New field on session record
   - `featuredBroadcastId: string | null` (cleared when original broadcast ends)

### Phase 3: Creator Spotlight Overlay & Viewer Badge

**What viewers see:**
- Small video tile in corner of broadcast (picture-in-picture style)
- Label: "Now featuring: [Creator Name]"
- Click to navigate to featured broadcast
- X button to close (broadcaster can also remove from dashboard)

**What this requires:**
- Broadcast playback component enhanced with featured broadcast rendering
- Playback token generation for featured broadcast (uses v1.3 JWT system)
- Graceful handling: if featured broadcast ends, overlay closes

**Why ship third:**
- Most complex; requires video rendering + layout changes
- Depends on Phases 1-2 working smoothly
- Can be tested/iterated independently once directory works

**Technical approach:**
1. Broadcast playback component receives `featuredBroadcastId` prop
2. If present, render featured video in corner:
   - Use HLS video element (same as main broadcast playback)
   - Apply CSS to position as PiP (e.g., bottom-right, 25% width)
   - OR use iframe if embedding external player
3. Add badge/label with featured creator name + avatar
4. Click handler navigates to featured broadcast viewer page
5. Cleanup: monitor featured broadcast status; close overlay if it ends

---

## UX Considerations

### Stream Quality Dashboard

**Visual design:**
- Metrics displayed as cards/tiles (each metric in its own box)
- Color coding: Green (good), Yellow (warning), Red (critical)
- Thresholds (example):
  - Bitrate >95% of target: Green
  - 80-95% of target: Yellow ("Check your connection")
  - <80% of target: Red ("Stream degraded")
  - Bitrate 0: Red ("Disconnected")

**Placement:** Floating panel, top-right corner
- Collapsible/minimize icon
- Draggable (optional for v1)
- Close button

**Mobile considerations:**
- Panel width: 80-90% on mobile, 300px on desktop
- Don't cover video controls
- Tap to expand full stats (if minimized)

**What metrics map to warnings:**
- Frame loss >5%: Yellow warning ("Packets dropping")
- Bitrate variance >50% over 30s: Yellow warning ("Unstable connection")
- Disconnected (0 bytes/sec for >5s): Red critical ("Reconnecting...")
- Recovers: Show green "✓ Stable" momentarily

### Creator Spotlight Selector

**Discoverability:** Button on Broadcast page in quality dashboard or main toolbar
- Label: "Feature a creator" or "Add spotlight"
- Icon: spotlight/star emoji or custom icon

**Search UX:**
- Live search by username (no debounce delay; just filter local list)
- Show "0 broadcasters live" if list is empty (graceful empty state)
- Sort alphabetically (or by "most recent broadcast start" if available)

**Permission model:**
- Public broadcasts: Any broadcaster can feature
- Private broadcasts: Only owner can feature (prevents abuse)
- Blocked broadcasters: If moderation features added later, respect blocks

**Selection feedback:**
- User clicks broadcast in list → item highlights
- "✓ Now featuring [Name]" confirmation
- Modal closes; featured video should appear on broadcast page immediately

### Creator Spotlight Overlay

**Visual design:**
- Small video tile (PiP) in corner of broadcast (e.g., bottom-right)
- 25% of main video width, maintains 16:9 aspect ratio
- Border/shadow to make it stand out from background
- Label above/below: "Now featuring: [Creator Name]" with avatar

**Interactivity:**
- Click to navigate to featured broadcast
- Hover shows "Open in new broadcast" tooltip (or navigates immediately, depending on UX choice)
- X button (top-right corner of tile) closes overlay
- Broadcaster can also remove from dashboard settings

**Fallback states:**
- Featured broadcast ends: "Stream ended" message → auto-close after 5s
- Featured broadcast becomes private: "No longer available" → close
- Network error loading featured video: Show placeholder; retry or close

**Mobile considerations:**
- On narrow viewports, PiP may be too small; consider making it top or bottom banner instead
- Tap to expand temporarily to full screen (then back to PiP)
- Close button always accessible

---

## Complexity Analysis

| Component | Complexity | Why | Mitigation |
|-----------|------------|-----|-----------|
| **Metrics collection** | Low-Medium | CloudWatch API latency (30-60s lag); need polling strategy | Start with 1-2s polling interval; accept lag; document latency |
| **Health score calculation** | Low | Simple weighted average or rule-based logic | Use formula: `(bitrate_pct * 0.4) + (fps_stability * 0.4) + (packet_loss_inverse * 0.2)` |
| **Permission model** | Low | Public vs. owner-only distinction | Check `isPrivate` flag and session owner; simple boolean logic |
| **Video overlay playback** | Medium | Concurrent HLS streams; potential CORS issues | Use playback tokens (already built); handle player lifecycle carefully |
| **Broadcaster selector UI** | Low | Simple search + list; no complex filtering for v1 | Linear search in local list (no backend pagination needed for MVP) |
| **Graceful fallbacks** | Medium | Handling stream ends, errors, permission changes mid-broadcast | Use status checks + event listeners to detect state changes |

---

## Integration with Existing Stack

### Dependencies on Completed Phases

- **v1.3 (Secure Sharing):** Critical — playback tokens for featured broadcasts use existing ES384 JWT system
- **v1.2 (Activity Feed):** Optional — metrics can feed into analytics later ("best performing broadcasts")
- **Existing Broadcast page:** Dashboard integrates as floating panel; featured overlay integrates as PiP

### New DynamoDB Fields

On **Session record:**
```typescript
// v1.4 additions
featuredBroadcastId?: string;           // ID of broadcast being featured (null if none)
featuredByBroadcastIds?: string[];      // Array of broadcaster IDs featuring this broadcast (analytics)
metricsLastUpdated?: number;            // timestamp of last metrics snapshot (for caching)

// Optional: pre-computed health score snapshot (if we cache instead of compute on-demand)
healthScoreSnapshot?: {
  score: number;                        // 0-100
  timestamp: number;
  bitratePct: number;
  fpsStability: number;
  packetLossRate: number;
};
```

### New API Endpoints

**Quality metrics:**
- `GET /sessions/{sessionId}/metrics` — Retrieve current stream quality metrics
  - Returns: `{ bitrate, targetBitrate, fps, resolution, duration, healthScore, status }`
  - Source: CloudWatch (with fallback to cached/last-known values if API latency)

**Spotlight selection:**
- `GET /sessions?status=live&isPrivate=false` — List active public broadcasts (can extend existing endpoint)
  - Returns: Array of sessions with `sessionId, userId, createdAt, sessionTitle`
- `PUT /sessions/{sessionId}/featured-broadcast` — Set featured broadcast
  - Request: `{ featuredBroadcastId: string | null }`
  - Response: Updated session record

**Enhancement to existing endpoints:**
- `GET /sessions/{sessionId}` — Now includes `featuredBroadcastId` in response (if set)
- `GET /viewers/{sessionId}` — Broadcast updates sent via WebSocket should broadcast featured status changes

### CloudWatch Integration

**Required IVS metrics (available from CloudWatch):**
- `AWS/IVS:IngestBitrate` — Current bitrate of ingest stream (bytes/sec)
- `AWS/IVS:IngestFramerate` — Current frame rate
- `AWS/IVS:IngestResolution` — Current resolution
- `AWS/IVS:ConcurrentViewerCount` — Current live viewers
- Note: Packet loss / dropped frames may not be directly exposed; may need to infer from bitrate variance or use custom CloudWatch metrics if encoder logs them

---

## UX Patterns Researched

### Industry Standard: Stream Quality Dashboards

**Twitch Stream Manager:**
- Shows bitrate, FPS, resolution in a dedicated panel
- Color-coded: green (good), yellow (warning), red (critical)
- Update frequency: ~1-2 second refresh

**YouTube Studio:**
- Live streaming metrics: encoder bitrate, resolution, FPS
- Health indicator: green checkmark vs. warning icon
- More detailed view: ingest network latency, dropped frames

**OBS (reference implementation — what broadcasters compare to):**
- Real-time stats: CPU load, FPS, frames dropped, bitrate
- Network stats: average bitrate vs. current bitrate
- Audio levels: input + output visualization

**Discord (voice/screen share):**
- Network quality indicator (Good / Unstable / Poor)
- Latency display (ms)
- Audio/video bitrate indicators

**Pattern consensus:** Metrics in compact, color-coded format with real-time updates and clear thresholds.

### Industry Standard: Creator Cross-Promotion

**Twitch Raid/Host:**
- End your broadcast, redirect viewers to another broadcaster
- Automated or manual trigger
- Sends viewers directly to featured channel

**YouTube Premieres:**
- Premiere is a scheduled watch party where creator can feature clips from other creators
- Shared screen during premiere

**Owncast (open-source reference):**
- Chat-based commands for cross-promotion
- Manual links/URLs shared in chat

**Pattern consensus:** Cross-promotion is most effective when it's frictionless (one-click, in-stream, with viewer persistence).

### Recommendation: Creator Spotlight Approach

Combine Twitch's raid concept (directed viewer traffic) with YouTube's in-stream presence (featured content visible during broadcast).

**v1.4 implementation:** Picture-in-picture featured broadcast during ongoing broadcast (not a transition like Twitch raid; more like YouTube's dual-screen setup).

---

## Metrics to Collect (Future Analytics)

For v1.5+ analytics dashboards, track:
- How often broadcasters open quality dashboard?
- Which metrics are viewed most frequently?
- Average duration of "featured broadcast" before changed?
- How many viewers click through to featured broadcast?
- Do featured broadcasters see follower/engagement increase?
- What's typical health score distribution?

---

## Phasing Implications for Roadmap

**Recommended phase order:**
1. **Phase 1: Stream Quality Dashboard** — Low risk, high broadcaster value, no feature dependencies
2. **Phase 2: Creator Spotlight Selector** — Medium risk, builds on existing APIs, enables Phase 3
3. **Phase 3: Featured Broadcast Overlay** — Medium-high risk, most complex UI, depends on Phases 1-2

**Rationale:**
- Dashboard ships fast (wins confidence with creators)
- Selector adds feature depth without video complexity
- Overlay polishes the experience; can iterate design based on early user feedback

**Estimated complexity:**
- Phase 1: 2-3 days (metrics API + React component + CloudWatch integration)
- Phase 2: 1-2 days (search UI + permission checks)
- Phase 3: 3-4 days (video embedding, layout changes, edge case handling)

---

## Validation & Testing Strategy

### Dashboard Metrics
- Test with live CloudWatch data from actual broadcasts
- Verify metric accuracy (compare to OBS encoder values)
- Test warning thresholds with simulated bitrate drops
- Validate refresh interval (1-2s) doesn't overload API

### Spotlight Selector
- Test with multiple live broadcasts
- Verify private session filtering
- Test search with special characters, unicode usernames
- Verify one-click selection updates session immediately

### Featured Overlay
- Test with active broadcast playing in featured tile
- Test graceful close when featured broadcast ends
- Test mobile viewport (PiP doesn't overlap key controls)
- Test viewer click-through to featured broadcast
- Test featured broadcast with playback token access

---

## Sources

### AWS IVS & CloudWatch (HIGH confidence)
- AWS IVS Streaming Configuration: https://docs.aws.amazon.com/ivs/latest/userguide/streaming-config.html
- AWS IVS CloudWatch Metrics: https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/EventTypes.html#IVS-metrics
- AWS MediaLive Metrics (reference): https://docs.aws.amazon.com/medialive/latest/ug/monitor-cloudwatch-metrics.html

### WebRTC & Media Standards (HIGH confidence)
- W3C WebRTC Statistics API: https://www.w3.org/TR/webrtc-stats/
- RFC 8216 (HLS): https://datatracker.ietf.org/doc/html/rfc8216
- Media Source Extensions API: https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API

### Streaming Platform Research (MEDIUM confidence)
- Twitch Creator Camp (reference for professional tools): https://www.twitch.tv/creator-camp
- OBS Project (open-source reference): https://obsproject.com
- Owncast (self-hosted streaming platform): https://github.com/owncast/owncast

### Industry Patterns (MEDIUM confidence)
- GetStream Activity Feed Design: https://getstream.io/blog/activity-feed-design/
- UX Design best practices for horizontal scrolling: https://uxdesign.cc/best-practices-for-horizontal-lists-in-mobile

---

*Feature research for: v1.4 Creator Studio & Stream Quality milestone*
*Researched: 2026-03-05*
*Confidence: MEDIUM (AWS docs HIGH, patterns MEDIUM, implementation LOW)*
