# Stack Research

**Domain:** AWS IVS video streaming platform — v1.5 additions
**Researched:** 2026-03-10
**Confidence:** HIGH (all critical API parameters verified against official AWS docs and official GitHub; HLS.js verified against official API reference; existing packages confirmed against local package.json)

---

## Scope

This is an additive research document for the v1.5 milestone. The existing stack (CDK, Lambda Node 20, DynamoDB, S3, IVS, IVS RealTime, IVS Chat, Transcribe, MediaConvert, EventBridge, Bedrock, SNS, React 19 + Vite + Tailwind) is unchanged. This file covers only the **new capabilities** required by five v1.5 features.

---

## Feature 1: Speaker-Attributed Transcripts (Transcribe Diarization)

### API Parameters

Diarization is enabled by adding a `Settings` block to `StartTranscriptionJobCommand`. Both fields are required together — specifying one without the other causes a validation error.

| Parameter | Type | Required | Value for VNL |
|-----------|------|----------|---------------|
| `Settings.ShowSpeakerLabels` | Boolean | Yes (if using diarization) | `true` |
| `Settings.MaxSpeakerLabels` | Integer (2–30) | Yes (when ShowSpeakerLabels=true) | `2` for broadcast or 1-on-1 hangout; `5` for group hangouts |

The existing `start-transcribe.ts` handler uses `StartTranscriptionJobCommand` from `@aws-sdk/client-transcribe` (already in backend/package.json at ^3.1003.0). No new package needed.

**Updated `StartTranscriptionJobCommand` call:**
```typescript
const transcribeParams = {
  TranscriptionJobName: jobName,
  Media: { MediaFileUri: audioFileUri },
  OutputBucketName: process.env.TRANSCRIPTION_BUCKET!,
  OutputKey: `${sessionId}/transcript.json`,
  LanguageCode: 'en-US' as const,
  Settings: {
    ShowSpeakerLabels: true,
    MaxSpeakerLabels: 2,   // adjust based on session type
  },
};
```

### Transcript JSON Output Structure

When diarization is enabled, each word item in `results.items` gains a `speaker_label` field directly on it. There is no need to cross-reference the separate `speaker_labels.segments` section for per-word attribution.

**Full item shape (with diarization):**
```typescript
interface TranscribeItem {
  id: number;
  start_time: string;        // "4.87" — string seconds, not present on punctuation
  end_time: string;          // "5.02" — not present on punctuation
  speaker_label: string;     // "spk_0" | "spk_1" — directly on each word
  alternatives: Array<{
    confidence: string;      // "0.9837"
    content: string;         // "Hello" or ","
  }>;
  type: 'pronunciation' | 'punctuation';
}
```

**Top-level speaker_labels section:**
```typescript
interface SpeakerLabels {
  speakers: number;           // actual speaker count detected
  channel_label: string;      // "ch_0"
  segments: Array<{
    start_time: string;
    end_time: string;
    speaker_label: string;    // "spk_0" | "spk_1"
    items: Array<{
      start_time: string;
      end_time: string;
      speaker_label: string;
    }>;
  }>;
}
```

### Algorithm to Map spk_0/spk_1 to Session Usernames

Transcribe assigns `spk_0` to the first detected speaker chronologically. For VNL broadcast sessions, this is the broadcaster. For 2-person hangouts, it is whichever participant speaks first.

```typescript
// Build speaker map at transcript-store time using session participant order
const speakerMap: Record<string, string> = {
  spk_0: session.userId,         // session owner (broadcaster or first hangout participant)
  spk_1: hangoutParticipants[1], // second participant if known
};

// Reconstruct attributed transcript from results.items
const utterances: Array<{ speaker: string; text: string; startTime: number }> = [];
let current: { speakerLabel: string; words: string[]; startTime: string } | null = null;

for (const item of transcriptJson.results.items) {
  if (item.type === 'punctuation') {
    if (current) current.words.push(item.alternatives[0].content);
    continue;
  }
  const label = item.speaker_label;
  if (!current || current.speakerLabel !== label) {
    if (current) utterances.push({
      speaker: speakerMap[current.speakerLabel] ?? current.speakerLabel,
      text: current.words.join(' '),
      startTime: parseFloat(current.startTime),
    });
    current = { speakerLabel: label, words: [item.alternatives[0].content], startTime: item.start_time };
  } else {
    current.words.push(item.alternatives[0].content);
  }
}
```

