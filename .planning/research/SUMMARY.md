# Project Research Summary

**Project:** VideoNowAndLater
**Domain:** Live Video Platform (AWS IVS)
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

VideoNowAndLater is a live video platform supporting two distinct modes: one-to-many broadcasting and multi-participant hangouts, both with integrated chat and replay functionality. The research reveals that successful implementation requires treating AWS IVS Low-Latency Streaming (channels) and IVS RealTime (stages) as fundamentally separate services with different APIs, SDKs, and resource models, despite both being marketed under the "IVS" brand.

The recommended approach uses a TypeScript monorepo with React frontend, AWS CDK infrastructure, and Lambda-based API layer. The critical architectural pattern is a pre-warmed resource pool that maintains ready-to-use IVS channels, stages, and chat rooms in DynamoDB, eliminating the 2-10 second cold start that would otherwise kill the "instant go-live" user experience. This pool pattern influences the entire data model and must be designed from Phase 1.

Key risks center on cost management (forgotten resources can rack up charges), the complexity of two separate IVS service integrations, and the requirement to persist chat messages for replay (IVS Chat provides no native persistence). Mitigation strategies include strict lifecycle management with timeout-based cleanup, billing alarms, separate backend modules for each IVS service type, and client-side chat relay to DynamoDB with timestamps for replay synchronization.

## Key Findings

### Recommended Stack

The stack is unified on TypeScript across all layers (frontend, CDK, Lambda, CLI) for type safety and consistent AWS SDK v3 integration. All versions verified via npm registry as of 2026-03-01.

**Core technologies:**
- **TypeScript 5.9 + Node 20.x LTS**: Single language across entire stack; Node 20 is current stable Lambda runtime
- **React 19.2 + Vite 7.3**: Latest stable React with no IVS SDK peer dependency conflicts; Vite handles WASM loading for IVS Player SDK
- **AWS IVS SDKs (browser)**: `amazon-ivs-web-broadcast` (1.32.0 - handles BOTH RTMPS broadcasting AND RealTime WebRTC stages), `amazon-ivs-player` (1.49.0), `amazon-ivs-chat-messaging` (1.1.1)
- **AWS SDK v3 (Lambda)**: `@aws-sdk/client-ivs`, `@aws-sdk/client-ivs-realtime`, `@aws-sdk/client-ivschat` at 3.1000.0
- **AWS CDK 2.240**: Infrastructure as code; note IVS only has L1 (CloudFormation-level) constructs, not ergonomic L2
- **Zustand + TanStack Query**: Client state (video/chat outside React tree) + server state/API caching
- **DynamoDB + S3 + CloudFront**: Sessions, pool, presence, reactions in DynamoDB; recordings in S3 served via CloudFront

**Critical stack note:** There is no separate "IVS RealTime Web SDK" — the `amazon-ivs-web-broadcast` SDK includes both RTMPS ingest for one-to-many and the Stage API for WebRTC hangouts.

