# Phase 18: Homepage Redesign & Activity Feed - Research

**Researched:** 2026-03-05
**Domain:** Frontend homepage layout + backend activity API endpoint
**Confidence:** HIGH

## Summary

Phase 18 adds a unified activity feed and recording slider to the homepage by (1) creating a new GET /activity endpoint that returns all recent sessions with full metadata, and (2) redesigning the HomePage and RecordingFeed React components to display a two-zone layout: horizontal scrollable recording slider + activity feed below. This phase depends on Phases 16-17 delivering participant and reaction summary data to DynamoDB. The main decision points are messageCount tracking strategy and GET /activity auth posture.

**Primary recommendation:** Implement GET /activity as **public** (matching GET /recordings) to preserve content discoverability. Track messageCount via atomic DynamoDB ADD counter in send-message.ts (simplest, most reliable).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RSUMM-02 | Reaction summary counts on recording cards in slider | GET /activity returns reactionSummary; frontend displays per RecordingCard |
| RSUMM-03 | Reaction summary in replay info panel | GET /sessions/:id extended with reactionSummary; ReplayViewer.tsx displays it |
| ACTV-01 | Homepage slider (3-4 items visible, peek-scroll, broadcasts only) | CSS scroll-snap-type, horizontal layout, sessionType filter |
| ACTV-02 | Unified activity feed below slider (all sessions, reverse chronological) | ActivityFeed component, sort by endedAt DESC |
| ACTV-03 | Broadcast activity entries (title, duration, reactions, timestamp) | BroadcastActivityCard component, display reactionSummary as emoji pills |
| ACTV-04 | Hangout activity entries (participants, messageCount, duration, timestamp) | HangoutActivityCard component, fetch participant list via GET /sessions/:id/participants |
| ACTV-05 | Filter hangouts out of slider (broadcasts only) | Filter sessionType === 'BROADCAST' in slider render |
| ACTV-06 | GET /activity returns all sessions with activity metadata | New list-activity.ts handler + CDK wiring, single API call |

## User Constraints

### Pre-Plan Decisions Required (from ROADMAP.md)

**Decision 1: messageCount Tracking Approach**
- Option A (RECOMMENDED): Atomic ADD counter in send-message.ts
  - Add `messageCount` field to session
  - In send-message.ts: UpdateCommand with SET messageCount = if_not_exists(messageCount, 0) + 1
  - Pro: Simple, atomic, no post-hoc counting
  - Con: Minimal (messageCount visible in real-time, but session is LIVE anyway)
- Option B: Count chat items at session end in recording-ended.ts
  - Pro: Accurate count at final snapshot
  - Con: Requires scan/query of all chat items (expensive, slow)
- Option C: Show N/A initially, compute later
  - Pro: No tracking overhead
  - Con: Confusing UX (blank count on activity cards until async pipeline finishes)

**Recommendation: Choose Option A before writing 18-01.** Atomic counter is standard DynamoDB pattern for high-frequency updates (chat messages), low cost, no complexity.

**Decision 2: GET /activity Auth Posture**
- Option A (RECOMMENDED): Public (matching GET /recordings)
  - No Authorization header required
  - Pro: Consistent with existing pattern, content discoverability, no auth header complexity on frontend
  - Con: Activity feed visible to unauthenticated users
- Option B: Authenticated
  - Requires Authorization header
  - Pro: Activity feed private to authenticated users
  - Con: Breaks discoverability for unauthenticated users, inconsistent with GET /recordings

**Recommendation: Choose Option A before writing 18-01.** Mirrors existing GET /recordings (public), maintains content discoverability, simpler frontend implementation.

---

## Standard Stack

### Core Libraries (Existing)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | UI framework (HomePage, RecordingFeed components) | Project standard |
| React Router | 6.x | Page navigation | Project standard |
| Tailwind CSS | 3.x | Styling (scroll-snap, horizontal layout) | Project standard |
| AWS Lambda (Node.js 20.x) | Latest | GET /activity handler | Project standard |
| AWS DynamoDB SDK v3 | Latest | Query sessions + metadata | Project standard |

### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | 2.30+ | Relative timestamp formatting ("2 hours ago") | Not currently used; recommend adding for consistent date handling |
| react-use-measure | 2.1+ | Measure scroll container width for responsive slider snap-to-columns | Alternative: use ResizeObserver directly in component |