Store `speakerMap` as a DynamoDB attribute on the session (JSON-stringified map) so the `get-transcript` handler can include resolved names in its response.

### IAM Permission

The existing `transcribe:StartTranscriptionJob` permission already granted to `startTranscribeFn` in session-stack.ts covers diarization — it is a parameter of the same API call, not a separate permission. No CDK changes needed.

### Accuracy Notes

Amazon Transcribe documentation states diarization works best with 2–5 speakers. VNL's use case (1 broadcaster or 2–5 hangout participants) is ideal. Use `MaxSpeakerLabels: 2` for broadcast sessions and `5` as a safe ceiling for group hangouts. Setting `MaxSpeakerLabels` lower than the actual speaker count causes multiple speakers to be merged under one label; setting it higher is safe (Transcribe stops at the actual count).

**Confidence:** HIGH — verified against official AWS Transcribe diarization docs and batch output example page.

---

## Feature 2: Dedicated Upload Video Player (HLS.js)

### Package

`hls.js` ships its own TypeScript declarations; no separate `@types/hls.js` is needed.

| Package | Version | Install location |
|---------|---------|-----------------|
| `hls.js` | `^1.6.0` (latest stable: 1.6.15) | `web/` (frontend only) |

The project uses `amazon-ivs-player` for live stream playback. HLS.js is the right choice for the upload video player because: (a) it works with plain HLS manifests from S3/CloudFront without IVS-specific extensions, (b) it exposes the quality level API needed for manual resolution switching, and (c) it runs in all modern browsers. IVS Player does not expose a quality level switching API.

```bash
# In web/
npm install hls.js@^1.6.0
```

### Quality Level API

**Initialization:**
```typescript
import Hls from 'hls.js';

if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(hlsUrl);
  hls.attachMedia(videoElement);

  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
    // data.levels is Level[] — all quality variants from the HLS manifest
    // Build resolution selector options:
    const options = hls.levels.map((level, index) => ({
      index,
      label: `${level.height}p`,
      bitrate: level.bitrate,
    }));
  });
}
```

**Level object shape:**
```typescript
interface Level {
  bitrate: number;   // bits/sec, e.g. 2_500_000
  width: number;     // e.g. 1280
  height: number;    // e.g. 720
  name?: string;     // optional label from manifest
  attrs: { RESOLUTION: string }; // "1280x720"
}
```

**Manual quality switching:**
```typescript
hls.currentLevel = 2;    // Switch immediately to index 2 (flushes buffer, re-fetches from position)
hls.currentLevel = -1;   // Return to ABR auto-switching
```

`currentLevel` setter flushes the buffer and fetches from the current playback position at the new quality. This is the correct API for a user-facing resolution selector. Do not use `hls.nextLevel` for this purpose — it only affects the next fragment without flushing, giving inconsistent UX.

**Detecting active quality:**
```typescript
hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
  const active = hls.levels[data.level]; // { width, height, bitrate }
  setCurrentQuality(`${active.height}p`);
});
```

**Optional: cap ABR without disabling it:**
```typescript
hls.autoLevelCapping = 2; // ABR stays at or below index 2
hls.autoLevelCapping = -1; // No cap (default)
```

**Cleanup (React useEffect):**
```typescript
return () => hls.destroy();
```

### Safari Fallback

Safari has native HLS support; `Hls.isSupported()` returns `false` on Safari.

```typescript
if (Hls.isSupported()) {
  // HLS.js path — quality selector available
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = hlsUrl; // Safari native — hide quality selector UI
}
```

### Async Video Comments

Timestamped comments on `/video/:sessionId` are stored in DynamoDB (see Feature 4 schema section for `COMMENT#` SK prefix pattern). No new npm packages needed; use existing API Gateway + Lambda patterns.

