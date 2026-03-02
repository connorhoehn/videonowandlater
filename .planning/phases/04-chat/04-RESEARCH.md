# Phase 4: Chat - Research

**Researched:** 2026-03-02
**Domain:** Real-time chat messaging with AWS IVS Chat SDK
**Confidence:** HIGH

## Summary

Phase 4 implements real-time text chat alongside live sessions using Amazon IVS Chat Messaging SDK. The chat architecture leverages pre-provisioned chat rooms from the resource pool (already implemented in Phase 2), server-side token generation via the AWS SDK, and client-side WebSocket connections via the IVS Chat Messaging SDK. Messages are persisted to DynamoDB with session-relative timestamps to enable Phase 5's replay synchronization. The implementation follows React best practices with custom hooks, context providers, and separation of connection state from message state.

**Primary recommendation:** Use amazon-ivs-chat-messaging SDK (latest: 1.1.1) for frontend WebSocket connections, create server-side chat token generation endpoint using @aws-sdk/client-ivschat, persist messages to DynamoDB on message receipt via SDK event listeners, and structure the React integration with useChatRoom hook + context providers for clean state management.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chat Panel Layout & Positioning:**
- Desktop/tablet: Right side panel, fixed at ~25-30% screen width
- Mobile: Toggleable overlay that slides over video (hide/show via icon)
- Resizing: Fixed width with hide/show toggle (no draggable resize)
- Video remains on left, chat on right (standard streaming platform pattern)

**Message Display & Metadata:**
- Per message: Username (required), relative timestamp ("2m ago"), broadcaster badge
- No avatars in initial implementation
- Role badges: Broadcaster only (simple badge/icon for session owner)
- Visual style: Compact density - minimal spacing, more messages visible, username + timestamp on same line

