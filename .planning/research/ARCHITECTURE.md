# Architecture Patterns

**Domain:** AWS IVS Live Video Platform (Broadcast + RealTime + Chat + Replay)
**Researched:** 2026-03-01
**Confidence:** MEDIUM-HIGH (official AWS docs verified for IVS core, training data supplemented for integration patterns)

## Recommended Architecture

### High-Level System Overview

```
                          +------------------+
                          |   React Web App  |
                          | (SPA, Vite/CRA)  |
                          +--------+---------+
                                   |
                    +--------------+--------------+
                    |              |               |
              Cognito Auth   API Gateway     IVS SDK/WebRTC
              (JWT tokens)   (REST APIs)     (direct to AWS)
                    |              |               |
                    v              v               v
              +----------+  +-----------+  +-------------+
              | Cognito  |  |  Lambda   |  | IVS Services|
              | User Pool|  | Functions |  | (Channels,  |
              +----------+  +-----------+  |  Stages,    |
                                |          |  Chat Rooms)|
                          +-----+-----+    +------+------+
                          |           |           |
                     DynamoDB    IVS APIs     S3 (Recordings)
                     (Sessions,  (Create      + CloudFront
                      Presence,   tokens,      (Replay HLS)
                      Reactions)  manage
                                  resources)
```

The system has three distinct runtime planes:

1. **Control Plane** (your backend): Lambda + API Gateway + DynamoDB -- manages sessions, users, resource pool, and token generation
2. **Media Plane** (AWS-managed): IVS Channels (broadcast), IVS RealTime Stages (WebRTC), IVS Chat Rooms -- handles all media transport
3. **Storage Plane**: S3 for recordings + CloudFront for replay delivery

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **React Frontend** | UI rendering, IVS player/SDK integration, chat UI, session browsing | API Gateway (REST), Cognito (auth), IVS Player SDK (playback), IVS Web Broadcast SDK (publish), IVS RealTime Web SDK (stages), IVS Chat JS SDK (messaging) |
| **Cognito User Pool** | User registration, login, JWT issuance | Frontend (auth flow), Lambda (JWT validation via authorizer) |
| **API Gateway** | REST endpoint routing, Cognito JWT authorization | Frontend (HTTPS), Lambda (invocation), Cognito (authorizer) |
| **Session Manager Lambdas** | Create/join/end sessions, allocate IVS resources from pool, generate IVS tokens | API Gateway (trigger), DynamoDB (session state), IVS APIs (resource management + token creation) |
| **Resource Pool Manager** | Pre-warm and recycle IVS channels, stages, chat rooms | DynamoDB (pool inventory), IVS APIs (create/delete resources), EventBridge/CloudWatch (scheduled warming) |
| **Token Generator Lambdas** | Generate IVS participant tokens and chat tokens on demand | API Gateway (trigger), IVS RealTime API (CreateParticipantToken), IVS Chat API (CreateChatToken), Cognito (user identity from JWT) |
| **Presence Tracker** | Track who is live, viewer counts, active sessions | DynamoDB (presence table), API Gateway WebSocket or polling (frontend updates) |
| **Recording Processor** | Handle recording lifecycle events, index completed recordings | EventBridge (IVS recording events), S3 (recording metadata JSON), DynamoDB (replay catalog) |
| **IVS Channel (Broadcast)** | One-to-many low-latency streaming (<5s latency) | Streamer (RTMP/RTMPS/SRT ingest), Viewers (HLS playback via CDN), S3 (auto-record) |
| **IVS RealTime Stage** | Multi-participant WebRTC (<300ms latency, up to 12 hosts) | Participants (WebRTC via IVS SDK), S3 (participant recording or server-side composition) |
| **IVS Chat Room** | Real-time messaging for live sessions | Frontend (WebSocket via IVS Chat SDK), persisted to DynamoDB via Lambda event handlers |
| **S3 Recording Bucket** | Store recorded HLS segments, thumbnails, metadata | IVS (auto-record destination), CloudFront (origin for replay), Lambda (metadata processing) |
| **CloudFront Distribution** | CDN for replay playback from S3 | S3 (origin), Frontend (HLS player) |
| **DynamoDB Tables** | All application state: sessions, pool, presence, reactions, replay catalog | All Lambda functions |

### Data Flow

#### Flow 1: User Goes Live (Broadcast Mode)

