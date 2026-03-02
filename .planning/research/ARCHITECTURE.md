# Architecture Integration Research

**Domain:** Live video platform with recording, reactions, and RealTime hangouts
**Researched:** 2026-03-02
**Confidence:** HIGH

## Integration Overview

This research focuses on how **recording metadata**, **reaction events**, and **IVS RealTime Stage management** integrate with the existing VideoNowAndLater architecture. The platform currently supports one-to-many broadcasts via IVS Channels with pre-warmed resource pools, DynamoDB single-table design, and EventBridge-driven lifecycle management.

### New Components Required

```
┌─────────────────────────────────────────────────────────────┐
│                    EXISTING ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────┤
│  API Gateway + Lambda + Cognito (Auth/API Layer)           │
│  DynamoDB Single Table + GSI1 (Data Layer)                 │
│  IVS Channels + Chat Rooms + Pool Management                │
│  EventBridge Rules (Stream/Recording State Changes)         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   NEW COMPONENTS (v1.1)                      │
├─────────────────────────────────────────────────────────────┤
│  NEW: IVS Recording Configurations (per-channel S3 output) │
│  NEW: IVS RealTime Stages (hangout sessions)               │
│  NEW: S3 Bucket (recordings + metadata storage)            │
│  NEW: Reaction Storage (DynamoDB items with timestamps)     │
│  NEW: GSI2 (time-range queries for replay sync)            │
│  NEW: EventBridge Rules (Recording Start/End handlers)      │
│  NEW: Lambda Functions (replay listing, reaction APIs)      │
└─────────────────────────────────────────────────────────────┘
```

## Recording Metadata Integration

### How IVS Recording Works

AWS IVS Auto-Record generates recordings in S3 with a structured path format:

```
/ivs/v1/<account_id>/<channel_id>/<year>/<month>/<day>/<hour>/<minute>/<recording_id>/
├── events/
│   ├── recording-started.json
│   ├── recording-ended.json
│   └── recording-failed.json
└── media/
    ├── hls/
    │   ├── master.m3u8
    │   └── [renditions]/
    └── thumbnails/
```

Recording metadata JSON files include:
- `channel_arn`: Which channel recorded
- `recording_started_at` / `recording_ended_at`: Timestamps
- `media.hls.duration_ms`: Total recording duration
- `media.hls.path`: Relative path to HLS content
- `media.hls.renditions[]`: Resolution, width, height per rendition
- `media.thumbnails`: Thumbnail paths and metadata

**Source:** [AWS IVS Auto-Record to S3 Documentation](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)

### Integration Points

#### 1. Infrastructure Layer (CDK)

**New Stack Component: Recording Configuration**

