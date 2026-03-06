# Architecture: Stream Quality Monitoring & Creator Spotlight (v1.4)

**Project:** VideoNowAndLater (v1.4 Creator Studio & Stream Quality)
**Researched:** 2026-03-05
**Mode:** Ecosystem integration research
**Confidence:** MEDIUM-HIGH

---

## Executive Summary

Stream quality metrics in AWS IVS come from two sources: **client-side WebRTC statistics** (bitrate, frame rate, quality limitations) and **server-side CloudWatch metrics** (viewer count, channel state). The recommended architecture collects both via a new metrics ingestion endpoint and dashboard component. Creator spotlight requires new Session model fields (featured broadcaster link) plus a UI overlay component that doesn't break existing session lifecycle — it operates as **session metadata**, not a structural change.

Integration points are clean: new Lambda handlers for metrics polling, one-way reference from viewer to featured creator (no bidirectional dependency), DynamoDB session fields for spotlight state. Build order prioritizes client metrics collection first (simpler), then server-side polling, then spotlight UI (depends on existing session retrieval).

---

## Quality Metrics Data Flow

### Where Metrics Come From

#### 1. **Client-Side Metrics (RECOMMENDED PRIMARY SOURCE)**

The **Amazon IVS Web Broadcast SDK** builds on WebRTC and exposes metrics via browser's `RTCPeerConnection.getStats()` API.

**Available fields (from RTCOutboundRtpStreamStats):**

| Metric | WebRTC Field | Availability | Use |
|--------|-------------|--------------|-----|
| **Bitrate (Kbps)** | `bytesSent` (cumulative) | Real-time | Calculate delta: `(bytesSent_t2 - bytesSent_t1) * 8 / (t2-t1_sec)` |
| **Frame Rate** | `framesPerSecond` | Real-time (video) | Current FPS during encoding |
| **Target Bitrate** | `targetBitrate` | Real-time | Codec target (informational) |
| **Quality Limitation** | `qualityLimitationReason` | Real-time (video) | Why stream is throttled: `"none"`, `"cpu"`, `"bandwidth"`, `"other"` |
| **Quality Limitation Duration** | `qualityLimitationDurations` | Real-time (video) | Map of reasons → time spent throttled |
| **Frame Dimensions** | `frameHeight`, `frameWidth` | Real-time (video) | Current encoding resolution |
| **Frames Encoded** | `framesEncoded` | Real-time (video) | Cumulative frames (calculate delta for rate) |
| **Network Errors** | `nackCount` | Real-time | Retransmission requests (connection quality) |
| **Encoder Time** | `totalEncodeTime` | Real-time (video) | Cumulative seconds spent encoding |

**Pattern for client-side collection:**

```typescript
// Broadcaster calls this periodically (every 1-2 seconds)
async function pollMetrics(rtcPeerConnection: RTCPeerConnection) {
  const stats = await rtcPeerConnection.getStats();
  const report = {};

  stats.forEach(stat => {
    if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
      report.bytesSent = stat.bytesSent;
      report.framesPerSecond = stat.framesPerSecond;
      report.frameWidth = stat.frameWidth;
      report.frameHeight = stat.frameHeight;
      report.qualityLimitation = stat.qualityLimitationReason;
      report.targetBitrate = stat.targetBitrate;
      // Calculate bitrate in Kbps
      report.currentBitrateKbps = calculateBitrate(stat.bytesSent, timeElapsed);
    }
  });

  return report;
}
```

**Confidence:** HIGH (standard WebRTC API, documented in MDN)

---

#### 2. **Server-Side Metrics (IVS GetStream API)**

**Available via `GetStreamCommand` from `@aws-sdk/client-ivs`:**

| Metric | Source | Availability | Use |
|--------|--------|--------------|-----|
| **Viewer Count** | `stream.viewerCount` | Every 15s (IVS update frequency) | Display to broadcaster |
| **Channel State** | `stream.state` | Real-time | "LIVE" or "OFFLINE" |
| **Start Time** | `stream.startTime` | On transition to LIVE | Duration calculation |

**Current implementation:** `broadcast-service.ts` already implements this with 15-second caching to respect 5 TPS rate limit.