### Frontend Patterns (Existing)
| Pattern | Example | Purpose |
|---------|---------|---------|
| Auth token in hooks | useAuth hook + fetchAuthSession | All protected endpoints require Bearer token |
| Config pattern | getConfig()?.apiUrl | Avoid window globals, use config function |
| Relative timestamps | formatDate() in RecordingFeed | Calculate "2 hours ago" from ISO date string |
| Component state for async data | useState + useEffect | Load recordings, sessions, activity data |

### API Response Patterns (Existing)
| Endpoint | Auth | Response | Precedent |
|----------|------|----------|-----------|
| GET /recordings | None | `{ recordings: Recording[] }` | list-recordings.ts (reference) |
| GET /sessions/:id | Bearer token | `{ sessionId, userId, ... }` | get-session.ts (reference) |
| GET /sessions/:id/reactions | Bearer token | `{ reactions: Reaction[] }` | get-reactions.ts (reference) |

---

## Architecture Patterns

### Recommended Project Structure (New Files)

```
backend/src/handlers/
├── list-activity.ts                          # NEW: GET /activity handler
└── __tests__/
    └── list-activity.test.ts                 # NEW: unit tests

backend/src/repositories/
└── (session-repository.ts extended with new query functions)

web/src/features/
├── replay/
│   ├── RecordingFeed.tsx                     # MODIFIED: add slider + activity feed
│   └── ActivityFeed.tsx                      # NEW: activity feed component
├── activity/                                 # NEW: activity-specific components
│   ├── BroadcastActivityCard.tsx             # NEW: broadcast entry card
│   ├── HangoutActivityCard.tsx               # NEW: hangout entry card
│   ├── RecordingSlider.tsx                   # NEW: horizontal recording slider
│   └── ReactionSummaryPill.tsx               # NEW: emoji + count pills
└── (existing: reactions, broadcast, hangout, chat)

infra/lib/stacks/
└── api-stack.ts                              # MODIFIED: add GET /activity route
```

### Pattern 1: Backend List Activity Handler (Reference: list-recordings.ts)

**What:** Create a new Lambda handler that scans DynamoDB for all ended/ending sessions, enriches with participant counts and reaction summaries, and returns in reverse chronological order.

**When to use:** GET /activity endpoint needs single API call (not multiple queries).

**Key differences from list-recordings.ts:**
- list-recordings.ts: Returns only available recordings (filters by recordingStatus)
- list-activity.ts: Returns all ended sessions (broadcasts and hangouts) with full metadata

**Example structure:**
```typescript
// Source: Pattern from list-recordings.ts + new enrichment logic
export async function getRecentActivity(
  tableName: string,
  limit: number = 20
): Promise<ActivitySession[]> {
  // Scan for all ended/ending sessions (both BROADCAST and HANGOUT)
  const sessions = await scanAllSessions();

  // Enrich each session with participant counts and reaction summaries
  const enriched = await Promise.all(sessions.map(async session => ({
    ...session,
    participantCount: await getParticipantCount(session.sessionId), // Phase 16 data
    reactionSummary: session.reactionSummary || {}, // Phase 17 data
    messageCount: session.messageCount || 0, // Tracked in send-message.ts
  })));

  return enriched.sort((a, b) =>
    new Date(b.endedAt || b.createdAt).getTime() -
    new Date(a.endedAt || a.createdAt).getTime()
  ).slice(0, limit);
}
```

### Pattern 2: Frontend Activity Feed Layout (Scroll-Snap Slider)

**What:** Two-zone homepage: (1) horizontal recording slider with CSS scroll-snap, (2) full-width activity feed below.

**When to use:** Homepage redesign needs responsive slider with "3-4 visible" + peek-to-next.

**CSS approach (Tailwind-native):**
```tsx
// Slider container: scroll-snap-type, scroll-behavior
<div className="overflow-x-auto snap-x snap-mandatory scroll-smooth">
  {/* Cards: snap-center, flex-shrink-0 for consistent width */}
  {recordings.map(recording => (
    <div key={recording.sessionId} className="snap-center flex-shrink-0 w-1/3">
      {/* Card content */}
    </div>
  ))}
</div>

// Activity feed: simple vertical stack
<div className="space-y-4">
  {activities.map(activity => (
    <ActivityCard key={activity.sessionId} {...activity} />
  ))}
</div>
```

**Why scroll-snap over custom JS:** Native browser feature, better mobile performance, automatic alignment, no library dependency. Requires no layout measurement or resize listeners.

