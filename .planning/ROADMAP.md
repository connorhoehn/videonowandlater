# Roadmap: VideoNowAndLater

## Overview

VideoNowAndLater delivers a live video platform in 8 phases, progressing from deployed AWS infrastructure through two distinct live modes (broadcast and hangout), persistent chat, automatic recording with synchronized replay, and social/operational polish. Each phase delivers a coherent, independently verifiable capability. The dependency chain follows the natural technical order: infrastructure and auth must exist before resource pools, pools before live sessions, chat before replay (persistence from day one), and broadcasting before hangouts (simpler IVS integration validates patterns first).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Auth** - CDK infrastructure, Cognito auth, deployment wiring, and developer bootstrapping tools
- [x] **Phase 2: Session Model & Resource Pool** - Session domain model, IVS resource pre-warming, and atomic pool claims (completed 2026-03-02)
- [ ] **Phase 3: Broadcasting** - One-to-many live broadcasting with IVS Player viewing, pool resource lifecycle, and test streaming
- [ ] **Phase 4: Chat** - Real-time text chat alongside live sessions with server-side persistence for replay
- [x] **Phase 4.1: Verify Phase 01 (INSERTED)** - Run verification on Foundation & Auth phase to validate already-built functionality (completed 2026-03-02)
- [x] **Phase 4.2: Frontend Integration Fixes (INSERTED)** - Wire BroadcastPage/ViewerPage routing, add session creation UI, fix API configuration (completed 2026-03-02)
- [ ] **Phase 5: Recording & Replay** - Automatic stream recording, EventBridge-driven processing, and Instagram-style replay viewer with chat sync
- [ ] **Phase 6: Hangouts** - Multi-participant RealTime video sessions with WebRTC grid, controls, and session type selection
- [ ] **Phase 7: Reactions & Presence** - Live emoji reactions with animated overlays, presence heartbeats, and replay reaction summaries
- [ ] **Phase 8: Admin Dashboard** - Operational visibility into active sessions, participants, messages, and recent replays

## Phase Details

### Phase 1: Foundation & Auth
**Goal**: Users can sign up, log in, and interact with a deployed backend; developers can bootstrap and tear down the entire stack cleanly
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, AUTH-01, AUTH-02, AUTH-03, AUTH-04, DEPLOY-01, DEPLOY-02, DEV-01, DEV-02, DEV-07
**Success Criteria** (what must be TRUE):
  1. Running `cdk deploy --all` produces a fully deployed stack with auth, storage, and API layers; `cdk destroy --all` removes everything cleanly
  2. User can sign up with username/password, log in, refresh the browser without losing session, and log out from any page
  3. Frontend detects when CDK stack is not deployed and displays developer setup guidance instead of crashing
  4. Developer can create/list/delete Cognito test users and generate auth tokens via CLI commands
  5. CloudWatch billing alarms are configured and fire at $10, $50, and $100 thresholds
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Monorepo scaffold + CDK Auth & Monitoring stacks
- [ ] 01-02-PLAN.md — API Gateway stack + deploy/destroy scripts + developer CLI tools
- [ ] 01-03-PLAN.md — React frontend with Amplify auth, signup/login/logout, stack-not-deployed detection

### Phase 2: Session Model & Resource Pool
**Goal**: The system maintains a pool of ready-to-use IVS resources so users can go live instantly without cold-start delays
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-04, POOL-01, POOL-02, POOL-03, POOL-04, POOL-05
**Success Criteria** (what must be TRUE):
  1. DynamoDB contains pre-warmed IVS channels, RealTime stages, and Chat rooms in AVAILABLE state, ready for instant claim
  2. Scheduled Lambda detects when available resources drop below threshold and replenishes the pool automatically
  3. Two simultaneous "go live" requests each atomically claim separate resources with no race conditions (conditional writes)
  4. Session lifecycle state machine tracks sessions through creating, live, ending, and ended states
  5. No AWS concepts (channels, stages, rooms, ARNs) appear in any API response or frontend-facing data structure
**Plans**: 3 plans

Plans:
- [ ] 02-01-PLAN.md — Session domain model + DynamoDB single-table design with GSI
- [ ] 02-02-PLAN.md — IVS resource pool replenishment Lambda with EventBridge schedule
- [ ] 02-03-PLAN.md — Session creation API with atomic pool claims and retry logic

### Phase 3: Broadcasting
**Goal**: Users can go live as a broadcaster and viewers can watch in near real-time; sessions clean up gracefully when they end
**Depends on**: Phase 2
**Requirements**: BCAST-01, BCAST-02, BCAST-03, BCAST-04, BCAST-05, BCAST-06, POOL-06, SESS-03, DEV-06
**Success Criteria** (what must be TRUE):
  1. User can go live with a single action and see a self-view preview before and during the broadcast
  2. Viewers can watch a live broadcast via IVS Player with low-latency HLS that auto-adapts to network conditions
  3. Live viewer count is visible to both broadcaster and viewers, and a live indicator shows which sessions are currently broadcasting
  4. When a broadcast ends, recording stops, pool resources are released back to available state, and session transitions to ended
  5. Developer can stream an MP4/MOV file into a broadcast session via FFmpeg for testing without a camera
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — Broadcast startup API and EventBridge stream state integration
- [ ] 03-02-PLAN.md — Frontend broadcasting and viewer playback with IVS SDKs
- [ ] 03-03-PLAN.md — Session cleanup, viewer count API, and FFmpeg test script

