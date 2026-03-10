---
phase: 24-creator-spotlight-selection-display
plan: 02
status: complete
completed: "2026-03-07"
commits:
  - 0182f5c feat(24-02): create spotlight feature components and hook
  - 2615956 feat(24-02): integrate spotlight into BroadcastPage and ViewerPage
---

# Plan 24-02 Summary: Frontend Spotlight UI

## What Was Built

Three new files in `web/src/features/spotlight/` plus integration into BroadcastPage and ViewerPage.

### useSpotlight.ts
Custom hook managing all spotlight state and API interactions:
- Polls `GET /sessions/{sessionId}` every 10s when live to pick up `featuredCreatorId`/`featuredCreatorName` changes
- Fetches `GET /sessions/live` on-demand when modal opens (filters own session from list)
- `selectCreator()` calls `PUT /sessions/{sessionId}/spotlight` with optimistic update and error revert
- `removeCreator()` clears spotlight via same endpoint with `null` values
- Guards all fetches with `!authToken` check

### SpotlightBadge.tsx
Fixed-position badge (`fixed top-16 right-4 z-40`) showing featured creator:
- Avatar initial, creator name, green live dot, "Watch" link via React Router `<Link>`
- Remove button (X) only rendered when `isBroadcaster && onRemove` provided
- Returns null when no `featuredCreator`

### SpotlightModal.tsx
Portal-based modal (`ReactDOM.createPortal` to `document.body`):
- Backdrop click and Escape key to close
- Lists live sessions with avatar, userId, "Live" badge, time since `createdAt`
- Refresh button triggers re-fetch
- Empty state: "No other live broadcasters right now"
- No Radix UI dependency — pure React portal

### BroadcastPage.tsx Integration
- "Feature Creator" / "Change Spotlight" button in live controls bar (purple, after ReactionPicker)
- `SpotlightBadge` rendered outside camera preview container with `isBroadcaster=true` and `onRemove`
- `SpotlightModal` rendered at bottom of BroadcastContent

### ViewerPage.tsx Integration
- Featured creator inline link in broadcaster info row (purple pill with green dot)
- Read-only `SpotlightBadge` fixed at top-right
- 15s polling interval re-fetches session data to keep featured creator info fresh

## Key Decisions

- **React portal for modal**: No `@radix-ui/react-dialog` installed; portal approach avoids new dependency
- **Optimistic updates**: `selectCreator`/`removeCreator` update local state immediately, revert on API error
- **Polling not websocket**: 10s poll on useSpotlight (broadcaster), 15s poll on ViewerPage — sufficient for spotlight discovery latency
- **Filter own session**: `fetchLiveSessions` excludes own `sessionId` from results

## Verification

- TypeScript: `cd web && npx tsc --noEmit` — passes clean
- All spotlight files present in `web/src/features/spotlight/`
- BroadcastPage and ViewerPage import and render spotlight components