### Pattern 3: Relative Timestamp Formatting

**What:** Format "2 hours ago", "just now", "3 days ago" from ISO date strings.

**When to use:** Activity feed and recording cards need human-readable timestamps.

**Implementation (existing RecordingFeed.tsx pattern):**
```typescript
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

**Gotcha:** Use `endedAt || createdAt` for sessions (endedAt available after Phase 17 recording-ended processes; createdAt fallback for HANGOUT sessions not yet recorded).

### Pattern 4: Reaction Summary Display (Pills)

**What:** Show emoji + count as small pills on activity cards (e.g., "❤️ 42  🔥 17").

**When to use:** Activity feed broadcast entries and recording slider cards display reaction counts.

**Implementation:**
```tsx
// Source: Inferred from Phase 7 (REACT-10) get-reactions.ts
interface ReactionSummary {
  [emojiType: string]: number; // e.g., { heart: 42, fire: 17, clap: 8 }
}

function ReactionSummaryPills({ reactionSummary }: { reactionSummary?: ReactionSummary }) {
  if (!reactionSummary || Object.keys(reactionSummary).length === 0) {
    return <div className="text-gray-400 text-xs">No reactions</div>;
  }

  return (
    <div className="flex gap-2">
      {Object.entries(reactionSummary).map(([emojiType, count]) => (
        <div key={emojiType} className="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full">
          <span>{EMOJI_MAP[emojiType as EmojiType]}</span>
          <span className="text-xs font-semibold text-gray-700">{count}</span>
        </div>
      ))}
    </div>
  );
}
```

**Reference:** EMOJI_MAP already defined in web/src/features/reactions/ReactionPicker.tsx.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative timestamp calculation | Custom date math | Existing formatDate() pattern (RecordingFeed.tsx) + date-fns if scaling | Already works, tested, handles edge cases (timezone offsets) |
| Horizontal scrolling with "peek" effect | Custom scroll JS | CSS scroll-snap-type: mandatory + Tailwind flex layout | Native browser feature, no JS overhead, mobile-friendly, automatically aligned |
| Emoji rendering + count display | Custom emoji picker | EMOJI_MAP constant (Phase 7, ReactionPicker.tsx) | Already exists, type-safe, consistent UI |
| Activity metadata enrichment (participants, reactions) | Frontend aggregation loop | Backend GET /activity endpoint (Phase 18-01) | Single API call, cache-friendly, reduces frontend JS, cleaner data fetching |
| Authorization header management | Manual fetch() headers | Existing pattern: fetchAuthSession() + Bearer token | Already used in all protected endpoints, maintains consistency |

**Key insight:** The biggest footgun is the temptation to fetch `/recordings` + `/sessions` separately on frontend and manually loop through to add participant/reaction data. This creates N+1 query patterns, increases latency, and makes caching harder. Single API call (GET /activity) is the right move.

---

## Common Pitfalls

### Pitfall 1: Missing Reaction Summary on Broadcast Cards

**What goes wrong:** Recording cards display "No reactions" even though the session has 50+ reactions, because Phase 17 hasn't written the reactionSummary to the session record yet, or the frontend doesn't know to fetch it.

**Why it happens:**
1. Phase 17 (recording-ended.ts) computes reactionSummary asynchronously and writes it to session — but this hasn't happened yet when Phase 18 card is first rendered.
2. Frontend fetches GET /recordings, which only returns basic metadata (thumbnailUrl, duration), not the reactionSummary field.

**How to avoid:**
1. Verify GET /sessions/:id returns reactionSummary (Phase 15 extended the endpoint; Phase 18-01 should confirm)
2. For recording slider cards: Display placeholder "Loading reactions…" while reactionSummary is empty (not "No reactions")
3. For activity feed: Use GET /activity endpoint, which returns pre-computed reactionSummary (set by Phase 17)
4. Do NOT refetch GET /sessions/:id for every card just to get reaction data — use GET /activity once

**Warning signs:**
- "No reactions" badge on cards that obviously had reactions (you saw floats during stream)
- Users report missing emoji counts on homepage but they're visible in replay viewer (means reactionSummary exists in DB, just not fetched)

### Pitfall 2: Hangout Sessions Appearing in Recording Slider as "Pending"

**What goes wrong:** Hangout sessions show up in the horizontal recording slider with a spinning "Processing…" badge, confusing users who expect only actual recordings there.

**Why it happens:** Current RecordingFeed.tsx logic filters by recordingStatus but doesn't check sessionType — it just shows all ended sessions that are recording-eligible.

**How to avoid:**
1. In RecordingFeed or new RecordingSlider component: Filter sessions where `sessionType === 'BROADCAST'` in addition to status checks
2. Activity feed (below slider) includes both BROADCAST and HANGOUT — only the slider filters by type
3. Verify in Phase 18-02 unit tests that slider rejects HANGOUT sessionType

**Warning signs:**
- Users ask "why is my hangout taking so long to process?"
- Hangout + recording appear in slider but hangout has no recordingDuration (type mismatch indicator)

### Pitfall 3: Frontend Loops Through Activity Cards, Making N+1 GET /sessions Requests

**What goes wrong:** Homepage activity feed renders 10 activity cards, and each card calls fetch(`/sessions/:id/participants`) to get participant list. Now you have 10 network requests instead of 1, latency spikes, and cache misses.

**Why it happens:** Easy to do without thinking — map activity list, fetch metadata for each. DynamoDB query-per-item is an anti-pattern.

**How to avoid:**
1. GET /activity endpoint (Phase 18-01) returns full activity metadata in one call: `{ sessions: [{ sessionId, userId, sessionType, reactionSummary, participantCount, messageCount, ... }] }`
2. Frontend receives rich payload and renders directly — no follow-up fetches needed
3. If you need more detail than GET /activity provides, that's a sign the endpoint schema is incomplete

**Warning signs:**
- Chrome DevTools Network tab shows 10+ parallel GET /sessions requests on homepage load
- Activity feed takes 5+ seconds to render after user lands on page
- API latency spikes when multiple users load homepage

### Pitfall 4: Message Count Unsynchronized (Showing 0 When Chat Exists)

**What goes wrong:** Activity feed shows "0 messages" on a hangout that clearly had chat activity, because messageCount isn't being tracked or wasn't set when card rendered.

**Why it happens:**
1. Decision not made on messageCount tracking approach, so no one implemented it
2. messageCount field not added to send-message.ts (Decision 1 above)
3. Frontend renders activity card before async session load completes (race condition)

**How to avoid:**
1. Implement Decision 1 (Option A: atomic ADD counter in send-message.ts)
2. In send-message.ts: Always update messageCount alongside message storage
3. GET /activity endpoint returns current messageCount in payload
4. Frontend waits for full GET /activity response before rendering (not streaming/incremental)

**Warning signs:**
- Activity card shows "0 messages" but clicking into hangout shows chat history
- messageCount is undefined on some sessions but not others (inconsistent tracking)

### Pitfall 5: Timezone Issues on Relative Timestamps

**What goes wrong:** Frontend shows "2 hours ago" on a session that was created 1 hour ago, because browser and server timezones are different.

**Why it happens:**
1. Server stores ISO dates in UTC (correct): "2026-03-05T18:00:00Z"
2. Frontend reads it, creates new Date(dateString) — browser interprets as local time if not explicit about Z
3. Calculation: now.getTime() - date.getTime() includes timezone offset

**How to avoid:**
1. Always store ISO dates with Z suffix (UTC): "2026-03-05T18:00:00Z"
2. Verify backend write: `new Date().toISOString()` always includes Z
3. Frontend parsing: new Date("2026-03-05T18:00:00Z") automatically UTC (Z suffix enforces it)
4. Never use local date constructor in backend — always ISO UTC

**Warning signs:**
- Timestamps off by exactly N hours (where N = timezone offset)
- Test passes locally, fails in different timezone
- "just now" shows as "2h ago" depending on user location

---

## Code Examples

Verified patterns from existing codebase:

### Example 1: GET /activity Handler Structure

```typescript
// Source: Pattern from list-recordings.ts (existing)
// File: backend/src/handlers/list-activity.ts (new)

