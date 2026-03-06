# Research Summary: v1.4 Creator Studio & Stream Quality

**Project:** VideoNowAndLater
**Milestone:** v1.4 Creator Studio & Stream Quality
**Researched:** 2026-03-05
**Overall Confidence:** MEDIUM-HIGH

---

## Executive Summary

Stream quality monitoring in AWS IVS integrates **client-side WebRTC metrics** (bitrate, frame rate, quality limitations from `RTCOutboundRtpStreamStats`) with **server-side IVS GetStream API** (viewer count, channel state). The recommended architecture keeps metrics collection fire-and-forget (non-blocking to broadcast) while persisting raw stats to DynamoDB for analytics.

Creator spotlight is a clean metadata pattern: a broadcaster's session stores optional `spotlightSessionId`, `spotlightDisplayName`, and `spotlightChannelArn` fields that reference another broadcaster's live session. This one-way reference requires no changes to the featured broadcaster's session and integrates seamlessly into existing session lifecycle. The feature naturally scales because there's no bidirectional sync — just session metadata.

Build order starts with client metrics (simpler, no backend), then server ingestion, then spotlight APIs, then UI. All changes are backward compatible; no schema migrations required.

---

## Key Findings

### Stream Quality Metrics Architecture

**Data Sources:**
1. **Primary (Client):** WebRTC `RTCPeerConnection.getStats()` provides real-time bitrate, frame rate, resolution, and quality limitation reasons
2. **Secondary (Server):** IVS `GetStreamCommand` provides viewer count (15s update frequency) and channel state
3. **Historical (AWS):** CloudWatch IVS metrics at 5-minute granularity (too coarse for real-time dashboard)

**Recommended Pattern:**
- Broadcaster's client polls WebRTC stats every 1-2 seconds
- Sends metrics to new `PUT /sessions/{id}/metrics` endpoint (fire-and-forget)
- Backend stores to DynamoDB with 24-hour TTL
- Dashboard renders from local client stats (always responsive, even if backend down)

**Key Implementation Detail:** Calculate bitrate from `bytesSent` delta (cumulative field), not from target or estimate. Use `qualityLimitationReason` to inform broadcaster of CPU/bandwidth constraints.

---

### Creator Spotlight Data Model

**Session Fields (New, Optional):**
- `spotlightSessionId`: String — ID of featured broadcaster's session
- `spotlightDisplayName`: String — Cached display name (avoid extra lookup)
- `spotlightChannelArn`: String — Featured broadcaster's IVS channel ARN
- `spotlightFeaturedAt`: ISO timestamp — When spotlight activated
- `spotlightExpiresAt`: ISO timestamp — TTL for auto-expiration

**Why This Works:**
- Metadata is attached to viewer's session, not a separate resource
- One-way reference: viewer knows who they're spotlighting; featured broadcaster unaware
- All session data retrieved in single DynamoDB read
- Backward compatible: fields are optional, no migration needed

**API Endpoints:**
1. `PUT /sessions/{id}/spotlight` — Set spotlight (with expiration)
2. `DELETE /sessions/{id}/spotlight` — Clear spotlight
3. `GET /sessions/featured-creators` — Discover live broadcasters (with search/pagination)

---

### Frontend Components

**New Dashboard:**
- `StreamQualityDashboard.tsx`: Sidebar panel showing bitrate, FPS, resolution, quality limitations
- Polling interval: 1 second (smooth updates)
- Color-coded status: green (healthy), yellow (warning), red (critical)

**Spotlight UI:**
- `SpotlightSelector.tsx`: Modal for discovering and selecting broadcasters to feature
- `SpotlightOverlay.tsx`: Picture-in-picture view of featured broadcaster (bottom-right)
- Supports easy on/off toggle and removal

---

## Implications for Roadmap

### Build Order (5 Phases)

1. **Phase 24: Client Metrics Collection** (1-2 days)
   - Addresses: Broadcaster visibility into stream quality
   - Risk: Low (client-only, no breaking changes)

2. **Phase 25: Metrics Backend Ingestion** (1 day)
   - Addresses: Persistent metrics for analytics
   - Risk: Very low (write-only handler)

