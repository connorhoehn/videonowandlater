# Phase 28: Chat Moderation - Research

**Researched:** 2026-03-10
**Domain:** IVS Chat moderation, DynamoDB single-table, React hover UI
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Bounce trigger location**
- Bounce button is inline on each message row, visible only to the broadcaster (when `authUser.userId === session.userId`)
- Shown as a small "x" or "Kick" button that appears on hover over the message row
- `MessageRow.tsx` receives two new boolean props: `isBroadcasterViewing` (shows bounce) and `isOwnMessage` (hides report)
- `currentUserId` must be threaded from `ChatPanel` → `MessageList` → `MessageRow`

**Report UX flow**
- Report button appears on hover on all non-own messages — a small flag/report icon
- Single-tap report: no reason categories
- After reporting: private toast confirmation ("Message reported") — reported message stays visible, no public label
- Toast is non-blocking, auto-dismisses after 3 seconds

**Bounced user experience**
- When a bounced user's chat token is denied (403 from `create-chat-token.ts`), the chat room shows an error state ("You have been removed from this chat")
- Bounce is per-session-only — bounce record is keyed to the sessionId in the moderation log
- Broadcaster gets no special visual confirmation beyond the user's messages disappearing

**Moderation log schema**
- DynamoDB single table, existing pattern: `PK: SESSION#{sessionId}`, `SK: MOD#{timestamp}#{uuid}`
- Bounce record fields: `actionType: 'BOUNCE'`, `userId` (bounced), `actorId` (broadcaster who bounced)
- Report record fields: `actionType: 'REPORT'`, `msgId`, `reporterId`, `reportedUserId`
- `create-chat-token.ts` queries `SK` prefix `MOD#` and denies token if any `BOUNCE` record exists for that `userId` in that session

**Cross-room availability**
- Report button (MOD-08): available in ALL chat rooms — broadcast chat and hangout chat
- Bounce (MOD-01): only in broadcast sessions — hidden in hangout context
- Determining hangout vs broadcast: use existing `sessionOwnerId` prop — if `currentUserId === sessionOwnerId`, broadcast controls appear

**Backend endpoints**
- New handler: `bounce-user.ts` → `POST /sessions/{sessionId}/bounce` with body `{ userId }`
  - Calls IVS Chat `DisconnectUser`
  - Writes BOUNCE record to moderation log
  - Auth check: only session owner can bounce
- New handler: `report-message.ts` → `POST /sessions/{sessionId}/report` with body `{ msgId, reportedUserId }`
  - Writes REPORT record to moderation log
  - Any authenticated user can report

### Claude's Discretion
- Exact hover animation/transition style on bounce/report buttons
- Toast component implementation (inline or reuse any existing toast pattern)
- Error boundary behavior if bounce API call fails (optimistic UI or pessimistic)
- TypeScript interface shapes for request/response payloads

### Deferred Ideas (OUT OF SCOPE)
- Admin view to review moderation log across sessions — MOD-F01
- Automatic content moderation via IVS Chat Lambda — MOD-F02
- Persistent cross-session user block — MOD-F03
- Broadcaster can delete a specific chat message — MOD-F04
- Moderation reason categories on report — deferred to future
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MOD-01 | Broadcaster can bounce (kick) a user from their active stream via a button visible only to the broadcaster | `isBroadcasterViewing` prop on `MessageRow`; gated by `currentUserId === sessionOwnerId` |
| MOD-02 | Bouncing a user calls IVS Chat `DisconnectUser` to immediately terminate their WebSocket connection | `DisconnectUserCommand` confirmed in `@aws-sdk/client-ivschat@^3.1000.0`; takes `roomIdentifier` + `userId` + optional `reason` |
| MOD-03 | A bounce event is written to a DynamoDB moderation log with `userId`, `actionType`, `actorId` | PutCommand pattern; `PK: SESSION#{id}`, `SK: MOD#{timestamp}#{uuid}`; follows existing single-table design |
| MOD-04 | `create-chat-token.ts` checks the moderation log before issuing a new token — bounced users denied 403 | QueryCommand with `begins_with(SK, 'MOD#')` + FilterExpression on `actionType = 'BOUNCE'` and `userId`; existing pattern confirmed in `getHangoutParticipants` |
| MOD-05 | Any user can report a chat message via an inline quick-action on other users' messages | `isOwnMessage` prop on `MessageRow`; hover-revealed report button |
| MOD-06 | Clicking report fires a backend request and shows a private toast — reported message remains visible | `fetch` call to `POST /sessions/{id}/report`; inline toast state in `ChatPanel` |
| MOD-07 | A report event is written to the moderation log with `msgId`, `actionType: 'report'`, `reporterId`, `reportedUserId` | Same PutCommand pattern as MOD-03 |
| MOD-08 | Moderation quick-action (report button) is available in all chat rooms (broadcast, hangout) | `ChatPanel` is shared between `BroadcastPage` and `HangoutPage`; adding `currentUserId` prop threads to both |
</phase_requirements>

