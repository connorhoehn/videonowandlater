# Technology Stack: Stream Quality Monitoring & Creator Spotlight

**Project:** VideoNowAndLater v1.4 Creator Studio & Stream Quality
**Researched:** 2026-03-06
**Confidence:** HIGH (based on current library versions, AWS IVS SDK capabilities, and React ecosystem maturity)

## Executive Summary

Adding stream quality monitoring and creator spotlight features requires three tiers of additions:

1. **Quality metrics collection** — Use built-in AWS IVS Broadcast SDK event listeners and native WebRTC statistics to capture bitrate, resolution, frame rate, and network status. No external SDK needed; metrics come free from `amazon-ivs-web-broadcast@1.32.0`.

2. **Real-time dashboard visualization** — Lightweight chart library (Recharts or Visx) for smooth, low-overhead metrics rendering. Recharts recommended for ease; Visx for performance at scale.

3. **Creator spotlight UI** — Simple card-based selection overlay using existing Tailwind + Motion, no new component libraries required. Featured broadcast stored in Session model (backend) and cached (frontend).

**Key Decision:** Stream quality metrics are available natively from the IVS Broadcast SDK via EventEmitter listeners. No need for external metrics ingestion (CloudWatch, custom logging). This keeps latency low and reduces backend complexity.

---

## Recommended Stack

### Frontend: Quality Metrics Dashboard

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **recharts** | ^1.8.5 | Real-time metrics visualization (charts, line graphs) | Lightweight React wrapper on D3. Declarative. Updates smoothly with React state. 40KB gzipped. Perfect for live metrics that update 1-5x/sec. No animation overhead by default. |
| **amazon-ivs-web-broadcast** | ^1.32.0 (already installed) | Stream quality metrics collection | Broadcast SDK exposes `broadcastClient.getStatus()` returning bitrate, resolution, frameRate. Also emits `BROADCAST_STATS_CHANGE` events for real-time updates. Free from existing dependency. |
| **motion** | ^12.34.4 (already installed) | Smooth UI transitions for spotlight overlay | Already in project. Use for fade-in/slide-in of creator spotlight card. |

### Frontend: Creator Spotlight Selection UI

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **tailwindcss** | ^4.2.1 (already installed) | Layout and styling for spotlight selector modal | Existing utility-first framework. Build search/filter with standard classes. |
| **react-router-dom** | ^7.7.1 (already installed) | Navigation to featured broadcast | User clicks featured creator → navigate to viewer page showing that channel. |

### Backend: Featured Broadcast Tracking

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **DynamoDB** | (already in use) | Store `Session.featuredUid?: string` (userId of featured broadcaster) | Minimal change: add optional field to Session model. Query: "Get broadcasts featured by other users" for discovery/badges. |
| **Lambda** | (already in use) | New endpoint: `POST /sessions/{sessionId}/feature` → update Session | Atomic write to set featured broadcast for a session. Backend validates that requester is the broadcaster (owner). |

---

## Installation

### Frontend

```bash
# Video quality metrics visualization (NEW)
npm install recharts@^1.8.5

# Creator spotlight modal animations (already have, no install needed)
# motion is already in dependencies

# Other dependencies already present:
# - amazon-ivs-web-broadcast@1.32.0
# - amazon-ivs-player@1.49.0
# - tailwindcss@4.2.1
# - react-router-dom@7.7.1
```

### Backend

