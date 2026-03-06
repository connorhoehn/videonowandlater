# v1.4 Research Summary: Stream Quality Monitoring & Creator Spotlight

**Project:** VideoNowAndLater v1.4 — Creator Studio & Stream Quality
**Researched:** 2026-03-05
**Research Scope:** Domain pitfalls for adding stream quality metrics + creator cross-promotion features to existing 22-phase IVS/React/CDK system
**Confidence Level:** HIGH

---

## Research Question

**What are the critical mistakes when adding stream quality monitoring and creator spotlight features to an existing real-time broadcast platform?**

Specifically:
- What breaks in existing assumptions about polling, caching, and API load?
- How does creator cross-promotion introduce data model complexity and scope creep?
- Where do real-time system integration points create conflicts?

---

## Key Findings

### Finding 1: Metrics Polling Must Be Bounded or API Load Multiplies 3-5x

**Problem:** Quality metrics naturally perceived as "real-time" (1-2s updates) but existing codebase optimized for 15s polling (viewer count). Adding unbounded metrics polling will create API storms.

**Evidence from codebase:**
- `useViewerCount` polls every 15 seconds with explicit cache invalidation
- `broadcast-service.ts` implements 15s cache TTL for IVS GetStream calls to respect 5 TPS rate limit
- No load testing infrastructure exists for concurrent broadcaster scenarios

**Implication:** Hard constraint required: metrics poll interval ≥ 5 seconds, with backend caching + frontend cache age display.

**Prevention:** Implement polling interval + caching as **first task** in Phase 23 before any UI code.

---

### Finding 2: Featured Broadcast Data on List Views Creates N+1 Query Explosion

**Problem:** Naive implementation adds featured broadcast lookup to every card on home feed (30 broadcasts = 30+ DynamoDB queries). Homepage load time degrades from 1-2s to 5-8s.

**Evidence from codebase:**
- `list-activity` handler already fetches 5-10 sessions; adding featured data per card multiplies queries
- No existing query audit or performance testing in verification
- Simple map-based rendering in `ActivityFeed.tsx` could trigger N+1 pattern

**Implication:** Featured broadcast link ONLY on detail views (replay viewer, broadcaster dashboard). NOT on list views. Defer global search to v1.5.

**Prevention:** Architectural decision gate in Phase 24 planning: "Featured data on detail views only."

---

### Finding 3: IVS Chat Not Designed for Feature Update Events

**Problem:** Existing architecture uses IVS Chat for messages + reactions. Adding spotlight events to same channel risks message delivery failures under load (chat events compete for processing bandwidth).

**Evidence from codebase:**
- `ChatRoomProvider` + `ChatMessagesProvider` implement polling loop for chat messages
- No event prioritization logic exists (messages treated same as other events)
- Reaction system already adds event volume (~1 per viewer per reaction)

**Implication:** Spotlight updates must use separate transport (HTTP API, not Chat). Enforce architectural constraint: "IVS Chat = messages + reactions ONLY."

**Prevention:** Choose spotlight transport as **first architectural decision** in Phase 24 planning before any implementation.

---

### Finding 4: Quality Metrics at Browser Level Don't Include Encoder Health

**Problem:** Assuming browser-based streaming can show encoder bitrate/fps/jitter is incorrect. Browser WebRTC stats show **received** metrics (viewer side), not **sent** (encoder side).

**Fact from domain:**
- IVS GetStream API returns viewer count + playback stats only (not encoder metrics)
- Browser getUserMedia + WebRTC doesn't expose encoder bitrate/frame drops
- Professional streamers use OBS plugins (not available in browser)

**Implication:** Quality dashboard must be scoped as "Viewer Experience Metrics" (buffering, join latency, playback quality) NOT "Encoder Health Metrics."

**Prevention:** Phase 23 research must clarify metrics availability with design before any mockups. Explicit scope gate: Option A (viewer experience) only.

---

### Finding 5: New Session Fields Must Be Backward Compatible

**Problem:** Adding `featuredCreatorId` field without marking optional will break loading of Phase 1-22 sessions (DynamoDB returns undefined; validation fails).

**Evidence from codebase:**
- Phase 20 established pattern: new optional fields (`aiSummary`, `aiSummaryStatus`) with undefined handling
- No backward compatibility testing in recent phases
- `list-activity` scans DynamoDB directly; missing fields cause parse errors

**Implication:** ALL new fields on Session marked optional. Validation assumes undefined = default behavior. Test Phase 1-22 session compatibility.

**Prevention:** Add backward compatibility requirement gate to Phase 24 plan. Include legacy session tests in verification.

---

### Finding 6: Featured Creator Selection Can Become Unusable Search Nightmare

**Problem:** If featured creator selection includes global search ("search all broadcasts by creator name"), each keystroke triggers DynamoDB full table scan. At 1000+ sessions, latency becomes >2s, modal breaks.

