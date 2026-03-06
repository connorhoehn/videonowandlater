# Requirements: VideoNowAndLater v1.4

**Defined:** 2026-03-06
**Core Value:** Users can go live instantly and every session is automatically preserved with its full context for later replay.

## v1.4 Requirements: Creator Studio & Stream Quality

### Stream Quality Monitoring

- [x] **QUAL-01**: Broadcaster can view real-time stream quality dashboard during live broadcast
- [x] **QUAL-02**: Dashboard displays current bitrate (Mbps) and target bitrate for comparison
- [x] **QUAL-03**: Dashboard displays current frame rate (FPS) and resolution (e.g., 1920x1080)
- [x] **QUAL-04**: Dashboard displays network status (Connected/Unstable/Disconnected) with visual indicator
- [x] **QUAL-05**: Dashboard displays health score (0-100%) based on bitrate stability and FPS consistency
- [ ] **QUAL-06**: Dashboard alerts broadcaster when bitrate drops >30% below target (warning badge)
- [ ] **QUAL-07**: Dashboard is non-intrusive overlay on broadcast page (does not block stream preview)
- [x] **QUAL-08**: Metrics update every 1-2 seconds with no API latency impact on broadcast

### Creator Spotlight

- [ ] **SPOT-01**: Broadcaster can feature another active broadcaster during their live stream
- [ ] **SPOT-02**: Feature selection shows a modal with search/list of live broadcasters from their viewers
- [ ] **SPOT-03**: Featured creator appears as a picture-in-picture overlay or elegant badge during broadcast
- [ ] **SPOT-04**: Viewers can click featured creator link to navigate to that broadcaster's stream
- [ ] **SPOT-05**: Featured broadcast selection is available only to public broadcasts (not private)
- [ ] **SPOT-06**: Featured broadcast link appears on viewer's stream detail page
- [ ] **SPOT-07**: When a broadcast ends, featured spotlight is automatically cleared
- [ ] **SPOT-08**: Broadcaster can remove/change featured creator at any time mid-stream

## v1.3 Requirements: Secure Sharing

### Shareable Links

- [ ] **SHARE-01**: User can generate a public shareable link for any broadcast or recording
- [ ] **SHARE-02**: Shareable link contains session metadata in URL (title, duration, thumbnail)
- [ ] **SHARE-03**: Shared links are accessible without user account creation
- [ ] **SHARE-04**: Shared link shows video player with reaction summary and chat history
- [ ] **SHARE-05**: Shared link is copyable one-click to clipboard

### Collections

- [ ] **COLL-01**: User can create a named collection (playlist)
- [ ] **COLL-02**: User can add sessions to collections
- [ ] **COLL-03**: User can remove sessions from collections
- [ ] **COLL-04**: Collections are private by default (only visible to creator)
- [ ] **COLL-05**: User can view their collections on homepage

## v2 Requirements

### Time-Limited Shares

- **SHARE-06**: User can set expiration time on shared links (7 days, 30 days, never)
- **SHARE-07**: Expired shared links return 404 or "link expired" message

### Share Link Security

- **SHARE-08**: User can revoke/disable a previously generated shared link
- **SHARE-09**: Share links support optional password protection

### Collection Discovery

- **COLL-06**: User can make collections public/shareable
- **COLL-07**: Public collections appear in browse/search
- **COLL-08**: User can generate shareable links for entire collections

## Out of Scope

| Feature | Reason |
|---------|--------|
| User profiles | Constraint: "Don't get into users" — deferred to future |
| Permission-based access (granular) | Complex auth model; defer to v2 |
| Collaborative editing | Requires user presence/conflict resolution |
| Email/social sharing | Deferred to future milestone |
| Mobile app | Web-first approach |

## Traceability

### v1.4 Requirements

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUAL-01 | Phase 23 | Complete |
| QUAL-02 | Phase 23 | Complete |
| QUAL-03 | Phase 23 | Complete |
| QUAL-04 | Phase 23 | Complete |
| QUAL-05 | Phase 23 | Complete |
| QUAL-06 | Phase 23 | Pending |
| QUAL-07 | Phase 23 | Pending |
| QUAL-08 | Phase 23 | Complete |
| SPOT-01 | Phase 24 | Pending |
| SPOT-02 | Phase 24 | Pending |
| SPOT-03 | Phase 24 | Pending |
| SPOT-04 | Phase 24 | Pending |
| SPOT-05 | Phase 24 | Pending |
| SPOT-06 | Phase 24 | Pending |
| SPOT-07 | Phase 24 | Pending |
| SPOT-08 | Phase 24 | Pending |

**Coverage:**
- v1.4 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0 ✓

### v1.3 Requirements (Previous Milestone — Archived)

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHARE-01 | Phase 23 (v1.3) | Pending |
| SHARE-02 | Phase 23 (v1.3) | Pending |
| SHARE-03 | Phase 23 (v1.3) | Pending |
| SHARE-04 | Phase 24 (v1.3) | Pending |
| SHARE-05 | Phase 23 (v1.3) | Pending |
| COLL-01 | Phase 24 (v1.3) | Pending |
| COLL-02 | Phase 24 (v1.3) | Pending |
| COLL-03 | Phase 24 (v1.3) | Pending |
| COLL-04 | Phase 24 (v1.3) | Pending |
| COLL-05 | Phase 25 (v1.3) | Pending |

**v1.3 Coverage:**
- v1.3 requirements: 10 total
- Mapped to phases: 10 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-06*
*Last updated: 2026-03-06 after v1.4 milestone planning and plan checker feedback*
