# Phase 7: Reactions & Chat Sync - Research

**Researched:** 2026-03-02
**Domain:** Real-time emoji reactions, DynamoDB hot partition sharding, timeline synchronization, floating animations
**Confidence:** HIGH

## Summary

Phase 7 implements emoji reaction capabilities for both live broadcasts and replay viewing, synchronized to video timeline. Users can send emoji reactions (heart, fire, clap, laugh, surprised) that display as floating animations and are stored with precise timestamps for replay synchronization. The system must handle viral reaction spikes (500+ concurrent users) without DynamoDB throttling through partition sharding strategies.

The recommended approach leverages IVS Chat SendEvent API for live reaction delivery (4KB metadata limit, server-side events), DynamoDB write sharding to distribute reaction writes across multiple partition keys (avoiding hot partition throttling), and Motion (formerly Framer Motion) for performant floating emoji animations (120fps hardware acceleration). For replay, reactions are stored with sessionRelativeTime matching the existing chat message pattern (Phase 6) and displayed as timeline markers synchronized to IVS Player getSyncTime.

**Primary recommendation:** Use IVS Chat SendEvent API with custom event type "reaction" for live broadcasts (leverages existing chat infrastructure), implement calculated write sharding with 50-100 shards for reaction writes (sessionId#emojiType#shardId pattern), create GSI2 for time-range queries (PK=sessionId, SK=sessionRelativeTime), use Motion library for floating animations (React 19 compatible, hardware-accelerated), and reuse Phase 6's synchronization pattern (SYNC_TIME_UPDATE + sessionRelativeTime filtering) for replay reactions.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| REACT-01 | Users can send emoji reactions during live broadcasts (heart, fire, clap, laugh, surprised) | IVS Chat SendEvent API with custom event type, emoji payload in attributes |
| REACT-02 | Live reactions display as floating animations on broadcaster and viewer screens | Motion library for React with floating animation patterns, 120fps hardware acceleration |
| REACT-03 | Reactions sent via IVS Chat custom events | SendEvent API documented, roomIdentifier + eventName + attributes (max 4KB) |
| REACT-04 | Reactions stored in DynamoDB with sessionRelativeTime (ms since stream start) | Same pattern as ChatMessage domain model (Phase 4), calculateSessionRelativeTime utility |
| REACT-05 | DynamoDB GSI2 created for time-range queries of reactions (supports replay sync) | GSI with PK=sessionId, SK=sessionRelativeTime for efficient range queries |
| REACT-06 | Reaction writes sharded across partitions to handle viral spikes (500+ concurrent users) | Calculated write sharding with 50-100 shards, (hash of userId) mod N pattern |
| REACT-07 | Users can send emoji reactions during replay viewing | POST endpoint to store replay reactions, distinguished by reactionType='replay' |
| REACT-08 | Replay reactions stored with video timestamp and distinguished from live reactions | Add reactionType field ('live' vs 'replay'), store with sessionRelativeTime |
| REACT-09 | Replay viewer displays reaction timeline synchronized to video playback position | Reuse Phase 6 useSynchronizedChat pattern, filter reactions by sessionRelativeTime <= syncTime |
| REACT-10 | Lambda API endpoints for creating and querying reactions (live + replay) | POST /sessions/:sessionId/reactions, GET /sessions/:sessionId/reactions with time-range query |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @aws-sdk/client-ivschat | ^3.1000.0 (existing) | SendEvent API for live reactions | Already used for chat tokens, same client supports custom events |
| @aws-sdk/lib-dynamodb | ^3.1000.0 (existing) | Sharded reaction writes, GSI2 time-range queries | Already used for sessions/messages, supports batch operations |
| motion | ^11.18.0 (NEW) | Floating emoji animations with hardware acceleration | React 19 compatible, 120fps performance, hybrid engine (Web Animations API + ScrollTimeline) |
| amazon-ivs-chat-messaging | ^1.1.1 (existing) | Listen for SendEvent reactions on client | Already used for chat, extends to custom event listening |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | ^10.0.0 (existing) | Generate reactionId for sharded writes | Already used for sessionId generation |
| @aws-lambda-powertools/logger | ^2.31.0 (existing) | Log reaction ingestion metrics | Already used for Lambda logging |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Motion (Framer Motion) | CSS keyframe animations | Motion provides React integration, gesture support, and performance optimization; CSS requires manual state management |
| Motion | react-spring | react-spring is physics-based (more complex), Motion is declarative and faster for simple floating animations |
| IVS SendEvent | WebSocket pub/sub | IVS Chat already established, SendEvent integrates with existing chat room, WebSocket requires separate infrastructure |
| Calculated sharding | Random sharding | Calculated allows efficient GetItem by userId, random requires Query across all shards |
| GSI2 for reactions | Embed in message items | Separate reaction items cleaner schema, supports independent scaling, easier to aggregate/analyze |

**Installation:**
```bash
# Frontend (web/)
npm install motion

# Backend (no new dependencies)
# Existing @aws-sdk/client-ivschat supports SendEvent
```

## Architecture Patterns

### Recommended Project Structure
```
web/src/
├── features/
│   ├── reactions/
│   │   ├── ReactionPicker.tsx        # NEW: Emoji selector for live/replay
│   │   ├── FloatingReactions.tsx     # NEW: Motion-powered floating animation overlay
│   │   ├── useReactionSender.ts      # NEW: Hook for sending reactions (live vs replay)
│   │   ├── useReactionListener.ts    # NEW: IVS Chat event listener for live reactions
│   │   ├── ReactionTimeline.tsx      # NEW: Timeline markers for replay viewer
│   │   └── useReactionSync.ts        # NEW: Filter reactions by syncTime (reuses Phase 6 pattern)
│   ├── replay/
│   │   └── ReplayViewer.tsx          # EXTEND: Add reaction timeline overlay
│   └── broadcast/
│       └── BroadcastView.tsx         # EXTEND: Add reaction picker + floating display
backend/src/
├── domain/
│   └── reaction.ts                   # NEW: Reaction entity, calculateShardId utility
├── repositories/
│   └── reaction-repository.ts        # NEW: Sharded writes, GSI2 time-range queries
├── services/
│   └── reaction-service.ts           # NEW: Business logic, SendEvent calls
└── handlers/
    ├── create-reaction.ts            # NEW: POST /sessions/:sessionId/reactions
    └── get-reactions.ts              # NEW: GET /sessions/:sessionId/reactions?startTime&endTime
infra/lib/stacks/
└── session-stack.ts                  # EXTEND: Add GSI2 to SessionTable
```

### Pattern 1: IVS Chat SendEvent for Live Reactions

**What:** Use IVS Chat SendEvent API to broadcast emoji reactions to all connected clients in a chat room. Server sends custom event with eventName="reaction", attributes contain emoji type and sender info.

**When to use:** All live broadcast reactions (REACT-01, REACT-02, REACT-03).

**Example:**
```typescript
// Source: AWS IVS Chat SendEvent API documentation
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSChatClient } from '../lib/ivs-clients';

export async function broadcastReaction(
  chatRoomArn: string,
  userId: string,
  emojiType: string,
  sessionRelativeTime: number
): Promise<string> {
  const chatClient = getIVSChatClient();

  const command = new SendEventCommand({
    roomIdentifier: chatRoomArn,
    eventName: 'reaction',
    attributes: {
      emojiType, // 'heart', 'fire', 'clap', 'laugh', 'surprised'
      userId,
      timestamp: sessionRelativeTime.toString(), // ms since stream start
      displayName: userId, // Or fetch from user profile
    },
  });

  const response = await chatClient.send(command);
  return response.id!; // Event ID for tracking
}
```

**Key advantages:**
- Integrates with existing IVS Chat infrastructure (no separate WebSocket)
- Automatically delivers to all connected chat clients
- Server-controlled (prevents client spoofing)
- 4KB attribute limit sufficient for emoji reactions

**Frontend listening:**
```typescript
// Source: amazon-ivs-chat-messaging SDK patterns
import { ChatRoom } from 'amazon-ivs-chat-messaging';

export function useReactionListener(room: ChatRoom, onReaction: (reaction: Reaction) => void) {
  useEffect(() => {
    const handleEvent = (event: any) => {
      if (event.eventName === 'reaction') {
        const { emojiType, userId, timestamp } = event.attributes;
        onReaction({
          emojiType,
          userId,
          sessionRelativeTime: parseInt(timestamp),
        });
      }
    };

    const unsubscribe = room.addListener('event', handleEvent);
    return unsubscribe;
  }, [room, onReaction]);
}
```

### Pattern 2: DynamoDB Write Sharding for Reaction Hot Partitions

**What:** Distribute reaction writes across multiple partition keys using calculated sharding (hash of userId mod N) to avoid throttling during viral spikes. Pattern supports 500+ concurrent users sending reactions.

**When to use:** All reaction persistence (REACT-04, REACT-06).

**Example:**
```typescript
// Source: AWS DynamoDB write sharding best practices
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

const SHARD_COUNT = 100; // 100 shards = 100K WCU capacity (1K per shard)

/**
 * Calculate shard ID from userId for consistent routing
 */
export function calculateShardId(userId: string): number {
  // Simple hash: sum of UTF-8 code points
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash += userId.charCodeAt(i);
  }
  return (hash % SHARD_COUNT) + 1; // 1-based: SHARD#1 to SHARD#100
}

export interface Reaction {
  reactionId: string;
  sessionId: string;
  userId: string;
  emojiType: 'heart' | 'fire' | 'clap' | 'laugh' | 'surprised';
  reactionType: 'live' | 'replay';
  sessionRelativeTime: number; // ms since stream start (for replay sync)
  createdAt: string; // ISO 8601 timestamp
  shardId: number; // Calculated from userId
}

export async function persistReaction(
  tableName: string,
  reaction: Reaction
): Promise<void> {
  const docClient = getDocumentClient();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      // Sharded partition key: sessionId#emojiType#shardId
      PK: `REACTION#${reaction.sessionId}#${reaction.emojiType}#SHARD${reaction.shardId}`,
      SK: `${reaction.sessionRelativeTime}#${reaction.reactionId}`,
      entityType: 'REACTION',
      ...reaction,
      // GSI2 for time-range queries (non-sharded)
      GSI2PK: `REACTION#${reaction.sessionId}`,
      GSI2SK: reaction.sessionRelativeTime.toString().padStart(15, '0'), // Zero-padded for sorting
    },
  }));
}
```

**Querying sharded data (aggregation):**
```typescript
// Read reactions for aggregation (e.g., count by emoji type)
export async function getReactionCounts(
  tableName: string,
  sessionId: string,
  emojiType: string
): Promise<number> {
  const docClient = getDocumentClient();
  let totalCount = 0;

  // Query all shards for this emoji type
  for (let shard = 1; shard <= SHARD_COUNT; shard++) {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `REACTION#${sessionId}#${emojiType}#SHARD${shard}`,
      },
      Select: 'COUNT', // Only count, don't fetch items
    }));
    totalCount += result.Count || 0;
  }

  return totalCount;
}
```

**Key advantages:**
- 100 shards × 1,000 WCU per partition = 100K WCU throughput (far exceeds 500 concurrent users)
- Calculated sharding allows efficient GetItem when userId is known
- Partition key includes emojiType for targeted aggregation
- GSI2 enables non-sharded time-range queries for replay sync

### Pattern 3: GSI2 for Reaction Timeline Queries

**What:** Create Global Secondary Index (GSI2) with non-sharded partition key (sessionId) and sort key (sessionRelativeTime) for efficient time-range queries during replay viewing.

**When to use:** Replay reaction timeline display (REACT-05, REACT-09).

**Example:**
```typescript
// Source: DynamoDB GSI time-range query patterns
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