**Confidence:** HIGH (existing implementation, documented in AWS IVS docs)

---

#### 3. **CloudWatch Metrics (AWS-Managed)**

IVS publishes metrics under `AWS/IVS` namespace:

| Metric | Dimensions | Update Frequency | Use |
|--------|-----------|------------------|-----|
| Bandwidth consumed | Channel, StreamKey | 5 minutes | Infrastructure monitoring |
| Concurrent viewers | Channel | 5 minutes | Analytics |

**Limitation:** 5-minute granularity too coarse for real-time broadcaster dashboard. Use only for historical analytics.

**Confidence:** MEDIUM (standard AWS service, but not ideal for live dashboard)

---

### Recommended Data Collection Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Broadcaster Client                           │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ BroadcastPage.tsx                                          │  │
│ │ - Polls RTCPeerConnection.getStats() every 1-2s          │  │
│ │ - Calculates bitrate from bytesSent delta                 │  │
│ │ - Sends metrics to POST /sessions/{id}/metrics endpoint  │  │
│ │ - Updates local QualityDashboard component               │  │
│ └────────────────────────────────────────────────────────────┘  │
│                              ↓ (emit metrics)                    │
└──────────────────────────────┬─────────────────────────────────┘
                               │
                    (PUT /sessions/{id}/metrics)
                    {
                      timestamp: 1709700000000,
                      bytesSent: 50000000,
                      framesPerSecond: 30,
                      frameHeight: 1080,
                      frameWidth: 1920,
                      qualityLimitation: "none",
                      targetBitrate: 2500000
                    }
                               │
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│              Backend: store-stream-metrics.ts (NEW)              │
│ - Lambda handler: PUT /sessions/{id}/metrics                    │
│ - Validates session ownership                                   │
│ - Writes to DynamoDB: METRICS#{sessionId}#<timestamp>          │
│ - No transformation (store raw WebRTC stats)                    │
│ - Response: { status: "recorded" }                             │
│ - TBD: TTL 24h (clean up after session ends)                   │
└────────────────────────────────────────────────────────────────┘
                               │
                               ↓
┌──────────────────────────────────────────────────────────────────┐
│                DynamoDB vnl-sessions table                        │
│                                                                   │
│ PK: SESSION#{sessionId}                                         │
│ SK: METRICS#{timestamp}  (TTL: 24h)                            │
│ Attributes:                                                     │
│   - bytesSent, framesPerSecond, qualityLimitation, etc.        │
│   - recordedAt: timestamp for sorting                           │
│   - TTL: expirationTime (auto-delete after session ends)       │
│                                                                   │
│ GSI for retrieving metrics by session:                          │
│   - GSI1PK: SESSION#{sessionId}                                │
│   - GSI1SK: METRICS#{timestamp}                                │
│   - Allows range query: get all metrics for session            │
└────────────────────────────────────────────────────────────────┘
```

---

## Frontend Components for Quality Dashboard

### New Component: `StreamQualityDashboard`

Displays during broadcast. Positioned in right sidebar (alongside ParticipantsPanel).

```typescript
// web/src/features/broadcast/StreamQualityDashboard.tsx

interface StreamQualityMetrics {
  bitrate: number;           // Kbps
  frameRate: number;         // FPS
  resolution: string;        // "1920x1080"
  qualityLimitation: 'none' | 'cpu' | 'bandwidth' | 'other';
  networkHealth: 'good' | 'warning' | 'critical'; // derived from metrics
  targetBitrate: number;     // Kbps (codec target)
}

