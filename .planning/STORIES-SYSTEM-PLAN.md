# Stories System — Complete Design Plan

## Overview

An Instagram-style Stories feature for VideoNowAndLater. Stories are ephemeral (24h) short-form content — images or video clips — that appear in a horizontal slider on the home feed and open in a full-screen viewer.

## What Already Exists

| Layer | Component | Status |
|-------|-----------|--------|
| Frontend | `StoriesSlider` — horizontal scrollable thumbnails with "Post a Story" | DONE |
| Frontend | `StoryViewer` — full-screen viewer with progress bars, tap zones, reactions, replies | DONE |
| Frontend | `LiveBroadcastsSlider` — maps live broadcasts to StoriesSlider | DONE |
| Backend | Reaction system (sharded, real-time via IVS chat) | DONE |
| Backend | Chat messaging (IVS SDK, persistent storage) | DONE |
| Backend | Comment system (timestamped, threaded) | DONE |
| Backend | Session model, DynamoDB single-table | DONE |
| Infra | S3, CloudFront, EventBridge, SQS pipeline | DONE |

## What Needs to Be Built

---

## Phase 1: Story Data Model & API

### 1A. Data Model

Stories reuse the `Session` entity with `sessionType: 'STORY'`. No new DynamoDB table needed.

```typescript
// Addition to SessionType enum
STORY = 'STORY'

// New fields on Session (only used when sessionType === 'STORY')
storyExpiresAt?: string;        // ISO 8601, set to createdAt + 24h
storySegments?: StorySegment[]; // ordered array of content segments
storyViewCount?: number;        // total unique views
storyReplyCount?: number;       // total replies received
```

```typescript
interface StorySegment {
  segmentId: string;
  type: 'image' | 'video';
  s3Key: string;             // S3 key in transcription bucket
  url?: string;              // CloudFront URL (derived)
  duration?: number;         // ms — required for video, default 5000 for image
  thumbnailS3Key?: string;   // poster frame for video segments
  order: number;             // display order
  createdAt: string;
}
```

### 1B. Story View Tracking

Track who viewed each story (for "viewers" list and seen/unseen ring state):

```
DynamoDB Key Pattern:
  PK: STORY_VIEW#{sessionId}
  SK: #{userId}
  Attributes: viewedAt (ISO), userId
```

### 1C. Story Reaction Storage

Reuse the existing reaction system pattern with a story-specific key:

```
DynamoDB Key Pattern:
  PK: STORY_REACTION#{sessionId}#{segmentId}
  SK: #{userId}#{emoji}
  Attributes: emoji, userId, createdAt
```

No sharding needed — story reactions are lower throughput than live broadcast reactions.

### 1D. Story Reply Storage

Replies are private messages from viewer → story owner:

```
DynamoDB Key Pattern:
  PK: STORY_REPLY#{sessionId}
  SK: #{createdAt}#{replyId}
  Attributes: replyId, senderId, content, segmentId, createdAt
```

---

## Phase 2: Backend API Endpoints

### 2A. Create Story

```
POST /sessions
Body: { sessionType: 'STORY' }
Response: { sessionId, uploadUrl (presigned S3 PUT) }
```

Reuses existing `create-session` handler. Adds STORY session type handling:
- No IVS channel/stage needed
- No chat room needed (replies use DynamoDB directly)
- Sets `storyExpiresAt = now + 24h`
- Returns presigned S3 URL for segment upload

### 2B. Add Story Segment

```
POST /stories/:sessionId/segments
Body: { type: 'image' | 'video', duration?: number }
Response: { segmentId, uploadUrl (presigned S3 PUT) }
```

New handler: `add-story-segment.ts`
- Validates session is STORY type and owned by caller
- Generates presigned S3 PUT URL for the segment file
- Appends segment to `storySegments[]` array on session
- Limit: max 10 segments per story

### 2C. Publish Story

```
POST /stories/:sessionId/publish
Response: { status: 'published' }
```

New handler: `publish-story.ts`
- Transitions session status from CREATING → LIVE (reuse existing states)
- Validates at least 1 segment exists
- Generates CloudFront URLs for all segments
- Story becomes visible in feeds

### 2D. Get Stories Feed