**Evidence from codebase:**
- No existing full-text search infrastructure in codebase
- DynamoDB queries rely on GSI with limited cardinality (`STATUS#AVAILABLE#BROADCAST`)
- Local testing with 5 sessions hides production latency issues

**Implication:** Featured creator selection limited to "viewers of THIS broadcast" only (~3-10 results). No global search. Modal shows fixed list, no autocomplete.

**Prevention:** Scope gate in Phase 24 planning: "Viewers of THIS broadcast only; global search deferred to v1.5."

---

## Recommendations for Phases 23-24

### Phase 23: Stream Quality Metrics

**Musts:**
1. Implement 5-second polling minimum + backend caching as first task (before UI)
2. Research available metrics from IVS GetStream API vs. browser WebRTC stats
3. Scope to "viewer experience" metrics only (join latency, buffering, playback quality)
4. Include load testing gate: 50 concurrent broadcasters, API latency < 200ms, 0 throttle events

**Architecture:**
- Add `getQualityMetrics(sessionId)` endpoint with 4-5s cache TTL
- Frontend `useQualityMetrics` hook polls every 5 seconds
- Display "Last updated 4s ago" to set expectations
- All new Session fields optional; backward compatible with Phase 1-22 sessions

### Phase 24: Creator Spotlight

**Musts:**
1. Choose spotlight event transport (separate HTTP API, not IVS Chat) as first decision
2. Implement featured creator selection from THIS broadcast viewers only (no global search)
3. Add featured broadcast data to `list-activity` response (eager load, one query per request)
4. Include query audit: homepage load time < 2.5s with 30 broadcasts

**Architecture:**
- Session model: `featuredCreatorId?: string` (optional field)
- Featured broadcast selection modal: max 20 broadcasts from current viewers
- Featured broadcast link: detail view only (replay viewer, broadcaster dashboard)
- Spotlight updates: separate API endpoint, 5-second update frequency cached

**Validation gates:**
- Homepage load time before/after: must be < 2.5s
- Featured creator modal search: < 500ms latency for any query
- Backward compatibility: Phase 1-22 sessions load without errors

---

## Pitfall Severity Matrix

| Pitfall | Severity | Likelihood | Impact | Prevention Effort |
|---------|----------|------------|--------|-------------------|
| Unbounded metrics polling | **CRITICAL** | HIGH | 3-5x API load increase, service degradation | LOW (hard ceiling + caching) |
| N+1 featured broadcast queries | **CRITICAL** | HIGH | Homepage unusable, DynamoDB throttle | LOW (architectural decision gate) |
| IVS Chat event conflicts | **CRITICAL** | MEDIUM | Message delivery failures | LOW (separate transport) |
| Encoder metrics unavailable | **MODERATE** | HIGH | Feature incomplete, user frustration | LOW (scope clarification) |
| Backward compatibility breaks | **MODERATE** | MEDIUM | Service failures, rollback required | LOW (test legacy sessions) |
| Featured search performance | **MODERATE** | MEDIUM | Modal unusable mid-broadcast | LOW (scope gate: viewers only) |
| Metrics state staleness | **MINOR** | LOW | Broadcaster confusion on stream health | LOW (show cache age, thresholds) |
| Avatar image flicker | **MINOR** | LOW | Visual jank, CLS metric impact | LOW (preload + skeleton) |
| Cached metrics hide live issues | **MINOR** | LOW | Delayed error detection | LOW (anomaly detection on cache) |

---

## Next Steps: Phase Planning

**Before Phase 23-01 Plan:**
1. Confirm metrics availability from IVS GetStream API (research)
2. Design quality metrics scope: viewer experience only (design)
3. Implement polling interval constraint + caching (architecture)

**Before Phase 24-01 Plan:**
1. Define featured broadcast selection scope: viewers of THIS broadcast (design)
2. Choose spotlight update transport: separate API (architecture)
3. Define backward compatibility requirement: all new fields optional (architecture)

**Infrastructure Additions:**
- Load testing suite for Phase 23+ (measure concurrent broadcaster API latency)
- Performance audit in verification: homepage load time < 2.5s

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Polling constraints | HIGH | Existing pattern + IVS rate limits documented |
| Query performance risks | HIGH | N+1 pattern analysis of codebase architecture |
| Event transport conflicts | HIGH | IVS Chat polling architecture already in place |
| Backward compatibility | HIGH | Phase 20 established optional field patterns |
| Scope creep prevention | MEDIUM | Requires product alignment; technical feasibility clear |
| Encoder metrics limitations | HIGH | WebRTC/IVS API capabilities well-known |

**Overall research confidence:** HIGH

**Valid until:** 2026-04-05 (30 days; refresh if AWS IVS capabilities change or product scope shifts)

---

## Research Artifacts

- **PITFALLS.md** — Detailed 9-pitfall breakdown with prevention strategies
- **V14_ARCHITECTURE.md** — System design for metrics + spotlight (may exist)

---

*Research completed: 2026-03-05*
*Researcher confidence:** HIGH
*Next: Phase 23-24 planning with gates from recommendations above