```typescript
// infra/lib/stacks/session-stack.ts (MODIFY)

// New: S3 bucket for recordings
const recordingBucket = new s3.Bucket(this, 'RecordingBucket', {
  bucketName: 'vnl-recordings',
  removalPolicy: RemovalPolicy.RETAIN, // Keep recordings on stack destroy
  lifecycleRules: [{
    expiration: Duration.days(90), // Optional: auto-delete old recordings
  }],
});

// New: IVS Recording Configuration
const recordingConfig = new ivs.CfnRecordingConfiguration(this, 'RecordingConfig', {
  destinationConfiguration: {
    s3: {
      bucketName: recordingBucket.bucketName,
    },
  },
  thumbnailConfiguration: {
    recordingMode: 'INTERVAL',
    targetIntervalSeconds: 60, // Thumbnail every minute
    storage: ['SEQUENTIAL', 'LATEST'],
  },
  recordingReconnectWindowSeconds: 60, // Merge fragmented streams within 60s
  renditionSelection: 'ALL', // Record all resolutions
});

// Grant IVS write access to S3 bucket
recordingBucket.addToResourcePolicy(new iam.PolicyStatement({
  actions: ['s3:PutObject'],
  resources: [`${recordingBucket.bucketArn}/*`],
  principals: [new iam.ServicePrincipal('ivs.amazonaws.com')],
}));
```

**Modified: Pool Replenishment (Associate Recording Config)**

```typescript
// backend/src/handlers/replenish-pool.ts (MODIFY createChannel function)

async function createChannel(tableName: string): Promise<void> {
  const ivsClient = getIVSClient();
  const docClient = getDocumentClient();

  const channelId = uuidv4();

  const createChannelResponse = await ivsClient.send(
    new CreateChannelCommand({
      name: `vnl-channel-${channelId}`,
      recordingConfigurationArn: process.env.RECORDING_CONFIG_ARN, // NEW
      latencyMode: 'LOW',
    })
  );

  // Store channel in pool with recording enabled flag
  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `POOL#${createChannelResponse.channel.arn}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#AVAILABLE',
      GSI1SK: new Date().toISOString(),
      resourceType: ResourceType.CHANNEL,
      status: Status.AVAILABLE,
      recordingEnabled: true, // NEW
      createdAt: new Date().toISOString(),
    },
  }));
}
```

#### 2. Data Layer (DynamoDB Schema Extension)

**Recording Metadata Storage**

Add recording metadata to Session items when recording completes:

```typescript
// DynamoDB Session Item (EXTENDED)
{
  PK: "SESSION#<sessionId>",
  SK: "METADATA",
  GSI1PK: "STATUS#ENDED",
  GSI1SK: "2026-03-02T14:30:00Z",

  // Existing fields
  sessionId: "abc123",
  userId: "user-456",
  sessionType: "BROADCAST",
  status: "ended",
  claimedResources: { channel: "arn:...", chatRoom: "arn:..." },
  createdAt: "2026-03-02T14:00:00Z",
  startedAt: "2026-03-02T14:05:00Z",
  endedAt: "2026-03-02T14:30:00Z",
  version: 3,

  // NEW: Recording metadata (added by recording-ended handler)
  recording: {
    s3Bucket: "vnl-recordings",
    s3KeyPrefix: "ivs/v1/.../2026/3/2/14/5/recId123/",
    durationMs: 1500000, // 25 minutes
    playbackUrl: "https://vnl-recordings.s3.amazonaws.com/.../media/hls/master.m3u8",
    thumbnailUrl: "https://vnl-recordings.s3.amazonaws.com/.../media/thumbnails/thumb0.jpg",
    renditions: [
      { resolution: "480p", width: 852, height: 480 },
      { resolution: "720p", width: 1280, height: 720 }
    ],
    chatMessageCount: 42, // Computed from chat history
    reactionCount: 18,    // Computed from reactions
  }
}
```

**New Handler: Recording Started**

```typescript
// backend/src/handlers/recording-started.ts (NEW)

export const handler = async (
  event: EventBridgeEvent<'IVS Recording State Change', RecordingStartDetail>
): Promise<void> => {
  const { channel_name, recording_s3_key_prefix } = event.detail;

  // Find session by channel ARN
  const session = await findSessionByChannel(tableName, channel_name);

  // Store preliminary recording metadata
  await updateSessionRecording(tableName, session.sessionId, {
    s3KeyPrefix: recording_s3_key_prefix,
    s3Bucket: event.detail.recording_s3_bucket_name,
    status: 'RECORDING',
  });
};
```

**Modified Handler: Recording Ended**

```typescript
// backend/src/handlers/recording-ended.ts (MODIFY)

export const handler = async (
  event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>
): Promise<void> => {
  const {
    channel_name,
    recording_s3_key_prefix,
    recording_duration_ms,
  } = event.detail;

  // Fetch recording-ended.json from S3
  const metadata = await fetchRecordingMetadata(
    event.detail.recording_s3_bucket_name,
    `${recording_s3_key_prefix}/events/recording-ended.json`
  );

  // Count chat messages and reactions for this session
  const [chatCount, reactionCount] = await Promise.all([
    countChatMessages(tableName, session.sessionId),
    countReactions(tableName, session.sessionId),
  ]);

  // Update session with full recording metadata
  await updateSessionRecording(tableName, session.sessionId, {
    s3KeyPrefix: recording_s3_key_prefix,
    s3Bucket: event.detail.recording_s3_bucket_name,
    durationMs: recording_duration_ms,
    playbackUrl: constructPlaybackUrl(metadata),
    thumbnailUrl: constructThumbnailUrl(metadata),
    renditions: metadata.media.hls.renditions,
    chatMessageCount: chatCount,
    reactionCount: reactionCount,
    status: 'COMPLETED',
  });

  // Existing: Transition session to ENDED, release pool resources
  await updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt');
  await releasePoolResources(session);
};
```

#### 3. API Layer (New Endpoints)

**GET /sessions (List Replay Sessions)**

```typescript
// backend/src/handlers/list-sessions.ts (NEW)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const tableName = process.env.TABLE_NAME!;
  const limit = parseInt(event.queryStringParameters?.limit || '20', 10);

  // Query GSI1 for ENDED sessions sorted by endedAt
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :status',
    ExpressionAttributeValues: {
      ':status': 'STATUS#ENDED',
    },
    ScanIndexForward: false, // Newest first
    Limit: limit,
  }));

  const sessions = result.Items.filter(item => item.recording?.status === 'COMPLETED');

  return {
    statusCode: 200,
    body: JSON.stringify({ sessions }),
  };
};
```

**GET /sessions/{sessionId}/replay (Get Replay Metadata)**

```typescript
// backend/src/handlers/get-replay.ts (NEW)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const sessionId = event.pathParameters!.sessionId;
  const session = await getSessionById(tableName, sessionId);

  if (!session || !session.recording) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Recording not found' }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      sessionId: session.sessionId,
      playbackUrl: session.recording.playbackUrl,
      thumbnailUrl: session.recording.thumbnailUrl,
      durationMs: session.recording.durationMs,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    }),
  };
};
```

### Recording State Flow

```
Channel Creation → Recording Config Associated
    ↓
Broadcaster Starts Stream → IVS Stream Start Event
    ↓
Session Status: CREATING → LIVE (existing)
    ↓
IVS Recording Start Event → recording-started.json written to S3
    ↓
Store preliminary recording metadata in session (NEW)
    ↓
Stream Ends → IVS Stream End Event
    ↓
Session Status: LIVE → ENDING (existing)
    ↓
IVS Recording End Event (delayed by reconnectWindow) → recording-ended.json written
    ↓
Fetch recording metadata from S3 (NEW)
Count chat messages and reactions (NEW)
Update session with full recording metadata (NEW)
    ↓
Session Status: ENDING → ENDED (existing)
Release pool resources (existing)
```

## Reaction Events Integration

### Reaction Storage Pattern

Reactions are time-series events that need to be:
1. Written in real-time during live streams
2. Queried for replay synchronization by timestamp
3. Aggregated for counts and statistics

**DynamoDB Schema for Reactions**

```typescript
// New DynamoDB items for reactions
{
  PK: "SESSION#<sessionId>",
  SK: "REACTION#<timestamp>#<reactionId>",
  GSI1PK: "USER#<userId>",           // Find all reactions by user
  GSI1SK: "<timestamp>",
  GSI2PK: "SESSION#<sessionId>",     // NEW GSI for time-range queries
  GSI2SK: "<sessionRelativeTimeMs>", // Milliseconds since session start

  reactionId: "uuid",
  sessionId: "abc123",
  userId: "user-456",
  reactionType: "heart" | "fire" | "clap" | "laugh",
  timestamp: "2026-03-02T14:10:30.500Z",
  sessionRelativeTime: 330500, // 5m 30.5s into the stream
}
```

**New GSI2 for Time-Range Queries**

```typescript
// infra/lib/stacks/session-stack.ts (MODIFY)

this.table.addGlobalSecondaryIndex({
  indexName: 'GSI2',
  partitionKey: {
    name: 'GSI2PK',
    type: dynamodb.AttributeType.STRING,
  },
  sortKey: {
    name: 'GSI2SK',
    type: dynamodb.AttributeType.NUMBER, // Numeric sort for time ranges
  },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**Source:** [DynamoDB time-series event patterns](https://aws.amazon.com/blogs/database/build-scalable-event-driven-architectures-with-amazon-dynamodb-and-aws-lambda/) and [GSI query patterns research](https://dynobase.dev/dynamodb-gsi/)

### Integration Points

#### 1. Live Reactions (During Broadcast)

**POST /sessions/{sessionId}/reactions**

```typescript
// backend/src/handlers/create-reaction.ts (NEW)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const sessionId = event.pathParameters!.sessionId;
  const userId = event.requestContext.authorizer!.claims.sub;
  const { reactionType } = JSON.parse(event.body!);

  // Get session to calculate relative time
  const session = await getSessionById(tableName, sessionId);

  if (!session || session.status !== SessionStatus.LIVE) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Session not live' }) };
  }

  const now = new Date().toISOString();
  const sessionRelativeTime = calculateSessionRelativeTime(session.startedAt!, now);
  const reactionId = uuidv4();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `REACTION#${now}#${reactionId}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: now,
      GSI2PK: `SESSION#${sessionId}`,
      GSI2SK: sessionRelativeTime, // Numeric sort key for time-range queries
      reactionId,
      sessionId,
      userId,
      reactionType,
      timestamp: now,
      sessionRelativeTime,
    },
  }));

  return {
    statusCode: 201,
    body: JSON.stringify({ reactionId, sessionRelativeTime }),
  };
};
```

#### 2. Replay Reactions (During Playback)

**POST /sessions/{sessionId}/replay-reactions**

```typescript
// backend/src/handlers/create-replay-reaction.ts (NEW)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const sessionId = event.pathParameters!.sessionId;
  const userId = event.requestContext.authorizer!.claims.sub;
  const { reactionType, videoTimestamp } = JSON.parse(event.body!);

  // videoTimestamp is milliseconds into the replay video (e.g., user at 5m30s)

  const session = await getSessionById(tableName, sessionId);

  if (!session || session.status !== SessionStatus.ENDED) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Session not ended' }) };
  }

  const now = new Date().toISOString();
  const reactionId = uuidv4();

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `REACTION#${now}#${reactionId}`,
      GSI1PK: `USER#${userId}`,
      GSI1SK: now,
      GSI2PK: `SESSION#${sessionId}`,
      GSI2SK: videoTimestamp, // Use video timestamp for sync
      reactionId,
      sessionId,
      userId,
      reactionType,
      timestamp: now,
      sessionRelativeTime: videoTimestamp,
      isReplayReaction: true, // Flag to distinguish from live reactions
    },
  }));

  return {
    statusCode: 201,
    body: JSON.stringify({ reactionId }),
  };
};
```

#### 3. Query Reactions for Replay Sync

**GET /sessions/{sessionId}/reactions?startTime=0&endTime=60000**

```typescript
// backend/src/handlers/get-reactions.ts (NEW)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const sessionId = event.pathParameters!.sessionId;
  const startTime = parseInt(event.queryStringParameters?.startTime || '0', 10);
  const endTime = parseInt(event.queryStringParameters?.endTime || '999999999', 10);

  // Query GSI2 for reactions within time range
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :session AND GSI2SK BETWEEN :start AND :end',
    ExpressionAttributeValues: {
      ':session': `SESSION#${sessionId}`,
      ':start': startTime,
      ':end': endTime,
    },
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ reactions: result.Items }),
  };
};
```

### Reaction Data Flow

```
Live Stream:
User clicks reaction → POST /sessions/{id}/reactions
    ↓
Calculate sessionRelativeTime from session.startedAt
    ↓
Store reaction with GSI2SK = sessionRelativeTime
    ↓
Frontend receives reaction → Display in real-time overlay

Replay:
User plays video → Video player at 5m30s (330000ms)
    ↓
Frontend polls: GET /sessions/{id}/reactions?startTime=330000&endTime=360000
    ↓
Query GSI2 for reactions in 30s window
    ↓
Display reactions synchronized to video timeline
```

**Source:** [Live streaming reactions architecture patterns](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-live-comments)

### Chat Message Pattern (Already Implemented)

Chat messages already use `sessionRelativeTime` field (see `backend/src/domain/chat-message.ts`). The same GSI2 pattern should be added to chat messages for efficient replay queries:

```typescript
// MODIFY: backend/src/handlers/send-message.ts

// Add GSI2 attributes to chat message items
{
  PK: "SESSION#<sessionId>",
  SK: "CHAT#<timestamp>#<messageId>",
  GSI1PK: "USER#<senderId>",
  GSI1SK: "<timestamp>",
  GSI2PK: "SESSION#<sessionId>", // NEW
  GSI2SK: sessionRelativeTime,   // NEW (already calculated)
  // ... rest of chat message fields
}
```

## IVS RealTime Stage Integration

### How IVS RealTime Stages Work

IVS RealTime Stages enable multi-participant WebRTC sessions (hangouts). Key differences from IVS Channels:

| Feature | IVS Channel (Broadcast) | IVS RealTime Stage (Hangout) |
|---------|------------------------|------------------------------|
| Participants | 1 broadcaster, N viewers | Up to 12 publishers, unlimited viewers |
| Protocol | RTMPS ingest, HLS playback | WebRTC (bidirectional) |
| Latency | 2-5 seconds | Sub-second |
| Recording | Channel-level recording config | Individual participant recording or composite |
| Resource pool | Pre-warmed channels | Pre-warmed stages |

**Source:** [IVS RealTime Stage Creation Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-create-stage.html)

### Integration Points

#### 1. Infrastructure Layer (Pool Management)

**Stage Pool with Recording**

```typescript
// infra/lib/stacks/session-stack.ts (MODIFY replenish pool environment)

environment: {
  TABLE_NAME: this.table.tableName,
  MIN_CHANNELS: '3',
  MIN_STAGES: '2',
  MIN_ROOMS: '5',
  STORAGE_CONFIG_ARN: storageConfig.attrArn, // NEW: For stage recording
}
```

**Storage Configuration for Stage Recording**

```typescript
// infra/lib/stacks/session-stack.ts (NEW)

const storageConfig = new ivs.CfnStorageConfiguration(this, 'StageStorageConfig', {
  s3: {
    bucketName: recordingBucket.bucketName,
  },
});
```

**Modified: Create Stage with Recording**

```typescript
// backend/src/handlers/replenish-pool.ts (MODIFY createStage function)

async function createStage(tableName: string): Promise<void> {
  const ivsRealTimeClient = getIVSRealTimeClient();
  const docClient = getDocumentClient();

  const stageId = uuidv4();

  const createStageResponse = await ivsRealTimeClient.send(
    new CreateStageCommand({
      name: `vnl-stage-${stageId}`,
      // NEW: Enable individual participant recording
      autoParticipantRecordingConfiguration: {
        storageConfigurationArn: process.env.STORAGE_CONFIG_ARN,
        mediaTypes: ['AUDIO_VIDEO'],
      },
    })
  );

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `POOL#${createStageResponse.stage.arn}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#AVAILABLE',
      GSI1SK: new Date().toISOString(),
      resourceType: ResourceType.STAGE,
      status: Status.AVAILABLE,
      recordingEnabled: true, // NEW
      createdAt: new Date().toISOString(),
    },
  }));
}
```

#### 2. Session Creation (Hangout vs Broadcast)

**Modified: Create Session Handler**

```typescript
// backend/src/handlers/create-session.ts (MODIFY)

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const userId = event.requestContext.authorizer!.claims.sub;
  const { sessionType } = JSON.parse(event.body!); // NEW: 'BROADCAST' or 'HANGOUT'

  if (sessionType === SessionType.HANGOUT) {
    // Claim stage from pool
    const stage = await claimPoolResource(tableName, ResourceType.STAGE);
    const chatRoom = await claimPoolResource(tableName, ResourceType.ROOM);

    const session = {
      sessionId: uuidv4(),
      userId,
      sessionType: SessionType.HANGOUT,
      status: SessionStatus.CREATING,
      claimedResources: {
        stage: stage.arn, // Stage ARN instead of channel
        chatRoom: chatRoom.arn,
      },
      createdAt: new Date().toISOString(),
      version: 1,
    };

    await createSession(tableName, session);

    return {
      statusCode: 201,
      body: JSON.stringify({
        sessionId: session.sessionId,
        sessionType: 'HANGOUT',
      }),
    };
  } else {
    // Existing broadcast logic (claim channel + room)
    // ...
  }
};
```

#### 3. Participant Token Generation

**POST /sessions/{sessionId}/participant-token**

```typescript
// backend/src/handlers/create-participant-token.ts (NEW)

import { CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const sessionId = event.pathParameters!.sessionId;
  const userId = event.requestContext.authorizer!.claims.sub;
  const username = event.requestContext.authorizer!.claims['cognito:username'];

  const session = await getSessionById(tableName, sessionId);

  if (!session || session.sessionType !== SessionType.HANGOUT) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Not a hangout session' }) };
  }

  const ivsRealTimeClient = getIVSRealTimeClient();

  const tokenResponse = await ivsRealTimeClient.send(
    new CreateParticipantTokenCommand({
      stageArn: session.claimedResources.stage,
      userId,
      attributes: {
        username,
      },
      capabilities: ['PUBLISH', 'SUBSCRIBE'], // Full participant (not just viewer)
      duration: 3600, // 1 hour
    })
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      token: tokenResponse.participantToken.token,
      participantId: tokenResponse.participantToken.participantId,
    }),
  };
};
```

#### 4. Stage Lifecycle Management

**Hangout Session Flow**

```
User creates hangout → Claim stage from pool
    ↓
Generate participant tokens for host and guests
    ↓
Participants join stage via WebRTC (IVS Web Broadcast SDK)
    ↓
Stage records individual participant streams to S3
    ↓
Host ends hangout → Participants disconnect
    ↓
IVS Recording End events (one per participant) → EventBridge
    ↓
Aggregate participant recordings metadata
    ↓
Session Status: CREATING → LIVE → ENDING → ENDED
Release stage + chat room back to pool
```

**EventBridge Rule for Stage Recording Events**

```typescript
// infra/lib/stacks/session-stack.ts (NEW)

// Lambda function for stage-recording-ended events
const stageRecordingEndedFn = new nodejs.NodejsFunction(this, 'StageRecordingEnded', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/stage-recording-ended.ts'),
  timeout: Duration.seconds(30),
  environment: {
    TABLE_NAME: this.table.tableName,
  },
});

this.table.grantReadWriteData(stageRecordingEndedFn);

// EventBridge rule for IVS RealTime Recording End events
new events.Rule(this, 'StageRecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['Recording End'],
      // Filter for stage recordings (not channel recordings)
      stage_arn: [{ exists: true }],
    },
  },
  targets: [new targets.LambdaFunction(stageRecordingEndedFn)],
  description: 'Handle stage participant recording completion',
});
```

**Handler: Stage Recording Ended**

```typescript
// backend/src/handlers/stage-recording-ended.ts (NEW)

export const handler = async (
  event: EventBridgeEvent<'IVS Recording State Change', StageRecordingEndDetail>
): Promise<void> => {
  const { stage_arn, participant_id, recording_s3_key_prefix } = event.detail;

  // Find session by stage ARN
  const session = await findSessionByStage(tableName, stage_arn);

  // Store participant recording metadata
  await addParticipantRecording(tableName, session.sessionId, {
    participantId: participant_id,
    s3KeyPrefix: recording_s3_key_prefix,
    s3Bucket: event.detail.recording_s3_bucket_name,
    durationMs: event.detail.recording_duration_ms,
  });

  // Check if all participants have finished recording
  const allParticipantsRecorded = await checkAllParticipantsRecorded(session);

  if (allParticipantsRecorded) {
    // Transition session to ENDED
    await updateSessionStatus(tableName, session.sessionId, SessionStatus.ENDED, 'endedAt');
    await releasePoolResources(session);
  }
};
```

### Stage Session Data Model

```typescript
// Session with stage recordings (multiple participants)
{
  PK: "SESSION#<sessionId>",
  SK: "METADATA",

  sessionId: "hangout-123",
  userId: "host-user",
  sessionType: "HANGOUT",
  status: "ended",
  claimedResources: {
    stage: "arn:aws:ivs:...:stage/...",
    chatRoom: "arn:aws:ivschat:...:room/...",
  },

  // NEW: Array of participant recordings
  participantRecordings: [
    {
      participantId: "participant-1",
      userId: "host-user",
      s3Bucket: "vnl-recordings",
      s3KeyPrefix: "ivs/v1/.../stage/.../participant-1/",
      durationMs: 1800000,
      playbackUrl: "https://.../.../media/hls/master.m3u8",
    },
    {
      participantId: "participant-2",
      userId: "guest-user",
      s3Bucket: "vnl-recordings",
      s3KeyPrefix: "ivs/v1/.../stage/.../participant-2/",
      durationMs: 1750000,
      playbackUrl: "https://.../.../media/hls/master.m3u8",
    },
  ],

  // Composite view for replay (requires frontend to sync multiple streams)
  recording: {
    type: "MULTI_PARTICIPANT",
    totalParticipants: 2,
    longestDurationMs: 1800000,
    chatMessageCount: 28,
    reactionCount: 9,
  }
}
```

## Component Boundaries & Communication

### Modified Components

| Component | What Changes | Why |
|-----------|-------------|-----|
| **SessionStack (CDK)** | Add S3 bucket, recording config, storage config, GSI2 | Recording output, reaction queries |
| **replenish-pool.ts** | Associate recording config with channels/stages | Enable auto-recording |
| **create-session.ts** | Support sessionType: HANGOUT, claim stage | Multi-participant sessions |
| **recording-ended.ts** | Fetch S3 metadata, count messages/reactions | Build replay metadata |
| **send-message.ts** | Add GSI2PK/GSI2SK | Enable time-range queries |
| **Session domain** | Add recording metadata, participantRecordings | Store playback info |

### New Components

| Component | Responsibility | Dependencies |
|-----------|---------------|--------------|
| **recording-started.ts** | Handle Recording Start events, store preliminary metadata | Session repo, S3 client |
| **stage-recording-ended.ts** | Handle stage participant recordings, aggregate metadata | Session repo, S3 client |
| **create-reaction.ts** | Store reactions with sessionRelativeTime | Session repo |
| **create-replay-reaction.ts** | Store replay-time reactions | Session repo |
| **get-reactions.ts** | Query reactions by time range (GSI2) | DynamoDB GSI2 |
| **list-sessions.ts** | Query ENDED sessions for home feed | DynamoDB GSI1 |
| **get-replay.ts** | Return replay metadata (playback URL, duration) | Session repo |
| **create-participant-token.ts** | Generate IVS RealTime participant tokens | IVS RealTime client |

### Data Flow Summary

#### Recording Flow

```
IVS Recording Start Event
    ↓
recording-started.ts → Store preliminary metadata
    ↓
IVS Recording End Event (delayed by reconnectWindow)
    ↓
recording-ended.ts → Fetch S3 metadata → Count messages/reactions → Update session
    ↓
Session available for replay via list-sessions.ts
```

#### Reaction Flow (Live)

```
User clicks reaction in live stream
    ↓
POST /sessions/{id}/reactions
    ↓
Calculate sessionRelativeTime (ms since session.startedAt)
    ↓
Store reaction with GSI2SK = sessionRelativeTime
    ↓
Frontend displays reaction overlay
```

#### Reaction Flow (Replay)

```
User plays replay video at 5m30s
    ↓
GET /sessions/{id}/reactions?startTime=330000&endTime=360000
    ↓
Query GSI2: GSI2PK = SESSION#{id}, GSI2SK BETWEEN 330000 AND 360000
    ↓
Return reactions + chat messages in time range
    ↓
Frontend displays synchronized to video timeline
```

#### Hangout Flow

```
User creates hangout session
    ↓
create-session.ts → Claim stage from pool
    ↓
POST /sessions/{id}/participant-token → Generate participant tokens
    ↓
Participants join via IVS Web Broadcast SDK (WebRTC)
    ↓
Individual participant recordings to S3
    ↓
IVS Recording End events (one per participant)
    ↓
stage-recording-ended.ts → Aggregate participant recordings
    ↓
Session available for replay with multi-stream playback
```

## Build Order & Dependencies

### Phase 1: Recording Foundation
**Dependencies:** None (extends existing architecture)
**Build order:**
1. CDK: Add S3 bucket, recording configuration, storage configuration
2. CDK: Add recording-started and recording-ended EventBridge rules
3. Backend: `recording-started.ts` handler (store preliminary metadata)
4. Backend: Modify `recording-ended.ts` to fetch S3 metadata
5. Backend: Extend Session domain with recording metadata
6. Backend: `list-sessions.ts` (query ENDED sessions)
7. Backend: `get-replay.ts` (return playback URL, duration)
8. Frontend: Home feed (list replays)
9. Frontend: Replay viewer (HLS player with recording URL)

**Why this order:** Recording is foundational. Must work before reactions/chat can sync to replay timeline.

### Phase 2: Reactions (Live + Replay)
**Dependencies:** Phase 1 (needs sessionRelativeTime from recording)
**Build order:**
1. CDK: Add GSI2 to DynamoDB table
2. Backend: `create-reaction.ts` (live reactions with sessionRelativeTime)
3. Backend: `get-reactions.ts` (query reactions by time range)
4. Backend: Modify `send-message.ts` to add GSI2 attributes
5. Backend: `create-replay-reaction.ts` (reactions during replay)
6. Frontend: Live reaction UI (click heart/fire/etc.)
7. Frontend: Replay reaction overlay (synchronized to video timeline)

**Why this order:** GSI2 must exist before reactions can be stored with time-range query keys. Live reactions before replay reactions (simpler, validates pattern).

### Phase 3: RealTime Hangouts
**Dependencies:** Phase 1 (recording), Phase 2 (chat/reactions work for hangouts too)
**Build order:**
1. CDK: Add IVS RealTime storage configuration
2. Backend: Modify `replenish-pool.ts` to create stages with recording
3. Backend: Modify `create-session.ts` to support sessionType: HANGOUT
4. Backend: `create-participant-token.ts` (generate IVS RealTime tokens)
5. Backend: `stage-recording-ended.ts` (handle participant recordings)
6. Backend: Extend Session domain with participantRecordings
7. Frontend: Hangout creation UI
8. Frontend: Participant video grid (IVS Web Broadcast SDK integration)
9. Frontend: Multi-stream replay viewer (sync multiple participant streams)

**Why this order:** Hangouts depend on recording infrastructure (Phase 1) and reactions/chat (Phase 2) to provide full feature parity. Participant token generation must work before frontend can join stages.

## Scaling Considerations

| Scale | Adjustments |
|-------|-------------|
| **0-1k users** | Current architecture sufficient. Single-table DynamoDB, GSI queries handle load. |
| **1k-10k users** | Add DynamoDB Stream → Lambda → EventBridge for fan-out if multiple consumers need recording events. Monitor GSI2 hot partition (reactions concentrated on popular sessions). |
| **10k-100k users** | Consider S3 CloudFront distribution for recording playback. Add read replicas via DynamoDB Global Tables if multi-region. Cache recording metadata in ElastiCache/CloudFront. |
| **100k+ users** | Partition reactions by time bucket (e.g., GSI2PK = SESSION#{id}#{hour}) to avoid hot partitions. Consider Kinesis Data Streams for real-time reaction aggregation. Separate DynamoDB tables for hot data (active sessions) vs cold data (historical replays). |

**First bottleneck:** GSI2 hot partition if a single session has millions of reactions. Solution: Partition by time bucket or move real-time reactions to Kinesis.

**Second bottleneck:** S3 GetObject requests for popular recordings. Solution: CloudFront CDN distribution.

## Anti-Patterns

### Anti-Pattern 1: Polling Recording Metadata from S3

**What people do:** Poll S3 for `recording-ended.json` after stream ends to detect completion.

**Why it's wrong:** EventBridge Recording End events are authoritative and include metadata. Polling S3 adds latency, costs, and complexity.

**Do this instead:** Subscribe to EventBridge `IVS Recording State Change` events with `recording_status: ['Recording End']`. Fetch metadata file from S3 only once in the handler.

### Anti-Pattern 2: Scanning DynamoDB for All Reactions

**What people do:** Use Scan operation to retrieve all reactions for a session during replay.

**Why it's wrong:** Scan is expensive, slow, and doesn't scale. Replay UI needs reactions in time order anyway.

**Do this instead:** Query GSI2 with `GSI2PK = SESSION#{id}` and `GSI2SK BETWEEN startTime AND endTime` to fetch reactions for the current video playback window (e.g., next 30 seconds).

### Anti-Pattern 3: Storing Recording URLs in Session at Creation Time

**What people do:** Store `playbackUrl` when session is created, assuming it will be available after stream ends.

**Why it's wrong:** Recording URL doesn't exist until recording completes. IVS generates unique S3 paths per recording. Storing incorrect URLs breaks replay.

**Do this instead:** Store recording metadata (S3 key prefix, playback URL) only after receiving the Recording End event and fetching `recording-ended.json` from S3.

### Anti-Pattern 4: Using Channel ARN as Session Identifier

**What people do:** Use IVS channel ARN directly as session ID to avoid lookups.

**Why it's wrong:** Channels are pooled resources, reused across multiple sessions. Multiple sessions can use the same channel over time. ARN-as-ID breaks replay history.

**Do this instead:** Generate unique session IDs (UUID) and store `claimedResources.channel` separately. Use Scan/Query to find session by channel ARN when needed (e.g., in EventBridge handlers).

### Anti-Pattern 5: Single GSI Sort Key for All Event Types

**What people do:** Use `GSI2SK = timestamp` for reactions, chat messages, and other events.

**Why it's wrong:** Queries return mixed event types, requiring filtering in application code. Can't efficiently query just reactions or just messages.

**Do this instead:** Prefix sort keys by type: `GSI2SK = REACTION#{sessionRelativeTime}` vs `CHAT#{sessionRelativeTime}`. Query with `begins_with` to filter by event type at the database level.

## Sources

### High Confidence (Official AWS Documentation)
- [IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)
- [IVS Individual Participant Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-individual-participant-recording.html)
- [IVS RealTime Stage Creation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-create-stage.html)
- [Using EventBridge with IVS](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html)
- [Using Global Secondary Indexes in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)

### Medium Confidence (Community Patterns & Best Practices)
- [DynamoDB Global Secondary Index Guide](https://dynobase.dev/dynamodb-gsi/)
- [Build Scalable Event-Driven Architectures with DynamoDB and Lambda](https://aws.amazon.com/blogs/database/build-scalable-event-driven-architectures-with-amazon-dynamodb-and-aws-lambda/)
- [Live Streaming Chat Architecture](https://www.vdocipher.com/blog/live-streaming-chat/)
- [Design Facebook's Live Comments System](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-live-comments)
- [Master Date Range Queries in DynamoDB](https://openillumi.com/en/en-dynamodb-date-range-query-gsi-design/)

---
*Architecture integration research for: VideoNowAndLater v1.1 Milestone*
*Researched: 2026-03-02*
*Confidence: HIGH — Based on official AWS documentation and existing codebase patterns*
