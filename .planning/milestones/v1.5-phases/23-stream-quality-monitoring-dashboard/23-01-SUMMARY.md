---
phase: 23-stream-quality-monitoring-dashboard
plan: 01
subsystem: web
tags: [metrics, webrtc, monitoring, health-score]
created: 2026-03-06T14:44:37Z
completed: 2026-03-06T14:58:00Z
dependencies:
  requires: []
  provides: [stream-metrics-domain, useStreamMetrics-hook, health-score-calculation]
  affects: [broadcast-feature]
tech-stack:
  added: [recharts@2.15.4]
  patterns: [webrtc-stats-polling, rolling-window-sampling, health-score-formula]
key-files:
  created:
    - web/src/domain/metrics.ts
    - web/src/domain/__tests__/metrics.test.ts
    - web/src/features/broadcast/useStreamMetrics.ts
    - web/src/features/broadcast/__tests__/useStreamMetrics.test.tsx
    - backend/src/domain/metrics.ts
    - backend/src/domain/__tests__/metrics.test.ts
  modified:
    - web/package.json
    - package-lock.json
key-decisions:
  - 60/40 weighting for bitrate/FPS in health score calculation
  - 5-second polling interval for WebRTC stats
  - 60-sample rolling window (5 minutes of history)
  - Instantaneous bitrate calculated from byte deltas
metrics:
  duration: 13m23s
  tasks-completed: 3
  tests-added: 17
  commits: 5
---

# Phase 23 Plan 01: Stream Metrics Domain Model Summary

**One-liner:** WebRTC stats extraction with health score calculation using 60% bitrate/40% FPS weighting formula

## What Was Built

### Domain Models
- **StreamMetrics interface** - Captures WebRTC stats including bitrate, FPS, resolution, network type, and quality limitations
- **HealthScoreResult interface** - Provides 0-100 score with component breakdown and warning detection
- **calculateHealthScore function** - Implements weighted formula with jitter penalties and threshold-based warnings

### React Hook
- **useStreamMetrics** - Polls WebRTC stats every 5 seconds when live
- Extracts outbound-rtp video reports from peerConnection.getStats()
- Calculates instantaneous bitrate from byte deltas between samples
- Maintains 60-sample rolling window for 5 minutes of history
- Computes health score after collecting 3+ samples

### Health Score Formula
- **Bitrate health (60% weight):** Penalizes deviation from target and variance/jitter
- **FPS health (40% weight):** Rewards consistent frame rates above 95% of target
- **Warning detection:** Triggers on >30% bitrate drop or <50% FPS on-target rate

## Implementation Details

### WebRTC Stats Extraction
```typescript
// Find outbound-rtp video report from native WebRTC API
stats.forEach((report: any) => {
  if (report.type === 'outbound-rtp' && report.mediaType === 'video') {
    videoReport = report;
  }
});
```

### Instantaneous Bitrate Calculation
```typescript
// Convert cumulative bytes to bits/sec using delta
const bytesDelta = newMetrics.bitrate - previousSample.bytesSent;
const timeDelta = (newMetrics.timestamp - previousSample.timestamp) / 1000;
instantaneousBitrate = (bytesDelta / timeDelta) * 8;
```

### Rolling Window Management
- Push new samples to arrays
- Shift oldest when length > 60
- Provides stable metrics for health calculation

## Test Coverage

- 9 tests for domain model and health score calculation
- 8 tests for useStreamMetrics hook behavior
- Covers perfect metrics, degraded conditions, jitter penalties, and cleanup

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies Added

- **recharts@2.15.4** - For visualization in Plan 02
  - 40KB gzipped
  - React 19 compatible
  - Optimized for real-time updates

## Integration Points

The useStreamMetrics hook expects an IVS broadcast client with peerConnection property:
```typescript
useStreamMetrics(broadcastClient, isLive)
```

Plan 02 will integrate this hook into BroadcastPage and create the visualization components.

## Verification Results

- ✅ All domain types exported and compile correctly
- ✅ calculateHealthScore produces correct 0-100 scores with warning detection
- ✅ useStreamMetrics polls WebRTC stats every 5 seconds when live
- ✅ Rolling window maintains 60 samples maximum
- ✅ Health score computed after 3+ samples collected
- ✅ Frontend test suite passes (85 tests)
- ✅ Backend StreamMetrics type compiles

## Self-Check

[ -f "/Users/connorhoehn/Projects/videonowandlater/web/src/domain/metrics.ts" ] && echo "FOUND: web/src/domain/metrics.ts" || echo "MISSING: web/src/domain/metrics.ts"
FOUND: web/src/domain/metrics.ts

[ -f "/Users/connorhoehn/Projects/videonowandlater/web/src/features/broadcast/useStreamMetrics.ts" ] && echo "FOUND: useStreamMetrics.ts" || echo "MISSING: useStreamMetrics.ts"
FOUND: useStreamMetrics.ts

git log --oneline --all | grep -q "c859858" && echo "FOUND: c859858" || echo "MISSING: c859858"
FOUND: c859858

## Self-Check: PASSED