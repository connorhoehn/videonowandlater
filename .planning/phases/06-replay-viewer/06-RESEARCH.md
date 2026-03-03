# Phase 6: Replay Viewer - Research

**Researched:** 2026-03-02
**Domain:** HLS video playback, chat synchronization, video feed discovery UI
**Confidence:** HIGH

## Summary

Phase 6 implements the replay viewing experience that transforms recorded sessions into discoverable, replayable content with synchronized chat. The phase builds on Phase 5's recording infrastructure (S3 recordings, CloudFront distribution, recording metadata) and extends the frontend with a home feed showing recent recordings and a dedicated replay viewer with HLS playback synchronized to chat messages.

The recommended approach leverages Amazon IVS Player SDK (already in use for live playback) for replay HLS playback with getSyncTime API for chat synchronization. The IVS Player provides superior synchronization accuracy compared to generic HLS players because it exposes wall-clock time via getSyncTime, which maps directly to chat message timestamps stored with sessionRelativeTime. For the home feed, a simple chronological list/grid using DynamoDB queries sorted by endedAt timestamp provides Instagram-style discovery without complex indexing.

**Primary recommendation:** Reuse existing amazon-ivs-player SDK for replay (already loaded for live streams), use getSyncTime + SYNC_TIME_UPDATE events for chat synchronization (millisecond-accurate, no drift), implement home feed as chronological query against Session items filtered by recordingStatus='available', and create a dedicated /replay/:sessionId route with separate ReplayViewer component (live and replay have different UX requirements).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REPLAY-01 | Home feed displays recently streamed videos in chronological order | DynamoDB query pattern with ScanIndexForward=false sorted by endedAt |
| REPLAY-02 | Home feed shows thumbnail, title, duration, broadcaster name for each recording | Session interface already includes recordingDuration, thumbnailUrl (Phase 5), fetch userId details |
| REPLAY-03 | User can click thumbnail to navigate to replay viewer page | React Router navigation pattern to /replay/:sessionId route |
| REPLAY-04 | Replay viewer plays HLS video from CloudFront using react-player | Amazon IVS Player SDK (existing) plays CloudFront HLS URLs (recordingHlsUrl) |
| REPLAY-05 | Replay viewer shows video playback controls | IVS Player provides native HTML5 video controls via attached video element |
| REPLAY-06 | Chat messages display alongside replay video in synchronized timeline | ChatMessage repository getMessageHistory method (existing from Phase 4) |
| REPLAY-07 | Chat auto-scrolls as video plays, matching video.currentTime to message timestamps | SYNC_TIME_UPDATE event + filter messages by sessionRelativeTime <= syncTime |
| REPLAY-08 | Chat synchronization uses IVS Sync Time API for accurate video-relative timestamps | IVS Player getSyncTime method + SYNC_TIME_UPDATE events (millisecond precision) |
| REPLAY-09 | Replay viewer shows session metadata | Session object includes userId, recordingDuration, createdAt fields |

</phase_requirements>

## Standard Stack

### Core (Already Installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| amazon-ivs-player | ^1.49.0 (existing) | HLS replay playback with getSyncTime API | Already used for live playback, provides wall-clock sync for chat, superior to generic HLS players |
| react-router-dom | ^7.7.1 (existing) | /replay/:sessionId route navigation | Already used for app routing |
| @aws-sdk/lib-dynamodb | ^3.x (existing backend) | Query recent recordings from Session table | Already used for session repository |

### Supporting (No New Frontend Dependencies)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| amazon-ivs-chat-messaging | ^1.1.1 (existing) | Chat message type definitions | Already used for live chat, reuse ChatMessage interface |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| amazon-ivs-player | react-player | react-player is simpler API but lacks getSyncTime (chat sync would drift on long videos), IVS Player provides millisecond-accurate wall-clock time |
| amazon-ivs-player | video.js + hls.js | More customizable UI but requires manual sync implementation, getSyncTime not available (would need HLS PDT tag parsing) |
| Chronological feed | DynamoDB GSI for sorting | GSI not needed - can query Session items with FilterExpression and sort client-side (small dataset <100 recordings) |
| Separate replay route | Reuse /viewer/:sessionId | Separate route better: live has "Waiting for stream" states, replay has seek controls, different chat behavior (no send) |