function StreamQualityDashboard({ metrics }: { metrics: StreamQualityMetrics }) {
  return (
    <div className="bg-white border-t p-4">
      <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">
        Stream Quality
      </h3>

      {/* Bitrate gauge */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <MetricGauge
          label="Bitrate"
          value={metrics.bitrate}
          unit="Kbps"
          target={metrics.targetBitrate}
          color={metrics.bitrate > 2000 ? 'green' : 'yellow'}
        />
        <MetricGauge
          label="Frame Rate"
          value={metrics.frameRate}
          unit="FPS"
          target={30}
          color={metrics.frameRate >= 25 ? 'green' : 'red'}
        />
      </div>

      {/* Resolution */}
      <div className="text-xs text-gray-700 mb-2">
        <span className="font-semibold">Resolution:</span> {metrics.resolution}
      </div>

      {/* Quality limitation alert */}
      {metrics.qualityLimitation !== 'none' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs">
          <div className="font-semibold text-yellow-800">
            ⚠️ Quality Limited by {metrics.qualityLimitation}
          </div>
          <div className="text-yellow-700 mt-1">
            {metrics.qualityLimitation === 'cpu' && 'Consider closing other apps'}
            {metrics.qualityLimitation === 'bandwidth' && 'Network bandwidth constrained'}
            {metrics.qualityLimitation === 'other' && 'Stream quality degraded'}
          </div>
        </div>
      )}

      {/* Network health indicator */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <div className={`w-2 h-2 rounded-full ${
          metrics.networkHealth === 'good' ? 'bg-green-500' :
          metrics.networkHealth === 'warning' ? 'bg-yellow-500' :
          'bg-red-500'
        }`} />
        <span className="text-gray-700">
          Network: <span className="font-semibold capitalize">{metrics.networkHealth}</span>
        </span>
      </div>
    </div>
  );
}
```

### Integration into BroadcastPage

```typescript
// In BroadcastPage.tsx useBroadcast hook

function useBroadcast({ sessionId, apiBaseUrl, authToken }: UseBroadcastOptions) {
  const [metrics, setMetrics] = useState<StreamQualityMetrics | null>(null);

  // Poll metrics every 1 second during broadcast
  useEffect(() => {
    if (!isLive || !client) return;

    const interval = setInterval(async () => {
      const stats = await client.getStats();  // IVS SDK method
      const outboundStats = findOutboundRtpStats(stats);

      if (outboundStats) {
        const newMetrics = {
          bitrate: calculateBitrate(outboundStats),
          frameRate: outboundStats.framesPerSecond,
          resolution: `${outboundStats.frameWidth}x${outboundStats.frameHeight}`,
          qualityLimitation: outboundStats.qualityLimitationReason,
          networkHealth: deriveNetworkHealth(outboundStats),
          targetBitrate: outboundStats.targetBitrate,
        };
        setMetrics(newMetrics);

        // Send to backend for persistence (fire-and-forget)
        fetch(`${apiBaseUrl}/sessions/${sessionId}/metrics`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({
            timestamp: Date.now(),
            ...outboundStats,
          }),
        }).catch(() => {}); // Ignore errors; dashboard updates still work
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive, client, sessionId, apiBaseUrl, authToken]);

  return { /* ... */ metrics, /* ... */ };
}
```

---

## Creator Spotlight Integration

### Data Model Changes

Add optional spotlight fields to Session:

```typescript
// backend/src/domain/session.ts

export interface Session {
  // ... existing fields ...

  // Creator spotlight (Phase 24 - optional, non-breaking)
  spotlightSessionId?: string;        // If set, this broadcast is spotlighting another creator
  spotlightDisplayName?: string;      // Featured creator's display name (cached for speed)
  spotlightChannelArn?: string;       // Featured broadcaster's IVS channel ARN (to show live indicator)
  spotlightFeaturedAt?: string;       // ISO timestamp when spotlight was activated
  spotlightExpiresAt?: string;        // TTL for automatic spotlight expiration
}
```

**Why this works:**
- **Backward compatible:** Fields are optional (`?`)
- **No session structure change:** Spotlight is metadata attached to viewer session, not a structural change
- **One-way reference:** Viewer knows what they're watching; featured broadcaster doesn't need to know they're featured
- **Efficient query:** All session data in one read; no extra lookups needed

---

### Backend APIs for Spotlight

#### **1. PUT /sessions/{sessionId}/spotlight (NEW)**

Broadcaster adds a spotlight to their session.

```typescript
// backend/src/handlers/add-spotlight.ts

interface AddSpotlightRequest {
  targetSessionId: string;  // Session ID of broadcaster to feature
  expirationMinutes?: number; // How long to show (default: 30)
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.sessionId;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];
  const { targetSessionId, expirationMinutes = 30 } = JSON.parse(event.body || '{}');

  // Validate session ownership
  const session = await getSession(sessionId);
  if (session.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Check target session exists and is live
  const targetSession = await getSession(targetSessionId);
  if (targetSession.status !== SessionStatus.LIVE) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Target session not live' }) };
  }

  // Update current session with spotlight metadata
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

  await updateSession(sessionId, {
    spotlightSessionId: targetSessionId,
    spotlightDisplayName: targetSession.userId, // Simple: use userId as name
    spotlightChannelArn: targetSession.claimedResources.channel,
    spotlightFeaturedAt: new Date().toISOString(),
    spotlightExpiresAt: expiresAt,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'spotlight_added' }),
  };
};
```

#### **2. DELETE /sessions/{sessionId}/spotlight (NEW)**

Remove spotlight from session.

```typescript
// backend/src/handlers/remove-spotlight.ts

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.sessionId;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  const session = await getSession(sessionId);
  if (session.userId !== userId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Clear spotlight fields
  await updateSession(sessionId, {
    spotlightSessionId: undefined,
    spotlightDisplayName: undefined,
    spotlightChannelArn: undefined,
    spotlightFeaturedAt: undefined,
    spotlightExpiresAt: undefined,
  });

  return {
    statusCode: 200,
    body: JSON.stringify({ status: 'spotlight_removed' }),
  };
};
```

#### **3. GET /sessions/featured-creators (NEW)**

Discover who's currently live to feature.

```typescript
// backend/src/handlers/list-featured-creators.ts

export const handler: APIGatewayProxyHandler = async (event) => {
  const limit = parseInt(event.queryStringParameters?.limit || '10');
  const search = event.queryStringParameters?.search || '';

  // Query all LIVE sessions from GSI1
  const response = await docClient.query({
    TableName: process.env.TABLE_NAME!,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: {
      ':pk': `STATUS#LIVE#BROADCAST`, // Only BROADCAST sessions
    },
    Limit: limit,
  });

  // Filter by search term (simple substring match on userId)
  let results = response.Items || [];
  if (search) {
    results = results.filter(s => s.userId.toLowerCase().includes(search.toLowerCase()));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      creators: results.map(s => ({
        sessionId: s.sessionId,
        userId: s.userId,
        viewerCount: s.liveViewerCount || 0, // Cached viewer count
        startedAt: s.startedAt,
      })),
      total: results.length,
    }),
  };
};
```

---

### Frontend Components for Spotlight

#### **1. SpotlightOverlay Component**

Displays featured creator's video over current broadcast (picture-in-picture style).

```typescript
// web/src/features/broadcast/SpotlightOverlay.tsx

