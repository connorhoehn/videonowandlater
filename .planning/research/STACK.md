# Technology Stack

**Project:** VideoNowAndLater v1.1 (Recording, Reactions, RealTime Hangouts)
**Researched:** 2026-03-02
**Overall Confidence:** HIGH (verified via official AWS docs + npm registry)

---

## Context: Stack Additions Only

This research focuses on **stack additions/changes needed for v1.1 features**:
- S3 recording (IVS Channels + RealTime Stages)
- Replay playback (HLS video from S3)
- Reaction storage/synchronization (live + replay)
- IVS RealTime Stage management (multi-participant hangouts)

**Existing validated stack (NOT re-researched):**
- IVS broadcasting, IVS Chat, Cognito auth, DynamoDB single-table, CDK infrastructure, React frontend, developer CLI

---

## Stack Additions Required

### Frontend: New Package

| Package | Version | Purpose | Why Recommended | Confidence |
|---------|---------|---------|-----------------|------------|
| `react-player` | ^2.16.0 | HLS replay video playback | Maintained by Mux (2025), native HLS support via hls.js, lightweight React API, no DOM manipulation needed | HIGH |

**Installation:**
```bash
cd web
npm install react-player@^2.16.0
```

**Why react-player over alternatives:**
- **vs video.js (8.23.7):** Simpler React integration (component-based), lighter bundle, sufficient for replay use case. video.js is overkill (designed for live DVR, ads, DRM).
- **vs react-hls-player (3.0.7):** Less maintained, smaller community. react-player is backed by Mux and actively updated.
- **vs custom hls.js wrapper:** react-player already bundles hls.js and handles browser compatibility/fallbacks.

**Integration with existing stack:**
- Compatible with React 19.2.0 (already installed)
- Works alongside `amazon-ivs-player` (use IVS Player for live, react-player for replay)
- No peer dependency conflicts

---

### Backend: No New Packages Needed

**Existing packages cover all v1.1 requirements:**

| Package | Current Version | New Use in v1.1 | Status |
|---------|----------------|-----------------|--------|
| `@aws-sdk/client-ivs` | ^3.1000.0 | Create/manage RecordingConfiguration for Channels | ✓ Already installed |
| `@aws-sdk/client-ivs-realtime` | ^3.1000.0 | Create Stages with StorageConfiguration, generate participant tokens | ✓ Already installed |
| `@aws-sdk/client-s3` | Not currently installed | Generate presigned URLs for replay access, manage recording bucket | **ADD THIS** |
| `@aws-sdk/lib-dynamodb` | ^3.1000.0 | Store reactions with timestamps, store replay metadata | ✓ Already installed |

**Add to backend/package.json:**
```bash
cd backend
npm install @aws-sdk/client-s3@^3
```

**Why no other changes needed:**
- Participant token generation → Use existing `@aws-sdk/client-ivs-realtime` (`CreateParticipantToken` API)
- Reaction storage → Use existing DynamoDB client with new access patterns
- Recording metadata → Use existing DynamoDB client with EventBridge triggers

---

### Infrastructure (CDK): Use Existing Library

**All required constructs available in `aws-cdk-lib@^2.170.0` (already installed):**

| Construct | Import Path | Purpose | Type |
|-----------|-------------|---------|------|
| `CfnRecordingConfiguration` | `aws-cdk-lib/aws-ivs` | Configure S3 recording for IVS Channels | L1 (stable) |
| `CfnStorageConfiguration` | `aws-cdk-lib/aws-ivsrealtime` | Configure S3 storage for RealTime Stages | L1 (stable) |
| `Bucket` | `aws-cdk-lib/aws-s3` | Create S3 bucket for recordings | L2 (stable) |
| `Rule` | `aws-cdk-lib/aws-events` | EventBridge rules for recording state changes | L2 (stable) |
| `LambdaFunction` (target) | `aws-cdk-lib/aws-events-targets` | Trigger Lambda on recording completion | L2 (stable) |
| `CfnStage` | `aws-cdk-lib/aws-ivs` | Create RealTime Stage with recording | L1 (stable) |

