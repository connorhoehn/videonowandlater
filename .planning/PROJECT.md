# VideoNowAndLater

## What This Is

A live video platform powered by AWS IVS with one-to-many broadcasting, small-group hangouts, and real-time chat. Users can create sessions instantly (backed by pre-warmed IVS resource pools), go live with their camera, and interact through chat and reactions. All sessions are automatically recorded and preserved for replay with synchronized chat and reactions. Built with CDK-managed infrastructure (Cognito auth, API Gateway, DynamoDB, IVS + IVS RealTime + IVS Chat), React frontend, and developer CLI tools for local testing.

## Core Value

Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

## Current Milestone: v1.2 Activity Feed & Intelligence

**Goal:** Surface richer session context on the homepage (hangout activity cards, reaction summary counts, horizontal recording slider + activity feed), and add an automated transcription + AI summary pipeline to every recording.

**Target features:**
- Homepage redesign: horizontal recording slider (3-4 visible, scrollable) + activity feed below
- Hangout activity cards: participants, message count, duration — no longer shows as "pending" recording tile
- Reaction summary counts displayed on recording cards and replay info panel
- Transcription pipeline: recording lands in S3 → Lambda → Amazon Transcribe → transcript stored on recording
- AI summary: transcript → Bedrock/Claude → one-paragraph summary stored + displayed on cards and replay page

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

**v1.2 Milestone (Activity Feed & Intelligence):**

- [ ] Homepage redesigned: horizontal recording slider (3–4 visible, scrollable) for replay-able broadcasts
- [ ] Homepage activity feed below slider: recent hangouts + broadcasts as list/card items
- [ ] Hangout sessions tracked with participant list (join/leave events persisted to DynamoDB)
- [ ] Hangout activity cards on homepage: participants, message count, duration, timestamp
- [ ] Reaction summary counts (per type) stored on session record after session ends
- [ ] Reaction summary counts displayed on recording cards and replay info panel
- [ ] Transcription pipeline: S3 recording event → Lambda → Amazon Transcribe job started
- [ ] Transcribe job completion → transcript stored on recording record in DynamoDB
- [ ] AI summary pipeline: transcript → Bedrock/Claude → one-paragraph summary generated
- [ ] AI summary stored on recording record and displayed on recording cards + replay page

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

**Latest milestone:** v1.1 Replay, Reactions & Hangouts (shipped 2026-03-05, 15 phases, 27 plans)
**Current milestone:** v1.2 Activity Feed & Intelligence (started 2026-03-05)
**Codebase:** ~6,000 LOC TypeScript (frontend + backend + CDK)
**Status:** Defining requirements for v1.2.

---
*Last updated: 2026-03-05 after starting v1.2 milestone*
