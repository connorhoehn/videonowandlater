# Phase 28: Chat Moderation - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Broadcaster bounce/kick + per-message report action for all chat users. Bouncing calls IVS Chat `DisconnectUser` AND blocks the token in `create-chat-token.ts`. Reporting fires a backend request and logs it — no public label on the message. All moderation actions are recorded in a DynamoDB moderation log. Available in both broadcast and hangout chat rooms.

Out of scope: admin dashboard to review logs across sessions, automatic content moderation, persistent cross-session user blocks, message deletion.

</domain>

<decisions>
## Implementation Decisions

### Bounce trigger location
- Bounce button is **inline on each message row**, visible only to the broadcaster (when `authUser.userId === session.userId`)
- Shown as a small "✕" or "Kick" button that appears on **hover** over the message row — not always-visible, to avoid cluttering the chat
- `MessageRow.tsx` receives two new boolean props: `isBroadcasterViewing` (shows bounce) and `isOwnMessage` (hides report)
- `currentUserId` must be threaded from `ChatPanel` → `MessageList` → `MessageRow`

### Report UX flow
- Report button appears on **hover** on all non-own messages — a small flag/report icon
- Single-tap report: no reason categories (keeps it simple for v1)
- After reporting: private toast confirmation ("Message reported") — reported message stays visible, no public label
- Toast is non-blocking, auto-dismisses after 3 seconds

### Bounced user experience
- When a bounced user's chat token is denied (403 from `create-chat-token.ts`), the chat room shows an error state ("You have been removed from this chat")
- Bounce is **per-session-only** (not persistent across sessions) — bounce record is keyed to the sessionId in the moderation log
- Broadcaster gets no special visual confirmation beyond the user's messages disappearing from the live stream (IVS Chat handles the disconnect)

### Moderation log schema
- DynamoDB single table, existing pattern: `PK: SESSION#{sessionId}`, `SK: MOD#{timestamp}#{uuid}`
- Bounce record fields: `actionType: 'BOUNCE'`, `userId` (bounced), `actorId` (broadcaster who bounced)
- Report record fields: `actionType: 'REPORT'`, `msgId`, `reporterId`, `reportedUserId`
- `create-chat-token.ts` queries `SK` prefix `MOD#` and denies token if any `BOUNCE` record exists for that `userId` in that session

### Cross-room availability
- Report button (MOD-08): available in ALL chat rooms — broadcast chat and hangout chat
- Bounce (MOD-01): only meaningful in broadcast sessions where a single broadcaster owns the room; hangout sessions have no "owner" with kick authority — bounce UI hidden in hangout context
- Determining hangout vs broadcast: use existing `sessionOwnerId` prop — if `currentUserId === sessionOwnerId`, broadcast controls appear; if session has no clear owner (hangout), bounce is hidden

### Backend endpoints
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

</decisions>

<specifics>
## Specific Ideas

- Architecture note from STATE.md: `DisconnectUser` API call alone is insufficient — must also block token in `create-chat-token.ts`. Both steps are mandatory.
- Token blocklist check: query `MOD#` SK prefix, deny if BOUNCE record exists for that userId in that session
- IVS Chat `DisconnectUser` API takes a `roomIdentifier` and `userId` — the room ARN is on the session record

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `MessageRow.tsx` — per-message UI, currently has `isBroadcaster` + `message` props. Add `isBroadcasterViewing` + `isOwnMessage` + `onBounce` + `onReport` callback props
- `MessageList.tsx` — maps messages to `MessageRow`, compares `message.sender?.userId === sessionOwnerId` for `isBroadcaster`. Thread `currentUserId` down here
- `ChatPanel.tsx` — has `sessionId`, `sessionOwnerId`, `authToken`. Add `currentUserId` prop and wire bounce/report API calls here
- `ChatMessagesProvider.tsx` — manages messages state; bounce does NOT remove messages from state (IVS Chat handles disconnect server-side)

### Established Patterns
- Auth header pattern: `Authorization: Bearer ${authToken}` on all fetch calls
- `cognito:username` (not `sub`) as userId consistently — bounce target must use `message.sender?.userId`
- DynamoDB single table with SK prefix queries for related records (established in recording-ended, scan-stuck-sessions)
- CDK route wiring: `sessionResource.addMethod('POST', ...)` pattern in `session-stack.ts`

### Integration Points
- `backend/src/handlers/create-chat-token.ts` — add blocklist check here (read BOUNCE records from DynamoDB before issuing token)
- `infra/lib/stacks/session-stack.ts` — add two new POST routes: `/sessions/{id}/bounce` and `/sessions/{id}/report`
- `web/src/features/broadcast/BroadcastPage.tsx` — passes `sessionOwnerId` to `ChatPanel`; add `currentUserId` prop
- `web/src/features/hangout/HangoutPage.tsx` — also uses `ChatPanel`; pass `currentUserId`, bounce hidden (no session owner)

</code_context>

<deferred>
## Deferred Ideas

- Admin view to review moderation log across sessions — MOD-F01 (explicitly out of scope for v1.5)
- Automatic content moderation via IVS Chat Lambda — MOD-F02 (deferred to v2)
- Persistent cross-session user block — MOD-F03 (deferred, much larger feature)
- Broadcaster can delete a specific chat message — MOD-F04 (deferred)
- Moderation reason categories on report — keep simple for v1, add categories later if moderation volume warrants it

</deferred>

---

*Phase: 28-chat-moderation*
*Context gathered: 2026-03-10*