export async function getReactionsInTimeRange(
  tableName: string,
  sessionId: string,
  startTime: number,
  endTime: number,
  limit: number = 100
): Promise<Reaction[]> {
  const docClient = getDocumentClient();

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':pk': `REACTION#${sessionId}`,
      ':start': startTime.toString().padStart(15, '0'),
      ':end': endTime.toString().padStart(15, '0'),
    },
    Limit: limit,
  }));

  if (!result.Items || result.Items.length === 0) {
    return [];
  }

  return result.Items.map(item => {
    const { PK, SK, entityType, GSI2PK, GSI2SK, ...reaction } = item;
    return reaction as Reaction;
  });
}
```

**CDK Infrastructure:**
```typescript
// In SessionStack.ts (EXTEND existing table)
// GSI2 for reaction time-range queries
this.table.addGlobalSecondaryIndex({
  indexName: 'GSI2',
  partitionKey: {
    name: 'GSI2PK',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'GSI2SK',
    type: dynamodb.AttributeType.STRING,
  },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**Key advantages:**
- Single query fetches reactions in time window (no shard iteration)
- Sorted by sessionRelativeTime for chronological display
- Supports pagination with LastEvaluatedKey
- ProjectionType.ALL includes all reaction attributes

### Pattern 4: Motion Floating Animations

**What:** Use Motion library (Framer Motion v11+) for hardware-accelerated floating emoji animations. Emojis float upward with fade-out, random horizontal wiggle, and staggered timing.

**When to use:** Live reaction display (REACT-02), replay reaction playback.

**Example:**
```typescript
// Source: Motion documentation + floating animation patterns
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect } from 'react';

interface FloatingEmoji {
  id: string;
  emoji: string;
  timestamp: number;
}

export function FloatingReactions({ reactions }: { reactions: FloatingEmoji[] }) {
  const [visible, setVisible] = useState<FloatingEmoji[]>([]);

  useEffect(() => {
    // Add new reactions to visible list
    reactions.forEach(reaction => {
      setVisible(prev => [...prev, reaction]);
      // Remove after animation completes (3 seconds)
      setTimeout(() => {
        setVisible(prev => prev.filter(r => r.id !== reaction.id));
      }, 3000);
    });
  }, [reactions]);

  return (
    <div className="floating-reactions-container">
      <AnimatePresence>
        {visible.map((reaction) => (
          <motion.div
            key={reaction.id}
            className="floating-emoji"
            initial={{
              opacity: 1,
              y: 0,
              x: Math.random() * 100 - 50, // Random horizontal offset (-50 to +50)
            }}
            animate={{
              opacity: 0,
              y: -200, // Float upward 200px
              x: Math.random() * 100 - 50 + Math.sin(Date.now() / 100) * 20, // Wiggle effect
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 3,
              ease: 'easeOut',
            }}
            style={{
              position: 'absolute',
              bottom: '20%',
              left: '50%',
              fontSize: '3rem',
              pointerEvents: 'none',
            }}
          >
            {reaction.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
```

**Performance optimization:**
```typescript
// Throttle reaction rendering to prevent UI thrashing during spikes
import { useCallback, useRef } from 'react';

export function useThrottledReactions(batchInterval: number = 100) {
  const queueRef = useRef<FloatingEmoji[]>([]);
  const [displayReactions, setDisplayReactions] = useState<FloatingEmoji[]>([]);

  const addReaction = useCallback((reaction: FloatingEmoji) => {
    queueRef.current.push(reaction);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        setDisplayReactions(prev => [...prev, ...queueRef.current]);
        queueRef.current = [];
      }
    }, batchInterval);

    return () => clearInterval(interval);
  }, [batchInterval]);

  return { displayReactions, addReaction };
}
```

**Key advantages:**
- Hardware-accelerated (GPU rendering, 120fps)
- React 19 compatible with concurrent mode
- AnimatePresence handles mount/unmount animations
- Declarative API (no manual RAF loops)
- Mobile-optimized (touch gestures, reduced motion support)

### Pattern 5: Replay Reaction Synchronization (Reuse Phase 6 Pattern)

**What:** Reuse Phase 6's useSynchronizedChat pattern for filtering reactions by sessionRelativeTime. Display reactions as timeline markers and floating animations when video reaches their timestamp.

**When to use:** Replay viewer reaction display (REACT-09).

**Example:**
```typescript
// Source: Phase 6 useSynchronizedChat pattern (06-RESEARCH.md)
import { useMemo } from 'react';
import type { Reaction } from '../domain/reaction';

export function useReactionSync(
  allReactions: Reaction[],
  currentSyncTime: number
): Reaction[] {
  return useMemo(() => {
    if (currentSyncTime === 0) {
      return []; // No playback started
    }

    return allReactions.filter(
      reaction => reaction.sessionRelativeTime <= currentSyncTime
    );
  }, [allReactions, currentSyncTime]);
}

// In ReplayViewer component:
function ReplayViewer({ sessionId }: { sessionId: string }) {
  const { syncTime } = useReplayPlayer(recordingHlsUrl); // Phase 6 hook
  const allReactions = useReactionHistory(sessionId); // Fetch all reactions
  const visibleReactions = useReactionSync(allReactions, syncTime);

  return (
    <div className="replay-container">
      <VideoPlayer />
      <ReactionTimeline reactions={allReactions} currentTime={syncTime} />
      <FloatingReactions reactions={visibleReactions} />
      <ReplayChat /> {/* Phase 6 component */}
    </div>
  );
}
```

**Timeline marker component:**
```typescript
export function ReactionTimeline({
  reactions,
  currentTime,
  duration,
}: {
  reactions: Reaction[];
  currentTime: number;
  duration: number;
}) {
  // Aggregate reactions by time buckets (e.g., 5-second windows)
  const buckets = useMemo(() => {
    const bucketMap = new Map<number, { emojis: string[]; count: number }>();
    const bucketSize = 5000; // 5 seconds

    reactions.forEach(reaction => {
      const bucket = Math.floor(reaction.sessionRelativeTime / bucketSize);
      if (!bucketMap.has(bucket)) {
        bucketMap.set(bucket, { emojis: [], count: 0 });
      }
      const data = bucketMap.get(bucket)!;
      data.count++;
      if (!data.emojis.includes(reaction.emojiType)) {
        data.emojis.push(reaction.emojiType);
      }
    });

    return bucketMap;
  }, [reactions]);

  return (
    <div className="reaction-timeline">
      {Array.from(buckets.entries()).map(([bucket, data]) => {
        const position = (bucket * 5000 / duration) * 100; // Percentage
        const isActive = currentTime >= bucket * 5000;

        return (
          <div
            key={bucket}
            className={`timeline-marker ${isActive ? 'active' : ''}`}
            style={{ left: `${position}%` }}
          >
            <span className="reaction-count">{data.count}</span>
            <div className="reaction-emojis">
              {data.emojis.map(emoji => (
                <span key={emoji}>{emoji}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

**Key advantages:**
- Reuses proven Phase 6 synchronization pattern (no new complexity)
- useMemo prevents unnecessary re-filtering on every SYNC_TIME_UPDATE
- Timeline markers provide visual "heatmap" of reaction activity
- Active marker highlighting shows current playback position

### Anti-Patterns to Avoid

- **Storing reactions in main partition without sharding:** Creates hot partition during viral streams. A single partition supports max 1,000 WCU; 500 concurrent users × 2 reactions/sec = throttling. Use write sharding.
- **Using WebSocket for live reactions:** Adds infrastructure complexity. IVS Chat SendEvent integrates with existing chat room, automatically delivers to all clients.
- **Rendering all floating emojis without batching:** 100+ emojis in 1 second causes UI lag. Batch animations in 100ms windows (max 10 emojis per batch).
- **Random sharding without calculated pattern:** Makes GetItem by userId impossible (must Query all shards). Use calculated sharding (hash of userId mod N).
- **Embedding reactions in message items:** Pollutes message namespace, complicates queries. Separate reaction entity type with dedicated partition keys.
- **Client-side reaction validation only:** Allows spoofing (unlimited reactions, fake userId). Validate server-side (rate limiting, authentication).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Floating animation system | Custom CSS keyframes + setInterval RAF loops | Motion library with AnimatePresence | Hardware acceleration (GPU), declarative API, React integration, mobile gesture support, concurrent mode compatible |
| WebSocket pub/sub for reactions | Custom WebSocket server + fan-out logic | IVS Chat SendEvent API | Already established infrastructure, automatic client delivery, server-controlled events, 4KB metadata sufficient |
| DynamoDB partition key sharding | Manual partition key generation | Calculated sharding pattern (hash mod N) | Consistent routing, deterministic shards, enables efficient GetItem, proven pattern |
| Reaction aggregation system | Real-time counters in memory | Query sharded writes + cache results | Scales horizontally, no state loss, DynamoDB handles consistency, simple Lambda logic |
| Timeline marker rendering | Custom timeline component | Reuse video player timeline, overlay markers | Browser-tested scrubbing, accessibility, mobile touch, time formatting |

**Key insight:** Reaction systems have two hard problems: (1) Hot partition throttling at scale, and (2) Performant floating animations. Write sharding solves (1) by distributing writes across 100 partitions (100K WCU capacity). Motion library solves (2) with hardware-accelerated animations and React integration. Don't build custom solutions for either.

## Common Pitfalls

### Pitfall 1: Hot Partition Throttling During Viral Streams

**What goes wrong:** Single sessionId partition key throttles at 1,000 WCU. During viral stream with 500 concurrent users sending 2 reactions/sec, total throughput is 1,000 writes/sec → consistent throttling.

**Why it happens:** DynamoDB partitions have hard limits (1,000 WCU per partition). Single partition key (e.g., `REACTION#sessionId`) concentrates all writes, creating hot partition.

**How to avoid:** Implement write sharding with 50-100 shards. Partition key format: `REACTION#sessionId#emojiType#SHARD{N}`. Calculate shard from userId hash: `(hash(userId) mod 100) + 1`. This distributes writes across 100 partitions (100K WCU total capacity).

**Warning signs:** CloudWatch metrics show WriteThrottleEvents, DynamoDB console shows "hot partition" warnings, users report "reaction failed to send" errors.

### Pitfall 2: Reaction Animation Performance Degradation

**What goes wrong:** Rendering 100+ floating emojis simultaneously causes frame drops, laggy UI, high CPU usage.

**Why it happens:** Each emoji is a DOM element with CSS animations. Browsers struggle with 100+ concurrent animations (layout thrashing, paint storms).

**How to avoid:**
1. Batch reactions in 100ms windows (max 10 emojis per batch)
2. Use Motion's AnimatePresence for automatic cleanup
3. Limit max simultaneous emojis (e.g., 50 max, queue excess)
4. Use `will-change: transform` CSS hint for GPU layer promotion
5. Throttle animation updates with requestAnimationFrame

**Warning signs:** Chrome DevTools Performance tab shows "Layout Shift", React Profiler shows slow render times (>16ms), mobile devices show stuttering animations.

### Pitfall 3: SendEvent Rate Limiting

**What goes wrong:** IVS Chat SendEvent API returns ThrottlingException (429) during high-frequency reaction sends.

**Why it happens:** AWS services have API rate limits. SendEvent likely has per-room or per-account limits (not publicly documented).

**How to avoid:**
1. Implement client-side rate limiting (e.g., 1 reaction per user per 500ms)
2. Batch reactions server-side (aggregate multiple reactions into single SendEvent)
3. Use exponential backoff retry for ThrottlingException
4. Monitor CloudWatch metrics for SendEvent throttling

**Warning signs:** Lambda logs show ThrottlingException, users report "Please wait before sending another reaction" error, SendEvent success rate drops below 95%.

### Pitfall 4: Incorrect Time Synchronization for Replay Reactions

**What goes wrong:** Replay reactions appear at wrong timestamps, don't sync with video playback, or jump backward after seek.

**Why it happens:** Using video.currentTime instead of IVS Player getSyncTime. currentTime is playback position (seconds), not wall-clock time. Reactions stored with sessionRelativeTime (UTC milliseconds).

**How to avoid:** Reuse Phase 6 synchronization pattern. Use IVS Player SYNC_TIME_UPDATE event to get syncTime, filter reactions where `sessionRelativeTime <= syncTime`. Use useMemo to prevent re-filtering on every update.

**Warning signs:** Reactions appear 2-3 seconds late, reactions disappear after seeking, reactions appear in wrong order.

### Pitfall 5: GSI2 Query Cost for Large Sessions

**What goes wrong:** Querying all reactions for a 60-minute session with 10,000 reactions consumes significant read capacity, slow page loads.

**Why it happens:** GSI2 query fetches all items in time range. Large sessions have many reactions, resulting in large result sets and high RCU consumption.

**How to avoid:**
1. Implement pagination with Limit parameter (fetch 100 reactions at a time)
2. Lazy-load reactions as user scrubs through timeline
3. Use aggregation queries (COUNT only) for timeline markers, fetch full items on-demand
4. Cache reaction aggregates in Lambda (e.g., "reactions per 5-second bucket")

**Warning signs:** DynamoDB console shows high read throttling on GSI2, Lambda timeout errors, replay viewer slow to load, CloudWatch shows RCU spikes.

### Pitfall 6: Emoji Rendering Cross-Platform Inconsistencies

**What goes wrong:** Emojis look different on iOS vs Android vs Windows, some emojis don't render (tofu squares).

**Why it happens:** Emoji rendering depends on system fonts (Apple Color Emoji, Noto Color Emoji). Unicode version differences cause missing glyphs.

**How to avoid:**
1. Use emoji font library (e.g., Twemoji by Twitter, Noto Emoji by Google)
2. Serve emoji images from CDN (consistent rendering across platforms)
3. Test on iOS Safari, Android Chrome, Windows Edge
4. Limit emoji set to widely-supported Unicode 13.0 emojis

**Warning signs:** QA reports "reaction shows as box" on Android, iOS users see different emoji style than design mocks.

## Code Examples

Verified patterns from official sources:

### Complete Reaction Domain Model

```typescript
// Source: DynamoDB write sharding + Phase 4 ChatMessage pattern
export type EmojiType = 'heart' | 'fire' | 'clap' | 'laugh' | 'surprised';
export type ReactionType = 'live' | 'replay';

export interface Reaction {
  reactionId: string; // UUID
  sessionId: string;
  userId: string;
  emojiType: EmojiType;
  reactionType: ReactionType;
  sessionRelativeTime: number; // Milliseconds since stream start
  createdAt: string; // ISO 8601 timestamp
  shardId: number; // Calculated from userId (1 to SHARD_COUNT)
}

const SHARD_COUNT = 100;

/**
 * Calculate shard ID from userId for consistent routing
 */
export function calculateShardId(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash += userId.charCodeAt(i);
  }
  return (hash % SHARD_COUNT) + 1;
}

/**
 * Calculate session-relative time for reaction synchronization
 * Reuses Phase 4 utility pattern
 */
export function calculateSessionRelativeTime(
  sessionStartedAt: string,
  reactionCreatedAt: string
): number {
  const startTime = new Date(sessionStartedAt).getTime();
  const createdTime = new Date(reactionCreatedAt).getTime();
  return createdTime - startTime;
}
```

### Lambda Handler: Create Reaction (Live)

```typescript
// Source: AWS Lambda + IVS Chat patterns
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { broadcastReaction } from '../services/reaction-service';
import { persistReaction } from '../repositories/reaction-repository';
import { getSessionById } from '../repositories/session-repository';
import { calculateShardId, calculateSessionRelativeTime } from '../domain/reaction';

export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.sessionId;
  const userId = event.requestContext.authorizer?.claims['cognito:username'];
  const body = JSON.parse(event.body || '{}');
  const emojiType = body.emojiType;

  if (!sessionId || !userId || !emojiType) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields' }),
    };
  }

  // Validate emoji type
  const validEmojis = ['heart', 'fire', 'clap', 'laugh', 'surprised'];
  if (!validEmojis.includes(emojiType)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid emoji type' }),
    };
  }

  // Fetch session to get chat room ARN and start time
  const session = await getSessionById(process.env.TABLE_NAME!, sessionId);
  if (!session) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Session not found' }),
    };
  }

  if (session.status !== 'live') {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Session is not live' }),
    };
  }

  const createdAt = new Date().toISOString();
  const sessionRelativeTime = calculateSessionRelativeTime(
    session.startedAt!,
    createdAt
  );

  const reaction: Reaction = {
    reactionId: uuidv4(),
    sessionId,
    userId,
    emojiType,
    reactionType: 'live',
    sessionRelativeTime,
    createdAt,
    shardId: calculateShardId(userId),
  };

  // Broadcast to IVS Chat (all connected clients receive)
  const eventId = await broadcastReaction(
    session.claimedResources.chatRoom,
    userId,
    emojiType,
    sessionRelativeTime
  );

  // Persist to DynamoDB (for replay and analytics)
  await persistReaction(process.env.TABLE_NAME!, reaction);

  return {
    statusCode: 201,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      reactionId: reaction.reactionId,
      eventId, // IVS Chat event ID
      sessionRelativeTime,
    }),
  };
};
```

### Frontend: Reaction Picker Component

```typescript
// Source: React best practices + emoji UI patterns
import { useState } from 'react';
import type { EmojiType } from '../domain/reaction';

const EMOJI_MAP: Record<EmojiType, string> = {
  heart: '❤️',
  fire: '🔥',
  clap: '👏',
  laugh: '😂',
  surprised: '😮',
};

export function ReactionPicker({
  onReaction,
  disabled = false,
}: {
  onReaction: (emoji: EmojiType) => void;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  const handleReaction = (emoji: EmojiType) => {
    if (cooldown || disabled) return;

    onReaction(emoji);
    setIsOpen(false);

    // Client-side rate limiting (500ms cooldown)
    setCooldown(true);
    setTimeout(() => setCooldown(false), 500);
  };

  return (
    <div className="reaction-picker">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || cooldown}
        className="reaction-button"
        aria-label="Send reaction"
      >
        ❤️
      </button>

      {isOpen && (
        <div className="reaction-menu">
          {Object.entries(EMOJI_MAP).map(([key, emoji]) => (
            <button
              key={key}
              onClick={() => handleReaction(key as EmojiType)}
              className="emoji-button"
              aria-label={`Send ${key} reaction`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Frontend: useReactionSender Hook

```typescript
// Source: React hooks patterns + API integration
import { useCallback, useState } from 'react';
import type { EmojiType } from '../domain/reaction';

const API_BASE_URL = (window as any).APP_CONFIG?.apiBaseUrl || '';

export function useReactionSender(sessionId: string, authToken: string) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReaction = useCallback(async (emojiType: EmojiType) => {
    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/sessions/${sessionId}/reactions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ emojiType }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send reaction');
      }

      return await response.json();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      console.error('Failed to send reaction:', err);
    } finally {
      setSending(false);
    }
  }, [sessionId, authToken]);

  return { sendReaction, sending, error };
}
```

### Frontend: Complete Floating Reactions with Throttling

```typescript
// Source: Motion library + performance optimization patterns
import { motion, AnimatePresence } from 'motion/react';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { Reaction } from '../domain/reaction';

