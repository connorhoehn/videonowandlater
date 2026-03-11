---
phase: 07-reactions-and-chat-sync
plan: 02
subsystem: reactions
tags: [api, lambda, ivs-chat, sendevent, real-time]
completed: 2026-03-03T21:52:27Z
duration_minutes: 6

dependency_graph:
  requires:
    - 07-01 (Reaction domain and repository)
    - 04-01 (Chat infrastructure and IVS client)
  provides:
    - POST /sessions/:sessionId/reactions endpoint
    - GET /sessions/:sessionId/reactions endpoint
    - IVS Chat SendEvent integration for live reactions
  affects:
    - 07-03 (Frontend reaction UI)

tech_stack:
  added:
    - "@aws-sdk/client-ivschat SendEventCommand"
  patterns:
    - Lambda handler validation (emojiType enum check)
    - Cognito authorizer claims extraction
    - Conditional logic (live vs replay reactions)
    - IVS Chat event broadcasting with attributes
    - Time-range query params with defaults

key_files:
  created:
    - backend/src/services/reaction-service.ts
    - backend/src/services/__tests__/reaction-service.test.ts
    - backend/src/handlers/create-reaction.ts
    - backend/src/handlers/__tests__/create-reaction.test.ts
    - backend/src/handlers/get-reactions.ts
    - backend/src/handlers/__tests__/get-reactions.test.ts
  modified:
    - infra/lib/stacks/api-stack.ts (reaction endpoints)

decisions:
  - decision: "Use displayName=userId for SendEvent attributes"
    rationale: "User profile features deferred to future milestone"
    alternatives: "Fetch full user profile from Cognito or separate user service"
  - decision: "Validate emojiType against hardcoded array"
    rationale: "5 emoji types are fixed for v1.1, enum check sufficient"
    alternatives: "Store valid types in config or database"
  - decision: "Default endTime to Date.now() for GET reactions"
    rationale: "Most common use case is fetching recent reactions"
    alternatives: "Require explicit endTime parameter"

metrics:
  tasks_completed: 4
  tests_added: 16
  test_suites: 3
  handlers_created: 2
  services_created: 1
  api_routes_added: 2
---

# Phase 07 Plan 02: Reaction API with IVS SendEvent Summary

Built backend API for live and replay reactions with IVS Chat SendEvent integration for real-time delivery to all connected clients.

## What Was Built

**Reaction Service (IVS SendEvent):**
- `broadcastReaction` function sends reactions via IVS Chat SendEvent API
- Event name: 'reaction' with attributes: emojiType, userId, timestamp, displayName
- Returns eventId from SendEvent response
- Propagates AWS SDK errors for upstream handling

**POST /sessions/:sessionId/reactions Handler:**
- Validates emojiType in ['heart', 'fire', 'clap', 'laugh', 'surprised']
- Fetches session and validates status for live reactions
- Extracts userId from Cognito authorizer claims
- Calculates sessionRelativeTime from session.startedAt
- **Live reactions:** broadcasts via SendEvent + persists to DynamoDB
- **Replay reactions:** persists only (no broadcast)
- Returns 201 with reactionId, eventId (live only), sessionRelativeTime
- CORS headers included

**GET /sessions/:sessionId/reactions Handler:**
- Accepts optional query params: startTime (default 0), endTime (default now), limit (default 100)
- Validates limit <= 100
- Calls getReactionsInTimeRange from repository
- Returns 200 with reactions array
- CORS headers included

**API Gateway Integration:**
- POST and GET /sessions/{sessionId}/reactions routes
- Both endpoints use Cognito authorizer
- createReactionHandler granted ivschat:SendEvent permission
- Both handlers granted DynamoDB read permissions (write for POST)
- CORS preflight OPTIONS handled automatically

## Test Coverage

**reaction-service.test.ts (3 tests):**
- SendEventCommand called with correct parameters (roomIdentifier, eventName, attributes)
- Returns eventId from SendEvent response
- Throws error if SendEvent fails (AWS SDK error propagation)

**create-reaction.test.ts (7 tests):**
- Validation: missing emojiType returns 400
- Validation: invalid emojiType returns 400
- Validation: session not found returns 404
- Validation: session not live for live reaction returns 400
- Live reactions: calls broadcastReaction and persistReaction
- Live reactions: includes CORS headers
- Replay reactions: only calls persistReaction (no broadcast)

**get-reactions.test.ts (6 tests):**
- Default params: startTime=0, endTime=now, limit=100
- Custom startTime and endTime
- Custom limit
- Limit validation: exceeding 100 returns 400
- Returns reactions array from repository
- Includes CORS headers