**History & Empty States:**
- History on join: Last 50 messages (enough context, fast to load, ~5-15 min of chat)
- Empty state: Friendly prompt - "Be the first to say hi!" or similar encouraging message
- Scroll behavior: Auto-scroll to bottom when new messages arrive, BUT only if user is already at bottom (don't interrupt if scrolled up reading history)
- Loading state: Skeleton messages (animated placeholders showing expected layout)

### Claude's Discretion

- Input field design and send interaction (text input, button vs Enter key behavior, character limits)
- Exact timestamp update frequency for "relative time"
- Broadcaster badge visual design (icon, color, placement)
- Scroll-to-bottom button styling and placement
- Error state handling (connection lost, failed to send)
- Message grouping/threading logic if any

### Deferred Ideas (OUT OF SCOPE)

None - discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHAT-01 | Real-time text chat is available alongside both broadcast and hangout sessions | IVS Chat Messaging SDK (amazon-ivs-chat-messaging) provides WebSocket-based real-time messaging; sessions already claim ROOM resources from pool |
| CHAT-02 | Chat messages display sender username | ChatMessage events include sender.userId; can be enriched with displayName from user attributes in chat token |
| CHAT-03 | Users joining mid-session can see recent chat history | DynamoDB message persistence + query pattern (PK=MESSAGE#{sessionId}, SK sorted by timestamp) enables fetching last N messages on join |
| CHAT-04 | Chat messages are persisted to DynamoDB with session-relative timestamps | Message event listeners trigger Lambda/handler to write to DynamoDB with sessionId + timestamp composite key |
| CHAT-05 | Chat tokens are generated server-side; clients only call REST endpoints | CreateChatToken API (@aws-sdk/client-ivschat) on backend; frontend calls /chat/token endpoint and passes token to ChatRoom via tokenProvider |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| amazon-ivs-chat-messaging | ^1.1.1 | Frontend WebSocket SDK for IVS Chat | Official AWS SDK for IVS Chat; handles WebSocket lifecycle, reconnection, message events |
| @aws-sdk/client-ivschat | ^3.1000.0 | Backend SDK for IVS Chat control plane | Already installed (Phase 2); used for CreateChatToken, CreateRoom (pool), logging configuration |
| @aws-sdk/lib-dynamodb | ^3.1000.0 | DynamoDB Document Client | Already in use (Phase 2); persist messages with PutCommand, query history with QueryCommand |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | ^10.0.0 | Generate unique message IDs | Already installed; use for client-side optimistic message IDs before server confirmation |
| React Context API | Built-in (React 19) | State management for chat connection and messages | Already pattern in project (useBroadcast, usePlayer); implement useChatRoom hook + ChatRoomProvider + ChatMessagesProvider |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| amazon-ivs-chat-messaging | WebSocket client library + manual IVS Chat Messaging API calls | SDK handles token refresh, reconnection logic, event parsing automatically - manual implementation would miss edge cases (see Pitfalls) |
| Server-side token generation | Client-side token generation | Security requirement: AWS credentials must never be exposed to client; CreateChatToken requires IAM permissions |
| DynamoDB message persistence | IVS Chat logging to S3 | S3 logging is append-only and eventual; DynamoDB enables real-time history queries (last 50 messages on join) and Phase 5 replay sync |

**Installation:**
```bash
# Frontend (web/)
npm install amazon-ivs-chat-messaging

# Backend (already has @aws-sdk/client-ivschat from Phase 2)
```

## Architecture Patterns

### Recommended Project Structure

```
backend/src/
├── handlers/
│   ├── create-chat-token.ts       # POST /sessions/{sessionId}/chat/token - generate chat token
│   ├── send-message.ts            # POST /sessions/{sessionId}/chat/messages - persist message to DynamoDB
│   └── get-chat-history.ts        # GET /sessions/{sessionId}/chat/messages - fetch last N messages
├── domain/
│   └── chat-message.ts            # ChatMessage domain model
├── repositories/
│   └── chat-repository.ts         # DynamoDB chat message persistence
└── services/
    └── chat-service.ts            # Chat token generation business logic

web/src/features/
├── chat/
│   ├── ChatPanel.tsx              # Main chat panel component (right side or overlay)
│   ├── MessageList.tsx            # Scrollable message list with virtualization
│   ├── MessageInput.tsx           # Text input with send button
│   ├── MessageRow.tsx             # Single message display (username, timestamp, content)
│   ├── useChatRoom.ts             # Hook for ChatRoom instance management
│   ├── ChatRoomProvider.tsx       # Context provider for ChatRoom instance
│   └── ChatMessagesProvider.tsx   # Context provider for message state (separate from connection state)
```

### Pattern 1: ChatRoom Initialization with Custom Hook

**What:** Single ChatRoom instance per session, initialized once via useState with initializer function

**When to use:** Every chat integration requires this pattern

**Example:**
```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-react-best-practices.html
import { ChatRoom } from 'amazon-ivs-chat-messaging';
import React from 'react';

interface ChatRoomConfig {
  regionOrUrl: string;
  tokenProvider: () => Promise<string>;
}

export const useChatRoom = (config: ChatRoomConfig) => {
  // CRITICAL: Use useState with initializer function to create instance only once
  const [room] = React.useState(() => new ChatRoom(config));
  return { room };
};
```

**Critical rule:** Do NOT use `setState` dispatch method to update configuration. Configuration cannot be changed after initialization. Token provider function is called automatically on reconnection.

### Pattern 2: Separate Context Providers for Connection vs Messages

**What:** ChatRoomProvider for connection state, ChatMessagesProvider for message state

**When to use:** Prevents excessive re-renders when messages update

**Example:**
```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-react-best-practices.html

// ChatRoomProvider - connection state only
const ChatRoomContext = React.createContext<ChatRoom | undefined>(undefined);

export const useChatRoomContext = () => {
  const context = React.useContext(ChatRoomContext);
  if (context === undefined) {
    throw new Error('useChatRoomContext must be within ChatRoomProvider');
  }
  return context;
};

export const ChatRoomProvider = ChatRoomContext.Provider;

// ChatMessagesProvider - message state only (separate to avoid re-renders)
const ChatMessagesContext = React.createContext<ChatMessage[]>([]);

export const ChatMessagesProvider = ({ children }: { children: React.ReactNode }) => {
  const room = useChatRoomContext();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);

  React.useEffect(() => {
    const unsubscribeOnMessageReceived = room.addListener('message', (message) => {
      setMessages((msgs) => [message, ...msgs]); // Prepend newest
    });

    const unsubscribeOnMessageDeleted = room.addListener('messageDelete', (deleteEvent) => {
      setMessages((prev) => prev.filter((message) => message.id !== deleteEvent.messageId));
    });

    return () => {
      unsubscribeOnMessageDeleted();
      unsubscribeOnMessageReceived();
    };
  }, [room]);

  return <ChatMessagesContext.Provider value={messages}>{children}</ChatMessagesContext.Provider>;
};
```

**Performance note:** Separation prevents every component from re-rendering on every message when they only need connection state.

### Pattern 3: Server-Side Token Generation Flow

**What:** Frontend calls backend endpoint to fetch chat token, passes token to ChatRoom via tokenProvider callback

**When to use:** Required for all IVS Chat implementations (security best practice)

**Example:**
```typescript
// Backend handler (create-chat-token.ts)
// Source: https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_CreateChatToken.html
import { CreateChatTokenCommand } from '@aws-sdk/client-ivschat';
import { getIVSChatClient } from '../lib/ivs-clients';

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters!.sessionId;
  const userId = event.requestContext.authorizer?.claims?.['cognito:username'];

  // Fetch session to get chatRoomArn
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  const chatClient = getIVSChatClient();
  const response = await chatClient.send(
    new CreateChatTokenCommand({
      roomIdentifier: session.claimedResources.chatRoom, // ARN from pool
      userId: userId,
      capabilities: ['SEND_MESSAGE', 'DELETE_MESSAGE'],
      sessionDurationInMinutes: 60,
      attributes: {
        displayName: userId, // Could fetch from user profile
        role: session.userId === userId ? 'broadcaster' : 'viewer',
      },
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ token: response.token }),
  };
};

// Frontend tokenProvider function
const tokenProvider = async () => {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/token`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await response.json();
  return data.token;
};

// ChatRoom initialization
const { room } = useChatRoom({
  regionOrUrl: 'us-east-1', // Match CDK stack region
  tokenProvider: tokenProvider,
});
```

**Security note:** Token is valid for 1 minute for connection, session lasts up to sessionDurationInMinutes. SDK automatically calls tokenProvider on reconnection.

### Pattern 4: Message Persistence on Receipt

**What:** Listen for 'message' events from ChatRoom, persist to DynamoDB via backend handler

**When to use:** Required for CHAT-04 (session-relative timestamps) and CHAT-03 (history on join)

**Example:**
```typescript
// Frontend: Trigger persistence when message is sent successfully
React.useEffect(() => {
  const unsubscribe = room.addListener('message', async (message: ChatMessage) => {
    // Persist to DynamoDB for replay sync
    await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        messageId: message.id,
        content: message.content,
        senderId: message.sender.userId,
        senderAttributes: message.sender.attributes,
        sentAt: message.sendTime, // ISO timestamp from IVS Chat
      }),
    });
  });

  return () => unsubscribe();
}, [room, sessionId, authToken]);