**Confidence:** HIGH — verified against official HLS.js API docs at github.com/video-dev/hls.js/blob/master/docs/API.md.

---

## Feature 3: EventBridge Pipeline Audit (Structured Logging)

### Approach: Lambda Powertools Logger (already installed)

`@aws-lambda-powertools/logger` at `^2.31.0` is **already in `backend/package.json`**. No new package installation needed.

### Usage Pattern for Pipeline Handlers

Initialize the logger at **module scope** (outside the handler function) so it persists across warm invocations and captures cold start context automatically:

```typescript
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({
  serviceName: 'vnl-pipeline',
  persistentKeys: {
    pipelineStage: 'recording-ended', // unique per handler file
  },
});

export const handler = async (event: EventBridgeEvent<...>): Promise<void> => {
  // Append session-scoped keys for this invocation
  logger.appendPersistentKeys({ sessionId: event.detail.sessionId });

  logger.info('Pipeline stage entered', {
    source: event.source,
    detailType: event['detail-type'],
    resourceArn: event.resources?.[0],
  });

  // ... handler logic ...

  logger.info('Pipeline stage completed', { jobId, durationMs });
};
```

**CloudWatch JSON output per log line:**
```json
{
  "level": "INFO",
  "message": "Pipeline stage completed",
  "service": "vnl-pipeline",
  "pipelineStage": "recording-ended",
  "sessionId": "abc123",
  "jobId": "1234567890",
  "timestamp": "2026-03-10T12:00:00.000Z",
  "cold_start": false,
  "xray_trace_id": "1-xxx-yyy"
}
```

### CloudWatch Logs Insights Query Pattern

```
fields @timestamp, sessionId, pipelineStage, level, message
| filter sessionId = "abc123"
| sort @timestamp asc
```

```
fields @timestamp, pipelineStage, message
| filter level = "ERROR"
| stats count() by pipelineStage
```

### CDK Changes for Log Retention

No code changes — Powertools Logger writes to Lambda's existing CloudWatch log group via stdout. To retain pipeline logs longer, add explicit `logGroup` to each pipeline Lambda in session-stack.ts (same pattern as the existing `ivsEventAuditFn`):

```typescript
import * as logs from 'aws-cdk-lib/aws-logs';

logGroup: new logs.LogGroup(this, 'RecordingEndedLogGroup', {
  retention: logs.RetentionDays.ONE_MONTH,
  removalPolicy: RemovalPolicy.DESTROY,
}),
```

Apply this to: `RecordingEnded`, `TranscodeCompleted`, `TranscribeCompleted`, `StoreSummary`, `StartTranscribe`.

### No New Permissions

Lambda Powertools Logger uses stdout only. No IAM changes. No CloudWatch PutMetricData calls. No Embedded Metric Format (EMF) — plain structured JSON is sufficient for v1.5 audit use case and is directly queryable via Logs Insights.

**Confidence:** HIGH — `@aws-lambda-powertools/logger` already installed at 2.31.0 in local package.json; `appendPersistentKeys` and `persistentKeys` constructor API verified against official Powertools TypeScript docs.

---

## Feature 4: Chat Moderation (Bounce/Kick + Report)

### IVS Chat Server-Side Kick (DisconnectUser)

The broadcaster bounce/kick action calls the IVS Chat control-plane API (not the WebSocket messaging API). This is a new Lambda handler.

**SDK:** `@aws-sdk/client-ivschat` — **already in `backend/package.json`** at `^3.1000.0`. No new package needed.

**DisconnectUserCommand parameters:**
```typescript
import { IvschatClient, DisconnectUserCommand } from '@aws-sdk/client-ivschat';

const client = new IvschatClient({});

await client.send(new DisconnectUserCommand({
  roomIdentifier: session.claimedResources.chatRoom, // must be ARN, not name
  userId: targetUserId,           // cognito:username of the user to kick; max 128 chars
  reason: 'Removed by broadcaster', // optional; max 256 chars
}));
```

`roomIdentifier` must be the room ARN (`arn:aws:ivschat:region:account:room/id`). The `claimedResources.chatRoom` field on the Session already stores this ARN. No lookup needed.