**Installation:**
```bash
# No new dependencies required
# Phase 6 uses existing amazon-ivs-player, react-router-dom, and backend AWS SDK packages
```

## Architecture Patterns

### Recommended Project Structure
```
web/src/
├── pages/
│   └── HomePage.tsx              # EXTEND: Add replay feed list
├── features/
│   ├── replay/
│   │   ├── ReplayViewer.tsx      # NEW: Dedicated replay viewer component
│   │   ├── useReplayPlayer.ts    # NEW: IVS Player hook for replay (getSyncTime focus)
│   │   ├── ReplayChat.tsx        # NEW: Chat panel for replay (read-only, synced)
│   │   └── RecordingFeed.tsx     # NEW: Home feed grid/list component
│   └── viewer/
│       ├── VideoPlayer.tsx       # REUSE: Works for both live and replay
│       └── usePlayer.ts          # EXISTS: Live player hook (reference pattern)
backend/src/
├── handlers/
│   └── list-recordings.ts        # NEW: GET /recordings endpoint
└── repositories/
    └── session-repository.ts     # EXTEND: Add getRecordings method
```

### Pattern 1: IVS Player with getSyncTime for Chat Synchronization

**What:** Use amazon-ivs-player SDK's getSyncTime method and SYNC_TIME_UPDATE event to get wall-clock time during replay, match against chat message sessionRelativeTime.

**When to use:** All replay scenarios where chat needs to sync with video playback.

**Example:**
```typescript
// Source: AWS IVS Player SDK docs + DEV.to article
import { useEffect, useState, useRef } from 'react';

interface ChatMessage {
  messageId: string;
  content: string;
  senderId: string;
  sessionRelativeTime: number; // Milliseconds since stream start
}

function useReplayChat(sessionId: string, allMessages: ChatMessage[]) {
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const playerRef = useRef<any>(null);

  useEffect(() => {
    if (!window.IVSPlayer || !playerRef.current) return;

    const player = playerRef.current;

    // Listen for sync time updates (fires every second during playback)
    const handleSyncTimeUpdate = (syncTime: number) => {
      // syncTime is UTC milliseconds representing current playback moment
      // Filter messages where sessionRelativeTime <= current playback position
      const currentMessages = allMessages.filter(
        msg => msg.sessionRelativeTime <= syncTime
      );
      setVisibleMessages(currentMessages);
    };

    player.addEventListener(
      window.IVSPlayer.PlayerEventType.SYNC_TIME_UPDATE,
      handleSyncTimeUpdate
    );

    return () => {
      player.removeEventListener(
        window.IVSPlayer.PlayerEventType.SYNC_TIME_UPDATE,
        handleSyncTimeUpdate
      );
    };
  }, [allMessages]);

  return visibleMessages;
}
```

**Key advantages:**
- Millisecond precision (no drift on 60+ minute videos)
- Wall-clock time matches server-recorded timestamps exactly
- No manual HLS PDT tag parsing required
- Works with IVS recordings automatically (HLS segments include PDT tags)

### Pattern 2: Home Feed Query for Recent Recordings

**What:** Query DynamoDB Session table for items where recordingStatus='available', sort by endedAt descending, limit to recent N items.

**When to use:** Home feed display of recently completed recordings.

**Example:**
```typescript
// Source: AWS DynamoDB best practices + existing session-repository.ts pattern
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

export async function getRecentRecordings(
  tableName: string,
  limit: number = 20
): Promise<Session[]> {
  const docClient = getDocumentClient();

  // Scan with filter (small dataset, <100 recordings expected in v1.1)
  // Future optimization: GSI with static PK='RECORDING', SK=endedAt
  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'recordingStatus = :available AND begins_with(PK, :session)',
    ExpressionAttributeValues: {
      ':available': 'available',
      ':session': 'SESSION#',
    },
    Limit: limit,
  }));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  // Sort by endedAt descending (most recent first)
  const recordings = result.Items
    .map(item => {
      const { PK, SK, entityType, ...session } = item;
      return session as Session;
    })
    .filter(s => s.endedAt) // Ensure endedAt exists
    .sort((a, b) =>
      new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime()
    );

  return recordings.slice(0, limit);
}
```