3. **Phase 26: Creator Spotlight Core APIs** (2-3 days)
   - Addresses: Backend support for spotlight feature
   - Risk: Low (new optional Session fields)

4. **Phase 27: Creator Spotlight UI** (2 days)
   - Addresses: Broadcaster UI to feature other creators
   - Risk: Medium (new components, test UX)

5. **Phase 28: Viewer Spotlight Highlight** (1 day)
   - Addresses: Viewer awareness of featured creators
   - Risk: Low (read-only integration)

**Total estimated effort:** 7-9 days (1.5 weeks)

---

### Why This Order

1. **Metrics first** because it's lowest risk and provides immediate value to broadcasters
2. **Backend ingestion** builds on (1) without adding UI complexity
3. **Spotlight APIs** can be implemented server-only while (4) is designed
4. **Spotlight UI** depends on working APIs from (3)
5. **Viewer highlight** is final touch that doesn't block earlier phases

---

### Phase Ordering Rationale

- **No phase can start earlier:** Each phase builds on the previous (0-1 dependency chain)
- **Parallel opportunities:** Phase 24 (client metrics) and Phase 26 (spotlight APIs) could theoretically run in parallel, but Phase 24 should ship first to provide immediate value
- **De-risking:** Phases 24-25 are low-risk and ship a complete feature; Phase 26 is backend-only with no UX yet; Phase 27 has highest UX risk and benefits from earlier phases being stable

---

## Architecture Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Client-side metrics as primary source** | WebRTC API is real-time, always available; doesn't depend on backend. Server-side metrics are only for verification. | Dashboard is responsive even if backend is slow/down |
| **Fire-and-forget metrics ingestion** | Broadcaster's stream quality can't depend on metrics backend being available. Metrics are informational, not critical. | Metrics API can be down without affecting broadcast |
| **Spotlight as session metadata, not separate resource** | Simpler state machine; single read retrieves all context; no extra lookups on every dashboard render | More efficient queries; fewer failure modes |
| **One-way spotlight reference** | Featured broadcaster has no knowledge they're being featured; no bidirectional sync needed | Scales better; no circular dependencies; featured creator's session unchanged |
| **Store featured broadcaster's channel ARN in spotlight metadata** | Avoids extra lookup when rendering overlay; ARN is stable for session lifetime | Faster overlay rendering; simpler code |
| **24-hour TTL on metrics** | Balances analytics retention (sufficient for post-broadcast review) vs. storage cost | Automatic cleanup; no manual data management |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|-----------|-------|
| **WebRTC Metrics API availability** | HIGH | MDN-documented standard API; all modern browsers support; verified in existing codebase (useBroadcast hook) |
| **IVS GetStream integration** | HIGH | Already implemented in broadcast-service.ts with 15s caching; AWS documentation clear |
| **Metrics data flow pattern** | HIGH | Fire-and-forget pattern proven in existing codebase; no breaking changes |
| **Spotlight metadata model** | MEDIUM-HIGH | Conceptually sound (one-way reference, metadata attachment); needs validation that DynamoDB queries remain efficient at scale |
| **DynamoDB schema expansion** | HIGH | Optional fields tested in existing codebase (e.g., aiSummary, uploadStatus); no migration required |
| **Scalability at 10K users** | MEDIUM | Featured creators list search could become bottleneck; pagination and caching strategy TBD in Phase 27 |
| **IVS player embedding (spotlight)** | MEDIUM | Player embedding in PiP hasn't been tested; potential performance implications with multiple concurrent players |

---

## What Might We Be Missing?

1. **IVS Web Broadcast SDK getStats() method:**
   - Training data suggests RTCPeerConnection is available, but exact API surface of "amazon-ivs-web-broadcast" package needs verification
   - **Mitigation:** Early phase 24 spike to confirm SDK exposes stats

2. **Featured creator search at scale:**
   - Current design uses simple substring match on GSI1 query
   - At 10K+ broadcasters, substring search could become slow
   - **Mitigation:** Implement pagination first; optimize search in subsequent phase if needed