**Do NOT install `@aws-cdk/aws-ivs-alpha`:**
- Reason: Alpha stability (not subject to semver), can introduce breaking changes
- Status: Not needed — L1 constructs are sufficient and stable
- When to use L2 constructs: Only if you need higher-level abstractions (not required for v1.1)

**No changes needed to infra/package.json.**

---

## What NOT to Add

| Package | Why Avoid | Use Instead |
|---------|-----------|-------------|
| `@aws-cdk/aws-ivs-alpha` | Alpha status, breaking changes risk | L1 constructs from `aws-cdk-lib` |
| `video.js` | Overkill for replay, requires DOM integration, heavier bundle | `react-player` |
| `hls.js` | Automatically bundled by react-player | Implicit via `react-player` |
| `react-hls-player` | Less maintained, smaller community | `react-player` |
| Separate WebRTC/RealTime SDK | No separate SDK exists for Web | `amazon-ivs-web-broadcast` (already installed) |
| WebSocket library for reactions | Adds complexity, not needed | DynamoDB + polling or EventBridge + Lambda |
| GraphQL subscriptions | Not in project spec, adds complexity | REST + DynamoDB Streams + Lambda |

---

## Integration Patterns

### 1. Recording Configuration (IVS Channels)

**CDK Setup:**
```typescript
import * as ivs from 'aws-cdk-lib/aws-ivs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';

// S3 bucket for recordings
const recordingBucket = new s3.Bucket(this, 'RecordingBucket', {
  bucketName: 'vnl-recordings',
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true, // Dev only
  versioned: false,
  publicReadAccess: false, // Private by default
});

// Recording configuration
const recordingConfig = new ivs.CfnRecordingConfiguration(this, 'RecordingConfig', {
  destinationConfiguration: {
    s3: {
      bucketName: recordingBucket.bucketName,
    },
  },
  recordingReconnectWindowSeconds: 60, // Merge fragmented streams
  thumbnailConfiguration: {
    recordingMode: 'INTERVAL',
    targetIntervalSeconds: 10, // Thumbnail every 10 seconds
    resolution: 'HD', // or 'SD', 'FULL_HD'
  },
});

// Attach to Channel (during pool creation)
const channel = new ivs.CfnChannel(this, 'Channel', {
  recordingConfigurationArn: recordingConfig.attrArn,
  // ... other props
});
```

**S3 Prefix Structure (IVS creates automatically):**
```
s3://vnl-recordings/ivs/v1/<account-id>/<channel-id>/<year>/<month>/<day>/<hour>/<minute>/<recording-id>/
  ├── events/
  │   ├── recording-started.json
  │   ├── recording-ended.json
  │   └── recording-failed.json (if applicable)
  └── media/
      ├── hls/
      │   ├── master.m3u8
      │   ├── playlist.m3u8
      │   └── *.ts (segments)
      └── thumbnails/ (if enabled)
          └── *.jpg
```

---

### 2. RealTime Stage Recording

**CDK Setup:**
```typescript
import * as ivsrealtime from 'aws-cdk-lib/aws-ivsrealtime';

// Storage configuration for RealTime Stages
const storageConfig = new ivsrealtime.CfnStorageConfiguration(this, 'StageStorage', {
  name: 'vnl-stage-storage',
  s3: {
    bucketName: recordingBucket.bucketName,
  },
});

// Stage with auto-participant recording
const stage = new ivs.CfnStage(this, 'Stage', {
  name: 'vnl-stage',
  autoParticipantRecordingConfiguration: {
    storageConfigurationArn: storageConfig.attrArn,
    mediaTypes: ['AUDIO_VIDEO'], // or ['AUDIO_ONLY']
  },
});
```

**Recording Options:**
- **Individual participant recording:** Each publisher's media saved as separate files
- **Composite recording:** All publishers combined into single view (requires additional config)

**For v1.1, use individual participant recording** (simpler, flexible for future editing).

---

### 3. EventBridge for Recording State Changes