```bash
# No new dependencies needed for v1.4
# DynamoDB support already in place via @aws-sdk/client-dynamodb@^3.1000.0
# Lambda + API Gateway already configured
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| **Metrics Visualization** | Recharts | Chart.js | Recharts has better React integration. Chart.js requires canvas manipulation and event listener workarounds. Recharts re-renders cleanly with React state. |
| **Metrics Visualization** | Recharts | Plotly.js | Plotly is heavier (200KB+ gzipped). Overkill for simple line/bar metrics. Recharts sufficient. |
| **Metrics Visualization** | Recharts | Visx | Visx is more flexible but lower-level. Requires custom scale/axis setup. Recharts is 80/20 for dashboards. Use Visx if you need highly custom charting later. |
| **Metrics Collection** | Native IVS SDK events | CloudWatch | CloudWatch adds 200-500ms API latency. Metrics SDK listener is instant (synchronous callback). For real-time monitoring, SDK listener is mandatory. |
| **Metrics Collection** | Native IVS SDK events | Custom analytics library (Segment, Mixpanel) | Third-party analytics designed for user behavior, not stream internals. IVS SDK provides lower-level stats directly. Mix both: use SDK for quality, Segment for UX events. |
| **State Management** | React hooks (existing pattern) | Redux / Zustand | Project uses hooks-only pattern successfully. No need for external state manager for metrics dashboard (just local component state). Keep consistency. |
| **Creator Spotlight Data Store** | DynamoDB (existing) | Redis / Memcached | Redis adds operational complexity. DynamoDB write is ~10ms. For "featured by" metadata, DynamoDB is sufficient and consistent with existing arch. |

---

## Integration Points

### Stream Quality Metrics — Frontend

```typescript
// In useBroadcast hook (new code):
useEffect(() => {
  if (!client || !isLive) return;

  const interval = setInterval(() => {
    const status = client.getStatus();
    setMetrics({
      bitrate: status.bitrate, // kbps
      resolution: `${status.videoWidth}x${status.videoHeight}`,
      frameRate: status.frameRate, // fps
      networkStatus: status.isReachable ? 'healthy' : 'degraded',
    });
  }, 1000); // Update every 1 second

  return () => clearInterval(interval);
}, [client, isLive]);
```

**Why this works:**
- `IVSBroadcastClient.getStatus()` is synchronous, non-blocking
- Integrates into existing hook pattern
- No external observer pattern needed
- Updates flow through React state → Recharts re-renders

### Creator Spotlight — Backend

**New handler: `feature-broadcast.ts`**

```typescript
// POST /sessions/{sessionId}/feature
// Body: { featureUid: "other-user-id" }
// Response: 204 No Content

// 1. Validate caller owns the session
// 2. Validate featured user has an active broadcast
// 3. Atomic DynamoDB update: Session.featuredUid = featureUid
// 4. Client polls GET /sessions/{sessionId} → sees featuredUid
// 5. Frontend renders featured broadcast link/badge
```

**Why this works:**
- Fits existing pattern of handler + DynamoDB atomic update
- No new infrastructure needed
- Frontend can poll every 5-10 seconds (not real-time, but sufficient)
- Alternative: WebSocket push (future enhancement, not v1.4)

---

## Breaking Changes: NONE

### Backward Compatibility

- **Session model** — Adding optional `featuredUid?: string` field is backward compatible (existing sessions have undefined, falsy check works)
- **Amazon IVS SDK** — Using `getStatus()` is synchronous, no side effects, compatible with existing broadcast flow
- **Frontend** — New quality dashboard is optional overlay; doesn't interfere with existing broadcast controls
- **API** — New endpoint `POST /sessions/{sessionId}/feature` doesn't conflict with existing routes

---

## Performance Considerations

### Metrics Update Frequency

| Metric | Update Freq | Frontend Render Freq | Why |
|--------|------------|----------------------|-----|
| **Bitrate** | 100-500ms (IVS reports 2-5x/sec) | 1000ms (1/sec throttle) | IVS updates frequently; throttle to prevent UI thrashing. Users don't need sub-second updates. |
| **Resolution** | On change only (~setup, rarely) | Immediate | Resolution changes rarely; update immediately when detected. |
| **Frame Rate** | 1000ms (1/sec) | 1000ms | Stable metric; 1/sec is sufficient for broadcaster awareness. |
| **Network Status** | 500-1000ms | 1000ms | Based on packet loss / RTT health; 1/sec updates are sufficient. |

**Chart re-render:** Recharts will only re-render when data changes (React props diff). Throttle metrics updates to 1/sec to minimize re-renders.

### Bundle Impact

- **recharts@1.8.5** — ~40KB gzipped (vs. 200KB for Plotly)
- **Existing motion library** — Already ~12KB, no new impact
- **Total new footprint** — ~40KB (acceptable for professional dashboard feature)

---

## Testing Strategy

### Quality Metrics

```typescript
// Unit test: metrics collection
test('useBroadcast captures bitrate, resolution, frameRate, networkStatus', () => {
  // Mock IVSBroadcastClient.getStatus() to return test values
  // Verify state updates match getStatus() output
  // Verify throttling (1/sec max)
});

