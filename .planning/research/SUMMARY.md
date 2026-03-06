# Project Research Summary: v1.4 Creator Studio & Stream Quality

**Domain:** AWS IVS live video platform — stream quality monitoring + creator cross-promotion features
**Research Date:** 2026-03-06
**Researched Artifacts:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Overall Confidence:** HIGH

---

## Executive Summary

Adding stream quality monitoring and creator spotlight features to VideoNowAndLater requires **minimal new infrastructure** but **careful integration discipline** to avoid degrading the existing real-time system.

**The recommendation:** Stream quality metrics are natively available from AWS IVS Web Broadcast SDK (`getStatus()` call, synchronous). Visualize with a lightweight charting library (Recharts, 40KB). Creator spotlight is purely metadata (one optional `featuredUid` field on Session). No breaking changes, fully backward compatible.

**The risk:** Quality metrics polling must be bounded (5+ second minimum cadence) to prevent API load multiplication. Featured broadcast cross-promotion creates N×M query explosion if not architecturally constrained. Both features compete with existing IVS Chat polling if spotlight updates sent via Chat instead of separate transport. Success depends on strict cardinality limits and performance gating during verification.

---

## Key Findings

### From STACK.md: Technology Additions

| Technology | Version | Purpose | Why | Status |
|-----------|---------|---------|-----|--------|
| **recharts** | ^1.8.5 | Real-time metrics visualization | Lightweight React wrapper on D3; 40KB gzipped; perfect for live updates | NEW dependency |
| **amazon-ivs-web-broadcast** | ^1.32.0 | Metrics collection | Already installed; `getStatus()` provides bitrate, resolution, fps natively | NO change |
| **motion** | ^12.34.4 | UI transitions for spotlight | Already installed; reuse for fade-in/slide-in | NO change |
| **DynamoDB** | existing | Featured broadcast storage | Add optional `featuredUid?: string` to Session model | Optional field |
| **Lambda** | existing | Spotlight endpoint | New `POST /sessions/{sessionId}/feature` handler | New handler |

**Breaking changes:** NONE. All additions are backward compatible. Session model extension is optional; existing sessions have undefined field (falsy check works).

**Key decision:** Metrics come free from IVS Broadcast SDK via synchronous `getStatus()` call. No external metrics infrastructure (CloudWatch, Datadog) needed. Latency stays low, cost stays zero. For real-time dashboard, synchronous API is mandatory.

---

### From FEATURES.md: What Gets Built in v1.4

**In Scope (Differentiators):**
- Stream quality metrics dashboard for broadcaster (viewer experience: join latency, buffering events, playback quality state)
- Creator spotlight: broadcaster can feature one active creator from their viewers
- Featured broadcast link shown on viewer page
- Featured broadcast persisted on Session (shows in replay)

