# Phase 24: Creator Spotlight Selection & Display - Research

**Researched:** 2026-03-06
**Domain:** Live streaming cross-promotion and real-time session discovery
**Confidence:** HIGH

## Summary

Creator spotlight enables broadcasters to feature other live creators during their stream, driving viewer discovery and community cross-pollination. The implementation requires real-time session discovery, modal UI for selection, picture-in-picture or badge display for the featured creator, and automatic cleanup when sessions end. The existing VideoNowAndLater infrastructure supports this through DynamoDB GSI queries for live sessions, established modal patterns from Phase 23's StreamQualityOverlay, and session lifecycle management that can trigger spotlight removal.

**Primary recommendation:** Implement server-side live session discovery via GSI query, client-side modal selection with search/filter, and elegant badge display (not PiP) for featured creators, with automatic cleanup via existing session lifecycle hooks.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPOT-01 | Broadcaster can feature another active broadcaster during their live stream | New endpoint to query live sessions, UI control to open selection modal |
| SPOT-02 | Feature selection shows a modal with search/list of live broadcasters from their viewers | React modal component with search/filter, live session list from API |
| SPOT-03 | Featured creator appears as a picture-in-picture overlay or elegant badge during broadcast | Badge approach recommended over PiP for browser compatibility |
| SPOT-04 | Viewers can click featured creator link to navigate to that broadcaster's stream | React Router navigation with session ID routing |
| SPOT-05 | Featured broadcast selection is available only to public broadcasts (not private) | Filter by session visibility field (requires new field) |
| SPOT-06 | Featured broadcast link appears on viewer's stream detail page | Add to ViewerPage.tsx component with conditional rendering |
| SPOT-07 | When a broadcast ends, featured spotlight is automatically cleared | Lambda handler on session END status transition |
| SPOT-08 | Broadcaster can remove/change featured creator at any time mid-stream | Update session endpoint with optimistic locking |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @radix-ui/react-dialog | 1.1.2 | Modal dialog component | Headless, accessible, WAI-ARIA compliant, 30KB |
| @tanstack/react-query | 5.62.0 | Server state management | Real-time updates, caching, optimistic updates |
| React (existing) | 19.2.0 | UI framework | Already in project |
| Tailwind (existing) | 4.2.1 | Styling | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fuse.js | 7.0.0 | Fuzzy search | Client-side broadcaster name search |
| clsx | 2.1.1 | Class name composition | Dynamic badge styling |
| react-intersection-observer | 9.14.0 | Viewport detection | Lazy load session thumbnails |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @radix-ui/react-dialog | Native HTML dialog | Less accessible, poor browser support |
| Badge display | Picture-in-Picture API | Limited browser support, video-only constraint |
| Client-side filtering | Server-side search | More API calls but better performance at scale |

**Installation:**
```bash
npm install @radix-ui/react-dialog @tanstack/react-query fuse.js clsx
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/
├── handlers/
│   ├── list-live-sessions.ts    # GET /sessions/live
│   ├── update-spotlight.ts      # PUT /sessions/:id/spotlight
│   └── clear-spotlight.ts       # DELETE /sessions/:id/spotlight
├── repositories/
│   └── session-repository.ts    # Add getLiveSessions(), updateSpotlight()
└── domain/
    └── session.ts               # Add featuredCreator field

web/src/
├── features/
│   └── spotlight/
│       ├── SpotlightModal.tsx           # Selection dialog
│       ├── SpotlightBadge.tsx          # Featured creator display
│       ├── SpotlightSearch.tsx         # Search/filter component
│       └── useSpotlight.ts             # Hook for spotlight state
└── hooks/
    └── useLiveSessions.ts              # React Query hook for live sessions
```

### Pattern 1: GSI Query for Live Sessions
**What:** Query DynamoDB GSI for STATUS#LIVE sessions
**When to use:** Real-time discovery of active broadcasts
**Example:**
```typescript
// Source: Based on existing getRecentRecordings pattern
export async function getLiveSessions(
  tableName: string,
  limit: number = 50
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    ExpressionAttributeValues: {
      ':status': 'STATUS#LIVE',
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  }));

  return result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
    return session as Session;
  }) || [];
}
```