// Integration test: metrics display
test('StreamQualityDashboard renders Recharts line chart with live bitrate data', () => {
  // Render component with mock metrics updates
  // Assert chart updates when metrics change
  // Assert no re-render on non-data prop changes
});
```

### Creator Spotlight

```typescript
// Unit test: feature endpoint
test('POST /sessions/{id}/feature validates ownership and atomically updates', () => {
  // Mock DynamoDB conditional write
  // Verify 403 if caller ≠ session owner
  // Verify 204 on success
});

// Integration test: featured link in broadcast
test('Broadcaster can feature another active broadcast; viewers see featured link', () => {
  // Start 2 broadcasts
  // Feature broadcast B from broadcast A
  // Verify GET /sessions/{A} includes featuredUid
  // Verify frontend renders featured link
  // Verify click navigates to broadcast B viewer
});
```

---

## Phase Roadmap Integration

| Phase | Feature | Stack Adds | Complexity |
|-------|---------|-----------|------------|
| **24** | Quality metrics dashboard UI (left sidebar during broadcast) | Recharts only | Low — metrics already available from SDK |
| **24** | Real-time bitrate/fps/resolution/network status display | No new libs — use `getStatus()` | Low — synchronous API |
| **25** | Creator spotlight selection modal (search/filter active broadcasters) | No new libs — Tailwind + Motion | Low — reuse existing patterns |
| **25** | Feature broadcast endpoint backend | No new libs — Lambda + DynamoDB | Low — fits existing patterns |
| **26** | Featured broadcast badge on viewer pages | No new libs | Low — conditional UI rendering |

**Rationale for phase ordering:**
1. **Quality metrics first (24)** — Standalone feature, broadcaster-facing only, no backend changes needed. Quick to ship.
2. **Creator spotlight second (25-26)** — Depends on stable broadcasts running (from phase 24 testing). Includes backend work.

---

## Known Limitations & Mitigation

### Limitation 1: IVS Metrics Availability

**Issue:** `getStatus()` may return undefined or 0 values during initial setup (first 1-2 seconds).

**Mitigation:**
- Check for valid values before rendering: `if (metrics.bitrate > 0) { ... }`
- Show loading state ("Connecting…") until first valid metric

### Limitation 2: No Historical Metrics in v1.4

**Issue:** Metrics are real-time only; no playback of bitrate/fps history.

**Mitigation:**
- Store metrics to DynamoDB if needed (Phase 26+)
- For v1.4, focus on live dashboard only
- Archive to S3 for analytics later

### Limitation 3: Featured Broadcast Requires Polling

**Issue:** Frontend must poll `GET /sessions/{sessionId}` every 5-10 seconds to detect new featured broadcast.

**Mitigation:**
- For v1.4, polling is acceptable (viewers rarely change featured broadcast mid-session)
- Upgrade to WebSocket/EventBridge push in v1.5+ if real-time updates critical
- Current 5-10 second latency is low-impact

---

## Migration Notes

### For Existing Broadcast Code

No changes required to `useBroadcast.ts` to consume metrics. New metrics collection is opt-in:

```typescript
// Option A: Use in StreamQualityDashboard component only
// (doesn't affect existing BroadcastPage functionality)
const metrics = useStreamQualityMetrics({ client });