3. **Spotlight expiration UX:**
   - Plan is to auto-expire spotlight at `spotlightExpiresAt` time
   - Need to verify client-side state updates when server-side TTL expires
   - **Mitigation:** Phase 27 should include polling to refresh spotlight state

4. **Multiple PiP players performance:**
   - If viewer navigates to featured creator and that creator is also featuring someone else, we'd have nested IVS players
   - Browser rendering performance TBD
   - **Mitigation:** Limit to 1 level of nesting in Phase 27; document limitation

5. **Metrics granularity trade-off:**
   - Currently suggesting 1-2s client-side polling → 1-2 PUT requests/second per broadcaster
   - At 1000 concurrent broadcasters, that's 1000-2000 Lambda invocations/second
   - **Mitigation:** Phase 25 should implement batching (e.g., accumulate 5 seconds of metrics, send once)

---

## Gaps to Address in Phase-Specific Research

- **Phase 24:** Verify exact API of IVS Web Broadcast SDK for accessing underlying RTCPeerConnection
- **Phase 25:** Decide metrics batching strategy and TTL policy
- **Phase 26:** Test DynamoDB GSI1 query performance with 10K+ broadcasters
- **Phase 27:** Design UX for featured creator selector and test multi-player rendering
- **Phase 28:** Plan viewer UX for featured creator link (badge placement, click behavior)

---

## Sources & Verification

| Source | Confidence | Notes |
|--------|-----------|-------|
| **MDN RTCOutboundRtpStreamStats** | HIGH | Official browser API documentation; standard, widely implemented |
| **AWS IVS GetStream** | HIGH | Verified in existing codebase (broadcast-service.ts); AWS documentation clear |
| **Existing codebase Session model** | HIGH | DynamoDB patterns proven; optional fields already used (aiSummary, uploadStatus) |
| **Amazon IVS Web Broadcast SDK docs** | MEDIUM | Package appears in useBroadcast.ts; exact stats API needs confirmation in Phase 24 spike |
| **Creator spotlight patterns** | MEDIUM | Inferred from Twitch/YouTube patterns; specific implementation details validated against existing IVS + Session design |

---

## Roadmap Integration Checklist

- [x] Quality metrics data sources identified (client WebRTC + server IVS APIs)
- [x] Metrics architecture designed (fire-and-forget pattern, DynamoDB storage)
- [x] Frontend dashboard components specified (StreamQualityDashboard)
- [x] Creator spotlight data model designed (session metadata fields)
- [x] Spotlight APIs specified (PUT/DELETE /spotlight, GET /featured-creators)
- [x] Spotlight UI components specified (SpotlightSelector, SpotlightOverlay)
- [x] Build order prioritized (5 phases, 7-9 days total)
- [x] Integration points identified (BroadcastPage, Session model, API Gateway, DynamoDB)
- [x] Backward compatibility verified (all changes additive, no migrations)
- [x] Scalability considerations documented (metrics batching, pagination, search optimization)
- [x] Confidence levels assigned honestly
- [x] Gaps and research flags documented for phase handoff

---

## Next Steps

1. **Hand off to phase leads:**
   - Phase 24: Verify IVS SDK stats API surface (early spike)
   - Phase 25: Finalize metrics ingestion batching strategy
   - Phase 26: Load test featured creators list query at 10K broadcasters
   - Phase 27: Design spotlight UX mockups and test multi-player rendering
   - Phase 28: Plan viewer navigation flow

2. **Recommended pre-phase work:**
   - Create spike test for IVS Web Broadcast SDK `getStats()` method access
   - Prototype multi-player IVS embed (performance test)
   - Mock featured creators search with pagination

---

## Appendix: Related Files

- **Architecture deep-dive:** `.planning/research/V14_ARCHITECTURE.md`
- **Existing implementation reference:** `backend/src/services/broadcast-service.ts` (viewer count with caching)
- **Session model:** `backend/src/domain/session.ts`
- **Broadcast UI:** `web/src/features/broadcast/BroadcastPage.tsx`, `useBroadcast.ts`