### Phase 4: Chat
**Goal**: Users can send and receive real-time text messages alongside any live session, with messages persisted for later replay
**Depends on**: Phase 3
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05
**Success Criteria** (what must be TRUE):
  1. Real-time text chat panel is visible alongside both broadcast and hangout sessions, displaying sender usernames
  2. Users joining a session mid-stream can see recent chat history (not just messages from after they joined)
  3. Chat messages are persisted to DynamoDB with session-relative timestamps (enabling replay sync in Phase 5)
  4. Chat tokens are generated server-side; the frontend never calls IVS Chat APIs directly for token creation
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD

### Phase 4.1: Verify Phase 01 Foundation & Auth (INSERTED)
**Goal**: Validate that Phase 01 foundation and auth functionality is complete by running verification
**Depends on**: Phase 4 (gap closure from milestone audit)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, DEV-01, DEV-02, DEV-07, DEPLOY-01, DEPLOY-02
**Gap Closure**: Addresses 9 unsatisfied/partial requirements from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. Phase 01 VERIFICATION.md exists and validates auth flows (signup, login, session persistence, logout)
  2. CLI tools (create-user, get-token) are verified as working
  3. Deploy/destroy scripts and CDK output wiring are confirmed functional
  4. Frontend stack-not-deployed detection is validated
  5. All Phase 01 requirements are properly marked in REQUIREMENTS.md traceability table
**Plans**: 1 plan

Plans:
- [ ] 04.1-01-PLAN.md — Run gsd-verifier on Phase 01 to create VERIFICATION.md

### Phase 4.2: Frontend Integration Fixes (INSERTED)
**Goal**: Complete frontend integration by wiring existing components and fixing API configuration
**Depends on**: Phase 4 (gap closure from milestone audit)
**Requirements**: Enables BCAST-01, BCAST-02, BCAST-03, BCAST-05, BCAST-06, SESS-01, POOL-05, CHAT-01, CHAT-03
**Gap Closure**: Fixes 3 critical integration issues from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. BroadcastPage and ViewerPage are routed in App.tsx at /broadcast/:sessionId and /viewer/:sessionId
  2. HomePage includes "Create Broadcast" button that calls POST /sessions API and navigates to broadcast page
  3. All frontend components use getConfig().apiUrl from aws-config.ts for API calls (no hardcoded URLs or env vars)
  4. E2E flows work: user creates broadcast → goes live → viewer watches → both can chat
**Plans**: 1 plan

Plans:
- [ ] 04.2-01-PLAN.md — Add routing, session creation UI, and fix API configuration

### Phase 5: Recording & Replay
**Goal**: Every broadcast is automatically recorded and users can browse and watch replays with synchronized chat playback
**Depends on**: Phase 4
**Requirements**: REPLAY-01, REPLAY-02, REPLAY-03, REPLAY-04, REPLAY-05, REPLAY-06, REPLAY-07
**Success Criteria** (what must be TRUE):
  1. Broadcast streams are automatically recorded to S3 and a recording processor Lambda fires on EventBridge Recording State Change events
  2. Replay catalog stores duration, thumbnail URL, and HLS playback URL; users can browse recently streamed videos in a feed with thumbnails
  3. User can watch a replay with IVS Player via CloudFront-served HLS
  4. Chat messages scroll in sync with replay playback position (scrubbing the player updates chat to match)
  5. Reaction summaries are displayed alongside replays (populated once Phase 7 delivers reaction data)
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD
- [ ] 05-03: TBD

### Phase 6: Hangouts
**Goal**: Users can start or join small-group video hangouts with up to 5 participants, completing the second live mode
**Depends on**: Phase 3, Phase 4
**Requirements**: HANG-01, HANG-02, HANG-03, HANG-04, HANG-05, HANG-06, SESS-02, DEV-03
**Success Criteria** (what must be TRUE):
  1. User can start a hangout and other users can join seamlessly, with up to 5 participants in a session
  2. Participants see self-view and a grid layout of other participants' video feeds
  3. Participants can mute/unmute audio and toggle camera on/off independently
  4. Participant list and count are visible to all participants during the hangout
  5. Before going live, user selects session type (broadcast or hangout) and the correct IVS mode activates
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

### Phase 7: Reactions & Presence
**Goal**: Live sessions feel alive with emoji reactions and visible participant presence; reaction data feeds into replay summaries
**Depends on**: Phase 4, Phase 5
**Requirements**: REACT-01, REACT-02, REACT-03, PRES-01, PRES-02, DEV-04, DEV-05
**Success Criteria** (what must be TRUE):
  1. Users can send emoji reactions during live sessions and see them appear as animated overlays for all participants/viewers
  2. Reactions are stored with timestamps so replay summaries show reaction activity over the session timeline
  3. Presence system shows who is currently watching or participating, updated via heartbeat API
  4. Presence auto-expires via DynamoDB TTL when users disconnect or stop sending heartbeats
  5. Developer can seed chat messages, reaction events, and simulated presence via CLI commands for testing
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Admin Dashboard
**Goal**: Operators have real-time visibility into platform activity for monitoring and debugging
**Depends on**: Phase 3, Phase 5, Phase 7
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04
**Success Criteria** (what must be TRUE):
  1. Admin view displays a count of currently active sessions (broadcast and hangout)
  2. Admin view displays active participant count across all sessions
  3. Admin view displays aggregate message and reaction counts
  4. Admin view displays a list of recent replays with basic metadata
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Auth | 2/3 | In Progress|  |
| 2. Session Model & Resource Pool | 3/3 | Complete   | 2026-03-02 |
| 3. Broadcasting | 0/3 | Not started | - |
| 4. Chat | 0/2 | Not started | - |
| 5. Recording & Replay | 0/3 | Not started | - |
| 6. Hangouts | 0/3 | Not started | - |
| 7. Reactions & Presence | 0/2 | Not started | - |
| 8. Admin Dashboard | 0/1 | Not started | - |