```
1. User clicks "Go Live (Broadcast)" in React app
2. Frontend calls POST /sessions { mode: "broadcast" }
3. API Gateway validates Cognito JWT via authorizer
4. Session Lambda:
   a. Claims a pre-warmed IVS Channel from the resource pool (DynamoDB)
   b. Claims a pre-warmed IVS Chat Room from the pool
   c. Creates a session record in DynamoDB (sessionId, channelArn, chatRoomArn, hostUserId, status: "live")
   d. Generates an IVS stream key (or retrieves the pre-created one from pool)
   e. Calls IVS Chat CreateChatToken for the host (capabilities: [SEND_MESSAGE, DELETE_MESSAGE, DISCONNECT_USER])
   f. Returns { sessionId, ingestEndpoint, streamKey, chatToken, playbackUrl }
5. Frontend uses IVS Web Broadcast SDK to push RTMP/RTMPS to the ingest endpoint
6. Frontend connects to IVS Chat via WebSocket using the chat token
7. Viewers call GET /sessions/live to discover active sessions
8. Viewers call POST /sessions/{id}/join to get:
   a. Playback URL (IVS channel playback URL)
   b. Chat token (capabilities: [SEND_MESSAGE])
9. Viewers use IVS Player SDK for HLS playback + IVS Chat SDK for messaging
10. IVS auto-records to S3 (configured on the channel's recording configuration)
```

#### Flow 2: User Goes Live (RealTime Hangout Mode)

```
1. User clicks "Go Live (Hangout)" in React app
2. Frontend calls POST /sessions { mode: "realtime", maxParticipants: 5 }
3. API Gateway validates Cognito JWT
4. Session Lambda:
   a. Claims a pre-warmed IVS RealTime Stage from the resource pool
   b. Claims a pre-warmed IVS Chat Room from the pool
   c. Creates session record in DynamoDB
   d. Calls IVS RealTime CreateParticipantToken for host:
      - capabilities: ["PUBLISH", "SUBSCRIBE"]
      - userId: cognito username
      - duration: 43200 (12 hours default)
   e. Calls IVS Chat CreateChatToken for host
   f. Returns { sessionId, participantToken, chatToken }
5. Frontend uses IVS RealTime Web SDK to join stage (publish + subscribe)
6. Other participants call POST /sessions/{id}/join:
   a. Lambda checks participant count < maxParticipants
   b. Generates new participant token (PUBLISH + SUBSCRIBE)
   c. Generates chat token
   d. Returns { participantToken, chatToken }
7. Each participant joins via IVS RealTime SDK (WebRTC)
8. Stage has auto-participant-recording enabled (records each participant to S3)
```

#### Flow 3: Session Ends and Replay Becomes Available

```
1. Host clicks "End Session" or disconnects
2. Frontend calls POST /sessions/{id}/end
3. Session Lambda:
   a. Updates DynamoDB session status to "ended"
   b. Returns IVS channel/stage to the resource pool (mark as "recycling")
   c. Returns chat room to pool
4. IVS finishes writing recording to S3:
   S3 path: /ivs/v1/{accountId}/{channelOrStageId}/{yyyy}/{mm}/{dd}/{HH}/{MM}/{recordingId}/
   Contents:
     events/recording-started.json
     events/recording-ended.json
     media/hls/master.m3u8
     media/hls/{rendition}/playlist.m3u8
     media/thumbnails/
5. EventBridge receives IVS Recording State Change event (RECORDING_ENDED)
6. Recording Processor Lambda:
   a. Reads recording-ended.json from S3
   b. Extracts: duration, renditions, thumbnail path, playback URL
   c. Creates replay record in DynamoDB:
      { replayId, sessionId, userId, duration, hlsUrl, thumbnailUrl, createdAt }
7. Replay becomes available in the frontend's "Recently Streamed" feed
```

#### Flow 4: Token Generation Flow (Detailed)

```
Cognito → API Gateway → Lambda → IVS API → Client

Step-by-step:
1. User authenticates with Cognito (username/password)
2. Cognito returns JWT (idToken, accessToken, refreshToken)
3. Frontend includes accessToken in Authorization header
4. API Gateway Cognito Authorizer validates JWT
5. Lambda receives event with claims (sub, username, etc.)
6. Lambda generates appropriate IVS token:

   For Broadcast: No IVS token needed client-side for viewing (just playback URL)
                  For streaming: stream key returned at session creation

   For RealTime:  IVS RealTime CreateParticipantToken API
                  - stageArn: from session record
                  - capabilities: ["PUBLISH", "SUBSCRIBE"] or ["SUBSCRIBE"]
                  - userId: Cognito username
                  - attributes: { displayName, avatarUrl }
                  - duration: 43200 (12h, max 14 days)

   For Chat:      IVS Chat CreateChatToken API
                  - roomIdentifier: chat room ARN from session record
                  - userId: Cognito username
                  - capabilities: ["SEND_MESSAGE"] (viewer) or
                                  ["SEND_MESSAGE", "DELETE_MESSAGE", "DISCONNECT_USER"] (host/mod)
                  - sessionDurationInMinutes: 180
                  - attributes: { displayName }

7. Token returned to frontend (treat as opaque, do not parse)
8. Frontend passes token to respective IVS SDK
```