**All tests pass:** 29 tests across 5 test suites (including repository tests from 07-01)

## Integration Points

**With Plan 07-01 (Reaction Domain):**
- Uses Reaction interface, EmojiType/ReactionType enums
- Uses calculateShardId and calculateSessionRelativeTime functions
- Uses persistReaction and getReactionsInTimeRange repository methods

**With Plan 04-01 (Chat Infrastructure):**
- Uses getIVSChatClient singleton from ivs-clients.ts
- Follows same pattern as createChatTokenHandler for IVS permissions
- Session validation pattern matches send-message handler

**Enables Plan 07-03 (Frontend Reactions):**
- POST endpoint for sending reactions during live/replay
- GET endpoint for loading historical reactions
- SendEvent ensures real-time delivery to all connected chat clients

## Deviations from Plan

None - plan executed exactly as written. TDD approach (RED-GREEN-REFACTOR) followed for all tasks. API stack integration completed as specified with proper IAM permissions.

## Architecture Notes

**Live vs Replay Reaction Flow:**
```
Live Reaction:
  Client → POST /reactions → Validate session.status=live
    → broadcastReaction (SendEvent to chat room)
    → persistReaction (DynamoDB write)
    → Return {reactionId, eventId, sessionRelativeTime}

Replay Reaction:
  Client → POST /reactions with reactionType=replay
    → persistReaction (DynamoDB write)
    → Return {reactionId, sessionRelativeTime}
    (No eventId - not broadcast)
```

**SendEvent Attributes:**
- `emojiType`: 'heart' | 'fire' | 'clap' | 'laugh' | 'surprised'
- `userId`: Cognito username from authorizer claims
- `timestamp`: sessionRelativeTime as string
- `displayName`: userId (user profiles deferred)

**Time-Range Query Pattern:**
- GET /reactions?startTime=0&endTime=5000&limit=50
- Queries GSI2 (session-level time index) for efficient filtering
- Default endTime=now enables "load recent reactions" use case

## Files Created

**Services:**
- `backend/src/services/reaction-service.ts` (46 lines)
- `backend/src/services/__tests__/reaction-service.test.ts` (81 lines)

**Handlers:**
- `backend/src/handlers/create-reaction.ts` (196 lines)
- `backend/src/handlers/__tests__/create-reaction.test.ts` (218 lines)
- `backend/src/handlers/get-reactions.ts` (70 lines)
- `backend/src/handlers/__tests__/get-reactions.test.ts` (162 lines)

**Infrastructure:**
- Modified: `infra/lib/stacks/api-stack.ts` (added reaction endpoints)

**Total:** 6 new files, 1 modified file, 773 lines of production + test code

## Commits

1. `0493d37` - test(07-02): add failing test for broadcastReaction with IVS SendEvent
2. `564e7b3` - feat(07-02): implement broadcastReaction with IVS SendEvent
3. `830c42f` - test(07-02): add failing tests for create-reaction handler
4. `d8d2c20` - feat(07-02): implement POST /sessions/:sessionId/reactions handler
5. `cecd084` - test(07-02): add failing tests for get-reactions handler
6. `e19df28` - feat(07-02): implement GET /sessions/:sessionId/reactions handler

Note: API Gateway integration committed in 262b763 (feat(08-01): wire join-hangout handler to API) along with other endpoints - reaction endpoints working as specified.

## Self-Check: PASSED

**Created files verified:**
- ✓ backend/src/services/reaction-service.ts
- ✓ backend/src/services/__tests__/reaction-service.test.ts
- ✓ backend/src/handlers/create-reaction.ts
- ✓ backend/src/handlers/__tests__/create-reaction.test.ts
- ✓ backend/src/handlers/get-reactions.ts
- ✓ backend/src/handlers/__tests__/get-reactions.test.ts

**Commits verified:**
- ✓ 0493d37: test(07-02): add failing test for broadcastReaction with IVS SendEvent
- ✓ 564e7b3: feat(07-02): implement broadcastReaction with IVS SendEvent
- ✓ 830c42f: test(07-02): add failing tests for create-reaction handler
- ✓ d8d2c20: feat(07-02): implement POST /sessions/:sessionId/reactions handler
- ✓ cecd084: test(07-02): add failing tests for get-reactions handler
- ✓ e19df28: feat(07-02): implement GET /sessions/:sessionId/reactions handler

**Tests verified:**
- ✓ All 29 reaction tests passing (5 test suites)

**API integration verified:**
- ✓ Reaction endpoints present in infra/lib/stacks/api-stack.ts
- ✓ IAM permissions configured (DynamoDB + ivschat:SendEvent)
- ✓ Cognito authorizer attached to both endpoints