```
GET /stories
Response: {
  stories: [{
    userId: string,
    userAvatar?: string,
    hasUnseenStories: boolean,
    stories: [{
      sessionId, segments[], createdAt, storyExpiresAt, viewCount
    }]
  }]
}
```

New handler: `get-stories-feed.ts`
- Queries sessions where `sessionType = 'STORY'` and `storyExpiresAt > now`
- Groups by userId
- Checks STORY_VIEW records to determine seen/unseen for current user
- Orders: unseen users first, then by most recent story

### 2E. Mark Story Viewed

```
POST /stories/:sessionId/view
Response: { viewCount: number }
```

New handler: `view-story.ts`
- Creates STORY_VIEW record (idempotent — PK+SK is userId)
- Increments `storyViewCount` on session (atomic counter)
- Non-blocking, fire-and-forget from client

### 2F. React to Story

```
POST /stories/:sessionId/react
Body: { segmentId: string, emoji: string }
Response: { ok: true }
```

New handler: `react-to-story.ts`
- Creates STORY_REACTION record
- Limit: 1 reaction per user per segment (upsert)
- Could notify story owner via push/WebSocket in future

### 2G. Reply to Story

```
POST /stories/:sessionId/reply
Body: { segmentId: string, message: string }
Response: { replyId: string }
```

New handler: `reply-to-story.ts`
- Creates STORY_REPLY record
- Increments `storyReplyCount` on session
- Could notify story owner via push/WebSocket in future

### 2H. Get Story Viewers

```
GET /stories/:sessionId/viewers
Response: { viewers: [{ userId, viewedAt }], total: number }
```

New handler: `get-story-viewers.ts`
- Query STORY_VIEW records for the session
- Only accessible by story owner

### 2I. Get Story Replies

```
GET /stories/:sessionId/replies
Response: { replies: [{ replyId, senderId, content, segmentId, createdAt }] }
```

New handler: `get-story-replies.ts`
- Query STORY_REPLY records for the session
- Only accessible by story owner

### 2J. Delete Story

```
DELETE /stories/:sessionId
Response: { ok: true }
```

Reuse existing `end-session` or new handler:
- Sets status to ENDED
- Clears `storyExpiresAt` (or sets to now)
- S3 objects cleaned up by expiration

### 2K. Expire Stories (Scheduled)

New handler: `expire-stories.ts`
- Triggered by EventBridge scheduled rule (every 1 hour)
- Scans for STORY sessions where `storyExpiresAt < now` and `status !== 'ended'`
- Sets status to ENDED for each
- Optional: delete S3 objects or let lifecycle policy handle it

---

## Phase 3: Frontend Integration

### 3A. Story Creation Flow

**"Post a Story" button** in StoriesSlider opens a creation modal:

```
User taps "Post a Story"
  → Modal opens with two options:
    1. "Go Live" — creates a BROADCAST session (existing flow)
    2. "Upload Story" — opens file picker
  
If "Upload Story":
  → File picker (images + videos, max 60s video, max 10 files)
  → POST /sessions { sessionType: 'STORY' }
  → For each file: POST /stories/:id/segments → upload to presigned URL
  → Preview segments in order (drag to reorder?)
  → POST /stories/:id/publish
  → Story appears in feed
```

New component: `StoryCreator.tsx`
- Modal with file picker
- Upload progress per segment
- Segment preview/reorder
- Publish button

### 3B. Story Feed Hook

```typescript
// web/src/hooks/useStories.ts
export function useStories() {
  // GET /stories — grouped by user, with seen/unseen state
  // Returns: { storyUsers, loading, markViewed, refresh }
  // markViewed(sessionId) → POST /stories/:id/view
}
```

### 3C. HomePage Integration

```tsx
// In HomePage:
const { storyUsers } = useStories();

// Map to StoriesSlider
<StoriesSlider
  stories={storyUsers.map(u => ({
    id: u.userId,
    name: u.userId,
    thumbnail: u.stories[0].segments[0].url,
    hasUnread: u.hasUnseenStories,
  }))}
  onStoryView={(index) => openStoryViewer(storyUsers, index)}
  onCreateStory={() => setShowStoryCreator(true)}
/>

// StoryViewer
<StoryViewer
  isOpen={storyViewerOpen}
  users={storyUsers.map(u => ({ id: u.userId, name: u.userId, ... }))}
  getSegments={(userId) => /* map user's story segments */}
  onReact={(userId, segmentId, emoji) => reactToStory(sessionId, segmentId, emoji)}
  onReply={(userId, segmentId, message) => replyToStory(sessionId, segmentId, message)}
  onClose={() => setStoryViewerOpen(false)}
/>
```

