# Technology Stack: Stream Quality Monitoring & Creator Spotlight (v1.4)

**Project:** VideoNowAndLater v1.4
**Researched:** 2026-03-05
**Confidence:** HIGH (all recommendations use existing stack; no new technologies required)

---

## Recommended Stack

### Core Framework (Unchanged from v1.3)
| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **React** | 18.x | Frontend component framework | Already in use; familiar patterns for dashboard UI |
| **TypeScript** | 5.x | Type safety | Existing project standard; prevents bugs in metric calculations |
| **AWS Lambda** | Node.js 20 | Backend handlers | Existing infrastructure; no new services needed |
| **AWS DynamoDB** | Latest | Metrics storage + session updates | Already used for sessions; familiar patterns |
| **AWS CloudWatch** | N/A | Stream metrics retrieval | Built-in to AWS; no provisioning needed |
| **AWS IVS** | Latest | Broadcast streaming | Already shipping; v1.4 only queries metrics |

### Frontend Libraries (Additions)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **react-query** or **SWR** | Latest | Real-time metrics polling | Manage 1-2s polling of dashboard metrics; handle stale state |
| **recharts** or **victory** | Latest | Health score sparkline / trend chart | Optional for Phase 1; defer to Phase 2 if metrics trend visualization added |
| **react-icons** | Latest | Dashboard UI icons | Status indicators (connected, unstable, disconnected) |

### Backend Libraries (No Additions)

All v1.4 features use existing backend patterns:
- `aws-sdk` v3 (already in use) — CloudWatch + DynamoDB queries
- `jsonwebtoken` (already in use) — Playback tokens for featured broadcasts (v1.3)
- Lambda environment (Node.js 20) — No new libraries required

### Infrastructure (CDK Stacks — No Changes)

**No new AWS services required for v1.4.** All infrastructure already exists:
- **API Gateway:** Add routes to new endpoints (`/metrics`, `/featured-broadcast`)
- **Lambda:** Add handlers for metrics ingestion + featured broadcast selection
- **DynamoDB:** Extend Session table with `featuredBroadcastId` field (no migration)
- **CloudWatch:** Query existing IVS metrics (no new metrics to configure)
- **IAM:** Extend Lambda role to allow CloudWatch `GetMetricStatistics` call

---

## Why No New Technologies?

v1.4 is **entirely built on existing stack:**

1. **Metrics dashboard:** React component + CloudWatch API queries (existing service)
2. **Health score:** Simple calculation in Node.js Lambda (no ML/external service)
3. **Featured broadcasts:** Metadata on existing Session model + DynamoDB queries
4. **Overlay video:** HLS player (already embedded in Broadcast page)
5. **Playback tokens:** Use v1.3's ES384 JWT system (no new auth service)

This is intentional — **reduce external dependencies and ship faster.**

---

## Frontend Architecture

### New React Components

```
BroadcastPage/
├── BroadcasterQualityDashboard.tsx
│   ├── Metrics polling (1-2s interval)
│   ├── Health score calculation
│   ├── Color-coded status display
│   └── Warning/alert logic
├── CreatorSpotlightSelector.tsx
│   ├── Search input
│   ├── Live creators list with pagination
│   └── Permission-aware filtering
└── CreatorSpotlightOverlay.tsx
    ├── Featured broadcast PiP video
    ├── Creator attribution badge
    └── Close/remove button
```

### State Management Pattern

**Use existing pattern from v1.2/v1.3:**
- `useQuery` (react-query or SWR) for periodic metrics fetching
- React Context for featured broadcast ID (session-scoped state)
- localStorage for dashboard panel position/minimized state

