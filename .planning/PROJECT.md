# VideoNowAndLater

## What This Is

A live video platform powered by AWS IVS with one-to-many broadcasting, small-group hangouts, and real-time chat. Users can create sessions instantly (backed by pre-warmed IVS resource pools), go live with their camera, and interact through chat and reactions. All sessions are automatically recorded and preserved for replay with synchronized chat and reactions. Built with CDK-managed infrastructure (Cognito auth, API Gateway, DynamoDB, IVS + IVS RealTime + IVS Chat), React frontend, and developer CLI tools for local testing.

## Core Value

Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

## Latest Milestone: v1.3 Secure Sharing (SHIPPED 2026-03-06)

**Accomplished:** Enable private broadcasts with secure viewer links and granular access control via JWT tokens.

**Delivered:**
- ✅ Private broadcast flag: Session.isPrivate field with backward compatibility
- ✅ Private channel pool management: isolated resource pool for private sessions
- ✅ ES384 JWT token generation: time-limited tokens with channel ARN and access control
- ✅ Activity feed privacy: private sessions hidden from non-owners
- ✅ API Gateway integration: POST /sessions/{sessionId}/playback-token endpoint wired

## Previous Milestone: v1.2 Activity Feed & Intelligence (SHIPPED 2026-03-06)

**Accomplished:** Surface richer session context on the homepage (hangout activity cards, reaction summary counts, horizontal recording slider, and activity feed), and add an automated transcription and AI summary pipeline to every recording.

**Delivered:**
- ✅ Homepage redesign: horizontal recording slider (3-4 visible, scrollable) + activity feed below
- ✅ Hangout activity cards: participants, message count, duration with relative timestamps
- ✅ Reaction summary counts (per emoji type) displayed on recording cards and replay info panel
- ✅ Transcription pipeline: automatic S3 recording → Amazon Transcribe → transcript stored on session
- ✅ AI summary pipeline: transcript → Bedrock/Claude Sonnet → one-paragraph summary on every recording
- ✅ Video uploads: users can upload pre-recorded videos (MOV/MP4) with automatic adaptive bitrate encoding

## Current Milestone: v1.4 Creator Studio & Stream Quality

**Goal:** Give broadcasters professional tools to monitor stream health and showcase other creators in real-time.