---

## Summary

Phase 28 adds two moderation capabilities to the existing IVS Chat integration: a broadcaster-only bounce (kick) action and a per-user report action available to all participants. The backend consists of two new Lambda handlers (`bounce-user.ts` and `report-message.ts`), a modification to `create-chat-token.ts` to enforce a per-session blocklist, and two new API Gateway routes. The frontend changes are contained entirely within the chat feature (`MessageRow.tsx`, `MessageList.tsx`, `ChatPanel.tsx`) by threading a `currentUserId` prop down the component tree.

The critical correctness constraint is that `DisconnectUser` alone does not prevent a bounced user from rejoining. The IVS Chat WebSocket is terminated immediately, but the user can request a new token and reconnect unless `create-chat-token.ts` rejects them. The moderation log in DynamoDB bridges this gap: a BOUNCE record written at bounce time is checked every time any user requests a chat token for that session.

All infrastructure already in place — the `IvschatClient` singleton, the `@aws-sdk/client-ivschat` SDK at v3.1000.0, the single-table DynamoDB, and the API Gateway + CDK patterns — means this phase is purely additive with no new dependencies.

**Primary recommendation:** Implement in two plans: (1) backend — two new handlers + `create-chat-token.ts` modification + CDK wiring; (2) frontend — `MessageRow`/`MessageList`/`ChatPanel` changes + inline toast + error state for bounced users.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-ivschat` | ^3.1000.0 (installed) | `DisconnectUserCommand` to terminate user WebSocket | Project already uses this SDK for `CreateChatTokenCommand`; `getIVSChatClient()` singleton in `ivs-clients.ts` |
| `@aws-sdk/lib-dynamodb` | ^3.1000.0 (installed) | `PutCommand`, `QueryCommand` for moderation log | All other repositories use this; `getDocumentClient()` available |
| `uuid` | ^10.0.0 (installed) | Generate unique SK suffix for moderation records | Already a dependency in `session-repository.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| React inline state (`useState`) | (React 18, installed) | Toast visibility timer | Simple inline approach sufficient; no external toast library needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline toast via `useState` | Third-party toast lib (react-hot-toast, sonner) | No new dependency justified for one toast; inline is simpler and keeps the codebase clean |
| SK prefix query for blocklist | Additional GSI | SK prefix query on the existing PK is efficient (single partition) and follows established patterns (`getHangoutParticipants`); no new GSI needed |

**Installation:** No new packages required — all dependencies already installed.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:
```
backend/src/handlers/bounce-user.ts
backend/src/handlers/report-message.ts
backend/src/handlers/__tests__/bounce-user.test.ts
backend/src/handlers/__tests__/report-message.test.ts
```

Modified files:
```
backend/src/handlers/create-chat-token.ts          — add blocklist check
backend/src/services/chat-service.ts               — add moderation repository calls or inline logic
infra/lib/stacks/api-stack.ts                      — add two new POST routes
web/src/features/chat/MessageRow.tsx               — add bounce/report buttons
web/src/features/chat/MessageList.tsx              — thread currentUserId
web/src/features/chat/ChatPanel.tsx                — thread currentUserId, wire API calls, toast state
web/src/features/broadcast/BroadcastPage.tsx       — pass currentUserId to ChatPanel
web/src/features/hangout/HangoutPage.tsx           — pass currentUserId to ChatPanel
```

### Pattern 1: Handler Structure (matches `update-spotlight.ts`)

All new handlers follow the established pattern:
```typescript
// Source: infra/lib/stacks/api-stack.ts + update-spotlight.ts
const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};
function resp(statusCode: number, body: object): APIGatewayProxyResult {
  return { statusCode, headers: CORS, body: JSON.stringify(body) };
}
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) return resp(500, { error: 'TABLE_NAME not set' });
  const sessionId = event.pathParameters?.sessionId;
  if (!sessionId) return resp(400, { error: 'sessionId is required' });
  const actorId = event.requestContext?.authorizer?.claims?.['cognito:username'];
  if (!actorId) return resp(401, { error: 'Unauthorized' });
  // ... business logic
}
```

