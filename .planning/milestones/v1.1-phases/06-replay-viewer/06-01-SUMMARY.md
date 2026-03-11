---
phase: 06-replay-viewer
plan: 01
subsystem: replay-discovery
tags: [api, frontend, recording-feed]
completed: 2026-03-03T02:00:13Z
duration_minutes: 3

dependencies:
  requires: [05-01, 05-02]
  provides: [recording-list-api, recording-feed-ui]
  affects: [06-02]

tech_stack:
  added:
    - DynamoDB scan with filter for available recordings
    - React RecordingFeed component with Tailwind
  patterns:
    - Public API endpoint pattern (no auth)
    - Repository scan and sort pattern
    - Responsive grid layout with aspect-ratio

key_files:
  created:
    - backend/src/handlers/list-recordings.ts
    - web/src/features/replay/RecordingFeed.tsx
  modified:
    - backend/src/repositories/session-repository.ts
    - infra/lib/stacks/api-stack.ts
    - web/src/pages/HomePage.tsx

decisions:
  - decision: Public GET /recordings endpoint with no authorization
    rationale: Discovery feed should be accessible without login to maximize content discoverability
    alternatives: [Authenticated endpoint, Per-user filtering]
  - decision: DynamoDB scan instead of GSI query
    rationale: Small dataset at v1.1 milestone, scan is acceptable; can optimize with GSI in future
    alternatives: [GSI on recordingStatus, Separate recordings table]
  - decision: Simple userId display as broadcaster name
    rationale: User profiles not yet implemented in v1.1; userId substring sufficient for MVP
    alternatives: [Fetch username from Cognito, Add displayName to Session]

metrics:
  tasks_completed: 2
  commits: 2
  files_created: 2
  files_modified: 3
---

# Phase 06 Plan 01: Recording Discovery Feed Summary

**One-liner:** Public recording feed on home page with thumbnails, duration badges, and click-to-replay navigation

## Overview

Implemented discovery feed for recently recorded sessions on the home page. Users can now browse available replays in a responsive grid layout with thumbnails, duration badges, and metadata. Clicking any recording navigates to the replay viewer (route handler to be implemented in Plan 06-02).

## Tasks Completed

### Task 1: Create List Recordings API and Repository Method
**Status:** ✅ Complete
**Commit:** d622ae6

Created GET /recordings API endpoint that queries DynamoDB for sessions with `recordingStatus='available'`. Added `getRecentRecordings` repository method using DynamoDB scan with filter expression, sorting results by `endedAt` descending. Wired public endpoint in API stack with read-only DynamoDB permissions.

**Key changes:**
- Added `ScanCommand` import to session-repository
- Implemented `getRecentRecordings(tableName, limit)` function with filtering, mapping, and sorting
- Created list-recordings Lambda handler with error handling and CORS headers
- Wired public `/recordings` endpoint in API Gateway (no authorizer)
- Fixed TypeScript import path for `canTransition` (added `.js` extension for ES modules)

### Task 2: Create RecordingFeed Component and Update HomePage
**Status:** ✅ Complete
**Commit:** e8f9fd0

Built responsive RecordingFeed component displaying recordings in a 1/2/3 column grid (mobile/tablet/desktop). Component shows thumbnails with duration badges, formatted timestamps, and broadcaster IDs. Updated HomePage to fetch recordings from API and render feed below existing "Get Started" section.

**Key changes:**
- Created `web/src/features/replay/` directory
- Implemented RecordingFeed component with Recording interface
- Added `formatDuration` helper (milliseconds to MM:SS)
- Added `formatDate` helper (relative time with fallback to absolute date)
- Integrated RecordingFeed into HomePage with fetch on mount
- Added loading state and empty state handling
- Removed unused React import (TypeScript build fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript ES module import path**
- **Found during:** Task 1 type-checking
- **Issue:** TypeScript error "Relative import paths need explicit file extensions in ECMAScript imports" for `import('../domain/session')` in session-repository.ts
- **Fix:** Changed to `import('../domain/session.js')` to satisfy Node16/NodeNext module resolution
- **Files modified:** backend/src/repositories/session-repository.ts
- **Commit:** d622ae6 (included in Task 1 commit)

**2. [Rule 1 - Bug] Removed unused React import**
- **Found during:** Task 2 build verification
- **Issue:** TypeScript error TS6133 - React declared but never used in RecordingFeed.tsx
- **Fix:** Removed `import React from 'react'` (JSX transform handles React automatically)
- **Files modified:** web/src/features/replay/RecordingFeed.tsx
- **Commit:** e8f9fd0 (included in Task 2 commit)

## Verification Results

**Backend:**
- ✅ TypeScript compilation successful (tsc --noEmit)
- ✅ Repository export verified: `export async function getRecentRecordings`
- ✅ Handler export verified: `export const handler`

**Infrastructure:**
- ✅ API route verified: `recordings.addMethod('GET', ...)`

**Frontend:**
- ✅ Web build successful (vite build)
- ✅ Component exports verified: `export function RecordingFeed`
- ✅ Navigation verified: `navigate(\`/replay/${recording.sessionId}\`)`
- ✅ HomePage integration verified: `<RecordingFeed recordings={recordings} />`
- ✅ Fetch verified: `fetch(\`${config.apiUrl}/recordings\`)`

## Integration Points

**Consumes:**
- Session.recordingStatus from Phase 05-01 (Recording Infrastructure)
- Session.thumbnailUrl from Phase 05-02 (Recording Lifecycle)
- Session.recordingDuration from Phase 05-02 (Recording Lifecycle)

**Provides:**
- GET /recordings API endpoint for other consumers
- RecordingFeed component for potential reuse
- Navigation pattern to /replay/:sessionId route

**Affects:**
- Plan 06-02 depends on this plan's /replay/:sessionId navigation

## Technical Debt & Future Optimizations

1. **DynamoDB Scan Performance:** Current implementation uses scan with filter. At scale (>1000 recordings), should migrate to GSI on `recordingStatus` with `endedAt` as sort key for efficient queries.

2. **Pagination:** No pagination implemented. Hardcoded to 20 recordings. Should add cursor-based pagination when recording count grows.

3. **Broadcaster Display:** Using `userId.substring(0, 8)` as placeholder. Replace with actual username/displayName once user profiles are implemented.

4. **Thumbnail Fallback:** Generic play icon SVG shown when thumbnail missing. Could generate fallback thumbnails server-side.

5. **Real-time Updates:** Feed requires manual refresh. Could add WebSocket subscription or polling for newly available recordings.

## Self-Check: PASSED

**Created files verification:**
```bash
✅ backend/src/handlers/list-recordings.ts exists
✅ web/src/features/replay/RecordingFeed.tsx exists
```

**Modified files verification:**
```bash
✅ backend/src/repositories/session-repository.ts contains getRecentRecordings
✅ infra/lib/stacks/api-stack.ts contains recordings endpoint
✅ web/src/pages/HomePage.tsx contains RecordingFeed component
```

**Commits verification:**
```bash
✅ Commit d622ae6 exists: feat(06-01): create list recordings API and repository method
✅ Commit e8f9fd0 exists: feat(06-01): create RecordingFeed component and update HomePage
```

All artifacts verified successfully.