const MAX_SIMULTANEOUS = 50; // Limit concurrent animations
const BATCH_INTERVAL = 100; // Batch reactions every 100ms

interface FloatingEmoji {
  id: string;
  emoji: string;
  timestamp: number;
}

export function FloatingReactions({ sessionId }: { sessionId: string }) {
  const [visible, setVisible] = useState<FloatingEmoji[]>([]);
  const queueRef = useRef<FloatingEmoji[]>([]);

  // Add reaction to queue (throttled batching)
  const addReaction = useCallback((reaction: Reaction) => {
    const emoji = getEmojiFromType(reaction.emojiType);
    queueRef.current.push({
      id: reaction.reactionId,
      emoji,
      timestamp: Date.now(),
    });
  }, []);

  // Flush queue at intervals (batch processing)
  useEffect(() => {
    const interval = setInterval(() => {
      if (queueRef.current.length > 0) {
        setVisible(prev => {
          const newItems = queueRef.current.splice(0, 10); // Max 10 per batch
          const updated = [...prev, ...newItems];

          // Enforce max simultaneous limit
          if (updated.length > MAX_SIMULTANEOUS) {
            return updated.slice(-MAX_SIMULTANEOUS);
          }
          return updated;
        });
      }
    }, BATCH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // Remove completed animations
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      setVisible(prev => prev.filter(item => now - item.timestamp < 3000));
    }, 500);

    return () => clearInterval(cleanup);
  }, []);

  return (
    <div
      className="floating-reactions-container"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <AnimatePresence>
        {visible.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{
              opacity: 1,
              y: 0,
              x: (index % 5) * 20 - 40, // Stagger horizontally
              scale: 1,
            }}
            animate={{
              opacity: 0,
              y: -200,
              x: (index % 5) * 20 - 40 + Math.sin(Date.now() / 200) * 15,
              scale: 1.2,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 3,
              ease: 'easeOut',
            }}
            style={{
              position: 'absolute',
              bottom: '20%',
              left: '50%',
              fontSize: '3rem',
              willChange: 'transform', // GPU hint
            }}
          >
            {item.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function getEmojiFromType(type: string): string {
  const map: Record<string, string> = {
    heart: '❤️',
    fire: '🔥',
    clap: '👏',
    laugh: '😂',
    surprised: '😮',
  };
  return map[type] || '❤️';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Framer Motion | Motion (v11+, rebranded 2025) | 2025 | React 19 compatibility, improved concurrent mode support, 120fps animations |
| Random write sharding | Calculated write sharding | DynamoDB best practices 2024+ | Enables efficient GetItem, deterministic routing, same throughput benefits |
| CSS keyframe animations | Motion with hardware acceleration | Web Animations API adoption 2024+ | GPU rendering (120fps), declarative React integration, gesture support |
| Single partition for reactions | Write sharding with 100 partitions | Hot partition mitigation 2023+ | 100K WCU capacity (100x throughput), scales to viral streams |
| Embedding reactions in messages | Separate reaction entity type | Single-table design evolution 2024+ | Cleaner schema, independent scaling, easier aggregation |

**Deprecated/outdated:**
- Framer Motion package name: Now called Motion (motion/react), Framer Motion is legacy name
- CloudFront OAI for S3: Phase 5 already migrated to OAC (Origin Access Control)
- Manual RAF loops for animations: Use Motion's declarative API, browser handles RAF scheduling
- WebSocket for custom events: IVS Chat SendEvent provides server-controlled event delivery

## Open Questions

1. **Reaction rate limiting strategy**
   - What we know: Client-side cooldown (500ms) prevents accidental spam, server-side validation required
   - What's unclear: What's the ideal rate limit? 1 reaction/sec per user? 10 reactions/min?
   - Recommendation: Start with 2 reactions/sec per user (60/min), monitor CloudWatch metrics, adjust if throttling occurs

2. **Emoji font consistency**
   - What we know: System emojis render differently on iOS vs Android vs Windows
   - What's unclear: Should we use emoji image library (Twemoji, Noto) or accept system font variations?
   - Recommendation: Accept system fonts for v1.1 (simpler), defer to emoji image CDN in v2 if cross-platform consistency becomes user complaint

3. **Replay reaction submission**
   - What we know: Users can send reactions during replay viewing (REACT-07), stored with video timestamp
   - What's unclear: Should replay reactions be visible to other viewers in real-time? Or only to self?
   - Recommendation: Store replay reactions but don't broadcast (no IVS SendEvent). Display only user's own replay reactions. Social replay features deferred to v2.

4. **Reaction analytics aggregation**
   - What we know: Sharded writes require querying 100 partitions to aggregate totals
   - What's unclear: Should we pre-aggregate reaction counts (Lambda + DynamoDB Streams)? Or compute on-demand?
   - Recommendation: Compute on-demand for v1.1 (simpler). If aggregation queries exceed 1-second latency, implement DynamoDB Streams + aggregate counts in separate table.

5. **Timeline marker granularity**
   - What we know: Timeline markers show reaction "heatmap" along video scrubber
   - What's unclear: What time bucket size? 5 seconds? 10 seconds? Dynamic based on video length?
   - Recommendation: Use 5-second buckets for videos <30 minutes, 10-second buckets for longer videos. Prevents overcrowding on timeline.

## Validation Architecture

> Note: config.json does not specify workflow.nyquist_validation, defaulting to test coverage.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 (backend), Vitest (frontend - not yet configured) |
| Config file | backend/jest.config.js (existing) |
| Quick run command | `npm test -- --testPathPattern=reaction` |
| Full suite command | `npm test` (backend/) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REACT-01 | Users can send emoji reactions during live broadcasts | integration | `npm test -- create-reaction.test.ts -x` | ❌ Wave 0 |
| REACT-02 | Live reactions display as floating animations | e2e/manual | Manual UI test (Motion animations) | ❌ Manual only |
| REACT-03 | Reactions sent via IVS Chat custom events | unit | `npm test -- reaction-service.test.ts::test_broadcast_reaction -x` | ❌ Wave 0 |
| REACT-04 | Reactions stored with sessionRelativeTime | unit | `npm test -- reaction-repository.test.ts::test_persist_reaction -x` | ❌ Wave 0 |
| REACT-05 | GSI2 created for time-range queries | integration | CDK synth validation + query test | ❌ Wave 0 |
| REACT-06 | Reaction writes sharded across partitions | unit | `npm test -- reaction-repository.test.ts::test_calculate_shard_id -x` | ❌ Wave 0 |
| REACT-07 | Users can send reactions during replay viewing | integration | `npm test -- create-reaction.test.ts::test_replay_reaction -x` | ❌ Wave 0 |
| REACT-08 | Replay reactions distinguished from live | unit | `npm test -- reaction.test.ts::test_reaction_type -x` | ❌ Wave 0 |
| REACT-09 | Replay viewer displays reaction timeline | e2e/manual | Manual UI test (timeline markers + sync) | ❌ Manual only |
| REACT-10 | Lambda endpoints for creating/querying reactions | integration | `npm test -- create-reaction.test.ts get-reactions.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --testPathPattern=reaction --bail`
- **Per wave merge:** `npm test` (full backend suite)
- **Phase gate:** Full suite green + manual UI verification (floating animations, timeline markers)

### Wave 0 Gaps
- [ ] `backend/src/domain/__tests__/reaction.test.ts` — covers calculateShardId, calculateSessionRelativeTime (REACT-04, REACT-06)
- [ ] `backend/src/repositories/__tests__/reaction-repository.test.ts` — covers persistReaction, getReactionsInTimeRange (REACT-04, REACT-05)
- [ ] `backend/src/services/__tests__/reaction-service.test.ts` — covers broadcastReaction (REACT-03)
- [ ] `backend/src/handlers/__tests__/create-reaction.test.ts` — covers POST /sessions/:sessionId/reactions (REACT-01, REACT-07, REACT-10)
- [ ] `backend/src/handlers/__tests__/get-reactions.test.ts` — covers GET /sessions/:sessionId/reactions (REACT-10)
- [ ] Frontend tests (Vitest): Not yet configured. Manual UI testing for REACT-02, REACT-09.

## Sources

### Primary (HIGH confidence)
- [AWS IVS Chat SendEvent API Documentation](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_SendEvent.html) - SendEvent API specification, parameters, limitations
- [AWS CLI SendEvent Reference](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ivschat/send-event.html) - CLI examples, event attributes structure
- [AWS DynamoDB Write Sharding Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html) - Official sharding pattern, calculated vs random sharding
- [Motion Library Documentation](https://motion.dev) - Motion (Framer Motion v11+) API, AnimatePresence, hardware acceleration
- [Phase 6 Research](./06-replay-viewer/06-RESEARCH.md) - IVS Player getSyncTime pattern, sessionRelativeTime synchronization

### Secondary (MEDIUM confidence)
- [DynamoDB Hot Partition Strategies 2026](https://blogdeveloperspot.blogspot.com/2026/01/eliminating-dynamodb-hot-partition.html) - Sharding strategies, throughput calculations
- [DynamoDB GSI Time-Range Queries](https://openillumi.com/en/en-dynamodb-date-range-query-gsi-design/) - GSI design for date/time range queries
- [WebSocket Batching Patterns 2026](https://peerdh.com/blogs/programming-insights/optimizing-websocket-performance-for-real-time-applications) - Message batching, throttling strategies
- [React Performance Optimization 2026](https://softtechnosol.com/blog/react-js-optimization-techniques-for-faster-apps/) - useMemo, batching, virtualization
- [Amazon IVS Chat Replay Pattern](https://dev.to/aws/amazon-ivs-live-stream-playback-with-chat-replay-using-the-sync-time-api-1d6a) - Sync Time API usage, replay synchronization

### Tertiary (LOW confidence)
- [React Emoji Libraries Comparison](https://medium.com/@manpreetkamboj6191/implementing-flying-emojis-in-react-7a9ae55d0ec9) - Floating emoji implementation patterns (unverified, educational reference)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - IVS Chat existing (verified in backend/package.json), Motion well-documented React 19 library
- Architecture: HIGH - Patterns reuse Phase 4 (ChatMessage), Phase 5 (EventBridge), Phase 6 (synchronization)
- DynamoDB sharding: HIGH - Official AWS documentation, proven pattern for hot partitions
- IVS SendEvent: HIGH - Official API documentation, CLI examples, attribute limits verified
- Floating animations: MEDIUM - Motion library documented, performance patterns based on community best practices
- Rate limiting: MEDIUM - AWS API limits not publicly documented, recommendations based on typical SaaS patterns

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - stable APIs, Motion library mature)