### Pattern 2: DisconnectUserCommand (from SDK type definitions)

```typescript
// Source: @aws-sdk/client-ivschat/dist-types/commands/DisconnectUserCommand.d.ts
import { IvschatClient, DisconnectUserCommand } from "@aws-sdk/client-ivschat";

const client = getIVSChatClient(); // existing singleton
const command = new DisconnectUserCommand({
  roomIdentifier: session.claimedResources.chatRoom, // room ARN from session record
  userId: targetUserId,                              // cognito:username of user being bounced
  reason: "Removed by broadcaster",                 // optional string
});
await client.send(command);
// Response is empty {}; throws AccessDeniedException, ResourceNotFoundException, etc.
```

### Pattern 3: Moderation Log PutCommand

```typescript
// Source: chat-repository.ts, session-repository.ts — same single-table pattern
import { v4 as uuidv4 } from 'uuid';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

// BOUNCE record
await docClient.send(new PutCommand({
  TableName: tableName,
  Item: {
    PK: `SESSION#${sessionId}`,
    SK: `MOD#${new Date().toISOString()}#${uuidv4()}`,
    entityType: 'MODERATION',
    actionType: 'BOUNCE',
    userId: targetUserId,      // who was bounced
    actorId: actorId,          // broadcaster who bounced
    sessionId,
    createdAt: new Date().toISOString(),
  },
}));

// REPORT record
await docClient.send(new PutCommand({
  TableName: tableName,
  Item: {
    PK: `SESSION#${sessionId}`,
    SK: `MOD#${new Date().toISOString()}#${uuidv4()}`,
    entityType: 'MODERATION',
    actionType: 'REPORT',
    msgId,
    reporterId: actorId,
    reportedUserId,
    sessionId,
    createdAt: new Date().toISOString(),
  },
}));
```

### Pattern 4: Blocklist Check in create-chat-token.ts

```typescript
// Source: session-repository.ts getHangoutParticipants — exact SK-prefix query pattern
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

async function isBounced(tableName: string, sessionId: string, userId: string): Promise<boolean> {
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    FilterExpression: 'actionType = :actionType AND #userId = :userId',
    ExpressionAttributeNames: { '#userId': 'userId' },
    ExpressionAttributeValues: {
      ':pk': `SESSION#${sessionId}`,
      ':skPrefix': 'MOD#',
      ':actionType': 'BOUNCE',
      ':userId': userId,
    },
    Limit: 1,
  }));
  return (result.Count ?? 0) > 0;
}
```

If `isBounced` returns true, return 403 with `{ error: 'You have been removed from this chat' }`.

### Pattern 5: CDK Route Wiring

```typescript
// Source: api-stack.ts — matches all existing POST sub-resource routes
const bounceResource = sessionIdResource.addResource('bounce');
const bounceUserHandler = new NodejsFunction(this, 'BounceUserHandler', {
  entry: path.join(__dirname, '../../../backend/src/handlers/bounce-user.ts'),
  handler: 'handler',
  runtime: Runtime.NODEJS_20_X,
  environment: { TABLE_NAME: props.sessionsTable.tableName },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});
props.sessionsTable.grantReadWriteData(bounceUserHandler);
bounceUserHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ivschat:DisconnectUser'],
  resources: ['arn:aws:ivschat:*:*:room/*'],
}));
bounceResource.addMethod('POST', new apigateway.LambdaIntegration(bounceUserHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});

const reportResource = sessionIdResource.addResource('report');
const reportMessageHandler = new NodejsFunction(this, 'ReportMessageHandler', {
  entry: path.join(__dirname, '../../../backend/src/handlers/report-message.ts'),
  handler: 'handler',
  runtime: Runtime.NODEJS_20_X,
  environment: { TABLE_NAME: props.sessionsTable.tableName },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});
