# Feature Landscape

**Domain:** Live video platform (broadcast + group hangouts + chat + replay)
**Researched:** 2026-03-02 (Updated for v1.1 milestone)
**Confidence:** HIGH (AWS IVS official docs verified; YouTube/Instagram/Twitch UX patterns verified via 2026 sources)

## Table Stakes

Features users expect. Missing = product feels incomplete.

### Live Broadcasting (One-to-Many)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Go-live with single action | Users expect instant broadcasting; any friction = abandonment | Med | Must abstract IVS channel provisioning behind a "Go Live" button. Pre-warmed pool is critical path. |
| Live viewer count | Every streaming platform shows this; users measure engagement by it | Low | Track via IVS viewer session events or custom presence via API Gateway WebSocket / polling |
| Stream quality auto-adaptation | Users expect smooth video regardless of network; buffering = exit | Low | IVS handles ABR natively with BASIC/STANDARD/ADVANCED channel types. No custom work needed. |
| Broadcast preview (self-view) | Broadcasters need to see themselves before/during going live | Low | IVS Web Broadcast SDK provides local preview. Standard SDK feature. |
| Live indicator / stream status | Viewers need to know what's live right now vs. offline | Low | Poll session status or push via WebSocket. Essential for discovery UX. |

### Group Hangouts (Multi-Participant RealTime)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Join/leave hangout seamlessly | Users expect Zoom/FaceTime-level join UX | Med | IVS RealTime stages with participant tokens. Up to 12 publishers, 10K subscribers per stage. |
| Self-view + grid of participants | Standard video call layout; users are trained by Zoom/Teams/FaceTime | Med | Client-side composition using IVS RealTime SDK. Render each participant's stream in a grid. **Adaptive resolution critical:** deliver only pixels needed for grid cell size to prevent CPU/GPU overload. |
| Mute/unmute audio | Absolute baseline for any multi-participant video | Low | IVS RealTime SDK supports muting tracks locally before publishing. |
| Camera on/off toggle | Users expect control over their video presence | Low | Same as mute -- toggle video track publishing via SDK. |
| Participant list / count | Users need to know who's in the hangout | Low | Track via stage participant events (join/leave). Maintain in DynamoDB or in-memory. |
| Active speaker visual indicator | Zoom/Meet standard; users expect to know who's talking | Med | Monitor audio levels via Web Audio API or IVS server-side detection. Highlight border/name on active speaker tile. ASD uses ML + signal processing in 2026. |
| Participant join/leave notifications | Users need awareness of room changes | Low | Display toast/banner when participants enter/exit. Use IVS participant events. |

### Chat

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real-time text chat alongside video | Every live platform (Twitch, YouTube Live, Instagram Live) has this | Med | IVS Chat service. Create chat room per session, generate chat tokens per user. WebSocket-based. |
| Chat message history (session-scoped) | Users joining late expect to see recent messages | Med | IVS Chat does NOT persist messages natively. Must store in DynamoDB via Lambda on message events. Custom persistence required. |
| Username display on messages | Users need attribution; anonymous chat is confusing | Low | Pass Cognito username as chat token attribute. IVS Chat includes sender attributes. |
| Chat alongside replay | YouTube gold standard; users expect context when watching replays | High | Requires storing chat messages with timestamps, then synchronizing playback position with chat scroll. **YouTube synchronizes chat with video.currentTime and displays messages as they were originally sent during live broadcast.** |

### Recording and Replay

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Automatic stream recording | Users expect content preservation; Instagram/TikTok/YouTube set this expectation | Med | IVS auto-record to S3. Configure RecordingConfiguration on channel. Outputs HLS + thumbnails + metadata JSON. **Critical:** Regional alignment required (S3 bucket in same region as RecordingConfiguration). |
| Replay viewer with video playback | Core value prop of the project; "later" in VideoNowAndLater | Med | Serve HLS from S3 via CloudFront. Use IVS Player SDK or video.js for playback. **CloudFront with OAC required** for private S3 bucket access. |
| Replay feed / browse recently streamed | Instagram Stories-style discovery of past sessions | Med | Query DynamoDB replay metadata table. Sort by recency. Display thumbnails. **2026 discovery pattern:** Interest-based algorithm > social graph. TikTok FYP model dominant. |
| Thumbnail generation for replays | Visual browsing requires thumbnails; text-only lists feel broken | Low | IVS auto-recording generates thumbnails (configurable: 1-60s interval, resolution up to 1080p). **Note:** IDR/Keyframe interval in encoder must be < targetIntervalSeconds for thumbnails to generate correctly. |
| Video duration and seek controls | Users need to know length and navigate within video | Low | HTML5 video controls or video.js. Duration available from recording-ended.json metadata (duration_ms field). |
| Play/pause/volume controls | Baseline video player functionality | Low | Standard HTML5 video element or player library. |