**CDK Setup:**
```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';

// Lambda to process completed recordings
const processRecordingFn = new lambda.NodejsFunction(this, 'ProcessRecording', {
  entry: path.join(__dirname, '../../../backend/src/handlers/process-recording.ts'),
  handler: 'handler',
  environment: {
    TABLE_NAME: sessionTable.tableName,
    RECORDING_BUCKET: recordingBucket.bucketName,
  },
});

// Grant S3 read access
recordingBucket.grantRead(processRecordingFn);

// EventBridge rule for recording completion
new events.Rule(this, 'RecordingCompleteRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['RECORDING_STOPPED'], // Also: RECORDING_STARTED, RECORDING_FAILED
    },
  },
  targets: [new targets.LambdaFunction(processRecordingFn)],
});
```

**EventBridge Event Structure:**
```json
{
  "version": "0",
  "id": "event-id",
  "detail-type": "IVS Recording State Change",
  "source": "aws.ivs",
  "account": "123456789012",
  "time": "2026-03-02T12:00:00Z",
  "region": "us-west-2",
  "resources": ["arn:aws:ivs:us-west-2:123456789012:channel/abcd1234"],
  "detail": {
    "channel_arn": "arn:aws:ivs:us-west-2:123456789012:channel/abcd1234",
    "recording_status": "RECORDING_STOPPED",
    "recording_s3_bucket_name": "vnl-recordings",
    "recording_s3_key_prefix": "ivs/v1/123456789012/abcd1234/2026/03/02/12/00/recording-xyz/",
    "recording_duration_ms": 120000,
    "recording_status_reason": "" // Empty on success, error message on RECORDING_FAILED
  }
}
```

**Lambda handler stores replay metadata in DynamoDB:**
```typescript
// backend/src/handlers/process-recording.ts
export const handler = async (event: EventBridgeEvent<'IVS Recording State Change', IVSRecordingDetail>) => {
  const { detail } = event;

  // Store in DynamoDB
  await ddbClient.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: 'REPLAY',
      s3Bucket: detail.recording_s3_bucket_name,
      s3Prefix: detail.recording_s3_key_prefix,
      durationMs: detail.recording_duration_ms,
      status: 'AVAILABLE',
      createdAt: new Date().toISOString(),

      // For GSI1 (query all replays)
      GSI1PK: 'REPLAY',
      GSI1SK: detail.time, // Sort by recording time
    },
  }));
};
```

---

### 4. Replay Playback (React)

**Frontend Component:**
```tsx
import ReactPlayer from 'react-player';

interface ReplayViewerProps {
  s3Prefix: string; // e.g., "ivs/v1/.../recording-xyz/"
}

function ReplayViewer({ s3Prefix }: ReplayViewerProps) {
  // Construct HLS manifest URL (via CloudFront or presigned URL)
  const manifestUrl = `https://cdn.example.com/${s3Prefix}media/hls/master.m3u8`;

  return (
    <ReactPlayer
      url={manifestUrl}
      controls
      playing={false} // User-initiated playback
      width="100%"
      height="100%"
      config={{
        file: {
          forceHLS: true, // Use hls.js for HLS streams
          hlsOptions: {
            // Optional: custom hls.js config
            maxBufferLength: 30,
          },
        },
      }}
      onProgress={(state) => {
        // state.playedSeconds — use for syncing chat/reactions
        console.log('Current time:', state.playedSeconds);
      }}
    />
  );
}
```

**CloudFront Setup (CDK):**
```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';