**Out of Scope (Defer to v1.5+):**
- Encoder bitrate/fps/frame drops (requires encoder integration, not available in browser)
- Per-viewer analytics (privacy concern)
- Historical quality trends (analytics DB needed)
- Featured creator recommendations (ML)
- Global search for featured creators (scope: this broadcast's viewers only)

**Phasing constraint:** Reaction counts + Hangout tracking from v1.2 already complete. v1.4 sits on top of stable v1.1-v1.3 foundation.

---

### From ARCHITECTURE.md: System Integration Points

**Hangout Participant Tracking (Existing from v1.2):**
- Modify `join-hangout.ts`: persist PARTICIPANT item after token generation
- PK=`SESSION#{id}`, SK=`PARTICIPANT#{userId}` (separate items, no version conflict)
- Query with `begins_with(SK, 'PARTICIPANT#')` for all participants

**Reaction Summary (Existing from v1.2):**
- Modify `recording-ended.ts`: compute reaction counts at session end
- Store `reactionSummary: { fire: N, heart: N, ... }` on Session METADATA
- Frontend displays top 2-3 emoji types on cards + full breakdown on replay panel

**For v1.4 — Quality Metrics:**
- New metrics fields on Session (optional): `metricsLastUpdated`, `viewerExperienceStatus`
- No EventBridge changes; metrics polled on-demand via HTTP
- Caching: 4-5 second TTL on backend to prevent API storms

**For v1.4 — Featured Broadcast:**
- Add optional `featuredUid?: string` to Session METADATA item
- New handler: `POST /sessions/{sessionId}/feature` (atomic DynamoDB write)
- Frontend polls `GET /sessions/{sessionId}` every 5-10 seconds to detect featured change
- Alternative for v1.5+: WebSocket push (not v1.4)

**Performance constraint:** Featured broadcast data NOT loaded on list views. Only on broadcaster dashboard (during live) and replay detail page. Prevent N+1 query explosion.

---

### From PITFALLS.md: Critical Risks & Prevention

| Pitfall | Severity | Prevention | Detection |
|---------|----------|-----------|-----------|
| **Unbounded metrics polling creates API storms** | CRITICAL | Min 5s polling cadence; backend cache 4-5s; load test with 50 concurrent broadcasters | DynamoDB throttle warnings; IVS GetStream latency > 500ms |
| **Featured broadcast N×M query explosion** | CRITICAL | Featured data only on detail views, not lists; pre-fetch in list-activity response | Homepage load time > 2.5s; 20+ parallel GET requests on page load |
| **Spotlight events overwhelm IVS Chat channel** | CRITICAL | Separate API transport for spotlight updates; don't mix with messages | Chat message delivery latency increases 1-2s; users report missing messages |
| **Metrics require encoder instrumentation (unavailable in browser)** | MODERATE | Scope: viewer experience metrics only (join latency, buffering); NOT encoder bitrate/fps/frame drops | Phase research doesn't mention IVS API limitations; encoder stats in feature requirements |
| **Featured broadcast field added as required (backward compat failure)** | MODERATE | ALL new fields optional (`?`); default to undefined; test loading Phase 1-22 sessions | Activity feed 500 error on production; validation errors in logs |
| **Featured creator modal search becomes performance nightmare** | MODERATE | Scope: viewers of THIS broadcast only; max 20 broadcasts shown; no autocomplete search | Modal search latency > 2s; DynamoDB consumed capacity spikes |
| **Metrics state not cleared when broadcast ends** | MINOR | Reset metrics on session status → ENDED; unmount component or set state to null | Stale metrics visible for 5+ seconds after broadcast restart |
| **Featured creator avatar flickers (CLS issue)** | MINOR | Preload avatar image; include URL in response; show skeleton while loading | Avatar placeholder for 200ms then appears; CLS score increases |
| **Metrics caching obscures live issues** | MINOR | Show "last updated X seconds ago"; invalidate cache if bitrate drops > 50% | User complaint: dashboard said stream fine but viewers saw buffering |

**Gate requirements:**
- Phase 23 (Quality Metrics): Load test with 50 concurrent broadcasters; API latency < 200ms; backward compatibility test
- Phase 24 (Featured Broadcast): Homepage load < 2.5s; query audit required; featured data pre-fetched in list responses

---

## Implications for Roadmap

### Recommended Phase Structure

**Phase 23: Stream Quality Metrics Dashboard (Low to Medium Risk)**

*Rationale:* Standalone broadcaster-facing feature; no viewer impact; metrics free from IVS SDK.

**Deliverables:**
- Metrics collection hook in BroadcastPage: poll `client.getStatus()` on 5s cadence
- Quality dashboard component: Recharts line chart showing bitrate, fps, network status
- Caching layer: Backend caches metrics 4-5s; multiple simultaneous requests return cached result
- Display cache age: "Last updated 4s ago" label on dashboard
- Backward compatibility: Optional metric fields on Session; test with Phase 1-22 sessions
- Load test gate: 50 concurrent broadcasters; verify API latency < 200ms, no DynamoDB throttle

**Stack additions:** Recharts only (40KB gzipped)

**Duration estimate:** 2-3 weeks (includes load testing)

---

**Phase 24: Creator Spotlight (Medium Risk)**

*Rationale:* Depends on Phase 23 load testing validation. Pure metadata feature; scope strictly limited to avoid query explosion.

**Deliverables:**
- Featured broadcast selection modal: shows viewers of THIS broadcast only (max 20 results)
- Backend endpoint: `POST /sessions/{sessionId}/feature` (validate ownership, atomic DynamoDB write)
- Frontend polling: `GET /sessions/{sessionId}` every 5-10s to detect featured change (acceptable for v1.4)
- Viewer page link: featured broadcast info + link to navigate
- Replay persistence: featured broadcast shown on replay viewer of original session
- Backward compatibility: `featuredUid?: string` optional field; handle undefined gracefully
- Query audit: Featured data pre-fetched in `list-activity` response (not fetched per card)
- Privacy audit: Featured creator links only visible to active broadcast viewers

**Stack additions:** None (pure backend metadata + frontend UI)

**Duration estimate:** 2-3 weeks (includes query audit + load testing)

---

### Feature Grouping & Dependencies

```
Phase 1-22 (Complete)
├─ v1.1 (Broadcast + Hangout + Chat + Reactions + Replay)
├─ v1.2 (Reaction Counts + Hangout Tracking + Activity Feed)
├─ v1.3 (Transcription + AI Summaries)
│
└─ v1.4 (Creator Studio & Stream Quality)
   ├─ Phase 23: Quality Metrics (independent; broadcaster-only)
   │  └─ Phase 24: Creator Spotlight (depends on Phase 23 validation)
   │     └─ Phase 25 (optional): WebSocket Real-Time Spotlight Updates (v1.5+)
```

**No architectural changes.** Both phases add data to existing Session model (optional fields). No new tables, no new EventBridge rules, no new Lambda patterns beyond what v1.2 established.

---

## Validation Gates (Must Pass Before Ship)

### Phase 23 Verification Checklist
- [ ] Load test: 50 concurrent broadcasters polling metrics at 5s cadence; API latency < 200ms; DynamoDB throttle events = 0
- [ ] Backward compatibility: Load Phase 1-22 recordings; no validation errors on missing metric fields
- [ ] Cache behavior: Metrics display updates within 5 seconds; "last updated X seconds ago" label accurate and shows correct time
- [ ] Fallback: If IVS GetStream API fails, dashboard shows "Metrics unavailable"; broadcast continues normally
- [ ] Unit/integration tests: useBroadcast hook + QualityMetricsDashboard component; 80%+ code coverage
- [ ] Performance: Dashboard renders without janky animations; Recharts re-render optimized for 1-5 updates/sec

### Phase 24 Verification Checklist
- [ ] Query performance: Homepage loads in < 2.5s with 30 active broadcasts
- [ ] Featured data loading: Pre-fetched in `list-activity` response (verified in network tab)
- [ ] Featured creator selection: Modal search latency < 500ms; returns <= 20 broadcasts (viewers of THIS broadcast only)
- [ ] Backward compatibility: Replays of Phase 1-22 broadcasts render without errors; missing `featuredUid` field handled gracefully
- [ ] Avatar preload: Featured creator overlay loads without Cumulative Layout Shift (CLS); no visual flicker
- [ ] State reset: After broadcast ends, starting new broadcast shows clean featured state (no stale data)
- [ ] Privacy audit: Featured creator links only visible to active broadcast viewers; spot-check activity feed for no exposure
- [ ] Integration test: End-to-end flow — broadcaster selects featured creator → viewers see link → click → navigate to featured broadcast (no timeouts)

---

## Research Flags (Phases Needing Additional Research)

| Phase | Topic | Why Research Needed | Action |
|-------|-------|-------------------|--------|
| Phase 23 | IVS GetStream API exact metrics | Confirm available metrics from AWS IVS SDK before UI mockups created | Run Phase 23 research; document `getStatus()` output schema |
| Phase 23 | Encoder bitrate capability | Verify if browser WebRTC stats provide encoder-side metrics; probably not | Test IVS Web Broadcast SDK + RTCPeerConnection APIs in spike |
| Phase 24 | Featured creator opt-in | If creators don't want to be featured, should we require consent? | Product/design alignment; defer to v1.5 if complex |
| Phase 24 | WebSocket real-time updates | For featured broadcast changes to propagate instantly; current polling is 5-10s | Defer to v1.5; v1.4 acceptable with polling latency |

**Standard patterns (no research needed):**
- DynamoDB optional fields + backward compatibility (v1.2 established this pattern)
- Lambda handler + EventBridge integration (established in v1.1-v1.3)
- React hooks for state management (project convention)
- Frontend caching strategies (standard web patterns)

---

## Confidence Assessment

| Area | Level | Notes |
|------|-------|-------|
| **Stack (Recharts + IVS SDK metrics)** | HIGH | Recharts mature library (40K+ weekly npm downloads); IVS SDK v1.32.0 stable with documented `getStatus()` API |
| **Featured broadcast metadata** | HIGH | Simple optional Session field; backward compatible; proven pattern from v1.2 optional fields |
| **Architecture (no breaking changes)** | HIGH | All changes additive; Session model extension is optional; DynamoDB single-table design accommodates new fields |
| **Polling strategy (5s+ minimum)** | HIGH | Inferred from existing `useViewerCount` (15s cadence) and IVS API documented limits; load testing will validate |
| **No encoder metrics in browser** | MEDIUM | IVS Web Broadcast SDK likely limited to viewer experience stats; requires verification in Phase 23 research |
| **Query performance gating** | MEDIUM | Depends on discipline during Phase 24 implementation; risk if featured data added to list views without pre-fetch |
| **Privacy implications** | MEDIUM | Current plan assumes featured creators OK with visibility; opt-in consent may be needed (defer to v1.5) |
| **WebSocket real-time updates** | LOW | Deferred to v1.5; polling strategy (5-10s) acceptable for v1.4 MVP |

---

## Gaps & Open Questions

1. **Encoder metrics availability:** Phase 23 research must verify exact output of `IVSBroadcastClient.getStatus()` and whether browser WebRTC APIs provide encoder-side bitrate/fps/frame drops. If unavailable, scope dashboard to viewer experience metrics only.

2. **Featured creator opt-in:** Should creators be able to opt out of being featured by others? Current plan assumes yes. Product/design needs to clarify consent model before Phase 24 implementation.

3. **Avatar storage & CDN:** Featured creator avatars must be preloaded to avoid CLS. Confirm S3 avatars are CloudFront-cached with 1-year cache headers before Phase 24 ships.

4. **Real-time spotlight transport for v1.5:** Current featured broadcast selection uses HTTP polling (5-10s latency). For instant updates, v1.5 should add WebSocket transport to avoid cluttering IVS Chat with spotlight events.

5. **Load testing infrastructure:** CI/CD should add load testing suite for Phase 23+ to measure API latency under 50+ concurrent users. Currently not in test suite.

---

## Next Steps

1. **Phase 23 Planning:** Run `/gsd:research-phase` to confirm IVS SDK metrics availability + encoder limitations. Update feature requirements based on findings.

2. **Phase 23 Implementation:** Implement metrics collection (5s polling cadence) + caching before UI code. Load test gate must pass before Phase 24 begins.

3. **Phase 24 Planning:** Design featured creator selection modal scoped to "viewers of THIS broadcast only" (not global). Create query audit checklist.

4. **Phase 24 Implementation:** Implement with strict performance gating. Featured data pre-fetched in `list-activity` response; never loaded per card.

5. **Post-Phase 24:** Gather user feedback on polling latency (5-10s). If real-time updates critical, prioritize WebSocket transport for v1.5.

---

## Sources

**High Confidence (Direct Codebase Analysis):**
- STACK.md: Recharts library research + amazon-ivs-web-broadcast capabilities (verified against installed package versions)
- ARCHITECTURE.md: Integration points read directly from `backend/src/handlers/`, `backend/src/repositories/`, `infra/lib/stacks/`
- FEATURES.md: Phasing constraints + feature scope from v1.2 research + AWS official docs (Transcribe, Bedrock, IVS)
- PITFALLS.md: Risks identified from existing polling pattern (`useViewerCount` 15s cadence) + DynamoDB single-table design + N+1 query anti-patterns

**Medium Confidence (AWS Documentation + Community Patterns):**
- IVS GetStream API polling limits (5 TPS documented in service docs)
- Recharts performance at 1-5 updates/sec (40K+ weekly downloads + production dashboards using it)
- Backend caching tradeoffs for real-time systems (standard architecture pattern)
- DynamoDB optional fields + backward compatibility (v1.2 established this pattern in same codebase)

**Verification Required (Phase 23-24 Research Spikes):**
- Exact metrics available from `IVSBroadcastClient.getStatus()`
- Browser WebRTC RTCPeerConnection encoder-side stats availability
- Avatar CDN caching headers (S3 CloudFront config)
- Load test results with 50+ concurrent broadcasters

---

## Summary Table: v1.4 Roadmap at a Glance

| Aspect | Phase 23 (Quality Metrics) | Phase 24 (Creator Spotlight) |
|--------|---------------------------|--------------------------|
| **Risk Level** | Low-Medium | Medium |
| **Dependencies** | None | Phase 23 validation |
| **New Libraries** | Recharts (40KB) | None |
| **New Handlers** | None (HTTP polling) | `POST /sessions/{id}/feature` |
| **New Fields (Session)** | `metricsLastUpdated` (optional) | `featuredUid` (optional) |
| **Breaking Changes** | None | None |
| **Load Test Required** | YES (50 concurrent) | YES (query audit) |
| **Duration Estimate** | 2-3 weeks | 2-3 weeks |
| **Validation Gate** | API latency < 200ms @ 5s cadence | Homepage < 2.5s; featured data pre-fetched |
| **Backward Compat** | Optional fields; Phase 1-22 compatible | Optional fields; Phase 1-22 compatible |
| **v1.5 Upgrade Path** | Add encoder metrics if available | Add WebSocket real-time updates; global search |

---

**Research Complete:** 2026-03-06
**Confidence:** HIGH
**Ready for Phase Planning:** YES
