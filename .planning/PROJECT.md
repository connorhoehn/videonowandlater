# VideoNowAndLater

## What This Is

A live video platform powered by AWS IVS with one-to-many broadcasting and real-time chat. Users can create broadcast sessions instantly (backed by pre-warmed IVS Channel pool), go live with their camera, and chat with viewers in real-time. Built with CDK-managed infrastructure (Cognito auth, API Gateway, DynamoDB, IVS), React frontend, and developer CLI tools for local testing. Recording, replay viewer, hangouts, and reactions are planned for future milestones.

## Core Value

Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

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

### Active

- [ ] Small-group IVS RealTime hangouts (up to 5 participants)
- [ ] UX fully abstracted from AWS concepts (no channels/empty rooms — only "live" or "ready" experiences)
- [ ] Lambda + API Gateway APIs for presence, reactions, replay metadata
- [ ] DynamoDB models for presence, reactions, replay metadata
- [ ] Stream recording/routing for later viewing
- [ ] Instagram-style "recently streamed videos" replay viewer with reaction summaries
- [ ] IVS join tokens and chat token/authorization behind REST endpoints
- [ ] Developer CLI tool suite (create/list/delete users, generate tokens, seed data, simulate presence, stream test media)
- [ ] Admin/dashboard view (active sessions, participants, messages/reactions, recent replays)

### Out of Scope

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

**Shipped:** v1.0 Gap Closure (2026-03-02)
**Codebase:** ~5,300 LOC TypeScript (frontend + backend + CDK)
**Status:** Broadcast and chat functional end-to-end. Ready for hangouts, recording, and polish.

---
*Last updated: 2026-03-02 after v1.0 milestone*