## CDK Stack Organization

Use a multi-stack CDK app. Each stack is independently deployable and has clear boundaries.

### Recommended Stack Structure

```
cdk/
  bin/
    app.ts                    # CDK app entry point
  lib/
    auth-stack.ts             # Cognito User Pool + Client
    storage-stack.ts          # DynamoDB tables + S3 buckets
    media-stack.ts            # IVS resource pool (channels, stages, chat rooms)
    api-stack.ts              # API Gateway + Lambda functions
    recording-stack.ts        # EventBridge rules + recording processor Lambda + CloudFront
    monitoring-stack.ts       # CloudWatch dashboards + alarms (optional, add later)
```

**Stack dependency order:**
```
AuthStack (no deps)
StorageStack (no deps)
  --> MediaStack (depends on StorageStack for S3 bucket ARN)
    --> ApiStack (depends on Auth, Storage, Media for all ARNs)
      --> RecordingStack (depends on Storage for S3, DynamoDB)
```

**Why this split, not a monolith:**
- `cdk destroy` can tear down in reverse order cleanly
- IVS resources (MediaStack) can be deployed independently for pool management
- API changes (frequent) do not redeploy IVS resources (slow, costly)
- Auth stack changes are rare and high-risk, isolated from everything else

### CDK Construct Details

IVS only has L1 (CloudFormation-level) CDK constructs. No L2 abstractions exist yet.

```typescript
// Use L1 constructs from aws-cdk-lib/aws-ivs
import * as ivs from 'aws-cdk-lib/aws-ivs';

// Channel for broadcast
const channel = new ivs.CfnChannel(this, 'BroadcastChannel', {
  name: 'pool-channel-001',
  latencyMode: 'LOW',
  type: 'STANDARD',              // or BASIC for lower cost
  recordingConfigurationArn: recordingConfig.attrArn,
});

// Recording configuration
const recordingConfig = new ivs.CfnRecordingConfiguration(this, 'RecConfig', {
  destinationConfiguration: {
    s3: { bucketName: recordingBucket.bucketName },
  },
  thumbnailConfiguration: {
    recordingMode: 'INTERVAL',
    targetIntervalSeconds: 30,
    storage: ['SEQUENTIAL', 'LATEST'],
  },
});
```

**Important:** IVS RealTime resources (stages) and IVS Chat (rooms) are NOT in the `aws-cdk-lib/aws-ivs` module. They must be created via AWS SDK calls from Lambda (at runtime), not via CDK (at deploy time). This is actually the correct pattern because stages and rooms are ephemeral session resources, not infrastructure.

## DynamoDB Table Design

### Table 1: Sessions

**Purpose:** Core session state, maps user-facing sessions to IVS resources.

```
Table: Sessions
PK: sessionId (ULID or UUID)
GSI1PK: status (e.g., "live", "ended")
GSI1SK: createdAt (ISO timestamp)
GSI2PK: hostUserId
GSI2SK: createdAt

Attributes:
  sessionId: string (PK)
  mode: "broadcast" | "realtime"
  status: "live" | "ending" | "ended"
  hostUserId: string (Cognito username)
  hostDisplayName: string
  title: string
  channelArn: string | null (broadcast mode)
  stageArn: string | null (realtime mode)
  chatRoomArn: string
  playbackUrl: string | null (broadcast mode)
  maxParticipants: number (realtime mode, default 5)
  currentParticipants: number
  viewerCount: number
  createdAt: string (ISO)
  endedAt: string | null (ISO)
  recordingS3Prefix: string | null (populated after recording ends)
```

**Access patterns:**
- Get session by ID: `PK = sessionId`
- List live sessions: `GSI1PK = "live"`, sorted by `GSI1SK`
- List sessions by user: `GSI2PK = userId`, sorted by `GSI2SK`

### Table 2: ResourcePool