### Authentication and Identity

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Username/password signup and login | Baseline auth; users need identity to chat and broadcast | Med | Cognito User Pool with username/password. No email verification per PROJECT.md constraints. |
| Persistent identity across sessions | Users expect their username/history to persist | Low | Cognito handles this. Store user metadata in DynamoDB keyed to Cognito sub. |
| Token-based API authorization | APIs must be secured; unauthenticated access = abuse vector | Med | Cognito JWT tokens validated at API Gateway. IVS tokens generated server-side. **IVS RealTime participant tokens:** 12-hour default TTL, max 14 days. Tokens are JWTs with capabilities (PUBLISH, SUBSCRIBE). |

### Session Management

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Session lifecycle (create, active, ended) | Platform needs state machine for sessions; everything depends on this | High | DynamoDB session table with status field. Lambda handlers for transitions. This is the central data model. |
| Session type selection (broadcast vs. hangout) | Two modes = users need to choose; UX must make this clear | Low | Frontend routing. "Go Live" vs "Start Hangout" buttons route to different IVS resource types. |
| Graceful session end | Sessions must clean up (stop recording, release resources, finalize chat) | Med | Lambda triggered on stream end / stage disconnect. Return IVS resources to pool. Write replay metadata. **IVS RealTime auto-shutdown:** Compositions stop after 60 seconds of publisher inactivity. |

---

## Differentiators