props.sessionsTable.grantReadWriteData(reportMessageHandler);
reportResource.addMethod('POST', new apigateway.LambdaIntegration(reportMessageHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

Note: `create-chat-token.ts` Lambda already has `grantReadData` — this must be upgraded to `grantReadWriteData` (or at minimum read is sufficient since moderation log check is a read). Actually, blocklist check is reads only, so `grantReadData` on `create-chat-token.ts` is already sufficient.

### Pattern 6: Frontend — Hover Button in MessageRow

```tsx
// New props added to MessageRow
interface MessageRowProps {
  message: ChatMessage;
  isBroadcaster: boolean;      // existing — shows "Broadcaster" badge
  isBroadcasterViewing: boolean; // NEW — shows bounce button
  isOwnMessage: boolean;         // NEW — hides report button when true
  onBounce?: (userId: string) => void;  // NEW
  onReport?: (msgId: string, reportedUserId: string) => void; // NEW
}

// Hover state — simplest approach using Tailwind group
<div className="mb-2 group relative">
  {/* message content (unchanged) */}
  {/* Hover action buttons */}
  <div className="absolute right-0 top-0 hidden group-hover:flex gap-1">
    {isBroadcasterViewing && !isOwnMessage && (
      <button onClick={() => onBounce?.(message.sender?.userId!)}
        className="text-xs text-red-500 hover:text-red-700 px-1">
        Kick
      </button>
    )}
    {!isOwnMessage && (
      <button onClick={() => onReport?.(message.id, message.sender?.userId!)}
        className="text-xs text-gray-400 hover:text-gray-600 px-1">
        Report
      </button>
    )}
  </div>
</div>
```

Tailwind `group` / `group-hover:flex` pattern: no JavaScript state needed for hover — pure CSS.

### Anti-Patterns to Avoid

- **Relying solely on DisconnectUser for enforcement:** `DisconnectUser` terminates the current WebSocket. Without the DynamoDB blocklist check in `create-chat-token.ts`, the user can reconnect immediately.
- **Storing moderation records inline on the session item:** Do not add a `bouncedUsers` array to the session METADATA item. Use separate `MOD#` SK records to avoid item size growth and race conditions.
- **Using a GSI for the blocklist query:** The `PK = SESSION#{id}` + `begins_with(SK, 'MOD#')` query runs within a single partition — no GSI needed, and no RCU waste from a scan.
- **Querying all MOD records to find BOUNCE for one user:** Add `FilterExpression` for `actionType = 'BOUNCE' AND userId = :userId` with `Limit: 1` to short-circuit after the first hit.
- **Removing messages from ChatMessagesProvider state on bounce:** Do not touch the local message list. IVS Chat's server-side disconnect handles the live side; the local history is read-only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket disconnect of a specific user | Custom WebSocket close frame or SNS/Lambda to push a signal | `DisconnectUserCommand` from `@aws-sdk/client-ivschat` | IVS Chat server-side disconnect handles all active connections for that userId in the room |
| Toast notification system | Custom portal/overlay component with animation | Inline `useState` + Tailwind CSS opacity/translate transition | For a single use case in chat, a full toast library is unnecessary overhead |
| Hover-reveal action buttons | Custom `onMouseEnter/onMouseLeave` event handlers | Tailwind `group` + `group-hover:flex` CSS classes | Zero JS, handles edge cases like rapid mouse movement, already in use elsewhere in the project |

---

## Common Pitfalls

### Pitfall 1: Bounce Without Blocklist
**What goes wrong:** Bounced user reconnects to the chat room 1–2 seconds after being disconnected. Broadcaster has no way to stop them without bouncing again repeatedly.
**Why it happens:** `DisconnectUser` terminates current WebSocket sessions only. The room issues new tokens on demand to any authenticated user.
**How to avoid:** The blocklist check in `create-chat-token.ts` is mandatory. Implement it as the first operation after extracting `userId` and `sessionId`.
**Warning signs:** Manual test — bounce a user, then immediately refresh their browser. If they rejoin, the blocklist is not implemented.

### Pitfall 2: FilterExpression vs KeyConditionExpression Confusion
**What goes wrong:** Using `FilterExpression` to check `actionType = 'BOUNCE'` alone, without a proper `KeyConditionExpression`. This causes a full table scan or full partition scan.
**Why it happens:** DynamoDB only uses `KeyConditionExpression` for the index lookup; `FilterExpression` is post-scan. Without `Limit: 1`, every MOD record in the session is fetched.
**How to avoid:** Always use `KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)'` as the primary query, then `FilterExpression` with `Limit: 1` to stop after the first matching record.
**Warning signs:** CloudWatch showing high RCU on the `create-chat-token` Lambda.

### Pitfall 3: `userId` Consistency in DisconnectUser
**What goes wrong:** Passing the wrong userId to `DisconnectUserCommand` — e.g., a Cognito `sub` instead of `cognito:username`.
**Why it happens:** IVS Chat's `userId` in the token was set to `cognito:username` when `CreateChatTokenCommand` was called (see `chat-service.ts` line `userId: request.userId`). The `DisconnectUser` call must use the same identifier.
**How to avoid:** The bounce request body `{ userId }` from the frontend must come from `message.sender?.userId` (the IVS Chat userId field on the message), which is already `cognito:username`. On the backend, use this value directly for both `DisconnectUserCommand.userId` and the `BOUNCE` record's `userId` field.
**Warning signs:** `DisconnectUser` call succeeds (200) but user is not actually disconnected — wrong userId matched no active sessions.

### Pitfall 4: IAM Permission Gap for ivschat:DisconnectUser
**What goes wrong:** `bounce-user.ts` Lambda throws `AccessDeniedException` when calling `DisconnectUserCommand`.
**Why it happens:** The `create-chat-token.ts` Lambda has `ivschat:CreateChatToken` — but `DisconnectUser` is a separate IAM action not granted to any existing Lambda.
**How to avoid:** Add explicit IAM policy `ivschat:DisconnectUser` on `arn:aws:ivschat:*:*:room/*` to `bounceUserHandler` in CDK. See Pattern 5 above.
**Warning signs:** 500 response from `POST /sessions/{id}/bounce` with `AccessDeniedException` in CloudWatch.

### Pitfall 5: Frontend `currentUserId` Race Condition
**What goes wrong:** `currentUserId` is empty string on first render (before `fetchAuthSession` resolves), causing the bounce button to flash briefly as visible even on own messages.
**Why it happens:** `BroadcastPage` and `HangoutPage` fetch auth asynchronously. `ChatPanel` renders before `userId` state is populated.
**How to avoid:** Guard the `isBroadcasterViewing` and `isOwnMessage` derivations: `isBroadcasterViewing = !!currentUserId && currentUserId === sessionOwnerId`. Empty string evaluates to falsy, so buttons are hidden until auth resolves.
**Warning signs:** Flash of bounce button visible briefly for own messages on page load.

### Pitfall 6: `create-chat-token.ts` Now Needs `grantReadWriteData`
**What goes wrong:** The blocklist query fails with `AccessDeniedException` in DynamoDB.
**Why it happens:** `create-chat-token.ts` Lambda currently has `grantReadData` only (see api-stack.ts line 229). Adding a new PutCommand would require write access, but the blocklist check is a Query (read only).
**How to avoid:** The blocklist check is a `QueryCommand` (read), so existing `grantReadData` is sufficient. No CDK change needed for `createChatTokenHandler`. This is confirmed — do NOT upgrade to `grantReadWriteData` for this Lambda.

---

## Code Examples

### bounce-user.ts skeleton
```typescript
// bounce-user.ts — POST /sessions/{sessionId}/bounce
import { DisconnectUserCommand } from '@aws-sdk/client-ivschat';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getIVSChatClient } from '../lib/ivs-clients';
import { getDocumentClient } from '../lib/dynamodb-client';
import { getSessionById } from '../repositories/session-repository';

// 1. Auth: actorId = cognito:username
// 2. Parse body: { userId: targetUserId }
// 3. getSessionById — check session exists, check actorId === session.userId (403 if not)
// 4. DisconnectUserCommand: roomIdentifier = session.claimedResources.chatRoom, userId = targetUserId
// 5. PutCommand: PK=SESSION#{sessionId}, SK=MOD#{iso}#{uuid}, actionType=BOUNCE, userId, actorId
// 6. Return 200 { message: 'User bounced' }
```

### report-message.ts skeleton
```typescript
// report-message.ts — POST /sessions/{sessionId}/report
// 1. Auth: reporterId = cognito:username
// 2. Parse body: { msgId, reportedUserId }
// 3. Validate body fields present
// 4. PutCommand: PK=SESSION#{sessionId}, SK=MOD#{iso}#{uuid}, actionType=REPORT, msgId, reporterId, reportedUserId
// 5. Return 200 { message: 'Message reported' }
// No session ownership check — any authenticated user can report
```

### create-chat-token.ts blocklist addition
```typescript
// After extracting userId and sessionId, before calling generateChatToken:
const bounced = await isBounced(tableName, sessionId, userId);
if (bounced) {
  return {
    statusCode: 403,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'You have been removed from this chat' }),
  };
}
```

### Frontend toast pattern (inline, no library)
```tsx
// In ChatPanel — inline toast state
const [toast, setToast] = React.useState<string | null>(null);
const showToast = (msg: string) => {
  setToast(msg);
  setTimeout(() => setToast(null), 3000);
};

// In ChatPanelContent JSX:
{toast && (
  <div className="absolute bottom-16 left-4 right-4 bg-gray-800 text-white text-sm px-3 py-2 rounded shadow-lg text-center">
    {toast}
  </div>
)}
```

### ChatPanel API call pattern
```typescript
// Matches auth header pattern from CLAUDE.md / project patterns
const handleBounce = async (targetUserId: string) => {
  if (!authToken) return;
  await fetch(`${apiBaseUrl}/sessions/${sessionId}/bounce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ userId: targetUserId }),
  });
  // No optimistic state change — IVS Chat handles the disconnect server-side
};