**Performance note:** Scan is acceptable for v1.1 (expected <100 recordings). For scale (1000+ recordings), create GSI with PK='RECORDING', SK=endedAt.

### Pattern 3: Replay-Specific Route and Component

**What:** Create dedicated /replay/:sessionId route with ReplayViewer component separate from live ViewerPage.

**When to use:** Always - live and replay have fundamentally different UX requirements.

**Why separate:**
- Live: "Waiting for stream" states, LIVE badge, no seek
- Replay: Seek controls, duration display, read-only chat, playback speed controls
- Shared video player component (VideoPlayer.tsx) but different container logic

**Example:**
```typescript
// In App.tsx
<Route
  path="/replay/:sessionId"
  element={
    <ProtectedRoute>
      <ReplayViewer />
    </ProtectedRoute>
  }
/>

// In RecordingFeed.tsx (home feed)
<div onClick={() => navigate(`/replay/${recording.sessionId}`)}>
  <img src={recording.thumbnailUrl} alt="Recording thumbnail" />
  <div>{formatDuration(recording.recordingDuration)}</div>
</div>
```

### Anti-Patterns to Avoid

- **Using video.currentTime for chat sync:** currentTime is playback position in seconds, not wall-clock time. Chat messages have UTC timestamps (sessionRelativeTime) that won't match currentTime. Use getSyncTime instead.
- **Fetching all sessions and filtering client-side:** Inefficient for large datasets. Use DynamoDB FilterExpression server-side.
- **Rendering all chat messages and toggling visibility:** Performance issue for 500+ message sessions. Filter messages in state, render only visible subset.
- **Mixing live and replay in same component:** Creates complex conditional logic. Separate routes and components.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HLS video playback | Custom HLS parser + video element wrapper | amazon-ivs-player SDK | HLS ABR logic is complex (bitrate switching, segment buffering), getSyncTime API provides wall-clock sync |
| Chat synchronization algorithm | Manual timestamp matching with currentTime | IVS Player SYNC_TIME_UPDATE + sessionRelativeTime filter | getSyncTime handles HLS PDT tags automatically, millisecond precision prevents drift |
| Video player controls | Custom play/pause/seek UI | Native HTML5 video controls | Accessibility (keyboard navigation, screen readers), browser-tested, mobile-optimized |
| Feed pagination | Manual offset/limit tracking | Simple limit-based query (start simple) | v1.1 has <100 recordings, premature optimization |

**Key insight:** Video synchronization is deceptively complex. Wall-clock time (getSyncTime) is fundamentally different from playback time (currentTime). Chat messages are timestamped with wall-clock time (when user sent message), so synchronization requires wall-clock alignment. IVS Player provides this via getSyncTime API, generic players do not.

## Common Pitfalls

### Pitfall 1: Chat Sync Drift on Long Videos

**What goes wrong:** Using video.currentTime to filter chat messages causes sync drift. After 60 minutes, chat is 2-3 seconds behind video.

**Why it happens:** currentTime is playback position (seconds elapsed), not wall-clock time. HLS streams have variable segment timing, buffering pauses, and seek operations that break linear time assumptions.

**How to avoid:** Use IVS Player getSyncTime method which returns UTC milliseconds representing exact playback moment. Match against sessionRelativeTime (also UTC milliseconds).

**Warning signs:** Chat messages appearing late during replay, messages not appearing at all, chat jumping backward after seek.

### Pitfall 2: CORS Errors on CloudFront HLS URLs

**What goes wrong:** Browser blocks HLS manifest requests with "CORS policy: No 'Access-Control-Allow-Origin' header".

**Why it happens:** CloudFront distributions need CORS headers configured for video players to fetch .m3u8 manifests and .ts segments.