**API behavior:** Disconnects **all** connections from the specified userId in the room. Replicates the `DisconnectUser` WebSocket operation — IVS Chat clients receive a disconnect event and are removed from the room.

**IAM permission required:**
```typescript
bounceUserFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ivschat:DisconnectUser'],
  resources: ['arn:aws:ivschat:*:*:room/*'],
}));
```

**New API endpoint:** `POST /sessions/{sessionId}/bounce` — body `{ targetUserId: string, reason?: string }`. Verify the requesting user is the session owner (`session.userId === requestingUserId`) before calling DisconnectUser. Return 403 otherwise.

### IVS Chat Message Deletion (DeleteMessage)

For per-message report action (or broadcaster choosing to delete a message):

```typescript
import { DeleteMessageCommand } from '@aws-sdk/client-ivschat';

await client.send(new DeleteMessageCommand({
  roomIdentifier: session.claimedResources.chatRoom, // ARN
  id: messageId,      // IVS Chat message ID from the chat event (the `Id` field)
  reason: 'Reported by user', // optional
}));
```

**IAM permission:**
```typescript
actions: ['ivschat:DeleteMessage'],
resources: ['arn:aws:ivschat:*:*:room/*'],
```

`DeleteMessage` sends an `aws:DELETE_MESSAGE` event to all connected clients, causing them to unrender the message from their local chat history. No special client-side handling is needed beyond responding to that standard IVS Chat event.

### DynamoDB Moderation Log Schema

Use the existing single-table with a new entity type `MODERATION_EVENT`. No new table or GSI needed for v1.5 — all queries are per-session.

**PK/SK pattern:**
```
PK:  SESSION#{sessionId}
SK:  MOD#{ISO-timestamp}#{eventId}
```

The `MOD#` SK prefix keeps moderation events collocated with their session and separable from `METADATA`, `MSG#`, `REACTION#`, `EVENT#`, `COMMENT#` items via `begins_with` in Query.

**Full item shape:**
```typescript
interface ModerationEvent {
  PK: string;                    // SESSION#{sessionId}
  SK: string;                    // MOD#{timestamp}#{eventId}
  entityType: 'MODERATION_EVENT';
  eventId: string;               // uuid v4
  sessionId: string;
  moderationType: 'bounce' | 'delete_message' | 'report';
  actorUserId: string;           // cognito:username of moderator (broadcaster or reporter)
  targetUserId: string;          // cognito:username of the affected user
  targetMessageId?: string;      // for delete_message and report events
  reason?: string;               // optional text, max 256 chars
  createdAt: string;             // ISO 8601
}
```

**Write:**
```typescript
await docClient.send(new PutCommand({
  TableName: tableName,
  Item: moderationEvent,
  // No ConditionExpression needed — SK includes uuid, no collision risk
}));
```

Use `removeUndefinedValues: true` in marshall options (existing project pattern).

**Read moderation log for a session:**
```typescript
await docClient.send(new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
  ExpressionAttributeValues: {
    ':pk': `SESSION#${sessionId}`,
    ':prefix': 'MOD#',
  },
}));
```

No GSI needed for v1.5. Cross-user queries (e.g., "all bounces by actor X") are out of scope; if needed in a future milestone, add a GSI on `actorUserId` or `targetUserId` then.

### Video Comment Schema (Upload Video Player)

Timestamped async comments for `/video/:sessionId` follow the same single-table pattern:

```
PK:  SESSION#{sessionId}
SK:  COMMENT#{zeroPaddedVideoMs}#{commentId}
```

Zero-pad `videoTimestampMs` to 15 digits for correct lexicographic sort: `String(videoMs).padStart(15, '0')`.

```typescript
interface VideoComment {
  PK: string;              // SESSION#{sessionId}
  SK: string;              // COMMENT#{videoMs}#{commentId}
  entityType: 'VIDEO_COMMENT';
  commentId: string;       // uuid v4
  sessionId: string;
  userId: string;          // cognito:username
  content: string;
  videoTimestampMs: number; // milliseconds into the video
  createdAt: string;       // ISO 8601 wall-clock time
}
```

**Confidence:** HIGH — IAM action names `ivschat:DisconnectUser` and `ivschat:DeleteMessage` verified against official AWS IVS Chat API reference and JavaScript SDK v2 docs. DynamoDB pattern follows existing project conventions.

---

## Feature 5: Cron-Based Stuck Session Recovery

### Approach

Reuse the existing `events.Schedule.rate()` pattern already used for `ReplenishPoolSchedule` in session-stack.ts. Add a new rate-based rule targeting a new `RecoveryCheckFn` Lambda.

**CDK construct:**
```typescript
const recoveryFn = new nodejs.NodejsFunction(this, 'RecoveryCheck', {
  entry: path.join(__dirname, '../../../backend/src/handlers/recovery-check.ts'),
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: Duration.minutes(5),
  environment: {
    TABLE_NAME: this.table.tableName,
    STUCK_THRESHOLD_MINUTES: '30',
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});

this.table.grantReadWriteData(recoveryFn);

recoveryFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['events:PutEvents'],
  resources: ['arn:aws:events:*:*:event-bus/default'],
}));