**Purpose:** Track pre-warmed IVS resources available for allocation.

```
Table: ResourcePool
PK: resourceType#resourceId (e.g., "channel#abc123")
GSI1PK: resourceType (e.g., "channel", "stage", "chatroom")
GSI1SK: status#createdAt

Attributes:
  resourceType: "channel" | "stage" | "chatroom"
  resourceId: string
  resourceArn: string
  status: "available" | "in-use" | "recycling" | "failed"
  assignedSessionId: string | null
  ingestEndpoint: string | null (channels)
  streamKeyArn: string | null (channels)
  streamKeyValue: string | null (channels)
  playbackUrl: string | null (channels)
  createdAt: string (ISO)
  lastUsedAt: string | null (ISO)
  metadata: map (extra resource-specific data)
```

**Access patterns:**
- Claim an available resource: `GSI1PK = "channel"`, `GSI1SK begins_with "available"`, take first, update status atomically with condition expression
- List all resources by type: `GSI1PK = "channel"`

### Table 3: Reactions

**Purpose:** Store reactions/emoji responses tied to sessions, with timestamps for replay sync.

```
Table: Reactions
PK: sessionId
SK: timestamp#userId

Attributes:
  sessionId: string
  userId: string
  reactionType: string (emoji code or reaction name)
  timestamp: number (milliseconds since session start, for replay sync)
  createdAt: string (ISO)
```

**Access patterns:**
- Get reactions for session: `PK = sessionId`, sorted by SK
- Get reaction summary: Aggregation query or pre-computed in Sessions table

### Table 4: Replays

**Purpose:** Catalog of completed recordings available for replay viewing.

```
Table: Replays
PK: replayId (ULID)
GSI1PK: hostUserId
GSI1SK: createdAt
GSI2PK: "REPLAY"
GSI2SK: createdAt (for global feed)

Attributes:
  replayId: string
  sessionId: string (FK to Sessions)
  hostUserId: string
  hostDisplayName: string
  title: string
  mode: "broadcast" | "realtime"
  durationMs: number
  hlsPlaybackUrl: string (CloudFront URL to master.m3u8)
  thumbnailUrl: string (CloudFront URL)
  renditions: list of { resolution, path }
  reactionSummary: map { reactionType: count }
  viewCount: number
  createdAt: string (ISO)
```

**Access patterns:**
- Get replay by ID: `PK = replayId`
- List replays by user: `GSI1PK = userId`, sorted by `GSI1SK`
- Global replay feed: `GSI2PK = "REPLAY"`, sorted by `GSI2SK`

### Table 5: ChatMessages (for replay persistence)

**Purpose:** Persist chat messages for replay context. IVS Chat is real-time only; messages are not stored by AWS.

```
Table: ChatMessages
PK: sessionId
SK: timestamp#messageId

Attributes:
  sessionId: string
  messageId: string
  userId: string
  displayName: string
  content: string
  timestamp: number (ms since session start, for replay sync)
  createdAt: string (ISO)
```

**Access patterns:**
- Get chat history for replay: `PK = sessionId`, ordered by SK
- Paginated replay chat: `PK = sessionId`, `SK between timestamp_start and timestamp_end`

**Note:** Chat messages must be captured by a Lambda that subscribes to the IVS Chat room via WebSocket, or by a client-side relay that POSTs messages to your API alongside sending them to IVS Chat. The Lambda approach is more reliable.

## Lambda Function Design

### Function Organization

```
lambdas/
  sessions/
    create.ts          # POST /sessions -- allocate resources, create session
    get.ts             # GET /sessions/{id}
    list.ts            # GET /sessions?status=live
    join.ts            # POST /sessions/{id}/join -- generate viewer tokens
    end.ts             # POST /sessions/{id}/end -- release resources
  tokens/
    stage-token.ts     # POST /sessions/{id}/stage-token (refresh)
    chat-token.ts      # POST /sessions/{id}/chat-token (refresh)
  presence/
    heartbeat.ts       # POST /sessions/{id}/heartbeat -- viewer count
    get-viewers.ts     # GET /sessions/{id}/viewers
  reactions/
    add.ts             # POST /sessions/{id}/reactions
    summary.ts         # GET /sessions/{id}/reactions/summary
  replays/
    list.ts            # GET /replays
    get.ts             # GET /replays/{id}
    chat-history.ts    # GET /replays/{id}/chat
  recording/
    on-state-change.ts # EventBridge trigger: IVS Recording State Change
  pool/
    warm.ts            # Scheduled: ensure pool has N available resources
    recycle.ts         # Cleanup: delete old/failed resources
    status.ts          # GET /admin/pool -- pool health dashboard
  chat-relay/
    persist-message.ts # Receives chat messages for persistence
  admin/
    dashboard.ts       # GET /admin/dashboard -- active sessions overview
```