const handleReport = async (msgId: string, reportedUserId: string) => {
  if (!authToken) return;
  await fetch(`${apiBaseUrl}/sessions/${sessionId}/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ msgId, reportedUserId }),
  });
  showToast('Message reported');
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DisconnectUser only | DisconnectUser + DynamoDB blocklist | Phase 28 (new) | Prevents immediate reconnect |
| `isBroadcaster` prop for badge only | `isBroadcasterViewing` + `isOwnMessage` for action visibility | Phase 28 (new) | Separates "is sender a broadcaster" from "is viewer a broadcaster" |

**Note on IVS Chat SDK:** The `DisconnectUserCommand` exists on the service-side SDK (`@aws-sdk/client-ivschat`). The client-side library (`amazon-ivs-chat-messaging`) also exposes `DisconnectUserRequest` — but that is for broadcasters to call via the WebSocket connection from the browser. The correct approach here is the service-side Lambda call via `@aws-sdk/client-ivschat`, which does not require an active WebSocket connection and runs with IAM credentials.

---

## Open Questions

1. **Error handling if DisconnectUser fails (ResourceNotFoundException)**
   - What we know: If the user is not currently connected (already left), `DisconnectUserCommand` throws `ResourceNotFoundException`.
   - What's unclear: Should the bounce be recorded in the moderation log even if the user is not currently connected?
   - Recommendation: Yes — still write the BOUNCE record even if `DisconnectUser` throws `ResourceNotFoundException`. The record is the authoritative blocklist entry; the disconnect is best-effort. Catch `ResourceNotFoundException` and continue to the PutCommand.

2. **Bounce button in useChatRoom disconnect listener**
   - What we know: The current `useChatRoom.ts` already listens for `disconnect` events from the server and sets `connectionState = 'disconnected'`. When the broadcaster calls `DisconnectUser`, IVS Chat will fire this event on the bounced user's connection.
   - What's unclear: Is the current `disconnect` handler sufficient to show the error state, or does the frontend need to distinguish a "kicked" disconnect from a normal one?
   - Recommendation: The `disconnect` event's `reason` field should contain the reason string passed to `DisconnectUser` ("Removed by broadcaster"). The current handler already sets `setError(event.reason)`. This is likely sufficient — but verify that `ChatPanel` actually renders the `error` state visibly. If not, a small addition to `ChatPanelContent` is needed.

---

## Sources

### Primary (HIGH confidence)
- `@aws-sdk/client-ivschat/dist-types/commands/DisconnectUserCommand.d.ts` — confirmed `DisconnectUserCommand` input shape, IAM actions, error types
- `backend/src/services/chat-service.ts` — confirmed `IvschatClient` singleton usage and `CreateChatTokenCommand` pattern
- `backend/src/repositories/session-repository.ts` — confirmed `begins_with(SK, :skPrefix)` QueryCommand pattern
- `infra/lib/stacks/api-stack.ts` — confirmed CDK route pattern, existing `ivschat:CreateChatToken` IAM grant
- `web/src/features/chat/MessageRow.tsx`, `MessageList.tsx`, `ChatPanel.tsx` — confirmed current prop shapes and component hierarchy

### Secondary (MEDIUM confidence)
- `amazon-ivs-chat-messaging` type definitions — confirmed that `DisconnectUserEvent` exists on the client-side SDK, indicating the client does receive a disconnect notification with reason
- `backend/src/handlers/update-spotlight.ts` — confirmed handler response pattern and ownership check approach

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies confirmed installed at correct versions
- Architecture: HIGH — all patterns confirmed from existing codebase; no speculative patterns
- Pitfalls: HIGH — identified from actual code review of current implementation gaps
- DisconnectUser API: HIGH — confirmed from installed SDK type definitions

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable AWS SDK; IVS Chat API unlikely to change)