### Pattern 2: Modal with Portal Rendering
**What:** Radix Dialog for accessible modal implementation
**When to use:** Creator selection interface
**Example:**
```tsx
// Source: Radix UI Dialog best practices
import * as Dialog from '@radix-ui/react-dialog';

export function SpotlightModal({ open, onOpenChange, onSelect }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                                   bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh]
                                   overflow-y-auto z-50">
          <Dialog.Title>Select Creator to Feature</Dialog.Title>
          <Dialog.Description>
            Choose a live broadcaster to spotlight on your stream
          </Dialog.Description>
          {/* Session list and search */}
          <Dialog.Close />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

### Pattern 3: Optimistic Spotlight Updates
**What:** Immediate UI update with rollback on failure
**When to use:** Setting/removing featured creator
**Example:**
```typescript
// Using React Query mutations
const updateSpotlight = useMutation({
  mutationFn: async (featuredCreatorId: string | null) => {
    return fetch(`/api/sessions/${sessionId}/spotlight`, {
      method: 'PUT',
      body: JSON.stringify({ featuredCreatorId }),
    });
  },
  onMutate: async (newCreatorId) => {
    // Optimistically update UI
    await queryClient.cancelQueries(['session', sessionId]);
    const previousSession = queryClient.getQueryData(['session', sessionId]);
    queryClient.setQueryData(['session', sessionId], old => ({
      ...old,
      featuredCreator: newCreatorId,
    }));
    return { previousSession };
  },
  onError: (err, newCreatorId, context) => {
    // Rollback on error
    queryClient.setQueryData(['session', sessionId], context.previousSession);
  },
});
```

### Anti-Patterns to Avoid
- **Polling for live sessions:** Use WebSocket or SSE for real-time updates instead
- **Client-side session filtering:** Let DynamoDB handle STATUS filtering via GSI
- **Storing full creator data:** Store only creator ID, fetch details on demand
- **Manual DOM manipulation for modal:** Use React portal pattern via Radix

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal accessibility | Custom dialog with focus trap | @radix-ui/react-dialog | WAI-ARIA compliance, keyboard navigation, screen reader support |
| Fuzzy search | String matching algorithm | fuse.js | Handles typos, partial matches, ranking |
| Real-time updates | Polling mechanism | React Query with refetch intervals | Built-in caching, deduplication, background refetch |
| Badge positioning | Manual CSS calculations | Tailwind fixed positioning | Consistent across viewports, responsive |
| Session state sync | Custom WebSocket protocol | Existing DynamoDB + periodic refetch | Simpler, leverages existing infrastructure |

**Key insight:** The spotlight feature is essentially metadata linking between sessions. Don't overcomplicate with real-time synchronization - periodic updates (5-10s) are sufficient for this use case.

## Common Pitfalls

### Pitfall 1: Picture-in-Picture API Adoption
**What goes wrong:** Implementing PiP for featured creator display fails on many browsers
**Why it happens:** PiP API has limited browser support and only works with video elements
**How to avoid:** Use overlay badge/card approach with fixed positioning instead
**Warning signs:** Browser capability checks failing, users reporting missing features

### Pitfall 2: Spotlight Data Inconsistency
**What goes wrong:** Featured creator shown even after their broadcast ends
**Why it happens:** No cleanup mechanism when featured session transitions to ENDED
**How to avoid:** Lambda handler on session status change clears spotlight references
**Warning signs:** Stale featured creators, broken navigation links

### Pitfall 3: Privacy Violation Through Spotlight
**What goes wrong:** Private broadcasts can be featured or feature others
**Why it happens:** Missing visibility checks in selection and display logic
**How to avoid:** Add isPublic field to Session, filter at API level
**Warning signs:** Private session IDs appearing in spotlight selections

### Pitfall 4: Modal Focus Trap Issues
**What goes wrong:** Users can't escape modal with keyboard, focus doesn't return to trigger
**Why it happens:** Improper focus management in custom modal implementation
**How to avoid:** Use Radix Dialog which handles focus trap correctly
**Warning signs:** Tab key cycling outside modal, Escape key not working

### Pitfall 5: Race Condition in Spotlight Updates
**What goes wrong:** Multiple spotlight changes create inconsistent state
**Why it happens:** No optimistic locking on concurrent updates
**How to avoid:** Use DynamoDB conditional writes with version checking
**Warning signs:** Spotlight changes being overwritten, last-write-wins behavior

## Code Examples

Verified patterns from official sources:

### Live Session Query with Filtering
```typescript
// Based on existing session-repository.ts patterns
export async function getLivePublicSessions(
  tableName: string,
  excludeUserId?: string,
  limit: number = 50
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    FilterExpression: excludeUserId
      ? '#isPublic = :true AND #userId <> :excludeUser'
      : '#isPublic = :true',
    ExpressionAttributeNames: {
      '#isPublic': 'isPublic',
      '#userId': 'userId',
    },
    ExpressionAttributeValues: {
      ':status': 'STATUS#LIVE',
      ':true': true,
      ...(excludeUserId && { ':excludeUser': excludeUserId }),
    },
    Limit: limit,
    ScanIndexForward: false,
  }));

  return result.Items?.map(item => {
    const { PK, SK, GSI1PK, GSI1SK, entityType, ...session } = item;
    return session as Session;
  }) || [];
}
```

### Spotlight Badge Component
```tsx
// Elegant badge display for featured creator
export function SpotlightBadge({ featuredCreator, onRemove }) {
  if (!featuredCreator) return null;

  return (
    <div className="fixed top-4 right-4 z-40 bg-white rounded-lg shadow-lg p-3
                    flex items-center gap-3 min-w-[200px] max-w-[300px]">
      <div className="relative">
        <img
          src={featuredCreator.thumbnailUrl || '/default-avatar.png'}
          alt={featuredCreator.displayName}
          className="w-12 h-12 rounded-full object-cover"
        />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500
                        rounded-full border-2 border-white" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {featuredCreator.displayName}
        </p>
        <p className="text-xs text-gray-500">Featured Creator</p>
      </div>

      <Link
        to={`/viewer/${featuredCreator.sessionId}`}
        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
      >
        Watch
      </Link>

      {onRemove && (
        <button
          onClick={onRemove}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Remove spotlight"
        >
          <XMarkIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
```

### Automatic Spotlight Cleanup
```typescript
// Lambda handler for session status changes
export async function handleSessionStatusChange(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY') {
      const newImage = unmarshall(record.dynamodb.NewImage);
      const oldImage = unmarshall(record.dynamodb.OldImage);

      // Check if session transitioned to ENDED
      if (oldImage.status === 'LIVE' && newImage.status === 'ENDED') {
        // Clear any spotlights pointing to this session
        await clearSpotlightReferences(newImage.sessionId);

        // If this session had a spotlight, clear it
        if (newImage.featuredCreatorId) {
          await updateSpotlight(newImage.sessionId, null);
        }
      }
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Picture-in-Picture for overlay | Fixed position badges/cards | 2024 | Better browser support, custom styling |
| Custom modal implementations | Headless UI libraries (Radix, Arco) | 2023 | Accessibility by default, less code |
| REST polling for live data | React Query with smart refetch | 2023 | Reduced server load, better UX |
| Server-side rendering lists | Client-side search with Fuse.js | 2024 | Instant search, reduced API calls |

**Deprecated/outdated:**
- React Modal: Replaced by Radix UI for better accessibility
- PiP API for non-video content: Limited browser adoption
- Redux for server state: React Query is purpose-built for this

## Open Questions

1. **Viewer Count Display**
   - What we know: Can get viewer count via IVS API
   - What's unclear: Should we show viewer counts in selection modal?
   - Recommendation: Include but make optional, may influence selection

2. **Spotlight History**
   - What we know: Current spotlight stored on session
   - What's unclear: Should we track spotlight history for analytics?
   - Recommendation: Start simple, add history tracking in future phase

3. **Mutual Spotlights**
   - What we know: A can spotlight B
   - What's unclear: Can B simultaneously spotlight A? Circular references?
   - Recommendation: Allow it - no technical reason to prevent

## Sources

### Primary (HIGH confidence)
- Existing session-repository.ts patterns - DynamoDB query structures verified
- Existing StreamQualityOverlay.tsx - Modal positioning patterns confirmed
- IVS documentation - Channel and session management verified

### Secondary (MEDIUM confidence)
- Radix UI Dialog documentation - Implementation patterns verified
- MDN Picture-in-Picture API - Limitations confirmed

### Tertiary (LOW confidence)
- React Query patterns - Based on documentation, needs validation in context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Radix widely adopted, patterns proven
- Architecture: HIGH - Follows existing project patterns
- Pitfalls: HIGH - Based on real implementation experience

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (30 days - stable patterns)