### Lambda Design Principles

1. **Single-purpose functions:** Each Lambda does one thing. Avoid monolith handlers.
2. **Shared layer for IVS SDK clients:** Create a Lambda Layer with initialized `@aws-sdk/client-ivs`, `@aws-sdk/client-ivs-realtime`, and `@aws-sdk/client-ivschat` clients.
3. **Environment variables for resource ARNs:** Pass table names, bucket names, and pool config via env vars (set by CDK).
4. **Atomic DynamoDB operations for pool claims:** Use conditional writes (`attribute_not_exists` or `status = available`) to prevent race conditions when two sessions try to claim the same resource.
5. **Cold start mitigation:** Use provisioned concurrency on session/create and session/join Lambdas since they are latency-sensitive.

## React Frontend Component Architecture

### Page Structure

```
src/
  pages/
    HomePage.tsx           # Live sessions feed + "Go Live" button
    SessionPage.tsx        # Active live session (broadcast or realtime)
    ReplayPage.tsx         # Replay viewer with synced chat + reactions
    ProfilePage.tsx        # User's past sessions and replays
    AdminPage.tsx          # Dashboard for active sessions, pool health
    LoginPage.tsx          # Cognito auth
    SignupPage.tsx         # Cognito registration
  components/
    session/
      BroadcastView.tsx    # IVS Player for viewers watching a broadcast
      BroadcastControls.tsx # IVS Broadcast SDK controls for streamers
      RealtimeStage.tsx    # IVS RealTime SDK multi-participant grid
      RealtimeControls.tsx # Mute, camera, leave controls
      SessionCard.tsx      # Preview card in feed (thumbnail, title, viewer count)
      GoLiveModal.tsx      # Mode selection + title input
    chat/
      ChatPanel.tsx        # Real-time chat message list
      ChatInput.tsx        # Message input with send button
      ChatMessage.tsx      # Individual message bubble
    replay/
      ReplayPlayer.tsx     # HLS player for recorded content
      ReplayChatSync.tsx   # Chat messages synced to playback position
      ReactionTimeline.tsx # Reaction density visualization
      ReplayCard.tsx       # Replay thumbnail card for feed
    reactions/
      ReactionBar.tsx      # Emoji reaction buttons
      ReactionOverlay.tsx  # Floating reactions animation
    auth/
      AuthProvider.tsx     # Cognito auth context
      ProtectedRoute.tsx   # Route guard requiring auth
    layout/
      AppShell.tsx         # Navigation, header, layout
      NotDeployed.tsx      # "Stack not deployed" developer guidance
    common/
      LoadingSpinner.tsx
      ErrorBoundary.tsx
  hooks/
    useSession.ts          # Session CRUD operations
    useIVSPlayer.ts        # IVS Player SDK lifecycle
    useIVSBroadcast.ts     # IVS Broadcast SDK lifecycle
    useIVSRealtime.ts      # IVS RealTime SDK lifecycle
    useIVSChat.ts          # IVS Chat SDK lifecycle (WebSocket)
    usePresence.ts         # Viewer count polling/updates
    useReactions.ts        # Reaction submission + feed
    useReplays.ts          # Replay catalog fetching
    useAuth.ts             # Cognito auth operations
    useStackHealth.ts      # Check if backend is deployed
  services/
    api.ts                 # API Gateway client (axios/fetch wrapper)
    auth.ts                # Cognito Amplify auth service
    config.ts              # Runtime config from env vars / deployed outputs
```

### Key Frontend Patterns

**IVS SDK Initialization:** Each IVS SDK (Player, Broadcast, RealTime, Chat) has its own lifecycle and should be wrapped in a custom hook that handles initialization, cleanup, and error states. Never initialize IVS SDKs at module level -- always inside useEffect with proper cleanup.

**Session Abstraction:** The user never sees "channel", "stage", or "room". They see "Go Live" and pick Broadcast or Hangout. The frontend maps this to the correct IVS resource type internally.

**Stack Detection:** On app load, call a health endpoint (GET /health). If it fails, render the `NotDeployed` component with CDK deployment instructions rather than showing broken UI.

## Patterns to Follow