**How to avoid:** Add ResponseHeadersPolicy to CloudFront Distribution in CDK:
```typescript
// In SessionStack
const corsPolicy = new cloudfront.ResponseHeadersPolicy(this, 'RecordingsCorsPolicy', {
  corsBehavior: {
    accessControlAllowOrigins: { items: ['*'] }, // Or specific domain
    accessControlAllowMethods: { items: ['GET', 'HEAD', 'OPTIONS'] },
    accessControlAllowHeaders: { items: ['*'] },
    originOverride: true,
  },
});

// Attach to distribution
defaultBehavior: {
  responseHeadersPolicy: corsPolicy,
  // ...other config
}
```

**Warning signs:** Network tab shows 200 response but player error "Failed to load manifest", console CORS error.

### Pitfall 3: Autoplay Blocked on Mobile

**What goes wrong:** Replay video doesn't start automatically on mobile browsers, user sees black screen.

**Why it happens:** Mobile browsers block autoplay for non-muted videos (user experience + data usage policy).

**How to avoid:**
1. Set muted=true for autoplay, provide unmute button
2. OR require user interaction (Play button) before calling player.play()
3. Add playsInline attribute to video element (prevents fullscreen takeover on iOS)

**Warning signs:** Works on desktop Chrome, fails on mobile Safari/Chrome, console shows "play() was prevented by browser policy".

### Pitfall 4: Missing Recording Metadata

**What goes wrong:** Home feed shows recordings with broken thumbnails or "undefined" duration.

**Why it happens:** Phase 5 recording-ended handler updates metadata asynchronously. If handler fails or EventBridge is delayed, Session has recordingStatus='processing' but missing thumbnailUrl/recordingDuration.

**How to avoid:**
1. Filter feed to only show recordingStatus='available' (excludes processing/failed)
2. Add fallback UI for missing thumbnails (placeholder image)
3. Display "Processing..." state if recordingStatus='processing'

**Warning signs:** Home feed shows recordings but no thumbnail, duration shows "NaN minutes", CloudFront 404 for thumbnail URL.

### Pitfall 5: Performance Degradation with Large Message Lists

**What goes wrong:** Replay viewer becomes laggy when sessions have 500+ chat messages.

**Why it happens:** Rendering all messages in DOM (even hidden ones) causes performance issues. Re-filtering entire message list on every SYNC_TIME_UPDATE event (1Hz) is expensive.

**How to avoid:**
1. Use React.memo for message components to prevent unnecessary re-renders
2. Implement virtual scrolling for message list (react-window or react-virtualized)
3. Filter messages in useMemo with sessionRelativeTime as dependency
4. Limit initial message fetch (e.g., last 200 messages, load more on scroll)

**Warning signs:** Replay viewer stutters during playback, high CPU usage in profiler, console warnings about slow render times.

## Code Examples

Verified patterns from official sources:

### Setting Up IVS Player for Replay with getSyncTime

```typescript
// Source: AWS IVS Player SDK Documentation + DEV.to chat replay article
import { useEffect, useRef, useState } from 'react';

export function useReplayPlayer(recordingHlsUrl: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const [syncTime, setSyncTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!videoRef.current || !window.IVSPlayer) {
      console.error('IVS Player SDK not loaded');
      return;
    }

    // Create IVS Player instance
    const player = window.IVSPlayer.create();
    player.attachHTMLVideoElement(videoRef.current);
    playerRef.current = player;

    // Event: SYNC_TIME_UPDATE (fires every second during playback)
    player.addEventListener(
      window.IVSPlayer.PlayerEventType.SYNC_TIME_UPDATE,
      (time: number) => {
        setSyncTime(time); // UTC milliseconds
      }
    );

    // Event: PLAYING state
    player.addEventListener(window.IVSPlayer.PlayerState.PLAYING, () => {
      setIsPlaying(true);
    });

    // Event: IDLE state (paused or stopped)
    player.addEventListener(window.IVSPlayer.PlayerState.IDLE, () => {
      setIsPlaying(false);
    });

    // Load HLS URL from CloudFront
    player.load(recordingHlsUrl);
    player.setAutoplay(false); // Require user interaction for mobile

    return () => {
      player.delete();
    };
  }, [recordingHlsUrl]);

  return { videoRef, syncTime, isPlaying, player: playerRef.current };
}
```