new events.Rule(this, 'RecoveryCheckSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(30)),
  targets: [new targets.LambdaFunction(recoveryFn)],
  description: 'Recover sessions stuck in pipeline for >30 min',
});
```

**Handler logic:** Scan DynamoDB for sessions where `transcriptStatus = 'processing'` and `endedAt` is more than 30 minutes ago (or use `mediaConvertJobId` set time if stored). For each stuck session, publish an `Upload Recording Available` event to the default EventBridge bus to re-trigger `startTranscribeFn`. The `mediaConvertJobId` and `transcriptStatus = 'processing'` fields (already stored in `recording-ended.ts`) serve as the staleness indicators.

**IAM permissions needed:**
- DynamoDB read/write via `grantReadWriteData` (existing pattern)
- `events:PutEvents` on `event-bus/default` (new, same as `onMediaConvertCompleteFunction` already has)

No new CDK constructs or packages beyond the above.

**Confidence:** MEDIUM — recovery logic design is project-specific; EventBridge rate schedule pattern is HIGH confidence (direct reuse of existing session-stack.ts pattern).

---

## Installation Summary

### Backend (`backend/`)

No new npm packages. All required SDK clients are already installed:

| Package | Already At | Used By |
|---------|-----------|---------|
| `@aws-sdk/client-transcribe` | ^3.1003.0 | Add `Settings.ShowSpeakerLabels` to existing call |
| `@aws-sdk/client-ivschat` | ^3.1000.0 | Add `DisconnectUserCommand`, `DeleteMessageCommand` |
| `@aws-lambda-powertools/logger` | ^2.31.0 | Add to all pipeline handler files |

### Frontend (`web/`)

One new package:
```bash
# In web/
npm install hls.js@^1.6.0
```

`hls.js` includes TypeScript declarations. No `@types/hls.js` needed.

---

## New IAM Permissions Required (CDK)

| Handler | New Permission | Resource Pattern | Why |
|---------|---------------|-----------------|-----|
| `BounceUserFn` (new) | `ivschat:DisconnectUser` | `arn:aws:ivschat:*:*:room/*` | Server-side user kick |
| `BounceUserFn` or `ReportMessageFn` (new) | `ivschat:DeleteMessage` | `arn:aws:ivschat:*:*:room/*` | Moderated message removal |
| `RecoveryCheckFn` (new) | `events:PutEvents` | `arn:aws:events:*:*:event-bus/default` | Re-fire stuck session events |
| All pipeline Lambdas (existing) | (none new) | — | Powertools Logger uses stdout only |

---

## DynamoDB Access Patterns

| Access Pattern | PK | SK Condition | Operation | New GSI? |
|----------------|----|-----------  -|-----------|----------|
| Write moderation event | `SESSION#{id}` | `MOD#{ts}#{uuid}` | PutItem | No |
| Read moderation log | `SESSION#{id}` | `begins_with('MOD#')` | Query | No |
| Write video comment | `SESSION#{id}` | `COMMENT#{ms}#{uuid}` | PutItem | No |
| Read video comments | `SESSION#{id}` | `begins_with('COMMENT#')` | Query | No |
| Scan stuck sessions | — | filter `transcriptStatus = processing` | Scan + filter | No |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `hls.js` for upload player | `amazon-ivs-player` | IVS Player is for IVS channel streams; upload videos are plain S3/CloudFront HLS. IVS Player does not expose quality level switching API. |
| Lambda Powertools Logger (already installed) | Custom JSON `console.log` wrapper | Powertools is already in package.json at 2.31.0, provides cold_start, xray_trace_id, and appendPersistentKeys automatically. Zero marginal cost. |
| Lambda Powertools Logger | CloudWatch EMF + `@aws-lambda-powertools/metrics` | EMF adds metric extraction cost and CDK metric filter complexity; plain structured JSON queryable via Logs Insights is sufficient for audit logging. |
| `ivschat:DisconnectUser` server-side API | IVS Chat WebSocket `DisconnectUser` action | WebSocket action requires an active chat connection from the broadcaster; the server-side API is callable from Lambda without any active client connection. |
| DynamoDB single-table for moderation log | Separate DynamoDB table | Existing single-table pattern handles this; no new provisioned capacity, GSI, or CDK table construct needed. |
| Rate-based schedule for recovery | EventBridge Scheduler one-time schedules | One-time schedules require creating and deleting a Scheduler entry per session, adding state that must be cleaned up. Rate + Lambda scan is operationally simpler. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `hls.js` `nextLevel` setter for resolution selector | Only affects the next fragment load without flushing the buffer — gives inconsistent UX when the user selects a quality level | `hls.currentLevel` setter, which flushes the buffer and switches immediately |
| `MaxSpeakerLabels: 1` | Invalid — minimum is 2; API returns validation error | Use `MaxSpeakerLabels: 2` even for single-speaker broadcast recordings |
| Reading `speaker_labels.segments` for per-word speaker lookup | Unnecessary complexity — `results.items[N].speaker_label` contains the speaker directly on each word item | Read `speaker_label` from each element of `results.items` |
| CloudWatch PutMetricData from pipeline Lambdas | 200–500ms synchronous API call per invocation adds latency to the critical recording pipeline path | Use Powertools Logger JSON to stdout; query with Logs Insights |

---

## Sources

- [Amazon Transcribe diarization docs](https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html) — ShowSpeakerLabels/MaxSpeakerLabels parameters, speaker_labels JSON structure — HIGH confidence
- [Amazon Transcribe batch output example](https://docs.aws.amazon.com/transcribe/latest/dg/diarization-output-batch.html) — items array with speaker_label field directly on each word — HIGH confidence
- [Amazon Transcribe Settings API reference](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_Settings.html) — exact field names, types, valid ranges (min 2, max 30) — HIGH confidence
- [HLS.js API.md on GitHub](https://github.com/video-dev/hls.js/blob/master/docs/API.md) — levels array shape, currentLevel setter behavior, MANIFEST_PARSED/LEVEL_SWITCHED events — HIGH confidence
- [AWS IVS Chat DisconnectUser API reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_DisconnectUser.html) — request parameters, IAM action, resource ARN pattern — HIGH confidence
- [AWS IVS Chat JavaScript SDK v2](https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Ivschat.html) — DisconnectUser and DeleteMessage method signatures and parameters — HIGH confidence
- [Powertools for AWS Lambda TypeScript Logger docs](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/) — appendPersistentKeys, persistentKeys constructor option, plain handler usage without decorators — HIGH confidence
- `backend/package.json` (local read) — confirmed @aws-lambda-powertools/logger@^2.31.0 and @aws-sdk/client-ivschat@^3.1000.0 already installed — HIGH confidence
- `infra/lib/stacks/session-stack.ts` (local read) — confirmed existing events.Schedule.rate() pattern and events:PutEvents grant pattern — HIGH confidence

---

*Stack research for: AWS IVS video platform v1.5 — pipeline audit, speaker diarization, moderation, upload video player*
*Researched: 2026-03-10*