import type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getRecentActivity } from '../repositories/session-repository';

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const tableName = process.env.TABLE_NAME;
    if (!tableName) {
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'TABLE_NAME not set' }) };
    }

    const sessions = await getRecentActivity(tableName, 20);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
      body: JSON.stringify({ sessions }),
    };
  } catch (error) {
    console.error('Error listing activity:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Failed to list activity' }),
    };
  }
};
```

### Example 2: Activity Feed Frontend (Broadcast Card)

```tsx
// Source: Adapted from RecordingFeed.tsx pattern
// File: web/src/features/activity/BroadcastActivityCard.tsx (new)

import { useNavigate } from 'react-router-dom';
import type { ActivitySession } from '../types';
import { ReactionSummaryPills } from './ReactionSummaryPills';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function BroadcastActivityCard({ session }: { session: ActivitySession }) {
  const navigate = useNavigate();
  const timestamp = formatDate(session.endedAt || session.createdAt);
  const duration = session.recordingDuration ? formatDuration(session.recordingDuration) : 'unknown';

  return (
    <div
      onClick={() => navigate(`/replay/${session.sessionId}`)}
      className="p-4 bg-white rounded-lg border border-gray-100 hover:border-gray-300 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{session.userId}</h3>
          <p className="text-xs text-gray-500 mt-1">{duration} • {timestamp}</p>
        </div>
      </div>
      <div className="mt-3">
        <ReactionSummaryPills reactionSummary={session.reactionSummary} />
      </div>
    </div>
  );
}
```

### Example 3: Recording Slider (CSS Scroll-Snap)

```tsx
// Source: Tailwind scroll-snap documentation + existing RecordingFeed grid pattern
// File: web/src/features/activity/RecordingSlider.tsx (new)

