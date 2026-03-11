---
phase: 08-realtime-hangouts
plan: 03
subsystem: recording-integration
tags: [recording, hangout, discovery, replay]

dependency_graph:
  requires:
    - 08-01 (findSessionByStageArn repository function)
    - 05-02 (recording-ended handler base implementation)
    - 06-01 (home feed RecordingFeed component)
    - 08-02 (HangoutPage for replay navigation)
  provides:
    - Stage ARN recording event handling
    - Hangout recording discovery in home feed
    - Hangout replay navigation
  affects:
    - recording-ended handler (extended for Stage ARN support)
    - RecordingFeed component (navigation routing)

tech_stack:
  added: []
  patterns:
    - ARN type detection (Channel vs Stage)
    - Conditional session lookup by resource type
    - Session type-based navigation routing

key_files:
  created: []
  modified:
    - backend/src/handlers/recording-ended.ts
    - backend/src/handlers/__tests__/recording-ended.test.ts
    - web/src/features/replay/RecordingFeed.tsx

decisions:
  - "ARN type detection via string parsing (arn:aws:ivs:...:{resource-type}/{id})"
  - "Purple badge for hangout recordings to differentiate from broadcasts"
  - "Navigate to /hangout/:sessionId for hangout recordings vs /replay/:sessionId for broadcasts"
  - "Conditional session lookup: Channel ARN → inline scan, Stage ARN → findSessionByStageArn"

metrics:
  duration_minutes: 3
  tasks_completed: 3
  files_modified: 3
  completed_at: "2026-03-03"
---

# Phase 08 Plan 03: Hangout Recording Discovery & Replay Summary

**One-liner:** Extended recording-ended handler to support Stage ARN detection for hangout recordings and integrated hangout discovery/replay navigation in home feed with purple badge differentiation.

## What Was Built

### 1. Stage ARN Support in Recording-Ended Handler
Extended `backend/src/handlers/recording-ended.ts` to detect and handle Stage ARN format:
- **ARN Type Detection**: Parses `resource_arn` to extract resource type (`channel` or `stage`)
- **Conditional Session Lookup**:
  - Channel ARN → inline DynamoDB scan (existing behavior)
  - Stage ARN → calls `findSessionByStageArn` (from Plan 08-01)
  - Unknown ARN type → logs error and returns early
- **Recording Metadata Updates**: Same flow for both Channel and Stage sessions (CloudFront URLs, duration, status)
- **Resource Release**: Handles Stage resources alongside Channel resources

### 2. Hangout Recording Navigation
Extended `web/src/features/replay/RecordingFeed.tsx` to support hangout replay:
- **Session Type Detection**: Checks `recording.sessionType` field from GET /recordings API
- **Conditional Navigation**:
  - `sessionType === 'HANGOUT'` → navigates to `/hangout/${sessionId}`
  - `sessionType === 'BROADCAST'` → navigates to `/replay/${sessionId}`
- **Visual Differentiation**: Purple "Hangout" badge in top-right corner of recording card

### 3. End-to-End Verification
User verified complete flow (checkpoint passed):
- Hangout sessions auto-record via server-side composition
- EventBridge Recording End event triggers handler
- Handler detects Stage ARN format and queries session
- Recording metadata updated (CloudFront URLs, duration, status)
- Home feed displays hangout recordings with purple badge
- Navigation to `/hangout/:sessionId` works for replay

## Implementation Details

### ARN Parsing Logic
```typescript
// Extract resource type from ARN
const arnParts = resourceArn.split(':');
const resourcePart = arnParts[arnParts.length - 1]; // "channel/id" or "stage/id"
const resourceType = resourcePart.split('/')[0]; // "channel" or "stage"
```

### Conditional Session Lookup
```typescript
let session: Session | null = null;

if (resourceType === 'channel') {
  // Inline DynamoDB scan for Channel ARN (existing logic)
  // ...
} else if (resourceType === 'stage') {
  session = await findSessionByStageArn(tableName, resourceArn);
} else {
  console.error('Unknown resource type in ARN:', resourceArn);
  return;
}
```

### Session Type-Based Navigation
```typescript
const isHangout = recording.sessionType === 'HANGOUT';
const destination = isHangout
  ? `/hangout/${recording.sessionId}`
  : `/replay/${recording.sessionId}`;
```

## Deviations from Plan

None - plan executed exactly as written. No auto-fixes, no architectural changes, no blocking issues encountered.

## Testing

### Automated Tests
- **Backend**: Added 4 unit tests to `recording-ended.test.ts`:
  - Channel ARN detection and session lookup
  - Stage ARN detection and session lookup
  - Unknown ARN type error handling
  - Recording metadata updates for Stage sessions
- **All tests pass**: `npm test -- recording-ended.test.ts -x`

### Manual Verification (Checkpoint)
User verified:
1. Hangout session created and recorded (2 participants, 30+ seconds)
2. Recording End event triggered after session ended
3. Session metadata updated with CloudFront URLs
4. Home feed displays hangout recording with purple "Hangout" badge
5. Clicking recording navigates to `/hangout/:sessionId`
6. HangoutPage loads with video player and chat panel
7. Video playback works from CloudFront distribution

## Known Limitations

None. Full functionality delivered as specified.

## Next Steps

**Immediate (Phase 08):**
- None - Phase 08 complete (all 3 plans executed)

**Future Enhancements:**
- Add user profile display (deferred from Phase 6)
- Add session thumbnails for hangouts (currently uses first frame from recording)
- Optimize DynamoDB scan for Stage ARN lookup with GSI (acceptable for low-frequency recording events)

## Files Changed

### Backend
- `backend/src/handlers/recording-ended.ts` - Extended with Stage ARN detection and conditional session lookup
- `backend/src/handlers/__tests__/recording-ended.test.ts` - Added 4 test cases for Stage ARN support

### Frontend
- `web/src/features/replay/RecordingFeed.tsx` - Added session type detection, conditional navigation, and purple badge for hangouts

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 162e417 | test | Add failing tests for Stage ARN support in recording-ended handler |
| 102ea4c | feat | Add hangout recording navigation and visual badge to RecordingFeed |

## Self-Check

Verifying claimed artifacts exist:

**Files Modified:**
- [✓] backend/src/handlers/recording-ended.ts - Stage ARN detection logic present
- [✓] backend/src/handlers/__tests__/recording-ended.test.ts - Test cases added
- [✓] web/src/features/replay/RecordingFeed.tsx - Session type routing and badge present

**Commits:**
- [✓] 162e417 exists in git history
- [✓] 102ea4c exists in git history

**Key Functions:**
- [✓] Handler imports `findSessionByStageArn`
- [✓] Handler detects ARN type via string parsing
- [✓] Handler conditionally calls Channel vs Stage lookup
- [✓] RecordingFeed checks `sessionType === 'HANGOUT'`
- [✓] RecordingFeed navigates to `/hangout/:sessionId` for hangouts

## Self-Check: PASSED

All claimed artifacts verified. Implementation complete.