### 3D. Story Ring State

The `Avatar` component already supports `hasStory` prop (gradient ring). Wire it:
- In sidebar "Who to watch" — show story ring for users with active stories
- In feed post headers — show story ring on authors with active stories
- In StoriesSlider — ring on thumbnails with unseen stories

### 3E. Seen/Unseen Tracking

Dual strategy:
- **Server**: `POST /stories/:id/view` when user opens a story
- **Client**: `localStorage` cache of `{ [sessionId]: viewedAt }` for instant ring state without API call

```typescript
// web/src/hooks/useStoryViewState.ts
export function useStoryViewState() {
  // Read from localStorage on mount
  // markViewed(sessionId): update localStorage + fire POST /stories/:id/view
  // hasViewed(sessionId): check localStorage
}
```

---

## Phase 4: Story-Specific UX

### 4A. User Interaction Map

| Action | Where | What Happens |
|--------|-------|-------------|
| Tap "Post a Story" | StoriesSlider | Opens StoryCreator modal |
| Tap a story thumbnail | StoriesSlider | Opens StoryViewer at that user |
| Tap right 70% | StoryViewer | Next segment or next user |
| Tap left 30% | StoryViewer | Previous segment or previous user |
| Long press | StoryViewer | Pauses timer and progress bar |
| Release long press | StoryViewer | Resumes timer |
| Tap emoji reaction | StoryViewer | POST react, show fly-up animation |
| Type reply + send | StoryViewer | POST reply, show "Sent" toast |
| Tap X or swipe down | StoryViewer | Close viewer |
| Tap ... menu | StoryViewer | Dropdown: Report, Mute, Copy Link |
| Tap avatar in header | StoryViewer | Navigate to user's profile |
| Keyboard → | StoryViewer | Next segment |
| Keyboard ← | StoryViewer | Previous segment |
| Keyboard Space | StoryViewer | Pause/resume |
| Keyboard Escape | StoryViewer | Close |
| Focus message input | StoryViewer | Pause timer |
| Blur message input | StoryViewer | Resume timer |

### 4B. Story Owner View

When viewing your own story:
- Replace "Send message..." with viewer count: "Seen by 12"
- Tap "Seen by 12" → opens viewer list (avatars + names + timestamps)
- Show reply inbox: list of replies grouped by segment
- Swipe up → see replies for current segment

### 4C. Live Broadcast as Story

When a user is broadcasting live:
- Their story thumbnail shows "LIVE" badge (red pulsing dot)
- Tapping opens the ViewerPage (joins live), NOT the StoryViewer
- After broadcast ends, the recording becomes a story segment automatically
- Recording stays as story for 24h, then becomes a regular recording

### 4D. Edge Cases

| Scenario | Handling |
|----------|----------|
| Story expires while viewing | Show "Story no longer available" toast, advance to next user |
| Video fails to load | Show error placeholder, auto-skip after 2s |
| Image fails to load | Show broken image placeholder, auto-skip |
| User has 10+ segments | Allow scrolling, but cap at 10 for creation |
| Multiple stories from same user | Group as consecutive segments in viewer |
| No stories in feed | Hide StoriesSlider entirely |
| Slow network | Show loading spinner on segment, pause timer until loaded |
| User deletes story while others viewing | Current viewers finish, new viewers get "not found" |

---

## Phase 5: Infrastructure

### 5A. CDK Changes