### Pattern 1: Resource Pool with Atomic Claims

**What:** Pre-create IVS channels, stages, and chat rooms. Store their ARNs in DynamoDB with status "available". When a user goes live, atomically claim a resource using DynamoDB conditional writes.

**When:** Always. IVS resource creation takes 2-10 seconds. Users expect instant "go live".

**Example:**
```typescript
// Claim an available channel from the pool
const result = await dynamodb.send(new UpdateCommand({
  TableName: 'ResourcePool',
  Key: { pk: `channel#${resourceId}` },
  UpdateExpression: 'SET #status = :inUse, assignedSessionId = :sessionId',
  ConditionExpression: '#status = :available',
  ExpressionAttributeNames: { '#status': 'status' },
  ExpressionAttributeValues: {
    ':inUse': 'in-use',
    ':available': 'available',
    ':sessionId': sessionId,
  },
  ReturnValues: 'ALL_NEW',
}));
```

**Pool warming (scheduled Lambda, every 5 minutes):**
```typescript
// Ensure pool has at least N available resources of each type
const availableChannels = await countAvailable('channel');
const deficit = POOL_TARGET_CHANNELS - availableChannels;
for (let i = 0; i < deficit; i++) {
  const channel = await ivsClient.send(new CreateChannelCommand({
    name: `pool-${Date.now()}-${i}`,
    latencyMode: 'LOW',
    type: 'STANDARD',
    recordingConfigurationArn: RECORDING_CONFIG_ARN,
  }));
  await saveToPool('channel', channel);
}
```

### Pattern 2: Token Refresh via Dedicated Endpoints

**What:** Expose separate token refresh endpoints so the frontend can get new IVS tokens without re-creating the session. IVS participant tokens and chat tokens expire independently.

**When:** RealTime participant tokens default to 12h but chat tokens have configurable session duration. Provide refresh endpoints for both.

**Example:**
```typescript
// POST /sessions/{id}/stage-token
export const handler = async (event: APIGatewayProxyEvent) => {
  const sessionId = event.pathParameters?.id;
  const userId = event.requestContext.authorizer?.claims?.sub;

  const session = await getSession(sessionId);

  const token = await ivsRealTimeClient.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId,
    capabilities: [ParticipantTokenCapability.PUBLISH, ParticipantTokenCapability.SUBSCRIBE],
    duration: 43200,  // 12 hours
    attributes: { displayName: session.hostDisplayName },
  }));

  return { statusCode: 200, body: JSON.stringify({ token: token.participantToken?.token }) };
};
```

### Pattern 3: EventBridge-Driven Recording Pipeline

**What:** Use EventBridge to react to IVS recording lifecycle events rather than polling S3. IVS emits "Recording State Change" events when recordings start and end.

**When:** Always. This is the officially recommended approach.

**Example:**
```typescript
// EventBridge Rule (CDK):
const recordingRule = new events.Rule(this, 'RecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['Recording End'],
    },
  },
});
recordingRule.addTarget(new targets.LambdaFunction(recordingProcessorLambda));