**Avoid:** Redux (overkill), GraphQL (project spec says REST), AWS Amplify (massive bundle for minimal auth needs), separate IVS RealTime SDK (doesn't exist as separate package), Webpack (Vite is faster for media apps).

### Expected Features

**Must have (table stakes):**
- **One-to-many broadcasting**: Go-live with single action, live viewer count, stream quality auto-adaptation (IVS ABR), broadcast preview
- **Multi-participant hangouts**: Join/leave seamlessly (up to 12 publishers), self-view + participant grid, mute/camera toggles
- **Real-time chat**: Text chat alongside video (IVS Chat WebSocket), message history persisted to DynamoDB, username attribution
- **Recording and replay**: Automatic stream recording to S3, HLS playback via IVS Player SDK, replay feed with thumbnails, chat synchronized to replay timeline
- **Authentication**: Cognito username/password (no email verification), persistent identity, JWT-based API authorization
- **Session management**: Lifecycle state machine (create/active/ended), type selection (broadcast vs hangout), graceful cleanup

**Should have (differentiators):**
- **Pre-warmed IVS resource pool**: Instant go-live UX (no 2-5s cold start) — architecturally novel and major DX win
- **Chat-synchronized replay**: Chat scrolls in sync with playback position — recreates live experience, few platforms do this well
- **UX abstracted from AWS**: Users see "sessions" and "hangouts", never "channels" or "stages"
- **Developer CLI tool suite**: Create/list/delete users, generate tokens, stream test video via FFmpeg — essential for development since IVS requires real AWS resources
- **Live reactions**: Emoji burst animations (like Instagram/TikTok Live) with reaction summaries on replay timeline
- **Presence system**: Viewer avatars/names, heartbeat API with DynamoDB TTL auto-expiry
- **Admin dashboard**: Real-time view of active sessions, participants, message/reaction counts

**Defer (v2+):**
- **Content moderation/AI filtering**: PROJECT.md explicitly defers to v2
- **OAuth/social login**: Username/password sufficient for v1
- **Mobile native app**: Web-first per PROJECT.md
- **Monetization**: Ship free, add later if product validates
- **Multi-region deployment**: Massive infrastructure complexity
- **Server-side composition for hangout recording**: High complexity, 20 concurrent composition limit per account — hangouts without replay recording acceptable for initial release

### Architecture Approach

The system has three runtime planes: (1) Control Plane (Lambda + API Gateway + DynamoDB) manages sessions and tokens, (2) Media Plane (AWS-managed IVS) handles all media transport, (3) Storage Plane (S3 + CloudFront) for recordings. Users never interact with AWS APIs directly — backend generates opaque session IDs and IVS tokens.

**Major components:**
1. **Session Manager Lambdas**: Create/join/end sessions, allocate IVS resources from pool, generate participant/chat tokens
2. **Resource Pool Manager**: Pre-warm and recycle IVS channels, stages, chat rooms via scheduled Lambda; DynamoDB tracks pool state (AVAILABLE/IN_USE/RECYCLING)
3. **Recording Processor**: EventBridge-triggered Lambda on IVS Recording State Change events; reads S3 metadata JSON, creates replay catalog entries
4. **Chat Relay**: Client-side dual-send pattern (IVS Chat WebSocket + API POST) to persist messages to DynamoDB with timestamps for replay sync
5. **DynamoDB Tables**: Sessions (with GSIs for status/user queries), ResourcePool (atomic claims via conditional writes), Reactions (timestamped per session), Replays (catalog with HLS URLs), ChatMessages (replay persistence)
6. **CDK Multi-Stack**: AuthStack → StorageStack → MediaStack → ApiStack → RecordingStack; separate stacks for independent deployment and clean teardown

**Critical patterns:**
- **Atomic pool claims**: DynamoDB conditional writes (`status = available`) prevent race conditions when multiple users go live simultaneously
- **EventBridge-driven recording pipeline**: React to IVS recording lifecycle events, never poll S3
- **Token refresh endpoints**: Separate endpoints for stage-token and chat-token refresh (IVS tokens expire independently)
- **Session abstraction layer**: No AWS concepts (channels/stages/rooms) exposed to frontend; map server-side to user-friendly "sessions"

### Critical Pitfalls

1. **Treating IVS Streaming and IVS RealTime as the same service** — They are completely separate AWS services with different APIs, SDKs, token models, and recording mechanisms. Build separate backend modules from Day 1. Channels use stream keys; stages use participant tokens. Streaming has auto-record; RealTime requires server-side composition. [CRITICAL, Phase 1]

2. **Not pre-warming IVS resources (cold start latency)** — Creating channels/stages on-demand takes 2-10 seconds. Users expect instant go-live. API rate limits (5 TPS for CreateChannel/CreateStage) cause failures under load. Pre-warm a pool with scheduled replenishment. [CRITICAL, Phase 1-2]

3. **Runaway costs from forgotten resources** — IVS channels/stages left running, unbounded S3 storage, RealTime compositions running up to 24h max duration rack up charges. Implement session timeout Lambda, S3 lifecycle policies, CloudWatch billing alarms at $10/$50/$100 thresholds. [CRITICAL, all phases]

4. **IVS Chat tokens are single-use and short-lived** — Tokens can only be used once and expire quickly. Always generate fresh token for every WebSocket connection/reconnection attempt. Never cache chat tokens in localStorage. Rate limit is generous (200 TPS for CreateChatToken). [CRITICAL, Chat phase]

5. **Hardcoding recording paths and assuming static renditions** — S3 rendition paths vary per stream (resolution, bitrate). Always read `events/recording-ended.json` metadata to discover renditions dynamically. EventBridge-triggered Lambda processes metadata, never assume paths. [CRITICAL, Recording/Replay phase]

6. **Exposing AWS concepts in UX layer** — No "channels", "stages", "rooms", ARNs in user-facing UI. Define "Session" domain model that abstracts IVS resources. Error middleware translates AWS SDK errors to user-friendly messages. [CRITICAL, API phase]

## Implications for Roadmap

Based on combined research, the technical dependency graph dictates this phase structure:

### Phase 1: Foundation + Auth + Storage
**Rationale:** Everything depends on deployed infrastructure, authentication, and data storage. No IVS integration yet — proves CDK pipeline, establishes data model.
**Delivers:** CDK multi-stack setup (AuthStack, StorageStack), Cognito User Pool, DynamoDB tables (Sessions, ResourcePool, Reactions, Replays, ChatMessages), S3 recording bucket with lifecycle policies, CloudWatch billing alarms
**Addresses:** Authentication (table stakes), session management data model (critical dependency)
**Avoids:** Pitfall 3 (AWS concept abstraction established in API design), Pitfall 5 (cost management via billing alarms), Pitfall 7 (region pinning in CDK)
**Research flag:** SKIP RESEARCH — standard AWS patterns, well-documented

### Phase 2: Resource Pool + Broadcasting Core
**Rationale:** Broadcasting is simpler than RealTime (no WebRTC), validates pool pattern which is foundational for instant go-live UX. Pool must exist before any user-facing features.
**Delivers:** Pre-warmed IVS channel pool (DynamoDB ResourcePool table + scheduled Lambda), MediaStack with channels + recording config, session create/join/end API, React "Go Live (Broadcast)" flow, IVS Player for viewers, Developer CLI tool (stream test video via FFmpeg)
**Uses:** TypeScript + CDK L1 constructs (aws-cdk-lib/aws-ivs), Lambda with AWS SDK v3 client-ivs, React + amazon-ivs-player SDK
**Addresses:** One-to-many broadcasting (table stakes), pre-warmed pool (differentiator), developer CLI (differentiator)
**Avoids:** Pitfall 2 (recording metadata JSON processing), Pitfall 4 (pre-warming eliminates cold start), Pitfall 9 (CDK L1 constructs with wrapper), Pitfall 12 (API rate limit pacing in pool manager)
**Research flag:** STANDARD PATTERNS — IVS channel creation well-documented, pool pattern established in Phase 1 design

### Phase 3: Chat Integration
**Rationale:** Chat works with both broadcast and hangout modes. Persistence must be captured from day one for replay feature. Simpler than RealTime (no WebRTC complexity).
**Delivers:** IVS Chat room pool, chat token generation API, client-side chat relay (dual-send: IVS Chat WebSocket + API POST for persistence), React ChatPanel with real-time messaging, ChatMessages DynamoDB storage with session-relative timestamps
**Uses:** @aws-sdk/client-ivschat (Lambda), amazon-ivs-chat-messaging SDK (browser), WebSocket client
**Addresses:** Real-time chat (table stakes), chat message persistence (required for replay)
**Avoids:** Pitfall 6 (fresh token per connection/reconnect), Pitfall 13 (client-side rate limiting at 10 msg/sec)
**Research flag:** SKIP RESEARCH — IVS Chat API straightforward, WebSocket patterns standard

### Phase 4: Recording Pipeline + Replay Viewer
**Rationale:** Requires completed broadcast/chat to have content to record. EventBridge-driven recording processing is foundational for "Later" value prop. Chat sync makes replay compelling.
**Delivers:** EventBridge rule for IVS Recording State Change, recording processor Lambda (reads S3 metadata JSON, creates Replays catalog), CloudFront distribution with OAC, React replay viewer with IVS Player, chat-synchronized replay (player time-update seeks through ChatMessages), replay feed with thumbnails
**Uses:** EventBridge + Lambda, S3 + CloudFront, amazon-ivs-player SDK, DynamoDB query (Replays table GSI)
**Addresses:** Automatic recording + replay viewer (table stakes), chat-synchronized replay (differentiator)
**Avoids:** Pitfall 2 (read recording-ended.json metadata), Pitfall 15 (CloudFront CORS + OAC), Pitfall 17 (account for recordingReconnectWindow delay in UX)
**Research flag:** NEEDS RESEARCH — S3 metadata JSON schema, EventBridge event structure, chat synchronization algorithm

### Phase 5: RealTime Hangouts
**Rationale:** Most complex IVS integration (WebRTC, multi-participant grid). Builds on patterns from Phase 2 (pool) and Phase 3 (chat). Defer server-side composition (recording) to Phase 6.
**Delivers:** Pre-warmed IVS RealTime stage pool, participant token generation API (PUBLISH + SUBSCRIBE capabilities), React "Go Live (Hangout)" flow, multi-participant grid with IVS RealTime Web SDK, mute/camera toggle controls, participant list/count
**Uses:** @aws-sdk/client-ivs-realtime (Lambda), amazon-ivs-web-broadcast SDK Stage API (browser WebRTC)
**Addresses:** Multi-participant hangouts (table stakes), participant management (table stakes)
**Avoids:** Pitfall 1 (separate backend module from broadcast), Pitfall 8 (browser publishing instability warnings + reconnection logic), Pitfall 14 (only display-safe data in token attributes)
**Research flag:** NEEDS RESEARCH — IVS RealTime Stage API, participant token JWT structure, WebRTC grid layout patterns

### Phase 6: Social Layer + Admin Tools
**Rationale:** Enhancement layer on top of working core. Reactions, presence, and admin dashboard add polish but aren't blocking for launch.
**Delivers:** Live reactions (emoji burst via IVS Chat custom events), reaction summaries on replay timeline, presence system (heartbeat API with DynamoDB TTL), admin dashboard (active sessions, pool health), reaction bar UI, reaction overlay animations
**Uses:** IVS Chat custom events, DynamoDB TTL for presence auto-expiry, polling or WebSocket for real-time dashboard
**Addresses:** Live reactions (differentiator), presence system (differentiator), admin dashboard (differentiator)
**Avoids:** Cost overruns via operational visibility
**Research flag:** STANDARD PATTERNS — DynamoDB TTL well-documented, emoji animation libraries exist

### Defer to v2+:
- **Server-side composition for hangout recording**: High complexity, 20 concurrent composition limit per account, requires IVS RealTime composition API research
- **Reaction summaries on replay timeline**: Requires solid replay viewer first
- **Content moderation**: Per PROJECT.md

### Phase Ordering Rationale

- **Foundation first (Phase 1)**: Auth and storage are hard dependencies for everything else
- **Broadcasting before RealTime (Phase 2 before 5)**: Broadcasting is simpler (RTMP vs WebRTC), proves pool pattern with lower complexity
- **Chat before replay (Phase 3 before 4)**: Chat persistence must capture messages from day one; cannot retrofit historical chat
- **Replay before RealTime (Phase 4 before 5)**: Validates recording pipeline with simpler broadcast recordings before tackling RealTime composition
- **Social layer last (Phase 6)**: Polish features that enhance but don't block core flows

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 4 (Recording/Replay)**: S3 metadata JSON schema not fully detailed in research; EventBridge event payload structure needs verification; chat synchronization algorithm (time-based seeking) needs design
- **Phase 5 (RealTime Hangouts)**: IVS RealTime participant token JWT claims structure; Stage API lifecycle (join/leave events); WebRTC participant grid layout best practices

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Foundation)**: Cognito + DynamoDB + S3 are well-documented standard AWS patterns
- **Phase 2 (Broadcasting)**: IVS channel creation API verified in official docs; pool pattern designed in architecture research
- **Phase 3 (Chat)**: IVS Chat API verified; WebSocket client patterns standard
- **Phase 6 (Social Layer)**: DynamoDB TTL, polling, emoji animations all standard patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry 2026-03-01; IVS SDK compatibility confirmed via peer dependency analysis; AWS SDK v3 at 3.1000.0 |
| Features | MEDIUM-HIGH | AWS IVS official docs verified table stakes features; differentiators informed by competitor patterns (Instagram/TikTok Live) from training data; quotas verified (12 publishers/stage, 5 TPS CreateChannel) |
| Architecture | MEDIUM-HIGH | IVS Low-Latency + RealTime + Chat documentation verified via official docs; DynamoDB/Lambda patterns standard; resource pool pattern established in IVS community; server-side composition noted LOW confidence (couldn't verify current API) |
| Pitfalls | HIGH | Critical pitfalls verified in official AWS docs with explicit warnings; rate limits and quotas verified in service quotas pages; recording merge failures documented for Web Broadcast SDK |

**Overall confidence:** HIGH

### Gaps to Address

- **IVS RealTime server-side composition for recording**: Training data indicates this exists but documentation pages returned redirects during research. Validate current API availability before implementing hangout recording in Phase 6+.
- **S3 recording metadata JSON exact schema**: Official docs describe metadata files but didn't provide full JSON schema. Phase 4 planning should fetch sample recordings to document schema.
- **Chat synchronization algorithm**: Research identifies requirement but doesn't specify implementation. Phase 4 planning needs to design time-based seeking (player currentTime → filter ChatMessages by timestamp).
- **IVS Chat message persistence via server-side WebSocket**: Research recommends client-side relay for simplicity but notes server-side Lambda WebSocket subscription as "more reliable but complex" alternative. Phase 3 planning should evaluate trade-offs.

## Sources

### Primary (HIGH confidence)
- AWS IVS Low-Latency Streaming User Guide: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/ — service overview, channel creation, recording to S3, quotas
- AWS IVS RealTime Streaming User Guide: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/ — stages, participant tokens, quotas
- AWS IVS Auto-Record to S3: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html — S3 structure, metadata files, thumbnails
- AWS IVS Service Quotas (Low-Latency): https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/service-quotas.html — 5 TPS CreateChannel, 100 concurrent streams
- AWS IVS Service Quotas (RealTime): https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html — 12 publishers/stage, 20 compositions/account
- AWS IVS Chat Service Quotas: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/service-quotas.html — 10 msg/sec per connection, 200 TPS CreateChatToken
- AWS CDK IVS Constructs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ivs-readme.html — L1-only constructs confirmed
- npm registry: All package versions verified 2026-03-01

### Secondary (MEDIUM confidence)
- Resource pool pattern for IVS: Community best practice (training data) combined with official docs noting "create a new stage for each logical session"
- React component architecture: Standard React patterns applied to IVS SDK integration based on SDK documentation structure
- DynamoDB table design: Standard AWS serverless patterns

### Tertiary (LOW confidence)
- IVS RealTime server-side composition for recording: Training data indicates feature exists but API pages returned redirects — validate before implementing
- Competitor feature patterns (Instagram Live, TikTok Live): Training data, not individually verified

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*