**Target features:**
- Stream quality dashboard during broadcast (bitrate, resolution, network status, frame rate)
- Creator spotlight overlay feature (feature another broadcaster's stream with elegant UI)
- Real-time metrics ingest for professional broadcast experience

## Requirements

### Validated

- ✓ Pre-warmed pool of provisioned IVS resources — Phase 2
- ✓ CDK-defined backend infrastructure, cleanly destroyable — Phase 1-2
- ✓ Lambda + API Gateway APIs for sessions (creation/retrieval) — Phase 2
- ✓ DynamoDB models for sessions (lifecycle, resource pool) — Phase 2
- ✓ Cognito username/password auth (no email confirmation) — Phase 1
- ✓ Frontend "stack not deployed" detection with developer guidance — Phase 1
- ✓ Deployment outputs wired into web app via generated config files — Phase 1
- ✓ Logout functionality accessible from any protected route — Phase 1
- ✓ Developer CLI tools for user/token management — Phase 1
- ✓ Near real-time broadcasting (one-to-many via IVS Channel) — Phase 3
- ✓ Long-running chat attached to live sessions, persisting for replay — Phase 4
- ✓ Frontend routing for broadcast and viewer pages — Phase 4.2
- ✓ Session creation UI with loading/error states — Phase 4.2
- ✓ Centralized API configuration across frontend — Phase 4.2
- ✓ Auto-record all sessions (broadcasts + hangouts) to S3 — Phase 5
- ✓ Home feed showing recently streamed videos (Instagram-style grid) — Phase 6
- ✓ Replay viewer with video playback + synchronized chat — Phase 6
- ✓ Reaction system (live + replay, synchronized to video timeline) — Phase 7
- ✓ IVS RealTime hangouts (multi-participant video, up to 5 participants) — Phase 8
- ✓ Developer CLI: stream test media, seed data, simulate presence — Phase 9

### Active

**v1.4 Milestone (Creator Studio & Stream Quality):**

- [ ] Broadcaster can view stream quality metrics during live broadcast
- [ ] Stream quality dashboard shows bitrate, resolution, frame rate, network status
- [ ] Broadcaster can feature another creator's broadcast as an overlay/spotlight
- [ ] Featured broadcast selection UI with search and discovery
- [ ] Featured broadcast link/badge displayed to viewers during broadcast
- [ ] Viewers can click featured broadcast to navigate and watch

### Just Validated (v1.2)

- ✓ Homepage redesigned with horizontal recording slider and activity feed — Phase 18
- ✓ Hangout activity cards with participant list and message counts — Phase 16-18
- ✓ Reaction summary counts stored and displayed on recordings — Phase 17-18
- ✓ Transcription pipeline: automatic Transcribe integration for all recordings — Phase 19
- ✓ AI summary pipeline: Bedrock/Claude generates one-paragraph summaries — Phase 20
- ✓ Video upload support: multipart uploads with automatic MediaConvert processing — Phase 21
- ✓ Private broadcasts with ES384 JWT token access control — Phase 22

### Out of Scope

- Admin/dashboard view — deferred to future milestone
- Profile-based recording discovery — v1.1 uses home feed only, profiles later
- User choice for recording — all sessions record automatically, opt-out later
- Mobile app — deferred to future subrepo, web-first
- Email confirmation on signup — explicitly excluded for speed
- OAuth/social login — username/password only for v1
- Paid subscriptions/monetization — not in scope
- Content moderation/AI filtering — defer to v2
- Multi-region deployment — single region for v1

## Context

- AWS IVS provides two distinct products: IVS (low-latency streaming, one-to-many) and IVS RealTime (WebRTC-based, multi-participant). Both are needed.
- IVS Chat is a separate service that integrates with both streaming modes.
- Pre-warming IVS resources (channels, stages) is important to avoid cold-start latency when users go live.
- Recording uses IVS's built-in recording configuration to route to S3.
- The developer tool suite is critical for local development since IVS requires actual AWS resources — can't mock it.
- Frontend must work gracefully when CDK stack isn't deployed (first-time developer experience).

## Constraints

- **Tech stack**: AWS IVS + IVS RealTime + IVS Chat, CDK for infrastructure, React for frontend, Lambda + API Gateway + DynamoDB for backend
- **Auth**: Cognito with username/password only, no email verification
- **UX**: No AWS concepts exposed to end users — abstract away channels, stages, rooms
- **Infrastructure**: Must be cleanly destroyable via `cdk destroy`
- **Resource management**: Pre-warmed pool of IVS resources to avoid cold starts
- **Testing**: Developer CLI must support streaming real video files (MP4/MOV) into sessions for testing

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| IVS for broadcast + IVS RealTime for hangouts | Two distinct use cases require both IVS products | ✓ Broadcast shipped v1.0, hangouts pending |
| Cognito username/password only | Simplicity for v1, no email infrastructure needed | ✓ Phase 1 |
| Pre-warmed resource pool | Instant "go live" UX requires resources ready ahead of time | ✓ Phase 2 |
| CDK for infrastructure | Infrastructure as code, cleanly destroyable | ✓ Phase 1-2 |
| DynamoDB for data | Serverless, scales with usage, fits session/event data model | ✓ Phase 2 |
| REST APIs (not GraphQL) | Simpler for token exchange and session management | ✓ Phase 1-2 |
| Web-first, mobile later | Faster to ship, mobile as future subrepo | ✓ Phase 1 |
| Single-table DynamoDB design with GSI | Efficient querying, cost-effective, enables atomic pool claims | ✓ Phase 2 |
| Conditional writes for atomic operations | Prevents race conditions in concurrent resource claims | ✓ Phase 2 |
| EventBridge Scheduler for pool replenishment | Serverless, reliable, 5-minute intervals maintain pool readiness | ✓ Phase 2 |
| Retroactive Phase 01 verification | 9 requirements verified automated, 3 auth flows require manual testing | ✓ Phase 4.1 |

## Current State

**Shipped milestones:**
- v1.0 Gap Closure (4 phases, 11 plans) — shipped 2026-03-02
- v1.1 Replay, Reactions & Hangouts (15 phases, 27 plans) — shipped 2026-03-05
- v1.2 Activity Feed & Intelligence (7 phases, 19 plans) — shipped 2026-03-06

**Codebase:** ~6,500 LOC TypeScript (frontend + backend + CDK), 343/343 backend tests passing
**Next:** Planning v1.3 Secure Sharing milestone

---
*Last updated: 2026-03-06 after completing v1.3 milestone (22 phases total, 64 plans executed); now planning v1.4*