import { useNavigate } from 'react-router-dom';

export function RecordingSlider({ recordings }: { recordings: ActivitySession[] }) {
  const navigate = useNavigate();

  // Filter out hangouts (slider broadcasts only)
  const broadcasts = recordings.filter(r => r.sessionType === 'BROADCAST');

  if (broadcasts.length === 0) {
    return <div className="px-6 py-8 text-gray-400 text-sm">No recordings yet</div>;
  }

  return (
    <div className="px-6 py-6 border-b border-gray-100">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Broadcasts</h2>
      <div className="overflow-x-auto snap-x snap-mandatory scroll-smooth">
        <div className="flex gap-4 pb-2">
          {broadcasts.map(recording => (
            <div
              key={recording.sessionId}
              className="snap-center flex-shrink-0 w-56 bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/replay/${recording.sessionId}`)}
            >
              <div className="aspect-video bg-gray-900">
                {recording.thumbnailUrl && (
                  <img src={recording.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="p-3">
                <p className="text-xs font-semibold text-gray-800 truncate">{recording.userId}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {/* Reaction pills */}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Recording cards as grid only | Two-zone layout (slider + feed) | Phase 18 | Broadcasts more discoverable in slider, activity feed shows all session types |
| GET /recordings (public) for all data | GET /activity (public) + GET /sessions/:id (auth) | Phase 18 | Single API call for discovery, per-session auth for detail |
| Frontend counts reactions per card (N+1 queries) | Phase 17 pre-computes reactionSummary | Phase 17 | Single read on GET /activity, no runtime aggregation |
| Message count tracked ad-hoc | Atomic counter in send-message.ts | Phase 18-01 (Decision 1) | Reliable, low-latency, consistent across API calls |

---

## Open Questions

1. **Should GET /activity return all 20 sessions or paginate?**
   - Current assumption: 20 most recent sessions (like GET /recordings)
   - If more needed: Add limit/offset query parameters to handler
   - Validation: Confirm with frontend what makes sense for homepage feed (10-15 items visible, rest lazy-loaded?)

2. **What fields does reactionSummary contain if no reactions exist?**
   - Option A: Empty object `{}`
   - Option B: Null or undefined
   - Phase 17 decision needed, but Phase 18 frontend should handle both with fallback

3. **Should messageCount track only final count or real-time count?**
   - Current assumption: Real-time count (incremented every send-message)
   - Alternative: Count at session end (recording-ended.ts)
   - Decision 1 (above) locks this — confirm before 18-01

4. **Is participantCount pre-computed or fetched per-card?**
   - Assumption: Phase 16 writes participantCount to session after final participant leaves
   - GET /activity includes this, no follow-up queries needed
   - Validation: Confirm Phase 16 writes participantCount field

---

## Validation Architecture

**Workflow validation enabled:** workflow.verifier = true (from .planning/config.json)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (Node) + React Testing Library |
| Config file | backend/package.json (test script) + web/package.json |
| Quick run command | `cd backend && npm test -- --testNamePattern="list-activity"` |
| Full suite command | `cd backend && npm test && cd ../web && npm run test:ui` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACTV-06 | GET /activity returns sessions with metadata in single call | unit | `npm test -- --testNamePattern="list-activity"` | ❌ Wave 0 |
| ACTV-01 | Recording slider displays broadcasts only, 3-4 visible | integration | `cd web && npm test -- --testNamePattern="RecordingSlider"` | ❌ Wave 0 |
| ACTV-02 | Activity feed lists all sessions in reverse chronological order | integration | `cd web && npm test -- --testNamePattern="ActivityFeed"` | ❌ Wave 0 |
| ACTV-03 | Broadcast activity card shows title, duration, reactions, timestamp | component | `cd web && npm test -- --testNamePattern="BroadcastActivityCard"` | ❌ Wave 0 |
| ACTV-04 | Hangout activity card shows participant list, messageCount, duration | component | `cd web && npm test -- --testNamePattern="HangoutActivityCard"` | ❌ Wave 0 |
| RSUMM-02 | Recording cards display reaction summary counts | component | `cd web && npm test -- --testNamePattern="ReactionSummaryPills"` | ❌ Wave 0 |
| RSUMM-03 | Replay viewer shows reaction summary in info panel | integration | `cd web && npm test -- --testNamePattern="ReplayViewer.*reactionSummary"` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `backend/src/handlers/__tests__/list-activity.test.ts` — covers ACTV-06 (GET /activity endpoint returns sessions with all metadata)
- [ ] `web/src/features/activity/__tests__/RecordingSlider.test.tsx` — covers ACTV-01 (broadcasts only, scroll-snap behavior)
- [ ] `web/src/features/activity/__tests__/ActivityFeed.test.tsx` — covers ACTV-02 (reverse chronological, all session types)
- [ ] `web/src/features/activity/__tests__/BroadcastActivityCard.test.tsx` — covers ACTV-03 (renders title, duration, reactions, timestamp)
- [ ] `web/src/features/activity/__tests__/HangoutActivityCard.test.tsx` — covers ACTV-04 (renders participants, messageCount, duration)
- [ ] `web/src/features/activity/__tests__/ReactionSummaryPills.test.tsx` — covers RSUMM-02 (emoji + count pills)
- [ ] Extend `web/src/features/replay/__tests__/ReplayViewer.test.tsx` — covers RSUMM-03 (reactionSummary displayed in info panel)
- [ ] Add Phase 18 setup: API Gateway route wiring in `infra/lib/stacks/api-stack.ts`
- [ ] Extend Session domain type to include `reactionSummary` and `messageCount` fields (if not already present from Phase 17)

*(If no gaps after above: "None — test infrastructure ready for all Phase 18 requirements")*

---

## Sources

### Primary (HIGH confidence)
- **Existing codebase patterns:**
  - list-recordings.ts: GET /recordings handler (reference for GET /activity structure)
  - RecordingFeed.tsx: Frontend grid, formatDate(), formatDuration() (reference for activity cards)
  - api-stack.ts: CDK API Gateway wiring (reference for new route setup)
  - session-repository.ts: getRecentRecordings() query pattern (reference for activity query)
  - join-hangout.ts + test: Cognito username pattern, session queries (reference for auth patterns)

### Secondary (MEDIUM confidence)
- **Phase 16-17 contracts (to be verified):**
  - Phase 16: Writes participantCount to session record after hangout ends
  - Phase 17: Writes reactionSummary map to session record after broadcast/hangout ends
  - Both: Ensure messageCount field initialized (Phase 18 depends on this)

### Tertiary (LOW confidence)
- None — all critical patterns verified from codebase

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — React, Tailwind, Lambda, DynamoDB all present and documented in existing code
- Architecture: **HIGH** — GET /activity endpoint mirrors list-recordings.ts pattern; frontend layouts match existing RecordingFeed
- Pitfalls: **MEDIUM** — Derived from common DynamoDB anti-patterns (N+1 queries, missing enrichment) and existing codebase gotchas; Phase 16-17 dependencies not yet implemented so can't verify all assumptions

**Research date:** 2026-03-05
**Valid until:** 2026-03-19 (14 days — frontend UX/API patterns stable, but depends on Phase 16-17 implementation quality)

**Dependencies verified:**
- RecordingFeed.tsx pattern exists and works (Phase 6+)
- API Gateway public endpoints pattern exists (GET /recordings)
- Cognito auth token pattern exists (all POST handlers)
- DynamoDB session queries pattern exists (list-recordings, get-session)

**Dependencies NOT yet verified (Phase 16-17 incomplete):**
- Phase 16 participant tracking schema and participantCount field
- Phase 17 reactionSummary computation and storage
- messageCount initialization in send-message.ts handler
