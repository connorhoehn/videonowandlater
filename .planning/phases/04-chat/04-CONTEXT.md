# Phase 4: Chat - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time text messaging alongside live sessions (broadcasts and hangouts). Users can send and receive messages in real-time, see recent history when joining mid-stream, and all messages are persisted with session-relative timestamps for Phase 5's replay synchronization. Token generation happens server-side. Creating/editing/deleting messages, reactions to messages, and advanced moderation features are separate concerns.

</domain>

<decisions>
## Implementation Decisions

### Chat Panel Layout & Positioning
- **Desktop/tablet:** Right side panel, fixed at ~25-30% screen width
- **Mobile:** Toggleable overlay that slides over video (hide/show via icon)
- **Resizing:** Fixed width with hide/show toggle (no draggable resize)
- Video remains on left, chat on right (standard streaming platform pattern)

### Message Display & Metadata
- **Per message:** Username (required), relative timestamp ("2m ago"), broadcaster badge
- **No avatars** in initial implementation
- **Role badges:** Broadcaster only (simple badge/icon for session owner)
- **Visual style:** Compact density - minimal spacing, more messages visible, username + timestamp on same line

### History & Empty States
- **History on join:** Last 50 messages (enough context, fast to load, ~5-15 min of chat)
- **Empty state:** Friendly prompt - "Be the first to say hi!" or similar encouraging message
- **Scroll behavior:** Auto-scroll to bottom when new messages arrive, BUT only if user is already at bottom (don't interrupt if scrolled up reading history)
- **Loading state:** Skeleton messages (animated placeholders showing expected layout)

### Claude's Discretion
- Input field design and send interaction (text input, button vs Enter key behavior, character limits)
- Exact timestamp update frequency for "relative time"
- Broadcaster badge visual design (icon, color, placement)
- Scroll-to-bottom button styling and placement
- Error state handling (connection lost, failed to send)
- Message grouping/threading logic if any

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **IVS Chat Rooms:** Already provisioned in resource pool (Phase 2, ResourceType.ROOM)
- **IVS Chat SDK:** Backend has `@aws-sdk/client-ivschat` installed and ready
- **Custom hooks pattern:** `useBroadcast`, `usePlayer` in features/ - can create `useChat` hook
- **Feature pages:** BroadcastPage, ViewerPage structure - chat panel integrates into these
- **Tailwind CSS:** All styling uses Tailwind utility classes

### Established Patterns
- **Frontend:** Feature-based folders (`web/src/features/`), React functional components, custom hooks for state/effects
- **Backend:** Handler → Service → Repository → DynamoDB pattern
- **Domain models:** Defined in `backend/src/domain/` with TypeScript interfaces
- **API calls:** Frontend uses fetch with API_BASE_URL from env vars
- **Auth:** JWT tokens stored in localStorage, passed as authToken to hooks

### Integration Points
- **Resource claiming:** Sessions already claim ROOM resources from pool
- **Frontend pages:** Chat panel needs to be added to BroadcastPage and ViewerPage (conditionally rendered)
- **Backend handlers:** Need chat token generation endpoint and message persistence endpoint
- **DynamoDB:** New chat messages table with sessionId + timestamp as composite key for replay sync
- **Session lifecycle:** Chat initialization on session creation, cleanup on session end

</code_context>

<specifics>
## Specific Ideas

- Keep chat visually consistent with existing minimal, clean UI (similar to BroadcastPage/ViewerPage styling)
- Relative timestamps should feel "live" (update as time passes, not static)
- Broadcaster badge should be subtle but clear authority signal
- Empty state should match the encouraging, friendly tone of a live streaming platform

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 04-chat*
*Context gathered: 2026-03-02*