// Lambda handler:
export const handler = async (event: EventBridgeEvent) => {
  const { recording_s3_bucket_name, recording_s3_key_prefix, channel_name } = event.detail;

  // Read recording metadata from S3
  const metadata = await readRecordingMetadata(recording_s3_bucket_name, recording_s3_key_prefix);

  // Create replay entry
  await createReplay({
    sessionId: await findSessionByChannelArn(event.detail.channel_arn),
    durationMs: metadata.media.hls.duration_ms,
    hlsPlaybackUrl: `https://${CLOUDFRONT_DOMAIN}/${recording_s3_key_prefix}/media/hls/master.m3u8`,
    thumbnailUrl: `https://${CLOUDFRONT_DOMAIN}/${metadata.media.latest_thumbnail.path}`,
    renditions: metadata.media.hls.renditions,
  });
};
```

### Pattern 4: Chat Message Persistence via Lambda Relay

**What:** IVS Chat does not persist messages. To have chat available during replay, persist messages to DynamoDB. Use a backend-side WebSocket connection to each chat room that writes messages to DynamoDB, or have the frontend POST each message to your API in parallel with sending to IVS Chat.

**When:** Always -- chat replay is a core requirement.

**Recommended approach:** Client-side relay (simpler to implement, no server-side WebSocket management).

```typescript
// Frontend: send message to both IVS Chat and your API
const sendMessage = async (content: string) => {
  // Send to IVS Chat (real-time delivery)
  chatRoom.sendMessage({ content });

  // Persist to your API (for replay)
  await api.post(`/sessions/${sessionId}/messages`, {
    content,
    timestamp: Date.now() - sessionStartTime, // offset for replay sync
  });
};
```

**Alternative (more reliable but complex):** Server-side Lambda subscribes to IVS Chat room events and writes to DynamoDB. This catches all messages including from users who might not call your API.

### Pattern 5: Single-Table Design Consideration

**What:** DynamoDB works best when access patterns are known upfront. For this project, a multi-table design (one per entity) is recommended over single-table design because the entities are distinct enough and the team benefits from table-per-entity clarity.

**When:** Use separate tables. Single-table design adds complexity without proportional benefit for this use case since there are no cross-entity transactional queries.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Creating IVS Resources On-Demand

**What:** Creating channels, stages, or chat rooms when a user clicks "Go Live".
**Why bad:** IVS channel creation takes 2-10 seconds. Stage creation is faster but still adds latency. Users will perceive the app as slow. During high concurrency, you may hit IVS API rate limits.
**Instead:** Pre-warm a pool of resources. Claim from pool instantly. Replenish pool asynchronously.

### Anti-Pattern 2: Reusing Stages Across Sessions

**What:** Keeping a stage alive and having different groups use it over time.
**Why bad:** AWS recommends creating a new stage per logical session and deleting when done. Reusing stages can cause participant token conflicts, stale state, and makes recording boundaries unclear.
**Instead:** Create stage per session (pre-warmed via pool). Delete after session ends and recording completes. Create a fresh one for the pool.

### Anti-Pattern 3: Exposing IVS Resource ARNs to Frontend

**What:** Returning channel ARNs, stage ARNs, or room ARNs to the frontend and letting the frontend interact with IVS APIs directly.
**Why bad:** Leaks infrastructure details. Frontend should never call IVS control plane APIs. Tokens are the only thing the frontend needs.
**Instead:** Backend returns opaque session IDs and tokens. Frontend uses IVS SDKs with tokens only. All resource management stays server-side.

### Anti-Pattern 4: Polling S3 for Recording Completion

**What:** Periodically checking S3 to see if recording files have appeared.
**Why bad:** Wastes resources, introduces latency, unreliable timing. IVS warns that recording end events may be delayed by `recordingReconnectWindowSeconds`.
**Instead:** Use EventBridge to receive IVS Recording State Change events. Wait for the Recording End event before indexing.

### Anti-Pattern 5: Storing Chat Messages Only in IVS Chat

**What:** Relying on IVS Chat to persist message history.
**Why bad:** IVS Chat is a real-time messaging service. It does not provide message history or persistence. When the room is deleted or the user disconnects, messages are gone.
**Instead:** Persist messages to DynamoDB (either client-relay or server-relay pattern) with timestamps relative to session start for replay synchronization.

### Anti-Pattern 6: Monolith CDK Stack

**What:** Putting all resources (Cognito, DynamoDB, IVS, Lambda, API Gateway, CloudFront, S3) in a single CDK stack.
**Why bad:** Deployment takes forever. A change to a Lambda function redeploys IVS resources. Risk of hitting CloudFormation resource limits. Cannot independently manage resource lifecycle.
**Instead:** Split into 4-6 stacks with explicit cross-stack references (see CDK Stack Organization above).

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| **IVS Resource Pool** | 5-10 pre-warmed channels + stages | 50-100 pool size, faster recycling | Custom pool scaling, potential IVS service limit increases needed |
| **Lambda Concurrency** | Default limits fine | Reserve concurrency for session/create, join | Provisioned concurrency, potential move to ECS for session management |
| **DynamoDB** | On-demand capacity fine | On-demand still fine, monitor hot partitions | Consider DAX for session reads, GSI fan-out for presence |
| **Chat Messages** | DynamoDB writes fine | Batch writes, consider SQS buffer | Kinesis Data Streams for chat ingestion, batch to DynamoDB |
| **Replay Storage** | S3 standard | S3 lifecycle rules (IA after 30d, Glacier after 90d) | Same + CDN optimization, consider HLS segment caching |
| **Recording Processing** | Single Lambda per event | Fine (EventBridge scales) | Fine (Lambda + EventBridge auto-scale) |
| **IVS Service Limits** | Default limits sufficient | Request limit increases for channels, stages | Major limit increase requests, potential multi-region |

## IVS Service-Specific Architecture Notes

### IVS Low-Latency Streaming (Broadcast)
- **Ingest protocols:** RTMP, RTMPS, SRT
- **Delivery:** Managed CDN, HLS playback
- **Latency:** 2-5 seconds (low-latency mode)
- **Recording:** Built-in auto-record to S3 via RecordingConfiguration
- **S3 structure:** `/ivs/v1/{accountId}/{channelId}/{date}/{recordingId}/`
- **Metadata:** JSON files in `events/` subfolder
- **Playback:** HLS via `master.m3u8`, multiple renditions
- **Thumbnails:** Configurable interval (1-60s), multiple resolutions

### IVS RealTime (Hangouts)
- **Protocol:** WebRTC (managed by IVS SDK)
- **Latency:** <300ms
- **Capacity:** Up to 12 publishers, 25K+ subscribers
- **Tokens:** CreateParticipantToken API or self-signed JWTs with key pairs
- **Token capabilities:** PUBLISH, SUBSCRIBE (or both)
- **Token duration:** Default 12h, max 14 days
- **Token attributes:** userId and custom attributes are exposed to ALL participants (no PII)
- **Recording:** Individual participant recording (per-participant S3 output) or server-side composition (composed video)
- **Stage lifecycle:** Create per session, delete when done

### IVS Chat
- **Protocol:** WebSocket
- **Authentication:** Chat tokens (created via CreateChatToken API)
- **Token capabilities:** SEND_MESSAGE, DELETE_MESSAGE, DISCONNECT_USER
- **Persistence:** None built-in. Must implement your own.
- **Integration:** Independent service; works with both low-latency channels and RealTime stages
- **Rooms:** Created via API, independent resources

## Suggested Build Order (Dependencies)

Build the system in this order, based on technical dependencies:

```
Phase 1: Foundation (no IVS dependency)
  Auth (Cognito) + Storage (DynamoDB + S3) + CDK scaffolding
  Why first: Everything else depends on auth and storage

