# Domain Pitfalls: Stream Quality Monitoring & Creator Spotlight (v1.4)

**Domain:** Live streaming platform — broadcaster tools and creator cross-promotion
**Researched:** 2026-03-05
**Scope:** AWS IVS streaming + React UI for quality dashboards and creator features

---

## Critical Pitfalls

Mistakes that cause architectural rewrites or major user experience issues.

### Pitfall 1: Metrics Latency Breaks the Dashboard Value Proposition

**What goes wrong:**
Dashboard shows metrics that are 30-60 seconds stale. Broadcaster sees "bitrate: 4200 Kbps" while their encoder is already at 2000 Kbps (a crisis they can't see happening in real-time). Dashboard becomes a placebo — users ignore it after realizing it's not actually telling them what's happening *now*.

**Why it happens:**
- CloudWatch metrics have 30-60 second update latency by design (AWS aggregates across region)
- Temptation to rely solely on CloudWatch instead of client-side metrics
- Not validating latency against real broadcaster expectations

**Consequences:**
- Broadcasters lose trust in dashboard ("It's useless")
- Feature gets deprioritized as "not working"
- Creator satisfaction decreases; platform appears unprofessional vs. Twitch/YouTube

**Prevention:**
1. **Dual data sources (recommended):** Client-side WebRTC stats (real-time) + CloudWatch (historical/verification)
   - Dashboard displays client-side metrics immediately (responsive)
   - CloudWatch used for 24-hour retention + analytics
2. **Define latency acceptable to broadcasters:** Test with 5+ creators; ask "Is a 30-second delay acceptable?" If not, client-side metrics are mandatory
3. **Validate early (Phase 1):** Spike test CloudWatch latency against actual broadcast; don't assume documentation

**Detection:**
- Creator complaints: "Metrics don't match my encoder"
- Low dashboard engagement: <20% of broadcasters checking metrics after first week
- Compare displayed metrics to OBS encoder values during test broadcasts

---

### Pitfall 2: Health Score Calculation Doesn't Match Broadcaster Intuition

**What goes wrong:**
Platform shows "Health Score: 72/100" but broadcaster sees no visible issues (smooth video, no dropped frames). Or vice versa: score is 92 but stream quality is visibly degraded. Broadcasters don't understand what the score means or trust it, so they ignore it.

**Why it happens:**
- No ground truth about what "health" means for streaming
- Formula is arbitrary (e.g., equal weighting bitrate + FPS + packet loss)
- Not validated against real broadcaster feedback
- Over-engineering with ML/complex logic before understanding basic patterns

**Consequences:**
- Feature becomes noise (broadcasters ignore the score)
- Wasted implementation effort on something users don't value
- Potential rewrites if formula is fundamentally wrong

**Prevention:**
1. **Start simple:** Don't use ML or complex weighting
   - Simple formula: `(bitrate_stability * 0.4) + (fps_stability * 0.4) + (packet_loss_inverse * 0.2)`
   - Stability = 1.0 if variance < 10%, scales down linearly to 0 at ±50%
2. **Validate with users:** Show mockups to 5-10 creators; ask "What does 0-100 mean to you?"
3. **Iterate based on feedback:** After Phase 1 ships, gather data on what scores correspond to user-reported issues
4. **Document the formula:** Make it transparent what goes into the score

**Detection:**
- Creator feedback: "I don't understand what the score means"
- Low engagement: Score is displayed but broadcasters don't mention it in bug reports/feedback
- Mismatch validation: Compare platform score to creator's manual assessment in interviews

---

### Pitfall 3: Featured Broadcast Overlay Breaks Layout on Mobile

**What goes wrong:**
Picture-in-picture featured video takes up 25% of width on desktop (reasonable), but on a phone it becomes 25% of 375px = ~94px wide — unreadable, unwatchable, frustrating. Broadcaster gives up, removes feature. Viewers on mobile never see the featured creator showcase.

**Why it happens:**
- Desktop-first UI design (common for video apps)
- Didn't test on actual mobile devices
- No responsive layout strategy for PiP (assumed corner placement works everywhere)

**Consequences:**
- Mobile users (often majority on streaming apps) get subpar experience
- Feature doesn't drive cross-promotion effectively
- Platform looks half-baked on phones

**Prevention:**
1. **Mobile-first layout strategy:**
   - Desktop: corner PiP (25% width)
   - Tablet: side banner or adjustable drawer
   - Mobile: top or bottom banner (100% width, ~15% height) instead of corner
2. **Test on real devices early:** Phase 3 shouldn't start until mobile layout is designed and tested
3. **Provide toggle:** Let broadcaster collapse/expand featured view on mobile
4. **Fallback:** If device too narrow for PiP, show text link to featured creator instead

**Detection:**
- Broadcaster reports: "Can't see featured video on my phone"
- Mobile-specific bugs: Feature works on desktop, broken on mobile
- QA testing: Test portrait and landscape on multiple device sizes

---

### Pitfall 4: Permission Model Allows Accidental Privacy Leak

**What goes wrong:**
Broadcaster features a private broadcast (either their own or another creator's), without realizing the private stream URL is now visible to all viewers of the featuring broadcast. Privacy setting ignored; content exposed unintentionally.

**Why it happens:**
- Permission logic not properly enforced at multiple layers (UI + API + rendering)
- Assumption that "private flag" alone is enough
- Didn't test edge case: featuring private broadcasts

**Consequences:**
- Creator's private broadcast exposed to unintended audience
- Trust erosion: "This platform doesn't respect privacy settings"
- Potential data/security issue depending on what private broadcasts contain

**Prevention:**
1. **Enforce at three layers:**
   - UI: Don't show private broadcasts in featured creator selector (unless broadcaster owns them)
   - API: `GET /sessions?status=live` only returns public sessions by default; private sessions require ownership check
   - Rendering: Featured broadcast overlay only renders if playback token is valid for current user
2. **Default to safe:** Private broadcasts explicitly opt-in to featuring; don't assume featuring is always allowed
3. **Test edge case:** Try to feature a private broadcast that you don't own; should fail silently in UI + return 403 on API
4. **Document:** Make it clear to broadcasters that featuring is limited to public content (unless ownership)

**Detection:**
- Creator reports private broadcast appeared in someone else's spotlight
- API logging shows failed permission checks
- Audit: Review all featured broadcast links to ensure they don't expose private URLs

---

### Pitfall 5: Concurrent HLS Players Cause Performance Degradation

**What goes wrong:**
When viewer watches featured broadcast overlay + main broadcast (two HLS streams simultaneously), browser performance tanks: high CPU, buffering, or complete playback failure. Desktop or mobile device becomes unresponsive.

**Why it happens:**
- Each HLS video element requires HTTP requests, decoding, rendering
- Two concurrent 720p streams = 2x network bandwidth + 2x video decoder load
- Not tested on low-end devices or slow connections
- Assumption that "modern browsers can handle 2 streams" without validation

**Consequences:**
- Viewers on low-bandwidth or older devices can't use featured overlay
- Feature seen as broken/buggy
- Platform gains reputation for poor performance
- Users disable featured overlay or stop visiting

**Prevention:**
1. **Validate early (Phase 3 spike):** Test 2 concurrent HLS streams on:
   - Desktop (modern + older browsers)
   - Mobile (iOS Safari, Android Chrome)
   - Slow network (throttle to 3G in DevTools)
2. **Graceful degradation options:**
   - If playback stutters, automatically pause featured stream (show thumbnail + play button)
   - Reduce featured stream quality automatically (480p instead of 1080p)
   - Show warning: "Featured video requires better connection"
3. **Limit scope:** Phase 3 ships with featured overlay; Phase 4+ can add advanced optimization (dynamic bitrate, media element pooling)
4. **Fallback:** If featured video won't play smoothly, show static image + link instead of live video

**Detection:**
- Chrome DevTools Performance tab: Record playback; look for dropped frames, long tasks
- Network tab: Confirm two concurrent HTTP requests for HLS segments
- User reports: "Featured overlay makes my video buffer"
- Automated testing: Simulate slow network + 2 video elements; measure frame rate

---

## Moderate Pitfalls

Mistakes that cause user frustration or workarounds, but don't require architectural changes.

### Pitfall 6: Dashboard Panel Placement Obscures Video Controls

**What goes wrong:**
Floating dashboard panel in top-right corner is positioned exactly over video controls or broadcaster's face. Broadcaster has to move panel to see what they're doing. Feels sloppy and unprofessional.

**Why it happens:**
- Didn't test panel positioning on actual video player UI
- Assumed top-right is always safe (it's not for all video layouts)
- No draggability or auto-reposition logic

**Prevention:**
1. **Test positioning:** Verify panel doesn't cover broadcaster's critical UI areas (play button, exit button, participant list)
2. **Add draggability:** Let broadcaster move panel (state persisted to localStorage)
3. **Add minimize button:** Panel collapses to just the health score number (minimal footprint)
4. **Responsive placement:** On mobile, move to top or bottom banner instead of corner

---

### Pitfall 7: Featured Creator Selector Search Becomes Slow at Scale

**What goes wrong:**
With 100 live broadcasters, search is snappy. With 1000, search becomes slow (1-2 second delay between typing and results update). With 10K, search is unusable. Broadcaster gives up, doesn't feature anyone.

**Why it happens:**
- Linear search implemented without optimization
- No pagination; loading entire list of creators
- No caching or debouncing of search requests
- Didn't load test with realistic data volume

**Prevention:**
1. **Pagination from day 1:** Load first 20 creators; paginate on scroll
2. **Debounce search:** 300-500ms delay before sending search query
3. **Lazy load on backend:** Return results in batches; limit query size
4. **Add sorting:** "Most recent" or "most viewers" to help broadcasters find good creators quickly
5. **Load test Phase 26:** Test search performance with 10K mock broadcasters; if >500ms response, implement filtering on backend

---

### Pitfall 8: Featured Broadcast Ends, Overlay Stays Visible But Broken

**What goes wrong:**
Broadcaster features another creator. Featured creator's broadcast ends. Overlay still shows on screen but video is frozen or error message visible. Looks broken. Viewers get confused ("Why is there a dead video in the corner?").

**Why it happens:**
- No cleanup logic when featured broadcast ends
- HLS player doesn't gracefully handle ended stream
- No polling to detect featured broadcast status change

**Prevention:**
1. **Status polling:** Client polls featured broadcast status every 5-10 seconds
2. **Auto-cleanup:** When featured broadcast ends, automatically close overlay after 3-5 second grace period
3. **Graceful messaging:** Show "Stream ended" message briefly before closing
4. **Manual removal:** Broadcaster can always click X to close, no waiting
5. **Clear error state:** If playback fails, show "Stream unavailable" not a generic error

---

### Pitfall 9: Metrics Stored Forever; DynamoDB Costs Explode

**What goes wrong:**
Metrics endpoint puts a record for every broadcast (thousands per day). Records never deleted. After 6 months, DynamoDB table has millions of rows; scan operations become expensive; storage costs spike to $500+/month.

**Why it happens:**
- No TTL policy on metrics records
- Assumption that "we can delete later"
- Didn't estimate storage cost during design

**Consequences:**
- Unexpected AWS bill
- Performance degradation as table grows
- Ops overhead to clean up

**Prevention:**
1. **Set TTL on day 1:** 24-48 hour TTL on metrics records (sufficient for post-broadcast review + analytics)
2. **DynamoDB TTL feature:** Enable on metrics records to auto-delete
3. **Estimate storage:** At 1 metric per second per broadcaster × 1000 broadcasters × 86400 seconds = 86B items/day. With 24hr TTL, max ~2B items. Cost: ~$1/month for storage.
4. **Monitor:** Track table size in CloudWatch; alert if it grows unexpectedly

---

### Pitfall 10: Health Score Doesn't Update in Real-Time Due to Caching

**What goes wrong:**
Broadcaster sees health score: 92/100. Their connection drops. They wait 5 seconds, refresh. Score still shows 92. They wait 10 seconds, refresh. Now it shows 45. The lag makes the score feel unreliable.

**Why it happens:**
- Score cached for too long (e.g., 10 second cache instead of 1-2 second update)
- Backend lag in processing metrics
- Client didn't request fresh data after connection drop detected

**Prevention:**
1. **1-2 second cache max:** Don't cache health score longer than 1-2 seconds
2. **Cache busting on user action:** When broadcaster manually refreshes dashboard, force fresh fetch
3. **Real-time client data:** Use client-side WebRTC stats (always current) for dashboard display; don't wait for server
4. **Fallback gracefully:** If server metrics are stale, show client metrics and badge them as "local" not "verified"

---

## Minor Pitfalls

Small issues that cause confusion or workarounds, but are easy to fix.

### Pitfall 11: Featured Creator Name Truncated on Mobile

**What goes wrong:**
Featured creator name "Alexandra_StreamsWithPython_Official" gets truncated to "Alexand..." on small screens. Viewer can't tell who's actually featured.

**Prevention:** Tooltip on hover (desktop) + full name in modal (mobile); or just abbreviate intelligently (first 20 chars) + handle truncation gracefully.

---

### Pitfall 12: No Visual Indicator That Dashboard Is Real-Time

**What goes wrong:**
Broadcaster wonders if dashboard is live or cached. Is it updating? Did it freeze?

**Prevention:** Add timestamp ("Last updated: 2s ago") or subtle animation (brief flash when metrics update) to signal live data.

---

### Pitfall 13: Featured Broadcast Link Doesn't Work if Broadcaster Log Out

**What goes wrong:**
Viewer clicks featured broadcast link; it tries to open the featured broadcast. But user is logged out. Link breaks or requires login before showing featured broadcast.

**Prevention:** Playback token (v1.3 JWT) is valid regardless of login status; ensure featured broadcast viewer page works with token auth even if user is logged out.

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|-----------|
| Phase 1 (Dashboard) | Metrics latency unacceptable (pitfall 1) | Early spike test CloudWatch + WebRTC latency; validate with users |
| Phase 1 (Dashboard) | Health score confusing (pitfall 2) | Ship simple formula; gather feedback from creators before iterating |
| Phase 2 (Metrics Backend) | Metrics storage cost explodes (pitfall 9) | Set TTL on day 1; estimate storage cost upfront |
| Phase 3 (Selector) | Search becomes slow at scale (pitfall 7) | Load test with 1K+ creators; implement pagination early |
| Phase 3 (Selector) | Privacy leak with featured private broadcasts (pitfall 4) | Test edge case: try to feature private broadcasts; should fail |
| Phase 3 (Overlay) | Concurrent HLS players performance (pitfall 5) | Test 2 video streams on mobile + slow network early in phase |
| Phase 3 (Overlay) | Panel placement obscures controls (pitfall 6) | Test on actual broadcast layout; add draggability + minimize |
| Phase 3 (Overlay) | Featured broadcast ends, overlay stuck (pitfall 8) | Implement status polling + auto-cleanup + manual close |
| All phases | Cache staleness (pitfall 10) | 1-2s cache max; prefer client-side real-time data |

---

## Sources

### Industry Failures & Lessons

- **Twitch stream quality concerns** (Reddit communities, creator feedback circa 2020-2022): Metrics latency was a frequent complaint when Twitch first introduced dashboard
- **YouTube/Facebook cross-promotion flops:** Features that require too many clicks don't get used; one-click features see 10x higher adoption
- **Mobile UX failures in streaming apps:** Overlays on mobile are consistently a source of frustration in user reviews

### Technical Pitfalls

- **HLS concurrent playback:** Browser rendering performance with 2+ video elements documented in web performance literature
- **DynamoDB storage costs:** AWS pricing; TTL feature documented in AWS docs

### Architecture Patterns

- **GetStream Activity Feed blog:** Pagination + caching strategies
- **Mobile-first design principles:** Established UI/UX pattern since ~2018

---

## Pre-Phase Checklist

Before each phase, verify:

- [ ] **Phase 1:** CloudWatch latency tested; health score formula reviewed with >2 creators
- [ ] **Phase 2:** TTL policy set; storage cost estimated
- [ ] **Phase 3:** Search load tested (1K+ creators); permission model tested (try private broadcast featuring)
- [ ] **Phase 3:** Concurrent video playback tested on mobile + low bandwidth
- [ ] **All:** Cache expiration strategy defined; real-time vs. stale data trade-offs documented

---

*Pitfalls research for: v1.4 Creator Studio & Stream Quality milestone*
*Researched: 2026-03-05*
