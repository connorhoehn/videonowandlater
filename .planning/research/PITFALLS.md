# Stream Quality Monitoring & Creator Spotlight: Domain Pitfalls

**Domain:** AWS IVS broadcast metrics collection + creator cross-promotion features on existing real-time system
**Researched:** 2026-03-05
**Context:** v1.4 feature additions to established 22-phase codebase with live chat, reactions, replays, and event-driven session lifecycle
**Confidence:** HIGH (based on existing codebase patterns, AWS IVS service constraints, and real-time system architecture)

---

## Executive Summary

Adding stream quality monitoring and creator spotlight to the existing VideoNowAndLater system introduces **three categories of critical risk:**

1. **Metrics Collection Architecture** — Polling vs. push, rate limiting, cache invalidation, frontend performance impact
2. **Creator Feature Scope Creep** — Cross-promotion logic creates data model coupling, discovery UX complexity, and privacy boundary violations
3. **Real-Time System Integration** — New metric streams + spotlight updates compete with existing IVS Chat polling, can overwhelm frontend event loop and degrade UX

**Core danger:** The existing codebase is optimized for one-way broadcast polling (viewer count on 15s cadence). Adding quality metrics (bitrate, fps, latency, network status) + creator spotlight feature triggers + notification delivery will multiply API load by 3-5x if not carefully scoped.

**Success criterion:** Stream quality dashboard for broadcaster-only view (no viewer impact). Creator spotlight opt-in with strict cardinality limits (one active featured broadcast per session max).

---

## CRITICAL PITFALLS

### Pitfall 1: Unbounded Metrics Polling Creates API Storms

**What goes wrong:**
- Quality metrics API called every 1-2 seconds by broadcaster (vs. current 15s viewer count poll)
- Each metrics call hits IVS GetStream + DynamoDB session fetch
- If 10 concurrent broadcasters × 60 calls/min = 600 API calls/min
- Backend service degrades; DynamoDB throttles; featured broadcast queries timeout