Features that set VideoNowAndLater apart. Not expected by default, but high-value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Pre-warmed IVS resource pool | Instant go-live UX (no 2-5s cold start creating channels/stages). Users feel the speed difference. | High | Pool manager Lambda that maintains N ready channels + stages. Claim/release pattern. This is architecturally novel and a major DX win. **VALIDATED v1.0** |
| Reaction summaries on replays | Instagram-style aggregate reactions ("142 fire emojis at 2:34") overlaid on replay timeline. Unique social signal. | High | Store timestamped reactions in DynamoDB during live. Aggregate per time window. Render as overlay/markers in replay viewer. **Unique differentiator:** YouTube/Instagram/Twitch do NOT have replay reactions. |
| Chat-synchronized replay | Chat scrolls in sync with video playback position. Recreates the live experience. Few platforms do this well. | High | Requires timestamped chat storage + player time-update event listener that seeks through stored chat. **YouTube does this exceptionally well.** Match their pattern: chat window alongside video, auto-scroll as video plays. |
| UX fully abstracted from AWS | No "channels", "stages", "rooms" in UI. Users see "live sessions" and "hangouts". Feels native, not like an AWS demo. | Med | Naming/routing/UX design concern. Map IVS concepts to user-friendly terms in every API response and frontend component. **VALIDATED v1.0** |
| Developer CLI tool suite | CLI for create/list/delete users, generate tokens, seed data, simulate presence, stream test video. Massively accelerates development. | Med | Node.js CLI using AWS SDK. Essential because IVS requires real AWS resources -- cannot mock locally. Other IVS projects lack this. **VALIDATED v1.0** |
| "Stack not deployed" frontend detection | Frontend detects missing CDK stack and shows developer guidance instead of crashing. First-run DX that most projects ignore. | Low | Check for env vars / config file on app load. Show setup instructions if missing. Small effort, huge DX impact. **VALIDATED v1.0** |
| Admin dashboard | Real-time view of active sessions, participants, message/reaction counts, recent replays. Operational visibility. | Med | React page querying DynamoDB via admin API endpoints. Real-time updates via polling or WebSocket. |
| Live reactions (emoji burst) | Floating emoji animations during live sessions (like Instagram/TikTok Live). Social energy feedback loop. | Med | Send reactions via IVS Chat custom events. Render animated overlays on frontend. Store for replay summaries. **2026 pattern:** Floating animations with CSS emerge animation (bottom to 85% height, fade out) + wiggle/rotation. Anonymous by default (YouTube pattern). |
| Presence system (who's watching/online) | Show viewer avatars/names, "X is watching" indicators. Makes sessions feel alive. | Med | Custom presence via heartbeat API (POST every 30s) + DynamoDB TTL for auto-expiry. IVS doesn't provide native presence. |
| RealTime hangout recording via server-side composition | Record multi-participant hangouts as a single composed video for replay. Without this, hangouts have no replay. | High | IVS RealTime server-side composition to S3. Up to 5 compositions per stage, 2 destinations each. 20 concurrent compositions per account. **Outputs HLS + metadata JSON (recording-ended.json with duration_ms, renditions, thumbnails).** |

---

## Anti-Features

Features to explicitly NOT build. These add complexity without proportional value for v1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Content moderation / AI filtering | Massive scope (profanity, NSFW, harassment). Requires ML pipeline, appeals process, policy framework. PROJECT.md explicitly defers to v2. | Rely on manual admin tools (kick/ban) for v1. Add auto-moderation in v2. |
| OAuth / social login | Additional identity provider complexity. Each provider has its own flow, token format, edge cases. Username/password is sufficient for v1. | Cognito username/password only. Architecture should allow adding OAuth later without rewrites. |
| Mobile native app | Entirely different codebase, app store deployment, push notifications, background mode. Web-first per PROJECT.md. | Responsive React web app. Plan mobile as future subrepo. Ensure APIs are mobile-ready. |
| Paid subscriptions / monetization | Payment processing, billing, entitlements, subscription management. Orthogonal to core video platform. | Ship free. Add monetization layer if product validates. |
| Multi-region deployment | Cross-region IVS resource management, data replication, latency routing. Massive infrastructure complexity. | Single AWS region. Choose region closest to primary user base. |
| Custom video player | IVS Player SDK is mature and purpose-built for IVS streams. Building a custom player is months of work for no gain. | Use IVS Player SDK for both live and replay playback. Customize overlay/controls via CSS/React wrappers. |
| Email / push notifications | Notification infrastructure (SES/SNS), user preferences, delivery tracking. Tangential to core value. | In-app indicators only for v1. "X is live" shown on dashboard, not pushed to email/phone. |
| Custom RTMP ingest server | IVS handles ingest natively. Building custom ingest adds latency, cost, and maintenance for zero benefit. | Use IVS ingest endpoints directly. Web Broadcast SDK for browser-based broadcasting. |
| Video clipping / highlights | Complex UX (timeline selection, transcoding, storage). Nice-to-have but not core. | Serve full replays only. Clipping can be a v2 feature using IVS byte-range playlists. |
| Screen sharing in hangouts | Adds complexity to participant grid layout, bandwidth management, and UX. Nice-to-have but not MVP. | Focus on camera video only for v1. IVS RealTime SDK does support screen sharing, so it can be added later. |
| Chat emoji/GIF picker (rich media) | Complex UI component, content licensing (GIPHY), storage. Text chat is sufficient. | Plain text messages + emoji reactions (typed or button-bar). No inline image/GIF support. |
| End-to-end encryption | IVS manages encryption in transit (TLS/DTLS). Custom E2EE for WebRTC is extremely complex and breaks server-side composition. | Trust AWS transport encryption. Do not attempt custom E2EE. |
| Real-time reaction counts (exact numbers) | Creates WebSocket performance bottleneck at scale; distracts from content; users focus on numbers not experience. | Show aggregated "energy level" indicator or rate-limited count updates (e.g., every 5 seconds). |
| User choice for recording opt-in/opt-out | **2026 context:** Opt-out allows more data collection initially but creates inconsistent UX. Opt-in is mandatory for sensitive data (health, finance) but not standard for social video. Instagram/TikTok/YouTube all auto-record. User choice complicates discovery feed (some sessions missing). | Auto-record all sessions (table stakes). Add deletion capability in v2 if users request privacy controls. |
| Unlimited hangout participants (>12) | IVS RealTime max 12 publishers. Beyond that requires MCU (Multi-point Control Unit) complexity, degrades UX. **2026 context:** Zoom/Meet handle this but with server-side mixing. Not in scope for v1. | Cap at 5-8 participants for quality experience. Add "viewer mode" for additional attendees (subscribe-only, no publish). |
| Custom emoji upload for reactions | Moderation nightmare, brand consistency issues, storage bloat. **2026 context:** Twitch allows custom emotes but requires subscriptions and moderation. | Curated emoji set only (heart, fire, clap, laugh, surprised, etc.). 5-8 standard emojis. Add custom in v2 with moderation infrastructure. |

---

## Feature Dependencies

```
Auth (Cognito) --> Session Management --> Everything else
                                      |
                                      +--> Broadcasting (IVS channels)
                                      |       +--> Recording (auto-record config)
                                      |       |       +--> S3 Bucket (same region as RecordingConfiguration)
                                      |       |       +--> CloudFront Distribution (OAC for private bucket)
                                      |       |       +--> Recording Metadata (recording-ended.json)
                                      |       +--> Live Chat (IVS Chat room per session)
                                      |       |       +--> Chat Persistence (DynamoDB)
                                      |       |       +--> Live Reactions (custom events via Chat)
                                      |       +--> Presence (heartbeat API)
                                      |       +--> Viewer Count
                                      |
                                      +--> Hangouts (IVS RealTime stages)
                                      |       +--> Participant Tokens (JWT with capabilities)
                                      |       +--> Participant Management (join/leave events)
                                      |       +--> Mute/Camera Toggles
                                      |       +--> Active Speaker Detection (audio level monitoring)
                                      |       +--> Server-Side Composition (for recording)
                                      |       |       +--> EncoderConfiguration (defines video rendering)
                                      |       |       +--> StorageConfiguration (S3 destination)
                                      |       |       +--> Composition Metadata (recording-ended.json)
                                      |       +--> Live Chat (shared with broadcasting)
                                      |
                                      +--> Replay System
                                              +--> Recording must exist (S3 + CloudFront)
                                              +--> Chat Persistence must exist (DynamoDB with timestamps)
                                              +--> Replay Metadata (DynamoDB: duration, thumbnail, viewer count)
                                              +--> Reaction Summaries (aggregation of stored reactions)
                                              +--> Replay Viewer (IVS Player + chat sync)
                                                      +--> Chat Synchronization (video.currentTime → chat scroll)
                                                      +--> Reaction Timeline (replay reactions at video.currentTime)

Pre-warmed Resource Pool --> Broadcasting (provides channels)
Pre-warmed Resource Pool --> Hangouts (provides stages)
Pre-warmed Resource Pool --> Chat (provides chat rooms)

Developer CLI --> Depends on CDK stack being defined (needs to know resource ARNs)
Admin Dashboard --> Depends on Session Management + Presence + Chat Persistence

"Stack not deployed" Detection --> Independent (frontend-only, no backend dependency)
```

### Critical Path Dependencies for v1.1 (ordered)

**Already Complete (v1.0):**
1. CDK Infrastructure
2. Auth (Cognito)
3. Session Management
4. Pre-warmed Resource Pool
5. Broadcasting (IVS channels)
6. IVS Chat integration
7. Chat Persistence (DynamoDB)

**v1.1 New Dependencies:**
8. **Recording Configuration (broadcasts)** -- RecordingConfiguration on IVS channels, S3 bucket in same region
9. **CloudFront Distribution** -- OAC for serving private S3 recordings
10. **Recording Metadata Storage** -- DynamoDB table for session recordings (duration, thumbnail, viewer count, S3 path)
11. **Replay Viewer** -- video.js or IVS Player SDK with HLS playback
12. **Chat Synchronization** -- video.currentTime listener → chat scroll to matching timestamp
13. **Live Reactions** -- IVS Chat custom events for emoji, floating CSS animations
14. **Reaction Persistence** -- DynamoDB table for reactions with timestamps (live + replay)
15. **Home Feed** -- DynamoDB GSI on session end time, query most recent
16. **IVS RealTime Stage Setup** -- CreateStage, participant token generation
17. **Multi-Participant Grid Layout** -- CSS grid, adaptive resolution per tile
18. **Active Speaker Detection** -- Web Audio API or server-side audio level monitoring
19. **Hangout Recording (Composite)** -- StartComposition API, EncoderConfiguration, StorageConfiguration

---

## MVP Recommendation for v1.1

### Launch With (v1.1 Core):

1. **Auto-record broadcasts to S3** -- RecordingConfiguration + S3 bucket + CloudFront distribution
2. **Recording metadata tracking** -- DynamoDB table for replay sessions (duration, thumbnail, S3 path, viewer count)
3. **Home feed showing recent recordings** -- Query DynamoDB by recency, display thumbnail grid (Instagram-style)
4. **Replay viewer with HLS playback** -- video.js or IVS Player SDK
5. **Synchronized chat replay** -- Chat messages stored with timestamps, scroll chat as video plays (YouTube pattern)
6. **Live reactions (5-8 emoji types)** -- Floating animations (heart, fire, clap, laugh, surprised, etc.)
7. **Reaction storage for replay** -- DynamoDB table with reaction type, timestamp, session ID
8. **IVS RealTime Stage setup** -- Pre-warmed stage pool, participant token generation
9. **Multi-participant grid (up to 5 participants)** -- CSS grid layout, client-side composition
10. **Participant join/leave notifications** -- Toast/banner on stage events
11. **Active speaker highlighting** -- Audio level monitoring → border highlight on active speaker tile
12. **Hangout recording via composite** -- StartComposition → S3, recording-ended.json metadata

### Add After Validation (v1.2+):

13. **Replay timeline reactions** -- Users can add reactions while watching replay, stored with video timestamp
14. **Reaction aggregation on replay** -- "142 fire emojis at 2:34" overlay markers
15. **Admin dashboard** -- Real-time session/participant/reaction counts
16. **Presence system** -- "X is watching" indicators, viewer avatars
17. **Screen share in hangouts** -- IVS RealTime SDK supports this, add to participant grid
18. **Video duration/progress indicators** -- Time remaining, progress bar, seek preview
19. **Thumbnail hover preview** -- Show video preview on home feed thumbnail hover (Instagram pattern)

### Defer (v2+):

- **Replay reaction analytics** -- Aggregate reaction counts per session, trending content
- **Profile-based recording discovery** -- User profiles with their recording history
- **Recording deletion** -- Privacy control for users to remove their recordings
- **Custom emoji upload** -- Requires moderation infrastructure
- **Video editing/trimming** -- Major scope expansion
- **Multi-region deployment** -- Cross-region IVS management

---

## v1.1 Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Dependency Risk | Priority |
|---------|------------|---------------------|-----------------|----------|
| Auto-record broadcasts to S3 | HIGH | MEDIUM | LOW | P1 |
| Recording metadata tracking | HIGH | LOW | LOW | P1 |
| Home feed (recent recordings) | HIGH | MEDIUM | LOW | P1 |
| Replay viewer (HLS playback) | HIGH | MEDIUM | LOW | P1 |
| Synchronized chat replay | HIGH | HIGH | MEDIUM | P1 |
| Live reactions (floating emoji) | HIGH | MEDIUM | LOW | P1 |
| Reaction persistence (DynamoDB) | MEDIUM | LOW | LOW | P1 |
| IVS RealTime Stage setup | HIGH | MEDIUM | LOW | P1 |
| Multi-participant grid (5 participants) | HIGH | MEDIUM | MEDIUM | P1 |
| Participant join/leave notifications | MEDIUM | LOW | LOW | P1 |
| Active speaker highlighting | MEDIUM | MEDIUM | MEDIUM | P1 |
| Hangout recording (composite) | HIGH | HIGH | HIGH | P1 |
| Replay timeline reactions | MEDIUM | MEDIUM | MEDIUM | P2 |
| Reaction aggregation on replay | LOW | MEDIUM | MEDIUM | P2 |
| Admin dashboard | LOW | MEDIUM | LOW | P2 |
| Presence system | LOW | MEDIUM | MEDIUM | P2 |
| Screen share in hangouts | MEDIUM | MEDIUM | MEDIUM | P2 |
| Video duration/progress indicators | MEDIUM | LOW | LOW | P2 |
| Thumbnail hover preview | LOW | MEDIUM | LOW | P2 |

**Priority key:**
- P1: Must have for v1.1 launch (recording/replay + reactions + hangouts functional)
- P2: Should have for v1.2 (enhancements after core works)
- P3: Nice to have for v2+ (deferred until product-market fit)

---

## IVS-Specific Capability Notes

### AWS IVS Quotas That Shape Features (verified from official docs)

| Resource | Default Limit | Impact on Features |
|----------|--------------|-------------------|
| Channels per region | 5,000 | Pool size is well within limits |
| Concurrent streams | 100 | Pool of ~10-20 pre-warmed channels is safe |
| Concurrent views | 15,000 | Sufficient for v1; request increase before scaling |
| RealTime publishers per stage | 12 | Hangout limit of 5 participants is well within this |
| RealTime subscribers per stage | 10,000 | Viewers watching a hangout -- generous limit |
| RealTime stages per region | 1,000 | Pool of ~10-20 stages is safe |
| **Compositions per account** | **20** | **Limits concurrent recorded hangouts -- major constraint. Plan capacity carefully.** |
| Composition destinations | 2 per composition | Can record to S3 AND stream to IVS channel simultaneously |
| Recording configurations | 20 per region | One config shared across all channels is typical |
| Max publish resolution (RealTime) | 720p | Hangouts capped at 720p -- set user expectations |
| IVS ingest (STANDARD) | 8.5 Mbps / 1080p | Broadcasting supports up to 1080p |
| **Participant token TTL** | **12 hours (default), 14 days (max)** | **Token refresh required for long sessions (>12 hours)** |

### IVS Chat Capabilities (verified)

- WebSocket-based real-time messaging
- Chat rooms (one per session)
- Token-based authorization (generate server-side, use client-side)
- Send/receive messages
- Delete messages (moderation)
- Disconnect users (moderation)
- Custom events (usable for reactions, typing indicators, presence signals)
- **No native message persistence** -- must store messages yourself
- **No native reaction feature** -- use custom events to implement reactions

### IVS Recording Capabilities (verified from official docs)

**Broadcast Recording (IVS Channels):**
- Auto-record to S3 with HLS output
- Multiple ABR renditions (LOWEST_RESOLUTION through FULL_HD)
- Thumbnail generation (1-60s interval, configurable resolution)
- Byte-range playlists for granular seeking/clipping
- Stream reconnect merging (reconnect within window = same recording)
- JSON metadata files (recording-started, recording-ended, recording-failed)
- CloudWatch events for recording lifecycle
- Private S3 bucket playback via CloudFront with OAC
- **Regional requirement:** S3 bucket must be in same region as RecordingConfiguration

**Hangout Recording (IVS RealTime Composite):**
- Server-side composition combines all publishers into single HLS output
- Outputs to S3 bucket with HLS segments + metadata JSON
- recording-ended.json includes: stage_arn, recording_status, recording_started_at, recording_ended_at, duration_ms, media.hls (renditions, resolution, playlists), thumbnails
- **Auto-shutdown:** Compositions stop after 60 seconds of publisher inactivity
- **EventBridge integration:** "IVS Composition State Change (Session End)" event signals recording completion
- **S3 Bucket Policy required:** Allow ivs-composite.{region}.amazonaws.com to PutObject with bucket-owner-full-control ACL
- **Playback:** Use CloudFront distribution with OAC (same pattern as broadcast recordings)

### IVS RealTime Participant Token Details (verified from official docs)

**Token Generation:**
- Two approaches: Key pair (self-signed JWTs) or CreateParticipantToken API
- JWT format with header (alg: ES384, typ: JWT, kid: public key ARN) and payload

**Token Payload Fields:**
- `exp` (expiration): Default 12 hours, max 14 days
- `jti` (participant ID): Unique identifier, 64 chars max, alphanumeric + hyphen + underscore
- `user_id` (optional): Customer-assigned identifier, 128 chars max, **exposed to all participants -- no PII**
- `attributes` (optional): Custom app data, 1 KB max, **exposed to all participants -- no sensitive data**
- `capabilities`: `allow_publish` (send audio/video), `allow_subscribe` (receive audio/video)
- `resource`: Stage ARN
- `topic`: Stage ID (extracted from ARN)
- `events_url`: WebSocket endpoint for stage events
- `whip_url`: WHIP endpoint for media

**Best Practices:**
- Generate server-side only (never client-side)
- Don't use user_id or attributes for PII/sensitive data (visible to all stage participants)
- Cache events_url and whip_url for up to 14 days
- Use 12-hour default TTL; extend only if necessary
- Treat tokens as opaque; format may change

---

## UX Patterns from 2026 Research

### Reaction Systems (verified from platform research)

**YouTube Live (2026):**
- 5 emoji reactions (heart, laughing till crying, surprised, etc.)
- Anonymous reactions (viewers can't see who reacted)
- Timed reactions: emoji marker at specific video frame
- Real-time floating animations during live

**Instagram Live:**
- Heart emoji only
- Floating animation from bottom to top with fade
- Anonymous reactions
- No replay reaction support

**Twitch:**
- Emotes + Bits (paid reactions)
- Rich emote system (global + subscriber + channel-specific)
- Emotes delivered via chat messages
- Emote history preserved in chat replay

**Facebook Live:**
- Multiple emoji reactions (heart, laugh, wow, sad, angry)
- Floating animations across screen
- Customizable emoji set (brand/theme alignment)
- Reaction location on video player configurable
- Option to hold emoji to enlarge

**Common 2026 Patterns:**
- 5-8 standard emoji types is optimal (more = decision paralysis)
- Floating animations with CSS: emerge animation (bottom to 85% height, fade out) + wiggle (side-to-side) + random rotation
- Anonymous by default (reduces friction, increases participation)
- Real-time broadcast to all viewers (WebSocket or equivalent)
- Reaction data valuable for analytics (identify popular segments)

### Synchronized Chat Replay (verified from platform research)

**YouTube (Gold Standard):**
- Chat replay window alongside video player
- Messages synchronized to video.currentTime (timestamp-based)
- Auto-scroll as video plays, recreating live experience
- "Show chat" toggle button below video player
- Chat messages display with original timestamp and sender
- Creators can disable chat archiving (chat lost if disabled)

**Twitch:**
- VOD (Video On Demand) includes chat replay
- Similar to YouTube: chat window alongside video, synchronized playback
- Chat replay is default for all streams
- Subscriber-only feature in some channels

**Instagram:**
- NO chat replay support
- Live comments disappear when broadcast ends
- Stories preserve video for 24 hours but not comments

**2026 Implementation Pattern:**
- Store chat messages with timestamp (milliseconds since session start)
- Video player time-update event listener → seek through stored messages
- Display messages that fall within current playback position ± buffer window
- Auto-scroll chat to maintain "live" feel
- Fullscreen mode: CSS position chat overlay on video or toggle visibility

### Discovery Feeds (verified from 2026 platform research)

**TikTok For You Page (FYP) Model:**
- Interest graph > social graph (recommends content based on interests, not follows)
- Hyper-personalized infinite feed
- Balances familiarity with novelty (introduces new content to test user interest)
- Video-first, algorithm-driven discovery
- Rewatch rate >15-20% = strong algorithmic signal

**Instagram (2026 Shift):**
- Video-first content (Reels receive 10x weight vs static posts)
- Interest-based > follower-based discovery
- Explore Page: personalized feed based on engagement patterns
- 50%+ of time spent in Reels or DMs (not traditional feed)
- Discovery hubs prioritized over social graph

**v1.1 Approach (Simple Start):**
- Home feed: Query DynamoDB by session end time, most recent first
- Display thumbnail grid (Instagram-style)
- No algorithmic ranking in v1.1 (just chronological)
- Add interest-based recommendations in v2+ once usage data exists

### Multi-Participant Video Grid (verified from 2026 WebRTC research)

**Layout Patterns:**
- CSS grid with auto-fill or explicit columns
- Adaptive resolution: Deliver only pixels needed for grid cell size (prevents CPU/GPU overload)
- Volatility monitoring: Detect struggling CPU/GPU by monitoring render frame rate volatility
- Active speaker detection: Highlight border/name on active speaker tile
- AI integration: Auto-track speakers, frame faces, adjust layouts dynamically

**Performance Optimization:**
- SFU (Selective Forwarding Unit) architecture standard in 2026
- Individual streams adjusted on-the-fly to maintain target resolution (e.g., 720x960 total regardless of participant count)
- Grid-style layouts with several participants = high device load and bandwidth
- Limit grid to 5-8 participants for quality experience

**Active Speaker Detection:**
- Client-side: Web Audio API to analyze audio levels, detect volume threshold
- Server-side: Audio-levels header extension in SDP, server detects active speaker
- ML + signal processing for sophisticated ASD in 2026
- Benefits: Improved UX, bandwidth optimization (prioritize active speaker stream)

---

## Sources

### AWS IVS Official Documentation (HIGH confidence)
- [Auto-Record to Amazon S3 - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/create-channel-auto-r2s3.html)
- [IVS Composite Recording | Real-Time Streaming - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-composite-recording.html)
- [IVS Service Quotas | Real-Time Streaming - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html)
- [Step 3: Distribute Participant Tokens - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html)
- [RecordingConfiguration - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_RecordingConfiguration.html)
- [CreateRecordingConfiguration - Amazon IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_CreateRecordingConfiguration.html)
- AWS IVS Low-Latency Streaming User Guide -- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html (HIGH confidence)
- AWS IVS RealTime User Guide -- https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html (HIGH confidence)
- AWS IVS Chat User Guide -- https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/what-is.html (MEDIUM confidence)
- AWS IVS Low-Latency Service Quotas -- https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/service-quotas.html (HIGH confidence)
- AWS IVS RealTime Service Quotas -- https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html (HIGH confidence)

### Platform UX Research (MEDIUM-HIGH confidence, 2026 sources)
- [YouTube Tests New Emoji Reactions Within Live Streams | Social Media Today](https://www.socialmediatoday.com/news/YouTube-Tests-Emoji-Reactions-in-Live-Streams/638787/)
- [YouTube's Rolling Out Timed Reactions on Live-Streams | Social Media Today](https://www.socialmediatoday.com/news/youtubes-rolling-out-timed-reactions-on-live-streams/646978/)
- [How to See Live Chat on YouTube After It's Over - California Learning Resource Network](https://www.clrn.org/how-to-see-live-chat-on-youtube-after-it%CA%BCs-over/)
- [Amazon IVS Live Stream Playback with Chat Replay using the Sync Time API - DEV Community](https://dev.to/aws/amazon-ivs-live-stream-playback-with-chat-replay-using-the-sync-time-api-1d6a)
- [How to Watch Old Instagram Lives & Replays in 2026 | GREC](https://www.grecrecorder.com/blog/watch-old-instagram-lives-replays)

### Reaction Systems Implementation (MEDIUM confidence)
- [Live Reactions: Elevate Your Live Events with Real-Time Audience Engagement](https://streamshark.io/blog/live-reactions-elevate-your-live-events-with-real-time-audience-engagement/)
- [Reactions during Live Stream - Video SDK Docs | Video SDK](https://docs.videosdk.live/javascript/guide/interactive-live-streaming/reactions-during-livestream)
- [Add flying emoji reactions to a custom Daily video call](https://www.daily.co/blog/add-flying-emoji-reactions-to-a-custom-daily-video-call/)
- [HTML Video with Fullscreen Chat Overlay - DEV Community](https://dev.to/aws/html-video-with-fullscreen-chat-overlay-4jfl)

### WebRTC & Multi-Participant Video (MEDIUM-HIGH confidence, 2026 sources)
- [Large WebRTC Video Grids: Managing CPU and Network Constraints](https://www.agora.io/en/blog/large-webrtc-video-grids-managing-cpu-and-network-constraints/)
- [P2P, SFU, MCU, Hybrid: Which WebRTC Architecture Fits Your 2026 Roadmap?](https://www.forasoft.com/blog/article/webrtc-architecture-guide-for-business-2026)
- [WebRTC: Active Speaker Detection](https://www.linkedin.com/pulse/webrtc-active-speaker-detection-nilesh-gawande)
- [Discover The Magic: Active Speaker Detection And WebRTC](https://sheerbit.com/discover-the-magic-active-speaker-detection-and-webrtc/)
- [Understanding AWS IVS Real-Time (Stage) — How It Actually Works | Medium](https://medium.com/@singhkshitij221/understanding-aws-ivs-real-time-stage-how-it-actually-works-e56a7a0c5464)

### Video Discovery Feeds (MEDIUM confidence, 2026 sources)
- [Instagram's Discovery Feed in 2026: What Actually Works (Not What Meta Says Works) - Future](https://future.forem.com/synergistdigitalmedia/instagrams-discovery-feed-in-2026-what-actually-works-not-what-meta-says-works-3dfj)
- [TikTok Algorithm 2026: How the FYP Really Works (Ultimate Guide)](https://beatstorapon.com/blog/tiktok-algorithm-the-ultimate-guide/)
- [From Social Feed to Search Engine: Why Users Now Discover Everything on TikTok, Instagram & YouTube](https://www.dial911fordesign.com/post/from-social-feed-to-search-engine-why-users-now-discover-everything-on-tiktok-instagram-youtube)
- [Mastering the secrets of the algorithm to dominate TikTok and Instagram in 2026](https://www.valueyournetwork.com/en/tiktok-and-instagram-algorithm-secrets/)

### UX Best Practices (MEDIUM confidence)
- [Google Meet vs. Zoom: Which One to Choose in 2026](https://meetgeek.ai/blog/google-meet-vs-zoom)
- [Opt In vs Opt Out: What's the Difference? | Termly](https://termly.io/resources/articles/opt-in-vs-opt-out/)
- [8 Best Session Replay Software Tools for Teams in 2026 | Amplitude](https://amplitude.com/compare/best-session-replay-tools)

---
*Feature research for: Live video streaming with recording/replay, reactions, and small-group hangouts*
*Researched: 2026-03-02 (Updated for v1.1 milestone)*