**Example (pseudocode):**
```typescript
// In BroadcasterQualityDashboard.tsx
const { data: metrics } = useQuery(
  ['metrics', sessionId],
  () => fetch(`/sessions/${sessionId}/metrics`).then(r => r.json()),
  { refetchInterval: 1500 } // 1.5 second polling
);

// In CreatorSpotlightOverlay.tsx
const { data: session } = useQuery(
  ['session', sessionId],
  () => fetch(`/sessions/${sessionId}`).then(r => r.json()),
  { refetchInterval: 5000 } // 5s polling to detect featured broadcast end
);
```

---

## Backend Architecture

### New Lambda Handlers

**Three new handlers needed:**

1. **`get-metrics.ts`** — `GET /sessions/{id}/metrics`
   - Query CloudWatch for current IVS channel metrics
   - Calculate health score
   - Return in 200ms max

2. **`put-featured-broadcast.ts`** — `PUT /sessions/{id}/featured-broadcast`
   - Validate authorization (user owns this session)
   - Store `featuredBroadcastId` on session record
   - Generate playback token for featured broadcast
   - Update session TTL

3. **`list-creators.ts`** — `GET /sessions?status=live&search=query`
   - Query DynamoDB GSI for live sessions
   - Filter: `sessionStatus = 'LIVE'` + `isPrivate = false`
   - Apply search filter (substring match on username/title)
   - Return paginated results

### DynamoDB Schema Changes

**Session table — new fields (all optional):**
```typescript
// Featured broadcast metadata
featuredBroadcastId?: string;              // Session ID of featured creator
featuredBroadcastOwner?: string;           // Username (for display)
featuredBroadcastChannelArn?: string;      // IVS channel ARN (for overlay)
spotlightFeaturedAt?: number;              // Timestamp (for analytics)
spotlightExpiresAt?: number;               // TTL timestamp (auto-clear)

// Note: No migration required; all fields optional
// Existing sessions work without these fields
```

**No new table needed.** Use existing Session table and Reactions table (unchanged).

### CloudWatch Metric Query Pattern

**Existing pattern (from broadcast-service.ts):**
```typescript
const cloudwatch = new CloudWatchClient();
const response = await cloudwatch.send(new GetMetricStatisticsCommand({
  Namespace: 'AWS/IVS',
  MetricName: 'IngestBitrate',
  Dimensions: [{ Name: 'Channel', Value: channelArn }],
  StartTime: new Date(Date.now() - 60000), // Last 60s
  EndTime: new Date(),
  Period: 60,
  Statistics: ['Average', 'Minimum', 'Maximum']
}));
```

**For v1.4, reuse this pattern for:**
- `IngestBitrate` → current bitrate display
- `IngestFramerate` → FPS display
- `IngestResolution` → resolution display

---

## API Gateway Routes (New)

```
POST /sessions/{id}/metrics
  Handler: get-metrics.ts
  Auth: Public (guest viewer can see broadcaster's metrics? or auth-gated?)
  Returns: { bitrate, fps, resolution, healthScore, updatedAt }

PUT /sessions/{id}/featured-broadcast
  Handler: put-featured-broadcast.ts
  Auth: Bearer token (broadcaster only)
  Body: { featuredBroadcastId: string | null }
  Returns: Updated session record

GET /sessions?status=live&isPrivate=false&search=query
  Handler: list-creators.ts (extend existing)
  Auth: Public
  Returns: Paginated list of live broadcasters
```

---

## Data Flow Diagram