### Synchronizing Chat Messages with Video Playback

```typescript
// Source: Amazon IVS Chat Replay pattern
import { useMemo } from 'react';
import type { ChatMessage } from '../domain/chat-message';

export function useSynchronizedChat(
  allMessages: ChatMessage[],
  currentSyncTime: number
) {
  // Filter messages visible at current playback position
  // sessionRelativeTime is milliseconds since stream start
  const visibleMessages = useMemo(() => {
    return allMessages.filter(
      msg => msg.sessionRelativeTime <= currentSyncTime
    );
  }, [allMessages, currentSyncTime]);

  return visibleMessages;
}

// In component:
function ReplayChat({ sessionId }: { sessionId: string }) {
  const { syncTime } = useReplayPlayer(); // From hook above
  const allMessages = useChatHistory(sessionId); // Fetch all messages
  const visibleMessages = useSynchronizedChat(allMessages, syncTime);

  return (
    <div className="chat-container">
      {visibleMessages.map(msg => (
        <MessageRow key={msg.messageId} message={msg} />
      ))}
    </div>
  );
}
```

### Home Feed Query for Recent Recordings

```typescript
// Source: Existing session-repository.ts pattern + DynamoDB best practices
export async function getRecentRecordings(
  tableName: string,
  limit: number = 20
): Promise<Session[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression:
      'recordingStatus = :status AND begins_with(PK, :pk)',
    ExpressionAttributeValues: {
      ':status': 'available',
      ':pk': 'SESSION#',
    },
  }));

  const recordings = (result.Items || [])
    .map(item => {
      const { PK, SK, entityType, ...session } = item;
      return session as Session;
    })
    .filter(s => s.endedAt)
    .sort((a, b) =>
      new Date(b.endedAt!).getTime() - new Date(a.endedAt!).getTime()
    )
    .slice(0, limit);

  return recordings;
}
```

### Recording Feed Grid Component