```typescript
// New handlers to create:
// - add-story-segment.ts
// - publish-story.ts
// - get-stories-feed.ts
// - view-story.ts
// - react-to-story.ts
// - reply-to-story.ts
// - get-story-viewers.ts
// - get-story-replies.ts
// - expire-stories.ts (scheduled)

// New API routes:
// POST   /stories/:sessionId/segments
// POST   /stories/:sessionId/publish
// GET    /stories
// POST   /stories/:sessionId/view
// POST   /stories/:sessionId/react
// POST   /stories/:sessionId/reply
// GET    /stories/:sessionId/viewers
// GET    /stories/:sessionId/replies
// DELETE /stories/:sessionId

// New EventBridge scheduled rule:
// expire-stories: rate(1 hour)

// S3 lifecycle policy:
// Objects in stories/ prefix → expire after 48h (24h buffer after story expires)
```

### 5B. DynamoDB Access Patterns

| Access Pattern | Key Design | Handler |
|---------------|-----------|---------|
| Get stories feed (active, grouped) | Scan STORY sessions where expiresAt > now | get-stories-feed |
| Get story segments | GetItem SESSION#{id} METADATA → storySegments[] | get-session |
| Mark story viewed | PutItem STORY_VIEW#{sessionId} #{userId} | view-story |
| Check if viewed | GetItem STORY_VIEW#{sessionId} #{userId} | get-stories-feed |
| React to segment | PutItem STORY_REACTION#{sessionId}#{segmentId} #{userId}#{emoji} | react-to-story |
| Reply to story | PutItem STORY_REPLY#{sessionId} #{createdAt}#{replyId} | reply-to-story |
| Get viewers | Query STORY_VIEW#{sessionId} | get-story-viewers |
| Get replies | Query STORY_REPLY#{sessionId} | get-story-replies |
| Expire old stories | Scan sessions where expiresAt < now | expire-stories |

**GSI needed**: `GSI-StoryFeed` with `PK: sessionType = 'STORY'`, `SK: storyExpiresAt` — enables efficient query for active stories without scan.

---

## Implementation Priority

### v1 (MVP) — Build First
1. `STORY` session type in data model
2. `POST /sessions` with `sessionType: 'STORY'`
3. `add-story-segment` handler + S3 presigned upload
4. `publish-story` handler
5. `get-stories-feed` handler (active stories, seen/unseen)
6. `view-story` handler (mark viewed)
7. `StoryCreator` component (file upload flow)
8. `useStories` hook
9. Wire StoriesSlider + StoryViewer to real API data
10. localStorage seen/unseen cache

### v2 — Polish
11. `react-to-story` + `reply-to-story` handlers
12. Wire StoryViewer reactions/replies to backend
13. Story owner view (viewer count, reply inbox)
14. `expire-stories` scheduled Lambda
15. Live broadcast → story auto-conversion
16. Story ring on avatars throughout the app

### v3 — Advanced
17. Story highlights (pin to profile)
18. Story analytics dashboard
19. Privacy controls (public/friends-only)
20. Push notifications for replies
21. Story mention/tag other users
22. AR filters / text overlays (heavy lift)

---

## File Inventory (What to Create)

### Backend (9 new handlers)
```
backend/src/handlers/
  add-story-segment.ts
  publish-story.ts
  get-stories-feed.ts
  view-story.ts
  react-to-story.ts
  reply-to-story.ts
  get-story-viewers.ts
  get-story-replies.ts
  expire-stories.ts
```

### Backend (repository updates)
```
backend/src/repositories/
  story-repository.ts          (new — story views, reactions, replies)
  session-repository.ts        (update — add storySegments handling)
```

### Backend (domain updates)
```
backend/src/domain/
  session.ts                   (update — STORY type, new fields)
  story.ts                     (new — StorySegment, StoryView, StoryReaction, StoryReply types)
```

### Frontend (3 new components)
```
web/src/components/social/
  StoryCreator.tsx             (new — upload + publish flow)
```

### Frontend (2 new hooks)
```
web/src/hooks/
  useStories.ts                (new — stories feed, mark viewed)
  useStoryViewState.ts         (new — localStorage seen/unseen cache)
```

### Frontend (updates)
```
web/src/pages/HomePage.tsx                  (wire stories to real data)
web/src/features/activity/LiveBroadcastsSlider.tsx  (merge with stories feed)
web/src/components/AuthenticatedShell.tsx    (story ring on sidebar avatars)
```

### Infrastructure
```
infra/lib/stacks/session-stack.ts           (9 new Lambdas, API routes, scheduled rule, GSI)
```