// Backend: Persist with session-relative timestamp
// Domain model: ChatMessage
export interface ChatMessage {
  messageId: string;
  sessionId: string;
  senderId: string;
  content: string;
  sentAt: string; // ISO 8601 from IVS Chat event
  sessionRelativeTime: number; // Milliseconds since session.startedAt (for replay sync)
  senderAttributes: Record<string, string>; // displayName, role from token attributes
}

// Repository: DynamoDB schema
// PK = MESSAGE#{sessionId}, SK = {sentAt}#{messageId} (composite for uniqueness)
await docClient.send(
  new PutCommand({
    TableName: tableName,
    Item: {
      PK: `MESSAGE#${sessionId}`,
      SK: `${sentAt}#${messageId}`,
      messageId,
      sessionId,
      senderId,
      content,
      sentAt,
      sessionRelativeTime: calculateRelativeTime(session.startedAt, sentAt),
      senderAttributes,
    },
  })
);
```

**Replay sync note:** sessionRelativeTime enables Phase 5 to synchronize chat with video playback position.

### Pattern 5: Chat History Query on Join

**What:** Query last 50 messages from DynamoDB when user joins session mid-stream

**When to use:** Required for CHAT-03 (history on join)

**Example:**
```typescript
// Backend handler: GET /sessions/{sessionId}/chat/messages?limit=50
export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters!.sessionId;
  const limit = parseInt(event.queryStringParameters?.limit || '50', 10);

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `MESSAGE#${sessionId}`,
      },
      ScanIndexForward: false, // Descending order (newest first)
      Limit: limit,
    })
  );

  const messages = (result.Items || []).reverse(); // Reverse to oldest-first for display

  return {
    statusCode: 200,
    body: JSON.stringify({ messages }),
  };
};

