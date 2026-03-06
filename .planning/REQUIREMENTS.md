# Requirements: VideoNowAndLater v1.4

**Defined:** 2026-03-06
**Core Value:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

## v1.4 Requirements

### Stream Quality Monitoring

- [ ] **QUAL-01**: Broadcaster can view real-time stream quality dashboard during live broadcast
- [ ] **QUAL-02**: Dashboard displays current bitrate (Mbps) and target bitrate for comparison
- [ ] **QUAL-03**: Dashboard displays current frame rate (FPS) and resolution (e.g., 1920x1080)
- [ ] **QUAL-04**: Dashboard displays network status (Connected/Unstable/Disconnected) with visual indicator
- [ ] **QUAL-05**: Dashboard displays health score (0-100%) based on bitrate stability and FPS consistency
- [ ] **QUAL-06**: Dashboard alerts broadcaster when bitrate drops >30% below target (warning badge)
- [ ] **QUAL-07**: Dashboard is non-intrusive overlay on broadcast page (does not block stream preview)
- [ ] **QUAL-08**: Metrics update every 1-2 seconds with no API latency impact on broadcast

### Creator Spotlight

- [ ] **SPOT-01**: Broadcaster can feature another active broadcaster during their live stream
- [ ] **SPOT-02**: Feature selection shows a modal with search/list of live broadcasters from their viewers
- [ ] **SPOT-03**: Featured creator appears as a picture-in-picture overlay or elegant badge during broadcast
- [ ] **SPOT-04**: Viewers can click featured creator link to navigate to that broadcaster's stream
- [ ] **SPOT-05**: Featured broadcast selection is available only to public broadcasts (not private)
- [ ] **SPOT-06**: Featured broadcast link appears on viewer's stream detail page
- [ ] **SPOT-07**: When a broadcast ends, featured spotlight is automatically cleared
- [ ] **SPOT-08**: Broadcaster can remove/change featured creator at any time mid-stream

## v2 Requirements

Deferred to future releases. Tracked but not in v1.4 roadmap.

### Metrics History & Analytics

- **HIST-01**: Broadcaster can view historical metrics (bitrate over time, FPS trends, connection events)
- **HIST-02**: Metrics are persisted for 30 days for per-broadcast analytics
- **HIST-03**: Broadcaster can export session metrics as CSV for external analysis

### Creator Network & Recommendations

- **DISC-01**: Viewers can discover recommended broadcasters based on watch history
- **DISC-02**: Broadcaster can see who is currently viewing their stream
- **DISC-03**: Broadcaster can invite specific viewers to co-host (upgrade to hangout)

### Monetization Prep

- **MON-01**: Broadcaster can enable tips/donations during stream
- **MON-02**: Featured creator spotlight counts as "promotion credit" toward revenue sharing
- **MON-03**: Broadcaster can set price for featured spotlight access (premium placement)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Encoder-side metrics (bitrate sent, FPS encoded) | Browser WebRTC API doesn't expose sent metrics; viewer experience metrics sufficient for v1.4 |
| Global creator search | Performance risk at scale (1000+ broadcasts); search scoped to viewers of THIS broadcast only |
| Featured creator notifications | Scope creep; defer to notifications system in future milestone |
| Stream recovery/auto-switch | Out of scope; belongs in v1.5 resilience features |
| Concurrent multi-stream overlay | Defer to v1.5; v1.4 single featured creator only |
| Analytics dashboard (charts, graphs) | Defer to v1.5; v1.4 real-time metrics display only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUAL-01 | 23 | Pending |
| QUAL-02 | 23 | Pending |
| QUAL-03 | 23 | Pending |
| QUAL-04 | 23 | Pending |
| QUAL-05 | 23 | Pending |
| QUAL-06 | 23 | Pending |
| QUAL-07 | 23 | Pending |
| QUAL-08 | 23 | Pending |
| SPOT-01 | 24 | Pending |
| SPOT-02 | 24 | Pending |
| SPOT-03 | 24 | Pending |
| SPOT-04 | 24 | Pending |
| SPOT-05 | 24 | Pending |
| SPOT-06 | 24 | Pending |
| SPOT-07 | 24 | Pending |
| SPOT-08 | 24 | Pending |

**Coverage:**
- v1.4 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after research synthesis*