// CloudFront distribution for serving recordings
const distribution = new cloudfront.Distribution(this, 'RecordingCDN', {
  defaultBehavior: {
    origin: new origins.S3Origin(recordingBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // Cache HLS segments
  },
});

new CfnOutput(this, 'RecordingCDNUrl', {
  value: distribution.distributionDomainName,
});
```

**Alternative: Presigned URLs (no CloudFront):**
```typescript
// backend/src/handlers/get-replay.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({});

export const handler = async (event: APIGatewayProxyEvent) => {
  const { sessionId } = event.pathParameters;

  // Get replay metadata from DynamoDB
  const replay = await getReplayMetadata(sessionId);

  // Generate presigned URL for master.m3u8
  const command = new GetObjectCommand({
    Bucket: replay.s3Bucket,
    Key: `${replay.s3Prefix}media/hls/master.m3u8`,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

  return {
    statusCode: 200,
    body: JSON.stringify({ manifestUrl: url }),
  };
};
```

---

### 5. Reaction Storage (DynamoDB)

**Access Pattern (use existing table):**

```typescript
// Reaction item
{
  PK: 'SESSION#<sessionId>',
  SK: 'REACTION#<timestamp>#<userId>#<reactionId>',
  type: 'heart', // heart, fire, clap, laugh, etc.
  timestamp: 12500, // Milliseconds into video (for replay sync)
  userId: 'user123',
  username: 'alice',
  createdAt: '2026-03-02T12:00:25.500Z',

  // GSI1 for querying reactions by session
  GSI1PK: 'SESSION#<sessionId>#REACTIONS',
  GSI1SK: 'TIMESTAMP#<timestamp>',
}
```

**Query Patterns:**
1. **Get all reactions for a session:** Query `PK = SESSION#<sessionId>` and `SK begins_with REACTION#`
2. **Get reactions after a timestamp:** Query `GSI1PK = SESSION#<sessionId>#REACTIONS` and `GSI1SK > TIMESTAMP#<timestamp>`

**API Endpoint (POST /sessions/{sessionId}/reactions):**
```typescript
// backend/src/handlers/create-reaction.ts
export const handler = async (event: APIGatewayProxyEvent) => {
  const { sessionId } = event.pathParameters;
  const { type, timestamp } = JSON.parse(event.body);
  const userId = event.requestContext.authorizer.claims.sub;

  const reactionId = uuid();

  await ddbClient.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `SESSION#${sessionId}`,
      SK: `REACTION#${timestamp.toString().padStart(10, '0')}#${userId}#${reactionId}`,
      type,
      timestamp,
      userId,
      createdAt: new Date().toISOString(),
      GSI1PK: `SESSION#${sessionId}#REACTIONS`,
      GSI1SK: `TIMESTAMP#${timestamp.toString().padStart(10, '0')}`,
    },
  }));

  return { statusCode: 201, body: JSON.stringify({ reactionId }) };
};
```

**Frontend Sync (Replay):**
```tsx
function ReplayWithReactions({ sessionId }: { sessionId: string }) {
  const [currentTime, setCurrentTime] = useState(0);
  const [reactions, setReactions] = useState([]);

  // Fetch all reactions for session
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/reactions`)
      .then(res => res.json())
      .then(data => setReactions(data.reactions));
  }, [sessionId]);

  // Filter reactions to show based on current playback time
  const visibleReactions = reactions.filter(r =>
    r.timestamp <= currentTime * 1000 && // Convert seconds to ms
    r.timestamp > (currentTime - 3) * 1000 // Show for 3 seconds
  );

  return (
    <div>
      <ReactPlayer
        url={manifestUrl}
        onProgress={({ playedSeconds }) => setCurrentTime(playedSeconds)}
      />
      <ReactionOverlay reactions={visibleReactions} />
    </div>
  );
}
```

---

### 6. Participant Token Generation (RealTime Stages)

**Lambda Handler:**
```typescript
// backend/src/handlers/create-stage-token.ts
import { IVSRealTimeClient, CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';

const ivsRealTimeClient = new IVSRealTimeClient({});

export const handler = async (event: APIGatewayProxyEvent) => {
  const { sessionId } = event.pathParameters;
  const userId = event.requestContext.authorizer.claims.sub;

  // Get Stage ARN from DynamoDB (session record)
  const session = await getSession(sessionId);

  // Generate participant token
  const command = new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId, // Unique identifier for participant
    capabilities: ['PUBLISH', 'SUBSCRIBE'], // Or just ['SUBSCRIBE'] for viewers
    duration: 720, // Token duration in minutes (default 720 = 12 hours)
  });

  const response = await ivsRealTimeClient.send(command);

  return {
    statusCode: 200,
    body: JSON.stringify({
      token: response.participantToken.token,
      expiresAt: response.participantToken.expirationTime,
    }),
  };
};
```

**Frontend Usage (already have amazon-ivs-web-broadcast):**
```tsx
import { Stage, StrategyConfiguration, StageEvents } from 'amazon-ivs-web-broadcast';

async function joinStage(token: string) {
  const stage = new Stage(token, {
    strategy: StrategyConfiguration.default(),
  });

  // Get local media
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

  stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state) => {
    console.log('Stage connection state:', state);
  });

  stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant) => {
    console.log('Participant joined:', participant);
  });

  await stage.join();
}
```

---

## Version Compatibility

| Package | Current Version | New/Changed | Compatible With | Notes |
|---------|----------------|-------------|-----------------|-------|
| `react-player` | — → ^2.16.0 | NEW | React 19.2.0 | ✓ No conflicts |
| `@aws-sdk/client-s3` | — → ^3.1000.0 | NEW | Node.js 20.x | ✓ Matches other AWS SDK v3 packages |
| `amazon-ivs-web-broadcast` | ^1.32.0 | NO CHANGE | — | ✓ Already supports RealTime Stages |
| `aws-cdk-lib` | ^2.170.0 | NO CHANGE | — | ✓ Includes all needed IVS constructs |

**No version conflicts identified.**

---

## Summary for Roadmap

**Required additions:**
1. **Frontend:** `react-player@^2.16.0` for HLS replay playback
2. **Backend:** `@aws-sdk/client-s3@^3` for presigned URLs (if not using CloudFront)
3. **Infrastructure:** No new packages — use L1 constructs from existing `aws-cdk-lib`

**Key integration points:**
1. **Recording → S3:** `CfnRecordingConfiguration` (Channels), `CfnStorageConfiguration` (Stages)
2. **Recording metadata:** EventBridge `IVS Recording State Change` → Lambda → DynamoDB
3. **Replay playback:** `react-player` consuming HLS manifests from S3/CloudFront
4. **Reactions:** Store in existing DynamoDB table with timestamp-based SK for replay sync
5. **Participant tokens:** Generate via `CreateParticipantTokenCommand` in Lambda
6. **Stage joining:** Use existing `amazon-ivs-web-broadcast` SDK (no new package)

**No breaking changes. All additions integrate cleanly with v1.0 validated stack.**

---

## Sources

### Official AWS Documentation (HIGH confidence)

- [IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html) — Recording configuration, S3 structure
- [IVS RealTime Stage Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-create-stage.html) — Stage recording setup, storage config
- [IVS EventBridge Integration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html) — Recording state change events
- [AWS CDK CfnRecordingConfiguration](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_ivs/CfnRecordingConfiguration.html) — CDK construct API
- [IVS Participant Tokens](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html) — Token generation API
- [DynamoDB Streams Lambda Triggers](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.Lambda.html) — Reaction sync pattern
- [IVS Web Broadcast SDK Reference](https://aws.github.io/amazon-ivs-web-broadcast/docs/sdk-reference) — Version 1.32.0 API docs

### npm Registry (MEDIUM confidence, verified 2026-03-02)

- [react-player](https://www.npmjs.com/package/react-player) — Latest: 3.4.0 (recommend 2.16.0 for stability)
- [amazon-ivs-web-broadcast](https://www.npmjs.com/package/amazon-ivs-web-broadcast) — Latest: 1.27.0-1.32.0
- [@aws-cdk/aws-ivs-alpha](https://www.npmjs.com/package/@aws-cdk/aws-ivs-alpha) — Latest: 2.214.0-alpha.0 (NOT recommended)
- [@aws-sdk/client-s3](https://www.npmjs.com/package/@aws-sdk/client-s3) — Latest: 3.1000.0+

### Community Research (MEDIUM confidence)

- [Understanding AWS IVS Real-Time Stage](https://medium.com/@singhkshitij221/understanding-aws-ivs-real-time-stage-how-it-actually-works-e56a7a0c5464) — RealTime architecture overview
- [The best React video player libraries of 2026](https://blog.croct.com/post/best-react-video-libraries) — react-player vs alternatives
- [DynamoDB Streams Trigger Lambda](https://oneuptime.com/blog/post/2026-02-12-trigger-lambda-dynamodb-streams/view) — Real-time sync patterns

---

*Stack research complete for v1.1. All recommendations verified against official AWS documentation and npm registry (March 2, 2026).*