```
[Broadcaster Client]
  │
  ├─→ useQuery('metrics', refetchInterval: 1500ms)
  │   └─→ GET /sessions/{id}/metrics
  │       └─→ Lambda: get-metrics
  │           └─→ CloudWatch API (GetMetricStatistics)
  │               └─→ IVS metrics (IngestBitrate, IngestFramerate, etc.)
  │                   └─→ Render BroadcasterQualityDashboard
  │
  └─→ On "Feature a creator" click:
      ├─→ GET /sessions?status=live&isPrivate=false
      │   └─→ Lambda: list-creators
      │       └─→ Query DynamoDB SessionTable GSI1
      │           └─→ Show CreatorSpotlightSelector modal
      │
      └─→ On creator selected:
          └─→ PUT /sessions/{id}/featured-broadcast
              └─→ Lambda: put-featured-broadcast
                  ├─→ Validate authorization
                  ├─→ Store featuredBroadcastId on session
                  ├─→ Generate playback token for featured broadcast
                  └─→ Update session record in DynamoDB
                      └─→ Render CreatorSpotlightOverlay with featured video

[Viewer Client]
  │
  └─→ GET /sessions/{id} (includes featuredBroadcastId)
      └─→ If featuredBroadcastId present:
          ├─→ Get playback token from server (if private featured broadcast)
          └─→ Render CreatorSpotlightOverlay as PiP video
              └─→ Click → Navigate to featured broadcast viewer
```

---

## Performance Considerations

### Metrics Polling Trade-offs

| Interval | Pros | Cons | Recommendation |
|----------|------|------|-----------------|
| **500ms** | Very responsive | High API load (6 req/s per broadcaster) | ❌ Too aggressive |
| **1000ms (1s)** | Good responsiveness | Moderate API load (1 req/s per broadcaster) | ✅ Recommended for v1.4 |
| **2000ms (2s)** | Acceptable latency | Lower API load; less real-time feel | ✅ Alternative if API load becomes issue |
| **5000ms (5s)** | Very low API load | Dashboard feels sluggish | ❌ Too slow |

**Recommendation:** Start with 1.5-2 seconds; monitor CloudWatch Lambda duration + API Gateway throttling; increase if needed.

### DynamoDB Query Optimization

**Featured creators list query:**
- Current approach: Query GSI1 for `sessionStatus = 'LIVE'` + filter `isPrivate = false`
- At 1000 broadcasters: ~10-50ms query time (assuming 2-5 live at any time)
- At 10K broadcasters: ~50-200ms (may need pagination)

**Optimization if needed (Phase 2):**
- Add separate GSI for active broadcasts: `GSI_ACTIVE_BROADCASTERS` with `status#LIVE#PUBLIC` as key
- Use DynamoDB streams to maintain this GSI (out of scope for v1.4)

---

## Deployment Considerations

### Zero-Downtime Deployment

**All v1.4 changes are backward compatible:**
- New DynamoDB fields are optional (no schema migration)
- New API endpoints don't affect existing endpoints
- Existing session queries work unchanged

**Deployment steps:**
1. Deploy CDK changes (new API routes + Lambda handlers)
2. Deploy frontend React components (feature-flagged if desired)
3. No database migration needed
4. Rollback: Remove feature flag; old endpoints continue working

### Monitoring & Alerts

**Add to CloudWatch dashboards:**
- Metrics API latency (target: <200ms)
- Metrics API error rate (target: <1%)
- Featured creator selector query time (target: <500ms)
- DynamoDB throttling events (target: 0)

**Alerts:**
- Metrics API error rate > 5%
- Metrics API p99 latency > 1s
- Lambda cold start time > 1s (indicates need for optimization)

---

## Testing Strategy

### Unit Tests
- Health score calculation (verify formula with known inputs)
- Permission checks (public vs. private broadcast filtering)
- Metrics data transformation (ensure CloudWatch data → UI values correctly)

### Integration Tests
- Full flow: Broadcaster selects featured creator → featured broadcast ID stored → viewer sees overlay
- Edge cases: Featured broadcast ends → overlay closes gracefully
- Permissions: Try to feature private broadcast without ownership → fails

### Load Tests (Phase 1-2)
- 100 concurrent broadcasters checking metrics (1 req/s each = 100 req/s)
- 10 concurrent creators searching for broadcasters to feature
- Measure: API latency, Lambda duration, DynamoDB consumed capacity

### User Acceptance Tests
- Broadcaster feedback: "Are metrics responsive enough?"
- Broadcaster feedback: "Is health score understandable?"
- Viewer feedback: "Featured video overlay is not too distracting?"