Phase 2: Broadcast Core (simplest IVS integration)
  IVS Channels + Resource Pool + Session CRUD + IVS Player
  Why second: Broadcast is simpler than RealTime (no WebRTC), proves the pool pattern

Phase 3: Chat Integration
  IVS Chat rooms + chat tokens + WebSocket UI + message persistence
  Why third: Chat works with both modes, adds immediate interactivity

Phase 4: RealTime Hangouts
  IVS RealTime Stages + participant tokens + WebRTC UI + multi-participant grid
  Why fourth: Most complex SDK integration, benefits from patterns established in Phase 2-3

Phase 5: Recording + Replay
  EventBridge pipeline + recording processor + replay catalog + replay viewer + chat sync
  Why fifth: Requires completed broadcast/realtime/chat to have content to record

Phase 6: Polish + Admin
  Admin dashboard + developer CLI + presence tracking + reaction overlays
  Why last: Enhancement layer on top of working core
```

## Sources

- AWS IVS Low-Latency Streaming User Guide: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/what-is.html (HIGH confidence -- official docs, verified via WebFetch)
- AWS IVS RealTime Streaming User Guide: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/what-is.html (HIGH confidence -- official docs, verified via WebFetch)
- AWS IVS RealTime Stage Creation: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-create-stage.html (HIGH confidence -- official docs, verified via WebFetch)
- AWS IVS RealTime Token Distribution: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html (HIGH confidence -- official docs, verified via WebFetch, full JWT structure documented)
- AWS IVS Auto-Record to S3: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html (HIGH confidence -- official docs, verified via WebFetch, includes S3 structure and metadata schema)
- AWS CDK IVS Constructs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ivs-readme.html (HIGH confidence -- official docs, confirmed L1 only)
- AWS IVS Chat User Guide: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/what-is.html (MEDIUM confidence -- landing page confirmed service exists, detailed token API not directly verified via WebFetch)
- DynamoDB table design and Lambda patterns: Training data (MEDIUM confidence -- standard AWS serverless patterns, widely documented)
- React frontend component architecture: Training data (MEDIUM confidence -- standard React patterns, IVS SDK integration patterns based on official SDK documentation structure)
- Resource pool pattern: Training data combined with IVS docs noting "create a new stage for each logical session" (MEDIUM-HIGH confidence -- pattern well-established in IVS community, stage lifecycle confirmed in official docs)
- IVS RealTime server-side composition for recording: Training data (LOW confidence -- could not verify current API via WebFetch, documentation pages returned redirects; validate against latest docs before implementing)
