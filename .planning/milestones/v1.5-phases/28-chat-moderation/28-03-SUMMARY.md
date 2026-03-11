---
phase: 28-chat-moderation
plan: "03"
subsystem: frontend/chat
tags: [chat, moderation, bounce, ux, gap-closure]
dependency_graph:
  requires: ["28-01", "28-02"]
  provides: ["bounced-user-error-display"]
  affects: ["web/src/features/chat/ChatPanel.tsx", "web/src/features/broadcast/BroadcastPage.tsx", "web/src/features/hangout/HangoutPage.tsx"]
tech_stack:
  added: []
  patterns: ["prop threading", "error banner"]
key_files:
  created: []
  modified:
    - web/src/features/chat/ChatPanel.tsx
    - web/src/features/broadcast/BroadcastPage.tsx
    - web/src/features/hangout/HangoutPage.tsx
decisions:
  - "Render error banner inline in ChatPanelContent (above messages, below header) so it is always visible regardless of chat scroll position"
  - "chatError passed as optional prop (string | null) — no banner rendered when null, fully backward compatible"
metrics:
  duration_minutes: 10
  completed_date: "2026-03-10"
  tasks_completed: 2
  files_modified: 3
---

# Phase 28 Plan 03: Bounced User Error Display Summary

**One-liner:** IVS Chat disconnect reason ("You have been removed from this chat") now surfaces in a red banner in ChatPanel when a user is bounced, closing the final UX gap in the moderation pipeline.

## What Was Built

Three small file edits threading the `error` field from `useChatRoom` through the component tree to an inline error banner in `ChatPanelContent`.

### ChatPanel.tsx

- Added `chatError?: string | null` to `ChatPanelProps` and `ChatPanelContentProps`
- Destructured `chatError` in both `ChatPanel` and `ChatPanelContent`
- Rendered a red banner (`bg-red-50 border-b border-red-200 text-red-700`) immediately after the header block when `chatError` is truthy
- Passed `chatError` from outer `ChatPanel` to inner `ChatPanelContent`

### BroadcastPage.tsx

- Changed `useChatRoom` destructure to capture `error as chatError`
- Added `chatError={chatError}` to desktop ChatPanel call site
- Added `chatError={chatError}` to mobile ChatPanel call site

### HangoutPage.tsx

- Changed `useChatRoom` destructure to capture `error as chatError`
- Added `chatError={chatError}` to desktop ChatPanel call site
- Added `chatError={chatError}` to mobile ChatPanel call site

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 42bf904 | feat(28-03): add chatError prop to ChatPanel and render error banner |
| 2 | 64ae0bc | feat(28-03): thread chatError from useChatRoom through BroadcastPage and HangoutPage |

## Gap Truth Satisfied

**MOD-06:** A bounced user now sees "You have been removed from this chat" in the chat panel when IVS Chat disconnects them with a reason (event.reason). The error flows: `useChatRoom.error` → `BroadcastPage`/`HangoutPage` (chatError) → `ChatPanel` (chatError prop) → `ChatPanelContent` (red banner).

## Deviations from Plan

None — plan executed exactly as written.

## Verification

```
cd /Users/connorhoehn/Projects/videonowandlater/web && npx tsc --noEmit
```
Exits 0, no errors.

## Self-Check: PASSED

- web/src/features/chat/ChatPanel.tsx — FOUND, contains `chatError`
- web/src/features/broadcast/BroadcastPage.tsx — FOUND, contains `chatError`
- web/src/features/hangout/HangoutPage.tsx — FOUND, contains `chatError`
- Commit 42bf904 — FOUND
- Commit 64ae0bc — FOUND