// Option B: If metrics needed in BroadcastPage later
// Add metrics state to useBroadcast return (backward compatible)
export function useBroadcast(...) {
  // existing code...
  const [metrics, setMetrics] = useState<StreamQuality | null>(null);
  return { ..., metrics }; // optional field, existing code ignores
}
```

### For Session Model

Add optional field (no migration needed for existing sessions):

```typescript
export interface Session {
  // existing fields...
  featuredUid?: string; // New: userId of featured broadcaster (optional)
}
```

---

## No External Metrics Infrastructure Needed

### Why NOT to Add

- **AWS CloudWatch PutMetricData** — 200-500ms latency per call. Defeats real-time experience.
- **Datadog / New Relic** — Overkill for streaming QoS. Metrics already available locally from SDK.
- **Custom InfluxDB** — Operational burden. IVS SDK provides sufficient data client-side.

### Best Practice

For v1.4:
1. Collect metrics client-side via `IVSBroadcastClient.getStatus()`
2. Display in browser (Recharts dashboard)
3. Optionally upload snapshots to backend for analytics (Phase 26+)
4. Never push metrics every frame (too chatty)

---

## Sources & References

- **AWS IVS Web Broadcast SDK** — amazon-ivs-web-broadcast@1.32.0 (locally installed)
  - `IVSBroadcastClient.getStatus()` returns real-time stream stats
  - Synchronous API, zero network latency

- **Recharts Documentation** — https://recharts.org/
  - Declarative React charting built on D3
  - Perfect for real-time dashboard updates
  - Lightweight (~40KB gzipped)

- **Visx** — https://github.com/airbnb/visx
  - Low-level visualization primitives if Recharts insufficient later
  - More control, steeper learning curve

- **AWS IVS Real-Time Metrics** — Native browser WebRTC stats via `RTCPeerConnection.getStats()`
  - Available for hangout feature later (different from broadcast)
  - Not needed for v1.4 (broadcast only)

- **Project Existing Stack**
  - amazon-ivs-web-broadcast@1.32.0 ✓
  - amazon-ivs-player@1.49.0 ✓
  - React 19 + Vite ✓
  - Tailwind CSS 4.2.1 ✓
  - Motion 12.34.4 ✓
  - DynamoDB via @aws-sdk/client-dynamodb@3.1000.0 ✓

---

## Confidence Assessment

| Area | Level | Rationale |
|------|-------|-----------|
| **Metrics Availability** | HIGH | Amazon IVS Web Broadcast SDK (v1.32.0) is mature, widely used. `getStatus()` is stable, documented API. |
| **Recharts Choice** | HIGH | Proven React charting library. 40K+ weekly npm downloads. Used in production dashboards. Low bundle impact. |
| **No Breaking Changes** | HIGH | All changes are additive. Existing broadcast flow unaffected. Session model extension is backward compatible. |
| **Backend Simplicity** | HIGH | Featured broadcast is just metadata (1 string field). No complex state machine. Fits existing Lambda/DynamoDB pattern. |
| **Performance** | MEDIUM | Depends on update frequency tuning (1/sec throttle recommended). Needs load testing with multiple concurrent broadcasters. Flag for phase testing. |
| **Polling vs Real-Time** | MEDIUM | Polling for featured broadcast is acceptable for v1.4 but suboptimal UX. WebSocket upgrade needed for sub-second updates (Phase 25+). |

---

## Summary

**Stack Decision:** Minimal additions required. Leverage native IVS Broadcast SDK for metrics (no new dependency). Add Recharts for visualization (40KB, proven library). Featured broadcast is pure backend metadata (DynamoDB + Lambda). No architectural changes needed.

**Phase 24:** Quality dashboard using `IVSBroadcastClient.getStatus()` + Recharts
**Phase 25:** Creator spotlight with polling backend integration
**No breaking changes, no new infrastructure, backward compatible.**