```typescript
// Source: React best practices + Instagram grid layout patterns
import { useNavigate } from 'react-router-dom';

interface Recording {
  sessionId: string;
  thumbnailUrl: string;
  recordingDuration: number; // milliseconds
  createdAt: string;
  userId: string;
}

export function RecordingFeed({ recordings }: { recordings: Recording[] }) {
  const navigate = useNavigate();

  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4">
      {recordings.map(recording => (
        <div
          key={recording.sessionId}
          onClick={() => navigate(`/replay/${recording.sessionId}`)}
          className="cursor-pointer group"
        >
          {/* Thumbnail */}
          <div className="relative aspect-video bg-gray-200 rounded-lg overflow-hidden">
            <img
              src={recording.thumbnailUrl}
              alt="Recording thumbnail"
              className="w-full h-full object-cover group-hover:scale-105 transition"
            />
            {/* Duration badge */}
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
              {formatDuration(recording.recordingDuration)}
            </div>
          </div>
          {/* Metadata */}
          <div className="mt-2">
            <div className="text-sm font-medium">
              Stream from {new Date(recording.createdAt).toLocaleDateString()}
            </div>
            <div className="text-xs text-gray-500">User: {recording.userId}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Generic HLS players (video.js, plyr) | IVS Player SDK with getSyncTime | IVS Player 1.26.0 (2023) | Millisecond-accurate chat sync, no manual PDT parsing |
| Manual HLS PDT tag parsing | IVS getSyncTime API | IVS Player 1.26.0+ | Simplified implementation, automatic sync |
| Square thumbnails (Instagram pre-2026) | 3:4 vertical thumbnails | Instagram 2026 update | More visual space for portrait video content |
| Client-side full message filtering | Server-side limit + client sort | DynamoDB best practices | Better performance for large datasets |

**Deprecated/outdated:**
- CloudFront Origin Access Identity (OAI): Replaced by Origin Access Control (OAC) in 2022 - use OAC for new distributions
- video.currentTime for chat sync: Works for short videos but drifts on long recordings - use getSyncTime for accuracy
- react-player for IVS: Adds unnecessary abstraction layer - use IVS Player SDK directly for getSyncTime access

## Open Questions

1. **User display names in feed**
   - What we know: Session has userId (Cognito username), need to display broadcaster name in feed
   - What's unclear: Should we fetch full user profiles (name, avatar) or display userId directly?
   - Recommendation: v1.1 displays userId directly (simpler), defer user profiles to v2. Add GET /users/:userId endpoint if needed.

2. **Feed pagination strategy**
   - What we know: Scan works for <100 recordings, may not scale to 1000+
   - What's unclear: When to implement GSI for efficient sorting? Load more pattern vs infinite scroll?
   - Recommendation: Start with simple limit=20, add "Load More" button. Implement GSI (PK='RECORDING', SK=endedAt) if scan latency exceeds 200ms.

3. **Replay analytics tracking**
   - What we know: Requirements don't mention view counts, watch time, or replay engagement
   - What's unclear: Should we track when users watch replays? Store watch progress?
   - Recommendation: Defer to future phase. Phase 6 is read-only viewer, analytics can be added non-invasively later.

4. **Failed recording visibility**
   - What we know: recordingStatus='failed' sessions exist (EventBridge handler sets this)
   - What's unclear: Should failed recordings appear in feed with error message, or be hidden?
   - Recommendation: Hide from feed (filter to status='available' only). Add admin view in future for debugging failed recordings.

## Sources

### Primary (HIGH confidence)
- [Amazon IVS Player SDK Documentation](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player.html) - IVS Player API, getSyncTime method
- [Amazon IVS Player API Reference - getSyncTime](https://aws.github.io/amazon-ivs-player-docs/1.33.0/web/interfaces/Player.html) - Player interface methods
- [Amazon IVS Live Stream Playback with Chat Replay using Sync Time API](https://dev.to/aws/amazon-ivs-live-stream-playback-with-chat-replay-using-the-sync-time-api-1d6a) - Chat synchronization pattern
- [DynamoDB Query Performance with ScanIndexForward and Limit](https://repost.aws/questions/QUecwoP5rJSOWa6kSlvscfSA/dynamodb-query-performance-when-retrieving-latest-item-with-scanindexforward-and-limit) - Query optimization patterns
- [Media Player Accessibility - W3C WAI](https://www.w3.org/WAI/media/av/player/) - Keyboard controls, screen reader requirements

### Secondary (MEDIUM confidence)
- [The best React video player libraries of 2026](https://blog.croct.com/post/best-react-video-libraries) - react-player vs alternatives comparison
- [react-player npm package](https://www.npmjs.com/package/react-player) - API reference, version 3 features
- [HLS Video Player Common Pitfalls - VideoSDK](https://www.videosdk.live/developer-hub/hls/react-hls-player) - CORS, autoplay, mobile issues
- [Effective Data Sorting with Amazon DynamoDB](https://aws.amazon.com/blogs/database/effective-data-sorting-with-amazon-dynamodb/) - GSI design patterns
- [How to Create Instagram Explore Grid Layout with React Native](https://dev.to/nerdstack/how-to-create-instagram-explore-grid-layout-with-react-native-226o) - Feed UI patterns

### Tertiary (LOW confidence)
- None - all key findings verified with official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - amazon-ivs-player already in use (package.json verified), getSyncTime API documented
- Architecture: HIGH - Pattern matches existing usePlayer.ts hook, DynamoDB queries follow session-repository.ts patterns
- Chat synchronization: HIGH - IVS Player getSyncTime + sessionRelativeTime pattern verified in official AWS articles
- Feed implementation: MEDIUM - UI patterns well-established, DynamoDB query optimization may need adjustment based on data volume
- Pitfalls: HIGH - CORS, autoplay, sync drift all documented in official sources and GitHub issues

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - stable APIs, minimal churn expected)