// Frontend: Load history on mount
React.useEffect(() => {
  const loadHistory = async () => {
    const response = await fetch(
      `${API_BASE_URL}/sessions/${sessionId}/chat/messages?limit=50`,
      { headers: { Authorization: `Bearer ${authToken}` } }
    );
    const data = await response.json();
    setMessages(data.messages); // Initialize state with history
  };

  loadHistory();
}, [sessionId, authToken]);
```

**UX note:** Display loading skeleton while fetching history, then merge with live messages.

### Anti-Patterns to Avoid

- **Re-initializing ChatRoom on every render:** Use useState with initializer function, not useMemo or direct instantiation
- **Single context for connection + messages:** Causes unnecessary re-renders; separate ChatRoomProvider and ChatMessagesProvider
- **Client-side token generation:** Security risk; always generate tokens server-side with AWS SDK
- **Synchronous message persistence:** Use event listeners to persist asynchronously; don't block UI on persistence
- **Missing reconnection handling:** SDK handles reconnection automatically up to maxReconnectAttempts, but monitor 'disconnect' event for exhausted retries

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket connection management for IVS Chat | Custom WebSocket client with manual reconnection, token refresh, event parsing | amazon-ivs-chat-messaging SDK | SDK handles token expiry (1-minute validity), automatic reconnection (up to maxReconnectAttempts), event type parsing, disconnect reason codes, session duration tracking |
| Relative timestamp updates ("2m ago") | setInterval polling every 1 second to recalculate timestamps | Existing libraries (e.g., date-fns formatDistanceToNow) or React useEffect with 60-second interval | Edge cases: pluralization, locale support, performance (updating every second causes excessive re-renders) |
| Chat message virtualization | Custom scroll logic with conditional rendering | React Virtuoso or react-window | Complex edge cases: scroll position preservation on new messages, scroll-to-bottom detection, variable message heights |
| Message deduplication | Manual tracking of message IDs in Set | ChatMessage.id from SDK | SDK provides unique IDs; leverage built-in id field for React keys and deduplication |

**Key insight:** IVS Chat Messaging SDK is purpose-built for the IVS Chat Messaging API. The token refresh flow (tokenProvider called on reconnection), WebSocket connection lifecycle (connecting/connected/disconnected states), and event parsing (ChatMessage, DeleteEvent types) have complex edge cases that manual implementation will miss. Always use the official SDK.

## Common Pitfalls

### Pitfall 1: Token Expiry During Long Sessions

**What goes wrong:** Chat token is valid for 1 minute for initial connection, but session can last up to sessionDurationInMinutes (default: 180 minutes). After session expires, ChatRoom disconnects and user cannot send messages.

**Why it happens:** Misconception that 1-minute token validity means 1-minute session. Token is single-use for connection setup; session duration is separate.

**How to avoid:**
1. Set sessionDurationInMinutes in CreateChatToken to match expected session length (60-180 minutes)
2. Ensure tokenProvider function can be called multiple times (SDK refreshes token on reconnection)
3. Monitor 'disconnect' event with reason code; if session expired, prompt user to reconnect or refresh

**Warning signs:** Users report "chat stopped working after 3 minutes" or "cannot send messages after some time"

**Source:** https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_CreateChatToken.html

### Pitfall 2: Reconnection Loop Without Fresh Token

**What goes wrong:** After connection failure, ChatRoom tries to reconnect but tokenProvider returns cached token. Cached token was already used (tokens are single-use), causing authentication failure and disconnect loop.

**Why it happens:** tokenProvider is called on every connection attempt, but implementation caches token from first call.

**How to avoid:**
1. Always fetch fresh token from backend in tokenProvider function (do NOT cache)
2. tokenProvider MUST be async function that calls backend endpoint
3. SDK handles rate limiting internally; don't implement client-side caching

**Warning signs:** "WebSocket connection failed" errors in console, ChatRoom state stuck in 'connecting', rapid connection/disconnection cycles

**Code pattern (CORRECT):**
```typescript
const tokenProvider = async () => {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/token`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const data = await response.json();
  return data.token; // Fresh token every time
};
```

**Code pattern (INCORRECT):**
```typescript
// DO NOT DO THIS - token is cached
let cachedToken: string | null = null;
const tokenProvider = async () => {
  if (!cachedToken) {
    const response = await fetch(...);
    cachedToken = response.token;
  }
  return cachedToken; // WRONG - reuses same token
};
```

**Source:** https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-js-using-sdk.html

### Pitfall 3: Race Condition Between Message Event and Persistence

**What goes wrong:** Message appears in UI immediately via 'message' event listener, but persistence to DynamoDB fails. User sees message, but when they refresh, message is gone (not in history).

**Why it happens:** Message event fires as soon as message is received via WebSocket, but persistence is asynchronous and may fail (network error, Lambda timeout, DynamoDB throttling).

**How to avoid:**
1. Don't block UI on persistence (fire-and-forget pattern acceptable for v1)
2. For critical messages, implement optimistic UI with retry logic: display message immediately, mark as "pending" until persistence confirmed, show retry button on failure
3. Consider using DynamoDB Streams to trigger persistence Lambda asynchronously (decouples persistence from frontend)

**Warning signs:** Users report "messages disappear after refresh" or "missing messages in history"

**Phase 5 impact:** Missing messages in history will cause gaps in replay chat sync. Consider implementing retry logic or DynamoDB Streams pattern before Phase 5.

### Pitfall 4: Missing Broadcaster Role Identification

**What goes wrong:** All users see same messages without visual distinction between broadcaster and viewers. User cannot tell who the session owner is.

**Why it happens:** ChatMessage.sender.attributes are set in CreateChatToken but not read/displayed in frontend.

**How to avoid:**
1. Include 'role' attribute in CreateChatToken attributes: `{ role: session.userId === userId ? 'broadcaster' : 'viewer' }`
2. Read `message.sender.attributes.role` in MessageRow component
3. Display broadcaster badge conditionally: `{message.sender.attributes.role === 'broadcaster' && <BroadcasterBadge />}`

**Warning signs:** User feedback: "can't tell who is streaming" or "all messages look the same"

**Source:** https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_CreateChatToken.html (attributes field)

### Pitfall 5: Auto-Scroll Interrupts Manual Scrolling

**What goes wrong:** User scrolls up to read history, but new messages trigger auto-scroll, jumping user back to bottom mid-read.

**Why it happens:** Message listener always calls scrollToBottom() on new messages, regardless of user's scroll position.

**How to avoid:**
1. Track scroll position with IntersectionObserver or scroll event listener
2. Only auto-scroll if user is already at bottom (e.g., distance from bottom < 100px)
3. Show "New messages" button at bottom when user is scrolled up

**Code pattern:**
```typescript
const [isAtBottom, setIsAtBottom] = React.useState(true);
const messagesEndRef = React.useRef<HTMLDivElement>(null);

React.useEffect(() => {
  if (isAtBottom) {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [messages, isAtBottom]);

const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
  const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  setIsAtBottom(distanceFromBottom < 100);
};
```

**Warning signs:** User feedback: "chat keeps jumping while I'm reading" or "can't read old messages"

## Code Examples

Verified patterns from official sources:

### ChatRoom Connection Lifecycle

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-react-best-practices.html
import { ChatRoom, ConnectionState } from 'amazon-ivs-chat-messaging';

export const useChatRoom = (sessionId: string, authToken: string) => {
  const [connectionState, setConnectionState] = React.useState<ConnectionState>('disconnected');

  const tokenProvider = React.useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat/token`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await response.json();
    return data.token;
  }, [sessionId, authToken]);

  const [room] = React.useState(() => new ChatRoom({
    regionOrUrl: 'us-east-1',
    tokenProvider,
  }));

  React.useEffect(() => {
    const unsubscribeConnecting = room.addListener('connecting', () => {
      setConnectionState('connecting');
    });

    const unsubscribeConnected = room.addListener('connect', () => {
      setConnectionState('connected');
    });

    const unsubscribeDisconnected = room.addListener('disconnect', (reason) => {
      setConnectionState('disconnected');
      console.error('Chat disconnected:', reason);
    });

    room.connect();

    return () => {
      unsubscribeConnecting();
      unsubscribeConnected();
      unsubscribeDisconnected();
      room.disconnect();
    };
  }, [room]);

  return { room, connectionState };
};
```

### Sending Messages

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-js-tutorial-messages-events.html
const handleSendMessage = async (content: string) => {
  try {
    const request = room.sendMessage({
      content: content,
    });

    await request;
    // Message sent successfully
    // Will appear via 'message' event listener
  } catch (error) {
    console.error('Failed to send message:', error);
    // Show error UI
  }
};
```

### Message Display with Relative Timestamps

```typescript
// MessageRow.tsx
import { formatDistanceToNow } from 'date-fns';

interface MessageRowProps {
  message: ChatMessage;
  isFromBroadcaster: boolean;
}

export const MessageRow: React.FC<MessageRowProps> = ({ message, isFromBroadcaster }) => {
  const [relativeTime, setRelativeTime] = React.useState(() =>
    formatDistanceToNow(new Date(message.sendTime), { addSuffix: true })
  );

  // Update relative timestamp every minute
  React.useEffect(() => {
    const interval = setInterval(() => {
      setRelativeTime(formatDistanceToNow(new Date(message.sendTime), { addSuffix: true }));
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [message.sendTime]);

  return (
    <div className="message-row">
      <span className="username">
        {message.sender.attributes.displayName}
        {isFromBroadcaster && <BroadcasterBadge />}
      </span>
      <span className="timestamp">{relativeTime}</span>
      <p className="content">{message.content}</p>
    </div>
  );
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| IVS Chat WebSocket API (direct calls) | IVS Chat Messaging SDK (amazon-ivs-chat-messaging) | 2023 | SDK abstracts token refresh, reconnection, event parsing - production apps should use SDK not direct API |
| S3-only chat logging | S3 logging + DynamoDB persistence for history | N/A | S3 logging is append-only and eventual; DynamoDB enables real-time history queries (last 50 messages) |
| Global chat rooms | Session-specific chat rooms from resource pool | Architecture decision (Phase 2) | Each session gets isolated chat room; prevents cross-session message leakage |

**Deprecated/outdated:**
- Direct WebSocket calls to IVS Chat Messaging API: Use amazon-ivs-chat-messaging SDK instead (handles edge cases)
- Client-side token generation: Security risk; always use server-side CreateChatToken with AWS SDK

## Open Questions

1. **Message Persistence Trigger: Frontend or Lambda?**
   - What we know: Two approaches: (1) Frontend calls REST endpoint to persist message on receipt, (2) DynamoDB Streams Lambda triggered by session table writes
   - What's unclear: Which approach better balances latency, reliability, and complexity?
   - Recommendation: Start with frontend REST endpoint (simpler, synchronous confirmation). If persistence failures become issue in testing, migrate to DynamoDB Streams pattern in Wave 1 revision.

2. **Chat History Load Timing: On Mount or After Connection?**
   - What we know: Need to load last 50 messages when user joins mid-stream
   - What's unclear: Load history before connecting to ChatRoom (optimistic) or after connected state confirmed?
   - Recommendation: Load history in parallel with ChatRoom connection (useEffect with Promise.all). Display loading skeleton until both complete. Merge history with live messages using messageId deduplication.

3. **Broadcaster Badge Precedence: Token Attribute or Session Owner Check?**
   - What we know: Can set role='broadcaster' in token attributes OR check if message.sender.userId === session.userId in frontend
   - What's unclear: Which is more reliable for multi-tab scenarios?
   - Recommendation: Use token attribute (source of truth set server-side). Frontend check is fallback if attribute missing.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 + ts-jest 29.4.6 |
| Config file | backend/jest.config.js |
| Quick run command | `npm test -- --testPathPattern=chat` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAT-01 | Real-time chat available alongside sessions | integration | `npm test -- handlers/__tests__/create-chat-token.test.ts -x` | ❌ Wave 0 |
| CHAT-02 | Messages display sender username | unit | `npm test -- domain/__tests__/chat-message.test.ts -x` | ❌ Wave 0 |
| CHAT-03 | Users see last 50 messages on join | integration | `npm test -- handlers/__tests__/get-chat-history.test.ts -x` | ❌ Wave 0 |
| CHAT-04 | Messages persisted with session-relative timestamps | unit | `npm test -- services/__tests__/chat-service.test.ts -x` | ❌ Wave 0 |
| CHAT-05 | Chat tokens generated server-side only | integration | `npm test -- handlers/__tests__/create-chat-token.test.ts -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=chat --bail` (runs chat-related tests, stops on first failure)
- **Per wave merge:** `npm test` (full backend suite including existing tests)
- **Phase gate:** Full suite green + manual smoke test (send message, see in UI, refresh, see in history)

### Wave 0 Gaps

- [ ] `backend/src/domain/__tests__/chat-message.test.ts` — validates ChatMessage domain model structure, sessionRelativeTime calculation
- [ ] `backend/src/repositories/__tests__/chat-repository.test.ts` — tests message persistence (PutCommand) and history query (QueryCommand with limit)
- [ ] `backend/src/services/__tests__/chat-service.test.ts` — tests chat token generation with correct capabilities and attributes
- [ ] `backend/src/handlers/__tests__/create-chat-token.test.ts` — covers CHAT-01, CHAT-05 (token endpoint integration)
- [ ] `backend/src/handlers/__tests__/send-message.test.ts` — tests message persistence endpoint (if using REST pattern)
- [ ] `backend/src/handlers/__tests__/get-chat-history.test.ts` — covers CHAT-03 (last 50 messages query)

**Frontend testing:** Manual smoke test acceptable for Phase 4 (React Testing Library tests can be added in Phase 5 if time permits). Focus backend test coverage on persistence and token generation.

## Sources

### Primary (HIGH confidence)

- [IVS Chat Client Messaging SDK: React & React Native Best Practices](https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-react-best-practices.html) - ChatRoom initialization, context providers, performance patterns
- [CreateChatToken API Reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_CreateChatToken.html) - Token generation, capabilities, session duration, attributes
- [IVS Chat Client Messaging SDK: JavaScript Tutorial](https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-sdk-js-tutorial-chat-rooms.html) - Connection lifecycle, event listeners, sending messages
- [amazon-ivs-chat-messaging npm package](https://www.npmjs.com/package/amazon-ivs-chat-messaging) - Latest version (1.1.1), installation, exports
- [IVS Chat Client Messaging SDK: JavaScript Guide](https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/chat-js-using-sdk.html) - WebSocket reconnection, token refresh, disconnect reasons

### Secondary (MEDIUM confidence)

- [AWS DynamoDB data models for generative AI chatbots](https://aws.amazon.com/blogs/database/amazon-dynamodb-data-models-for-generative-ai-chatbots/) - Chat message schema patterns, timestamp handling, session organization
- [Build a React Native Chat App on AWS (Part 2 — DynamoDB)](https://medium.com/@budilov/build-a-react-native-chat-app-on-aws-part-2-dynamodb-5ea1b965bb05) - Message storage patterns with session IDs
- [How-To Work With Timestamps in DynamoDB](https://dynobase.dev/dynamodb-timestamp/) - Number vs String types, ISO 8601 formatting

### Tertiary (LOW confidence)

- [GitHub: amazon-ivs-chat-web-demo](https://github.com/aws-samples/amazon-ivs-chat-web-demo) - Sample implementation (not verified, may use outdated SDK version)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official AWS SDK for IVS Chat, confirmed npm packages, documented React patterns
- Architecture: HIGH - Official AWS best practices documentation, verified with real SDK code examples
- Pitfalls: MEDIUM - Combination of official docs (token expiry, reconnection) and inferred issues (race conditions, scroll behavior)

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days for stable AWS SDKs)