---

## Cost Estimation (Monthly)

Assumptions: 100 active broadcasters, 1000 viewers, 4-hour average session length

| Service | Usage | Estimated Cost |
|---------|-------|-----------------|
| **CloudWatch API calls** | 6 per broadcaster/minute × 100 broadcasters = 864K/month | ~$3-5 |
| **DynamoDB (metrics table)** | 1 metrics record per second per broadcaster (24hr TTL) | ~$5-10 |
| **DynamoDB (sessions GSI)** | Same as v1.3; no change | $0 |
| **Lambda (metrics handler)** | ~1ms per call × 864K calls/month | ~$1-2 |
| **Lambda (featured broadcast)** | ~50 calls/month per broadcaster | <$1 |
| **API Gateway** | Included in existing plan | $0 |
| **Total incremental cost** | | ~$10-20/month |

**Negligible increase** over existing v1.3 costs (~$50-100/month base).

---

## Future Technology Additions (Out of Scope v1.4)

These can be added in v1.5+ without affecting v1.4:

| Technology | Purpose | Timeline | Rationale |
|-----------|---------|----------|-----------|
| **OpenSearch** | Semantic search of live creators | v1.5+ | When 10K+ broadcasters exist |
| **WebRTC stats collection** | Real-time client metrics | v1.5+ if CloudWatch proves insufficient | Currently CloudWatch + client polling sufficient |
| **Amazon Bedrock** | AI recommendations ("creators similar to you") | v1.5+ | Requires engagement data corpus |
| **DataDog / New Relic** | Advanced monitoring | v1.5+ | CloudWatch sufficient for v1.4 |

---

## Compatibility with Existing Code

### No Breaking Changes

- `Session` table: New fields optional; existing code unaffected
- API routes: New routes don't conflict with existing routes
- Frontend: New components isolated; existing Broadcast page logic unchanged
- Auth: Uses existing token system (no changes to Cognito)

### Reuse Patterns

**From v1.2 (Activity Feed):**
- `useQuery` hook for periodic fetching (new components use same pattern)
- Session GSI queries (reuse for featured creators list)

**From v1.3 (Secure Sharing):**
- Playback token generation (JWT, ES384) — reuse for featured broadcast access
- Permission checks (`isPrivate` flag) — extend to spotlighting logic

---

## Recommendations Summary

✅ **Recommended:** Use existing AWS stack (Lambda + DynamoDB + CloudWatch)
- Faster deployment
- No new vendor relationships
- Team already familiar with patterns
- Cost-effective at v1.4 scale

✅ **Recommended:** Client-side metrics polling with React Query/SWR
- Responsive dashboard (no waiting for server)
- Reduced backend load
- Familiar to React team

✅ **Recommended:** Simple health score formula (no ML)
- Fast calculation
- Easy to understand/debug
- Can iterate based on user feedback

❌ **Not recommended:** Adding new services (ElasticSearch, Redis, third-party analytics)
- Increases operational complexity
- Unnecessary at current scale
- Can defer to v1.5

---

## Installation & Setup (Quick Reference)

For developers implementing v1.4:

```bash
# No new npm packages for backend (use existing)
cd backend && npm list

# Frontend additions (optional, if using charts)
cd web && npm install recharts react-query

# CDK deploy
cd infra && npm run cdk deploy

# Tests
cd backend && npm test
cd web && npm test
```

---

## Sources

- **AWS CloudWatch IVS Metrics:** https://docs.aws.amazon.com/AmazonCloudWatch/latest/events/EventTypes.html#IVS-metrics
- **React Query Documentation:** https://tanstack.com/query/latest
- **Existing VideoNowAndLater codebase:** backend/src/services/broadcast-service.ts, web/src/hooks/useBroadcast.ts
- **DynamoDB best practices:** https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html

---

*Technology stack research for: v1.4 Creator Studio & Stream Quality*
*Researched: 2026-03-05*