**Why it happens:**
- Stream quality is perceived as "real-time dashboard data" so engineer implements 1s polling cadence
- Existing `useViewerCount` pattern (15s interval) is copied without adjustment
- No rate-limit testing in local dev environment (IVS mocks don't reflect production quotas)
- Frontend sees "stale" metrics and pushes poll interval down to 3s

**Consequences:**
- IVS API throttling (5 TPS limit for GetStream in some operations)
- DynamoDB consumed capacity exhausted
- Metrics displayed are 30s stale anyway due to API lag (defeats dashboard purpose)
- Featured broadcast selection UI becomes unusable (queries timeout)

**Prevention:**
- **Hard ceiling:** Quality metrics poll interval = 5 seconds minimum (not negotiable)
- **Caching strategy:** Backend caches metrics for 4-5s; multiple simultaneous calls return cached result
- **Metric subsetting:** Only expose metrics broadcaster actually needs (bitrate, fps, network status) — not 20 dimensions
- **Load testing gate:** Before Phase ship, test with 50 concurrent broadcasters polling metrics at 5s cadence; measure API/DynamoDB utilization
- **Frontend feedback loop:** Show "last updated 4s ago" on metrics display to set expectations
- **Rate limit monitoring:** CloudWatch alarm on IVS GetStream throttling and DynamoDB read capacity exceeded

**Detection:**
- DynamoDB consumed capacity warnings in CloudWatch (watch `ConsumedReadCapacityUnits`)
- IVS GetStream latency spikes above 500ms (baseline is 50-100ms)
- Featured broadcast queries timeout (403 Gateway Timeout in browser console)
- Metrics dashboard shows stale data (> 5s old) consistently

**When to address:**
- Phase implementing quality metrics (likely Phase 23+) — implement caching + polling interval limit as first task before any UI code
- Phase implementing featured broadcast (Phase 24+) — add cardinality limit (one featured creator per session) as requirement gate

---

### Pitfall 2: Featured Broadcast Cross-Promotion Creates N×M Query Explosion

**What goes wrong:**
- For each broadcast on viewer's home page, fetch "featured creator" data to show "now featuring broadcaster X"
- If 30 broadcasts on home feed + each has featured creator link = 30 extra DynamoDB queries per page load
- Each query hits Session table, then Creator profile table (if profiles exist), then featured broadcast Session fetch
- Total: 90 DynamoDB reads per homepage load (vs. current 6 reads: list-activity → 5-10 recordings)
- Homepage becomes unusably slow; DynamoDB throttles

**Why it happens:**
- "Creator spotlight" conceptually means "show every broadcast's featured creator on the card"
- Naive implementation: For each recording card, call `GET /sessions/{sessionId}/featured-creator` endpoint
- Frontend renders in map loop, triggering 30 sequential requests or 30 parallel requests (both bad)
- No one thinks about N+1 query problem during feature design

**Consequences:**
- Homepage loads in 5-8 seconds (vs. current 1-2 seconds)
- DynamoDB throttled; session queries timeout
- Users navigate away; engagement metrics drop
- Featured broadcast data stale (30s old) because queries were so slow
- Cascading failure: slow homepage → users refresh → more queries → worse throttling

**Prevention:**
- **Hard limit:** Featured broadcast data NOT loaded on list views (home feed, activity feed)
- **Featured broadcast link** only on: (1) broadcaster dashboard (during live), (2) single session detail page (replay viewer)
- **Eager load in list responses:** If featured broadcast must appear on cards, pre-fetch it in `list-activity` handler and include in response (one query, 5-10 records fetched, not N queries)
- **Cardinality constraint:** Exactly one featured creator per session (not "featured creators" plural)
- **TTL/caching:** Featured broadcast reference cached 60s on frontend; don't refetch on every page view
- **Query audit:** Phase gate requires comparing homepage load time before/after; if >2.5s, feature is deferred

**Detection:**
- PageSpeed/Lighthouse scores drop 20+ points on home page
- Network waterfall shows 20+ GET requests happening in parallel on page load
- Backend logs show 30+ consecutive `ListActivity` handlers each triggering featured broadcast fetches
- DynamoDB `ConsumedReadCapacityUnits` spikes 5-10x normal during homepage load

**When to address:**
- Phase 24 (featured broadcast): Include query audit in VERIFICATION.md
- Before adding featured broadcast to any list view component, add architectural review task

---

### Pitfall 3: Spotlight Feature Update Events Overwhelm IVS Chat Channel

**What goes wrong:**
- Current architecture: Broadcaster + viewers connected to IVS Chat room for messages + reactions
- New feature: Broadcaster selects featured creator → event sent to IVS Chat room to notify viewers
- Problem: Chat room is designed for messages/reactions (~10-50 events/min), not feature updates (~1 event per click)
- But if feature updates sent via IVS Chat, they compete with message polling
- Frontend's `ChatRoomProvider` polling loop may drop messages to process feature update events
- Users miss chat messages; experience feels broken

**Why it happens:**
- Engineer thinks "IVS Chat already connected, send spotlight update through same channel"
- Seems efficient; reduces API calls
- Doesn't model that Chat event types have different SLA requirements (messages = critical, spotlight = nice-to-have)
- No explicit event prioritization in `useChatRoom` hook

**Consequences:**
- Viewers miss chat messages during featured creator changes
- Featured broadcast update doesn't propagate reliably to some viewers
- Frontend error: "Message received but failed to render" in console
- Users manually refresh to see featured creator change

**Prevention:**
- **Separate event channel:** Spotlight updates sent via separate API endpoint or EventBridge, NOT through IVS Chat
- **Different transport:** If spotlight is shown on viewer page, use HTTP polling (5s interval, cached) or Cognito Sync
- **Explicit SLA:** Message events = 100% delivery, low latency. Spotlight events = best-effort, 5-10s latency OK
- **No mixing concerns:** IVS Chat = messages + reactions only (CRITICAL: document this constraint)
- **Event prioritization:** If spotlight MUST use Chat, implement explicit priority queue: messages → reactions → spotlight. Drop spotlight events if buffer fills.

**Detection:**
- ChatPanel logs show `message polling errors` or `dropped events`
- Users report missing chat messages during broadcasts with active spotlight changes
- CloudWatch logs show `message-buffer-overflow` warnings
- Message delivery latency increases from 200ms to 1-2s during featured broadcast changes

**When to address:**
- Phase 24 (featured broadcast): Choose transport for spotlight updates as **first architectural decision** before implementation
- Phase 23 (quality metrics): If metrics sent via Chat as events, same constraint applies — separate channel required

---

## MODERATE PITFALLS

### Pitfall 4: Quality Metrics Require Encoder-Side Instrumentation (Not Available in Browser)

**What goes wrong:**
- Engineer plans to display bitrate, framerate, network jitter, keyframe interval on broadcaster dashboard
- Realizes: Browser WebRTC stats API shows **received** metrics (viewer side), not **sent** metrics (broadcaster encoder side)
- IVS Chat doesn't provide encoder stats; AWS IVS GetStream endpoint returns only viewer count + playback stats
- Conclusion: Quality metrics must come from broadcaster's encoder/OBS/capture device
- But typical browser broadcasting setup (getUserMedia + WebRTC) doesn't expose encoder bitrate or frame drop rate

**Why it happens:**
- Assumption: "All live streaming platforms show quality dashboard to broadcaster"
- Reality: Twitch OBS integration sends stats via OBS native plugin, not from browser
- AWS IVS for web broadcasting has different constraints than OBS/encoder software
- Engineer doesn't research IVS Web Broadcast SDK capabilities until Phase implementation

**Consequences:**
- Quality dashboard stub created with placeholder metrics "Coming soon"
- Broadcaster has no insight into stream quality (defeats v1.4 feature goal)
- Phase ships with incomplete feature; marked for future enhancement
- User frustration: "Professional streamers get quality dashboards but this platform doesn't"

**Prevention:**
- **Phase research (Phase 23):** Document available metrics sources:
  1. **Viewer-side metrics** (from IVS Player): buffering events, playback quality, join latency (LOW confidence for encoder quality)
  2. **IVS GetStream API metrics** (available via AWS IVS SDK): current viewer count, playback stats (does NOT include encoder bitrate/fps/drops)
  3. **WebRTC RTCPeerConnection stats** (if custom WebRTC used): only available in Chrome/Firefox, requires deep integration
  4. **Encoder-provided metrics** (OBS/hardware encoder): NOT available in browser-based platform, requires native app
- **Feature scope gate:** Define "quality dashboard" precisely:
  - **Option A:** "Viewer experience metrics" — buffering events, join latency, bitrate adaptation (feasible from IVS Player)
  - **Option B:** "Encoder health metrics" — bitrate, fps, network jitter (NOT feasible without native encoder integration)
- **Decision:** v1.4 implements **Option A only** (viewer experience metrics)
- **Documentation:** Explicitly note in feature requirements: "Quality dashboard shows viewer experience, not encoder input metrics. For encoder stats, integrate with OBS/Streamlabs plugin."

**Detection:**
- Phase research doesn't mention IVS GetStream API limitations
- Quality dashboard feature request includes "bitrate" + "frame rate" + "network jitter" from broadcaster
- Phase implementation discovers RTCPeerConnection stats require Chrome-only APIs or fail silently

**When to address:**
- Phase 23 research MUST investigate IVS Web Broadcast SDK capabilities doc before any mockups created
- Clarify metrics availability with product/design before Phase 23-01 plan written

---

### Pitfall 5: Creator Spotlight Lookup Adds Field to Session Model Without Backward Compatibility

**What goes wrong:**
- Phase 24 adds `featuredCreatorId?: string` field to Session domain model
- Existing sessions (22 phases worth) have no `featuredCreatorId` (undefined)
- Frontend displays featured creator overlay; code checks `if (session.featuredCreatorId) { show() }`
- Existing broadcasts replay with no featured creator shown (OK)
- But if featured creator field is REQUIRED in DynamoDB scan queries, old sessions cause parse errors
- Code path: `list-activity` → DynamoDB scan → hydrate Session objects → if missing field, validation fails

**Consequences:**
- Activity feed fails to load (500 error)
- Viewers can't see replays of broadcasts
- Rollback required; Phase 24 blocked

**Prevention:**
- **Backward compatibility gate:** All new fields on Session marked optional (`?`)
- **Default values:** Frontend assumes undefined featured creator means "no spotlight" (not error)
- **Repository pattern:** `getSessionById` function initializes missing optional fields with defaults
- **Migration optional:** Phase 24 does NOT include migration job to backfill old sessions; defaults in code are sufficient
- **DynamoDB scan safety:** Query/Scan operations return sessions with missing fields; code must handle undefined for ALL newly-added fields
- **Test legacy sessions:** Phase 24 verification includes test loading sessions from Phase 1-22 data; ensure no parsing/validation errors

**Detection:**
- Phase 24 unit tests only test NEW sessions (missing old session coverage)
- Activity feed 500 error on production shortly after Phase 24 deployment
- CloudWatch logs show `ValidationError: featuredCreatorId is required` when sessions lacking field are queried

**When to address:**
- Phase 24 planning: Add `all new fields are optional` as requirement gate
- Phase 24 verification: Include test with mock session objects missing new fields

---

### Pitfall 6: Featured Broadcast Selection UI Becomes Infinite Scroll / Search Performance Nightmare

**What goes wrong:**
- Feature: Broadcaster chooses featured creator from list of all live broadcasts
- UI mockup shows searchable dropdown / modal with "Start typing creator name…"
- Implementation: Each keystroke queries DynamoDB for `list live broadcasts matching search term`
- At 100+ concurrent broadcasters, search returns 50 results
- If feature accessible from broadcaster dashboard (constantly visible), frontend sends search query every keystroke
- DynamoDB consumed capacity exhausted; search results timeout; featured creator selection UI breaks

**Why it happens:**
- Scope creep: "Easier if users can search for featured creator by name/title"
- No one models that search = full table scan with filter expression
- UI designer shows "autocomplete search" pattern; engineer builds it without query optimization
- Local testing with 5 total sessions shows instant results; production with 1000+ sessions reveals latency

**Consequences:**
- Featured creator selection modal unusable (search returns 0 results or times out)
- Broadcaster can't change featured creator mid-broadcast
- Feature feels broken despite code correctness

**Prevention:**
- **Cardinality constraint:** Featured creator selection limited to **"Current viewers of YOUR broadcast"** only, not global search
- **Pre-computed list:** Before opening selection modal, fetch `get-active-broadcasts-with-viewers-watching-mine` (1 query, returns ~3-10 broadcasts)
- **Hard limit:** Modal shows max 20 broadcasts; search disabled if <= 20 visible; if > 20, user required to scroll (no search)
- **No autocomplete on keystroke:** Search button required (not real-time keystroke-triggered)
- **Query optimization:** If search needed, use GSI with `sessionType#status` + `creatorName` prefix, not full scan
- **Scope gate:** Phase 24 requirement = "Featured creator selection from MY broadcast viewers only"; global search deferred to v1.5

**Detection:**
- Featured creator modal search latency > 2 seconds for any query
- DynamoDB consumed capacity spikes when modal opened
- Search returns 0 results on first load then "Request timeout" errors
- Phase implementation includes `list-broadcasts` query without GSI or limit

**When to address:**
- Phase 24 planning: Define UI mockup with strict "viewers of this broadcast only" scope
- Phase 24 verification: Load test with 1000+ concurrent broadcasts; confirm search latency < 500ms

---

## MINOR PITFALLS

### Pitfall 7: Metrics Frontend State Not Cleared When Broadcast Ends

**What goes wrong:**
- Broadcaster stops broadcast → session transitions to ENDING
- Quality metrics component still holding stale dashboard state (bitrate, fps, jitter, latency)
- Broadcaster navigates back to home, then starts NEW broadcast
- Quality metrics component reused; initialized with stale values from previous broadcast
- Dashboard shows old metrics until server updates arrive (5s+ delay)
- Confuses broadcaster about stream health

**Why it happens:**
- Quality metrics component created as singleton on BroadcastPage
- When new session starts, component updates via useEffect
- But useEffect debounced or delayed; stale state shown briefly
- No explicit `resetMetrics()` when session status transitions to ENDING

**Prevention:**
- **Clean state on session change:** When `sessionId` changes, clear metrics to loading state
- **Broadcast status dependency:** useEffect triggers on session.status → ENDED to reset all metrics
- **Explicit reset:** Call `setMetrics({ bitrate: null, fps: null, latency: null })` when starting new broadcast
- **Component cleanup:** Metrics component unmounts when session ends (not kept alive across broadcasts)

**Detection:**
- Quality metrics shown after broadcast stopped (should show "Broadcast ended" or nothing)
- Stale metrics data visible for 5+ seconds when new broadcast starts
- Unit test for metric reset missing in test suite

**When to address:**
- Phase 23: Include component test for metric state reset on session transition

---

### Pitfall 8: Featured Creator Avatar/Thumbnail Not Preloaded; Overlay Flickers

**What goes wrong:**
- Featured creator overlay loads creator avatar from S3 URL lazily
- Avatar image not cached; first time shown, browser fetches from S3
- Image takes 200-500ms to arrive; overlay renders without avatar for 200ms
- Avatar suddenly appears; layout shifts (CLS score increases)
- Viewer experience: featured creator box flickers / shifts
- Looks janky despite working correctly

**Why it happens:**
- Avatar URLs not included in featured broadcast response; fetched separately
- No image preload on featured broadcast selection UI
- Frontend doesn't use React lazy load / intersection observer for images

**Prevention:**
- **Include avatar URL in response:** When fetching featured broadcast data, include `featuredCreator.avatarUrl` in same response (no extra round-trip)
- **Preload images:** When broadcaster selects featured creator, preload avatar image: `new Image().src = url`
- **Skeleton loader:** Show avatar skeleton/placeholder while image loads
- **Image optimization:** Store avatars in S3 with CloudFront CDN; cache-control headers set to 1 year

**Detection:**
- Featured creator overlay shows blank space for 200ms, then avatar appears
- Cumulative Layout Shift (CLS) metric increases on pages with featured broadcasts
- Network waterfall shows avatar image fetched after overlay rendered

**When to address:**
- Phase 24 implementation: Include avatar preload in featured broadcast selection handler
- Phase 24 verification: Test featured broadcast overlay visual stability / CLS score

---

### Pitfall 9: Metrics Caching Obscures Live Issues; Broadcaster Trusts Stale Data

**What goes wrong:**
- Backend caches quality metrics for 4-5 seconds (to avoid API storms; see Pitfall 1)
- Broadcaster's stream quality degrades to nearly unwatchable (bitrate drops from 5 Mbps to 0.5 Mbps)
- Dashboard still shows "5 Mbps bitrate, excellent" for 4 seconds (cached old data)
- Broadcaster doesn't know something's wrong until viewers start complaining
- By then, damage done (viewers buffered, chat became laggy)

**Why it happens:**
- Caching strategy implemented to reduce API load
- No consideration for staleness implications on broadcaster decision-making
- Broadcaster assumes dashboard is real-time

**Prevention:**
- **Clear cache on anomaly:** If bitrate drops > 50% from previous reading, invalidate cache and fetch fresh data
- **Show cache age:** Display "Last updated 4s ago" or "Updates every 5s" on dashboard
- **Alerting on threshold:** If bitrate < 1 Mbps, show red warning regardless of cache age
- **Hybrid strategy:** Cache for 4s normally; cache for 1s if previous reading was critical/warning state
- **Broadcaster education:** Documentation: "Metrics updated every 5 seconds; not real-time; if you see quality issues, check viewer feedback"

**Detection:**
- Phase 24 verification includes "quality crisis" scenario: simulate bitrate drop, verify broadcaster notified within 5 seconds
- User complaint: "Dashboard said stream was fine but viewers saw buffering"

**When to address:**
- Phase 23 metrics design: Define cache invalidation strategy based on metric deltas
- Phase 24 verification: Include edge case tests for rapid metric changes

---

## SCOPE CREEP AVOIDANCE

### Feature 1: Stream Quality Monitoring — What to INCLUDE

**In scope (Phase 23):**
- View current viewer experience metrics during live broadcast:
  - Current viewer count (already have)
  - Playback join latency (time from broadcast start to first frame)
  - Buffering events count (how many times viewers experienced buffering)
  - Current playback quality/bitrate adaptation state
- Data sourced from IVS GetStream endpoint + CloudWatch logs
- Visible only to broadcaster (dashboard on broadcast page)
- Update frequency: 5-second intervals (cached backend)

**Out of scope (defer to v1.5+):**
- Encoder bitrate / fps / frame drops (requires encoder integration, not available in browser)
- Per-viewer analytics (privacy concern; not needed for v1.4)
- Regional viewing statistics (nice-to-have; adds complexity)
- Historical quality trends (requires analytics database; out of scope for MVP)
- Quality prediction / AI recommendations (out of scope)

---

### Feature 2: Creator Spotlight — What to INCLUDE

**In scope (Phase 24):**
- Broadcaster can choose **one active featured creator** from current viewers of broadcast
- Featured broadcast info shown on viewer page (creator name, viewer count, link to featured broadcast)
- Featured broadcast selection modal shows only active broadcasts with viewers
- Featured creator data persisted on Session model (survives broadcast end, shown in replay)
- Viewers can click featured broadcast link to navigate and watch

**Out of scope (defer to v1.5+):**
- Featured creator recommendations (ML-based; out of scope)
- Featured creator rotation / scheduling (too complex)
- Multiple featured creators per broadcast (scope: one only)
- Featured creator analytics (who clicked through, metrics)
- Featured creator tiers / monetization (business logic, out of scope)
- Search across all global broadcasts for featured creator (scope: viewers of THIS broadcast only)

---

## PHASE-SPECIFIC WARNINGS

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|-----------------|------------|
| Phase 23 (Quality Metrics) | Polling cadence selection | Underbounded polling (1-2s) causes API storms | Implement 5s+ minimum with tests; include rate-limit testing gate |
| Phase 23 | Metrics data model | Quality metrics fields not optional on Session | Add to backward compatibility gate; test with Phase 1-22 sessions |
| Phase 23 | Frontend polling | useMetrics hook created without cache awareness | Document cache TTL in component; show "last updated X seconds ago" |
| Phase 24 (Featured Broadcast) | Data model | `featuredCreatorId` field added as required | ALL new fields optional; initialize to undefined defaults; test legacy compatibility |
| Phase 24 | Query performance | Featured broadcast loaded on every activity feed card | Gate: featured data only on detail views, not lists; query audit required |
| Phase 24 | UI performance | Search autocomplete on featured creator modal | Gate: search disabled; show viewers of this broadcast only |
| Phase 24 | Event transport | Spotlight updates sent via IVS Chat | Gate: separate API/transport for spotlight; don't mix with messages |
| Phase 24 | User data | Featured broadcast link reveals creator identities to viewers | Document privacy implications; featured creator must opt-in (consider for v1.5) |

---

## VALIDATION GATES (MUST PASS BEFORE PHASE SHIP)

### Phase 23 (Quality Metrics) Verification Requirements

- [ ] **Load test:** 50 concurrent broadcasters polling metrics at 5s cadence; API latency remains < 200ms, DynamoDB throttle events = 0
- [ ] **Backward compatibility:** Load and display recordings from Phase 1-22; no validation errors on missing metric fields
- [ ] **Cache behavior:** Metrics updated display within 5 seconds; "last updated X seconds ago" label accurate
- [ ] **Fallback:** If IVS GetStream fails, dashboard shows "Metrics unavailable" (not error); broadcast continues normally
- [ ] **Unit tests:** useBroadcast hook + quality metrics component tests pass; 80%+ code coverage

### Phase 24 (Featured Broadcast) Verification Requirements

- [ ] **Query performance:** Homepage loads in < 2.5s with 30 active broadcasts; featured data pre-fetched in list-activity response
- [ ] **Featured creator selection:** Modal search latency < 500ms for any query; returns <= 20 broadcasts (viewers of THIS broadcast only)
- [ ] **Backward compatibility:** Replays of Phase 1-22 broadcasts render without errors; missing featuredCreatorId field handled gracefully
- [ ] **Avatar preload:** Featured creator overlay loads without CLS shifts; images preloaded during selection
- [ ] **State reset:** After broadcast ends, starting new broadcast shows clean featured creator state (no stale data from previous broadcast)
- [ ] **Privacy audit:** Featured creator links only visible to active broadcast viewers; no exposure on public activity feed without opt-in consent
- [ ] **Integration test:** End-to-end flow: broadcaster selects featured creator → viewers see link → click → navigate to featured broadcast (no timeouts/errors)

---

## RECOMMENDATIONS FOR ROADMAP PLANNING

1. **Phase 23 (Quality Metrics):** Implement with strict polling interval constraints (5s+) and caching as first task. Include load testing gate before UI code.

2. **Phase 24 (Featured Broadcast):** Implement featured creator selection modal with viewer-only search (not global). Do NOT add featured broadcast data to list views (activity feed, home). Defer global search to v1.5+.

3. **Phase 24b (Privacy gate):** Consider adding opt-in consent for featured creator linkage (if creators don't want to be featured, respect that). Current plan assumes featured creators OK with visibility.

4. **Research during Phase 23:** Confirm exact metrics available from IVS GetStream API and WebRTC RTCPeerConnection stats; document limitations for encoder-side metrics.

5. **Testing infrastructure:** Add load testing suite to CI/CD for Phase 23+ (measure API latency under 50+ concurrent users).

---

## Sources

**HIGH confidence:**
- Project codebase: `backend/src/handlers/get-viewer-count.ts`, `useViewerCount.ts` — polling pattern, 15s cadence rationale
- Project codebase: `backend/src/services/broadcast-service.ts` — GetStream API caching, rate limit awareness
- Project codebase: `backend/src/domain/session.ts` — session model structure; optional field pattern established in Phase 20 (aiSummary, aiSummaryStatus)
- Memory context: Real-time system architecture, auth flow (`cognito:username`), DynamoDB query patterns

**MEDIUM confidence:**
- AWS IVS documentation (inferred): GetStream API 5 TPS limit mentioned in service docs; CloudWatch metrics integration standard
- Real-time system patterns: IVS Chat event prioritization (inferred from project's message/reaction polling architecture)
- Frontend performance: CLS (Cumulative Layout Shift) metrics standard in Lighthouse / PageSpeed

**Domain knowledge:**
- N+1 query patterns in distributed systems (standard pitfall)
- Backend caching tradeoffs (staleness vs. load)
- Feature scope creep in UI-driven projects (common in social/discovery features)

---

**Confidence assessment:**
- **Quality metrics polling constraints:** HIGH — based on existing polling pattern, IVS API documented limits
- **Query performance risks:** HIGH — based on N+1 pattern analysis of existing codebase
- **Event transport conflicts:** HIGH — based on IVS Chat + message polling architecture already in place
- **Backward compatibility:** HIGH — Phase 20 established optional fields + default patterns
- **Scope creep prevention:** MEDIUM — requires product/design alignment; technical feasibility clear but product scope not locked

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (30 days; refresh if AWS IVS API changes or team product scope clarifies)

---

*Research completed: 2026-03-05*
*Prepared for: Phase 23-24 planning (Stream Quality Monitoring + Creator Spotlight)*