interface SpotlightOverlayProps {
  spotlightSessionId: string;
  spotlightDisplayName: string;
  spotlightChannelArn: string;
  isLive: boolean;
  onRemove: () => void;
}

function SpotlightOverlay({
  spotlightSessionId,
  spotlightDisplayName,
  spotlightChannelArn,
  isLive,
  onRemove,
}: SpotlightOverlayProps) {
  return (
    <div className="absolute bottom-4 right-4 w-48 h-28 bg-gray-900 rounded-lg overflow-hidden shadow-xl">
      {/* Featured broadcaster's video player */}
      <IVSPlayerEmbed
        channelArn={spotlightChannelArn}
        muted
        autoPlay
        controls={false}
      />

      {/* Badge overlay */}
      <div className="absolute inset-0 flex flex-col justify-between p-2">
        <div className="flex justify-between items-start">
          <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded">
            Featured Creator
          </div>
          <button
            onClick={onRemove}
            className="text-white hover:bg-black/50 rounded p-1"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-1">
          {isLive && (
            <span className="flex items-center gap-1 bg-red-600 text-white text-xs px-2 py-1 rounded">
              <span className="w-1 h-1 bg-white rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <span className="text-white text-xs font-semibold">{spotlightDisplayName}</span>
        </div>
      </div>
    </div>
  );
}
```

#### **2. SpotlightSelector Component**

UI for broadcasters to choose who to feature.

```typescript
// web/src/features/broadcast/SpotlightSelector.tsx

function SpotlightSelector({
  onSelect,
  isOpen,
  onClose,
}: {
  onSelect: (sessionId: string) => void;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [featuredCreators, setFeaturedCreators] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    fetch(`${getConfig()?.apiUrl}/sessions/featured-creators?search=${search}`)
      .then(r => r.json())
      .then(data => setFeaturedCreators(data.creators))
      .catch(console.error);
  }, [search, isOpen]);

  return (
    <div className={`fixed inset-0 bg-black/50 ${isOpen ? 'visible' : 'hidden'}`}>
      <div className="bg-white rounded-lg p-6 max-w-md">
        <h2 className="text-lg font-bold mb-4">Feature a Creator</h2>

        <input
          type="text"
          placeholder="Search creators..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-4"
        />

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {featuredCreators.map(creator => (
            <div
              key={creator.sessionId}
              onClick={() => onSelect(creator.sessionId)}
              className="p-3 border rounded hover:bg-gray-50 cursor-pointer flex justify-between items-center"
            >
              <span className="font-semibold">{creator.userId}</span>
              <div className="text-xs text-gray-600">
                {creator.viewerCount} watching
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-4 w-full bg-gray-200 text-gray-800 px-4 py-2 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

---

## Suggested Implementation Order

### Phase 1: Client-Side Metrics Collection (1-2 days)

**Outputs:** Broadcaster can see real-time stream quality on dashboard

**Components:**
1. Add metrics polling to `useBroadcast.ts` hook
2. Create `StreamQualityDashboard.tsx` component
3. Integrate dashboard into `BroadcastPage.tsx` (right sidebar, below viewer count)
4. Test WebRTC stats collection on local machine

**Dependencies:** None (client-only, no backend changes)

**Risk:** Low (new feature, no impact on existing code)

---

### Phase 2: Metrics Backend Ingestion (1 day)

**Outputs:** Metrics persisted to DynamoDB for analytics

**Components:**
1. Create `store-stream-metrics.ts` handler
2. Add metrics storage API route to CDK API Gateway stack
3. Add Session model metrics fields (optional)
4. Set up DynamoDB TTL for metrics cleanup

**Dependencies:** Phase 1 (client must send metrics)

**Risk:** Very Low (write-only handler, no side effects)

---

### Phase 3: Creator Spotlight Core (2-3 days)

**Outputs:** Broadcasters can feature other creators

**Components:**
1. Update Session domain model with spotlight fields
2. Create `add-spotlight.ts` handler
3. Create `remove-spotlight.ts` handler
4. Create `list-featured-creators.ts` handler
5. Add API routes to CDK stack

**Dependencies:** None (backend-only, no UI yet)

**Risk:** Low (new fields are optional, backward compatible)

---

### Phase 4: Creator Spotlight UI (2 days)

**Outputs:** Broadcasters can search and select featured creators from UI

**Components:**
1. Create `SpotlightSelector.tsx` modal
2. Create `SpotlightOverlay.tsx` PiP component
3. Add "Feature Creator" button to BroadcastPage
4. Integrate `getSession()` call to retrieve spotlight metadata
5. Render overlay if spotlight is active

**Dependencies:** Phase 3 (backend APIs must exist)

**Risk:** Medium (new UI components, test viewer experience)

---

### Phase 5: Viewer Highlight of Featured Creator (1 day)

**Outputs:** Viewers see badge/link to featured creator

**Components:**
1. Update Viewer page to fetch session with spotlight metadata
2. Display "Featured Creator" badge/link at top of video
3. Add click handler to navigate to featured creator's session
4. Test navigation flow

**Dependencies:** Phase 3 (spotlight data must exist)

**Risk:** Low (read-only, no state changes)

---

## Architecture Patterns to Follow

### Pattern 1: Metrics Collection Without Blocking Broadcast

**What:** Client-side metrics poll is asynchronous, non-blocking. Dashboard updates are optional for viewer experience.

**Implementation:**
```typescript
// Fire-and-forget metrics send
fetch(/* metrics */).catch(() => {
  // Silently ignore errors; dashboard still updates from client-side stats
});
```

**Why:** If metrics backend is down, broadcast continues unaffected.

---

### Pattern 2: One-Way Spotlight Reference

**What:** Viewer session references featured broadcaster; featured broadcaster has no reverse reference.

**Implementation:**
- Viewer session: `spotlightSessionId` → featured broadcaster's sessionId
- Featured broadcaster: No knowledge they're being featured
- No bidirectional sync needed

**Why:** Simpler state management, no risk of circular references, broadcasts scale without coupling.

---

### Pattern 3: Metadata-Attached vs. Structural Spotlight

**What:** Spotlight is metadata ON the viewer's session, not a separate resource.

**Implementation:**
```typescript
// DON'T do this:
{
  PK: `SPOTLIGHT#${sessionId}`,
  SK: 'METADATA',
  featured: { sessionId, displayName, ... },
}

// DO this:
{
  PK: `SESSION#${sessionId}`,
  SK: 'METADATA',
  spotlightSessionId: '...',
  spotlightDisplayName: '...',
  // ... plus all other session fields
}
```

**Why:** Single read retrieves all session context; no extra lookups needed for UI.

---

### Pattern 4: IVS Channel ARN Caching in Spotlight

**What:** Store featured broadcaster's channel ARN in viewer session for direct player embedding.

**Implementation:**
```typescript
// When setting spotlight:
spotlightChannelArn: targetSession.claimedResources.channel

// In overlay component:
<IVSPlayerEmbed channelArn={spotlightChannelArn} />
```

**Why:** No extra lookups on every render; channel ARN is stable for session lifetime.

---

## Data Model & DynamoDB Schema

### Metrics Storage

```
PK:     SESSION#{sessionId}
SK:     METRICS#{ISO_TIMESTAMP}

Attributes:
  recordedAt: number (epoch ms)
  bytesSent: number
  framesPerSecond: number
  framesEncoded: number
  frameHeight: number
  frameWidth: number
  qualityLimitationReason: string
  qualityLimitationDurations: object
  targetBitrate: number
  nackCount: number
  totalEncodeTime: number

  TTL: number (expirationTime in epoch seconds)
```

**Query pattern:**
```
Query GSI1:
  GSI1PK = SESSION#{sessionId}
  GSI1SK begins_with METRICS#
  → Get all metrics for session in order
```

---

### Spotlight Metadata in Session

```
Existing Session fields + :

spotlightSessionId: string (optional)
spotlightDisplayName: string (optional)
spotlightChannelArn: string (optional)
spotlightFeaturedAt: string (ISO timestamp, optional)
spotlightExpiresAt: string (ISO timestamp for TTL cleanup, optional)
```

**No schema migration needed:** DynamoDB allows arbitrary attributes; new fields are additive.

---

## Integration Points with Existing Architecture

| Component | Integration | Type |
|-----------|-----------|------|
| **BroadcastPage** | Import metrics into useBroadcast hook; render StreamQualityDashboard | Component hierarchy |
| **Session domain model** | Add optional spotlight fields | Data model |
| **API Gateway** | Add 3 new routes (PUT/DELETE /spotlight, GET /featured-creators) | Route registration |
| **CDK API stack** | Register new Lambda handlers | Infrastructure |
| **DynamoDB** | Add GSI for metrics queries (optional; can use existing GSI1) | Schema |
| **Viewer page** | Fetch spotlight metadata; render featured creator link | Component integration |

**Non-breaking:** All changes are additive. Existing broadcast flow unchanged.

---

## Scalability Considerations

| Concern | At 100 Users | At 10K Users | At 1M Users |
|---------|-------------|------------|------------|
| Metrics ingestion | 1 PUT request/sec per live broadcaster → ~1 TPS | ~10 TPS | ~100 TPS (scale Lambda + DynamoDB autoscaling) |
| Metrics storage size | ~1 KB per metric × 3600 metrics/hour = 3.6 MB/session | 36 MB/session | 360 MB/session (TTL cleanup mitigates) |
| Featured creators list | Query returns <10 results | Query returns 100+ results (add pagination, caching) | Consider search service (ElasticSearch) |
| Spotlight overlay load | Single PiP video player | Multiple overlays possible (1 per session) | No additional complexity |

**Recommendations:**
- Keep metrics TTL at 24 hours (auto-cleanup)
- Paginate featured creators list (10 per request)
- Consider caching popular creators in ElastiCache if search becomes bottleneck

---

## New vs. Modified Components Summary

### **NEW:**

- `backend/src/handlers/store-stream-metrics.ts` — Ingest metrics endpoint
- `backend/src/handlers/add-spotlight.ts` — Add spotlight to session
- `backend/src/handlers/remove-spotlight.ts` — Remove spotlight
- `backend/src/handlers/list-featured-creators.ts` — Discover live broadcasters
- `web/src/features/broadcast/StreamQualityDashboard.tsx` — Metrics display
- `web/src/features/broadcast/SpotlightSelector.tsx` — Creator discovery modal
- `web/src/features/broadcast/SpotlightOverlay.tsx` — Featured creator PiP
- CDK routes for 3 new handlers (API Gateway + Lambda wiring)

### **MODIFIED:**

- `backend/src/domain/session.ts` — Add spotlight fields (optional, backward compatible)
- `backend/src/features/broadcast/useBroadcast.ts` — Add metrics collection polling
- `backend/src/features/broadcast/BroadcastPage.tsx` — Import QualityDashboard + SpotlightOverlay
- CDK session-stack — Add GSI for metrics (or reuse GSI1)

### **UNCHANGED:**

- Session creation, lifecycle, ending (backward compatible)
- Chat, reactions, recording pipeline
- Viewer page rendering (add spotlight link, no breaking changes)

---

## Confidence Assessment

| Area | Level | Reasoning |
|------|-------|-----------|
| **WebRTC Metrics API** | HIGH | Standard browser API, documented in MDN, implemented in Safari/Chrome/Firefox |
| **IVS GetStream** | HIGH | Existing implementation verified in codebase, 15s update frequency confirmed |
| **Metrics data flow architecture** | HIGH | Fire-and-forget pattern reduces coupling; client-side stats always available |
| **Spotlight one-way reference** | MEDIUM-HIGH | Conceptually clean, but needs testing for viewer UX (navigation, link resolution) |
| **DynamoDB schema changes** | HIGH | Optional fields don't require migration; tested in existing codebase |
| **Scalability at 10K users** | MEDIUM | Featured creators list pagination not yet tested; search may need optimization |
| **IVS CloudWatch metrics latency** | MEDIUM | 5-minute granularity confirmed, but not suitable for real-time dashboard (use WebRTC instead) |

---

## Gaps & Phase-Specific Research Needed

1. **Phase 1 (Client Metrics):** Verify IVS Web Broadcast SDK exposes `getStats()` method (not documented in examples; may need to access underlying WebRTC connection)

2. **Phase 2 (Metrics Backend):** Decide on metrics granularity (store every second? every 5 seconds?) to balance storage cost vs. dashboard smoothness

3. **Phase 4 (Spotlight UI):** Test IVS player embedding performance with concurrent multiple players on same page (viewer might navigate to featured creator, creating nested showcases)

4. **Phase 5 (Viewer highlight):** Design UX for featured creator link — badge? banner? How to avoid distraction from main content?

5. **Scaling:** At 10K broadcasters, featured creators list could exceed 1000 results. Need to implement:
   - Pagination (10 per request)
   - Real-time sorting (by viewer count?)
   - Optional search service (ElasticSearch) if substring search becomes bottleneck

---

## Sources

- **WebRTC getStats API:** MDN Web Docs, standard browser API (HIGH confidence)
- **RTCOutboundRtpStreamStats:** MDN documentation of standard WebRTC stats (HIGH confidence)
- **AWS IVS GetStream:** Existing implementation in `broadcast-service.ts` (HIGH confidence)
- **IVS Web Broadcast SDK:** Amazon IVS documentation (MEDIUM confidence — specific `getStats()` method access needs verification)
- **DynamoDB optional fields:** Verified in existing codebase Session model (HIGH confidence)
- **Creator spotlight patterns:** Industry standard from Twitch/YouTube (MEDIUM confidence — specific implementation details inferred from common patterns)
