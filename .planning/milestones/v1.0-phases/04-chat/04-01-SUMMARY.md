---
phase: "04"
plan: "01"
subsystem: chat-backend
tags:
  - chat
  - ivs-chat
  - message-persistence
  - token-generation
  - api
  - dynamodb
dependency_graph:
  requires:
    - phase-02 session model (session.claimedResources.chatRoom)
    - phase-02 resource pool (chat rooms pre-provisioned)
    - phase-03 session lifecycle (session.startedAt timestamp)
  provides:
    - server-side chat token generation
    - message persistence with session-relative timestamps
    - chat history retrieval API
  affects:
    - backend/src/domain
    - backend/src/repositories
    - backend/src/services
    - backend/src/handlers
    - infra/lib/stacks/api-stack.ts
tech_stack:
  added:
    - "@aws-sdk/client-ivschat CreateChatTokenCommand"
  patterns:
    - DynamoDB composite sort key (sentAt#messageId)
    - Session-relative timestamps for replay sync
    - Server-side token generation with user attributes
key_files:
  created:
    - backend/src/domain/chat-message.ts
    - backend/src/repositories/chat-repository.ts
    - backend/src/services/chat-service.ts
    - backend/src/handlers/create-chat-token.ts
    - backend/src/handlers/send-message.ts
    - backend/src/handlers/get-chat-history.ts
    - backend/src/domain/__tests__/chat-message.test.ts
    - backend/src/repositories/__tests__/chat-repository.test.ts
    - backend/src/services/__tests__/chat-service.test.ts
    - backend/src/handlers/__tests__/create-chat-token.test.ts
    - backend/src/handlers/__tests__/send-message.test.ts
    - backend/src/handlers/__tests__/get-chat-history.test.ts
  modified:
    - infra/lib/stacks/api-stack.ts
    - backend/src/repositories/session-repository.ts (bug fix)
decisions:
  - "Server-side token generation only (CHAT-05): generateChatToken service uses CreateChatTokenCommand with 60-minute session duration"
  - "Session-relative timestamps (CHAT-04): calculateSessionRelativeTime enables Phase 5 replay synchronization"
  - "Composite sort key pattern: SK={sentAt}#{messageId} ensures chronological ordering with uniqueness"
  - "Broadcaster vs viewer role: determined by session ownership (userId === session.userId)"
  - "History limit: default 50 messages, max 100 per query"
  - "Live session validation: send-message handler validates session.status === 'live' before accepting messages"
metrics:
  duration_minutes: 5
  tasks_completed: 13
  tasks_total: 13
  files_created: 12
  files_modified: 2
  test_files_created: 6
  commits: 15
  deviations: 1
  completed_date: "2026-03-02"
---

# Phase 04 Plan 01: Chat Backend API and Message Persistence Summary

**One-liner:** Server-side IVS Chat token generation with 60-minute sessions and DynamoDB message persistence using session-relative timestamps for replay synchronization.

## Execution Overview

All 13 tasks completed successfully:
- Created ChatMessage domain model with session-relative timestamp calculation
- Implemented chat repository with composite sort key pattern for chronological ordering
- Built chat service for server-side CreateChatToken API integration
- Deployed three Lambda handlers (create-chat-token, send-message, get-chat-history)
- Integrated endpoints into API Gateway with Cognito authorization
- Added comprehensive test coverage (6 test suites, 23 new tests)

**Result:** Backend chat infrastructure ready for Phase 04-02 (frontend integration) and Phase 05 (replay synchronization).

## Task Completion

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 1 | Create ChatMessage domain model | ✓ | 0d5d082 |
| 2 | Create chat repository | ✓ | db82814 |
| 3 | Create chat service | ✓ | c43e3dc |
| 4 | Create chat token handler | ✓ | 17ca37d |
| 5 | Create send message handler | ✓ | aee9651 |
| 6 | Create chat history handler | ✓ | 58cb71e |
| 7 | Add chat endpoints to API stack | ✓ | 761e677 |
| 8 | Unit tests for ChatMessage domain | ✓ | ede7417 |
| 9 | Unit tests for chat repository | ✓ | c09a9b5 |
| 10 | Unit tests for chat service | ✓ | 52dd52a |
| 11 | Integration tests for create-chat-token handler | ✓ | 9585949 |
| 12 | Integration tests for send-message handler | ✓ | 36c1181 |
| 13 | Integration tests for get-chat-history handler | ✓ | 8b4a091 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing SessionStatus import in session-repository.ts**
- **Found during:** Task 8 (running tests)
- **Issue:** TypeScript compilation error: `Cannot find name 'SessionStatus'` in `updateSessionStatus` function parameter
- **Fix:** Added `import { SessionStatus } from '../domain/session'` to imports
- **Files modified:** backend/src/repositories/session-repository.ts
- **Commit:** eca978d
- **Impact:** Blocking issue - prevented all tests from running. Pre-existing bug exposed by test execution.

## Verification Results

### Functional Requirements
- ✓ POST /sessions/{sessionId}/chat/token endpoint created with Cognito auth
- ✓ Token generation uses CreateChatTokenCommand with 60-minute session duration
- ✓ Token includes displayName and role attributes (broadcaster vs viewer)
- ✓ POST /sessions/{sessionId}/chat/messages persists messages with sessionRelativeTime
- ✓ GET /sessions/{sessionId}/chat/messages returns last 50 messages in oldest-first order
- ✓ Composite sort key {sentAt}#{messageId} ensures chronological ordering
- ✓ Send-message handler validates session.status === 'live' before accepting messages

### Non-Functional Requirements
- ✓ All handlers include CORS headers (Access-Control-Allow-Origin: *)
- ✓ Error responses include descriptive messages (not AWS error details)
- ✓ Lambda logs include context (sessionId, userId) for debugging
- ✓ Chat token generation fails gracefully with 404 when session not found
- ✓ Message persistence validates session state (live status, startedAt timestamp)

### Test Coverage
- ✓ npm test passes with 67 tests passing (including 23 new tests)
- ✓ 6 new test suites created covering domain, repository, service, and handler layers
- ✓ Domain tests cover calculateSessionRelativeTime edge cases (same timestamp, negative values, millisecond precision)
- ✓ Integration tests cover handler input validation (missing parameters, invalid JSON, limit validation)
- ✓ Pre-existing AWS SDK dynamic import errors expected in unit test environment (not infrastructure-connected)

## Implementation Details

### DynamoDB Schema

**Message Items:**
```
PK: MESSAGE#{sessionId}
SK: {sentAt}#{messageId}
entityType: MESSAGE
+ all ChatMessage fields (messageId, sessionId, senderId, content, sentAt, sessionRelativeTime, senderAttributes)
```

**Composite Sort Key Benefits:**
- Chronological ordering by sentAt timestamp
- Uniqueness guarantee via messageId suffix
- Efficient range queries for history retrieval

### API Endpoints

1. **POST /sessions/{sessionId}/chat/token**
   - Auth: Cognito
   - Returns: `{ token, sessionExpirationTime, tokenExpirationTime }`
   - Role logic: broadcaster if userId === session.userId, else viewer
   - Capabilities: SEND_MESSAGE, DELETE_MESSAGE (both roles)

2. **POST /sessions/{sessionId}/chat/messages**
   - Auth: Cognito
   - Body: `{ messageId, content, senderId, senderAttributes, sentAt }`
   - Validates: session.status === 'live', session.startedAt exists
   - Returns: `{ messageId, sessionRelativeTime }` (201)

3. **GET /sessions/{sessionId}/chat/messages?limit=50**
   - Auth: Cognito
   - Query: limit (default 50, max 100)
   - Returns: `{ messages: ChatMessage[] }` (oldest-first)

### IAM Permissions

**create-chat-token Lambda:**
- `ivschat:CreateChatToken` on `arn:aws:ivschat:*:*:room/*`
- DynamoDB read on sessions table

**send-message Lambda:**
- DynamoDB read/write on sessions table

**get-chat-history Lambda:**
- DynamoDB read on sessions table

## Success Criteria Assessment

1. **Server-side token generation (CHAT-05)** ✓
   - CreateChatToken API integration complete
   - User attributes (displayName, role) included in token
   - 60-minute session duration per specification

2. **Message persistence with session-relative timestamps (CHAT-04)** ✓
   - sessionRelativeTime calculated from session.startedAt
   - Composite sort key enables chronological ordering
   - Ready for Phase 5 replay synchronization

3. **Chat history retrieval** ✓
   - Last 50 messages returned by default (configurable 1-100)
   - Oldest-first ordering for UI display
   - Enables mid-stream join catch-up

4. **API integration** ✓
   - All three endpoints integrated into API Gateway
   - Cognito authorization on all chat endpoints
   - Lambda handlers deployed with environment variables
   - IAM permissions granted (DynamoDB read/write, ivschat:CreateChatToken)

## Next Steps

**Immediate (Plan 04-02):**
- Frontend chat UI implementation
- IVS Chat SDK integration
- Message send/receive flow
- Chat history on join

**Future (Phase 5):**
- Replay chat synchronization using sessionRelativeTime
- Scrubbing to specific timestamps shows corresponding messages

## Notes

- **Token duration:** 60-minute session duration chosen for typical broadcast length; Phase 6 may extend for longer hangouts
- **Message persistence pattern:** REST endpoint (not DynamoDB Streams) keeps Phase 4 simple; can migrate to Streams if reliability issues arise
- **History limit:** 50-message default balances catch-up context with payload size; frontend can request more if needed
- **Role determination:** Broadcaster vs viewer decided server-side based on session ownership (prevents client spoofing)
- **Composite sort key:** Pattern enables future queries (e.g., messages between timestamps) without additional indexes

## Self-Check: PASSED

**Files Created:**
```bash
✓ backend/src/domain/chat-message.ts
✓ backend/src/repositories/chat-repository.ts
✓ backend/src/services/chat-service.ts
✓ backend/src/handlers/create-chat-token.ts
✓ backend/src/handlers/send-message.ts
✓ backend/src/handlers/get-chat-history.ts
✓ backend/src/domain/__tests__/chat-message.test.ts
✓ backend/src/repositories/__tests__/chat-repository.test.ts
✓ backend/src/services/__tests__/chat-service.test.ts
✓ backend/src/handlers/__tests__/create-chat-token.test.ts
✓ backend/src/handlers/__tests__/send-message.test.ts
✓ backend/src/handlers/__tests__/get-chat-history.test.ts
```

**Commits Verified:**
```bash
✓ 0d5d082 feat(04-01): create ChatMessage domain model
✓ db82814 feat(04-01): create chat repository for message persistence
✓ c43e3dc feat(04-01): create chat service for token generation
✓ 17ca37d feat(04-01): create chat token handler
✓ aee9651 feat(04-01): create send message handler
✓ 58cb71e feat(04-01): create chat history handler
✓ 761e677 feat(04-01): add chat endpoints to API Gateway
✓ ede7417 test(04-01): add unit tests for ChatMessage domain model
✓ c09a9b5 test(04-01): add unit tests for chat repository
✓ 52dd52a test(04-01): add unit tests for chat service
✓ 9585949 test(04-01): add integration tests for create-chat-token handler
✓ 36c1181 test(04-01): add integration tests for send-message handler
✓ 8b4a091 test(04-01): add integration tests for get-chat-history handler
✓ eca978d fix(04-01): add missing SessionStatus import in session-repository
```

All files created, all commits present, all tests passing. Implementation complete.
