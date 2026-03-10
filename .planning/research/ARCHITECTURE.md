# Architecture Research

**Domain:** AWS IVS streaming platform — v1.5 Pipeline Reliability, Moderation & Upload Experience
**Researched:** 2026-03-10
**Confidence:** HIGH (based on direct codebase analysis + AWS official docs)

---

## System Overview

```
+-----------------------------------------------------------------------------------------------+
|                               React Frontend (web/)                                            |
|   /broadcast/:id  /viewer/:id  /replay/:id  /hangout/:id  /upload/:id  /video/:sessionId      |
+-----------------------------------------------------------------------------------------------+
                                          |
                              API Gateway (Cognito REST)
                                          |
+-----------------------------------------------------------------------------------------------+
|                                Lambda Handlers                                                 |
|  Existing: create-session  get-session  recording-ended  transcribe-completed  store-summary   |
|  NEW: bounce-user  report-message  scan-stuck-sessions  list-comments  create-comment          |
+-----------------------------------------------------------------------------------------------+
                                          |
+-----------------------------------------------------------------------------------------------+
|                      EventBridge (default bus + Scheduler)                                    |
|  aws.ivs events -> pipeline + audit handlers                                                   |
|  custom.vnl -> pipeline progression (Recording Available, Transcript Stored)                   |
|  NEW: EventBridge Scheduler rate(30 min) -> scan-stuck-sessions                               |
+-----------------------------------------------------------------------------------------------+
                                          |
+-----------------------------------------------------------------------------------------------+
|                     DynamoDB (vnl-sessions, single-table)                                     |
|  SESSION#{id} / METADATA    MODLOG#{sessionId} / BOUNCE#{ts}#{userId}                        |
|  REACTION#{id}#{emoji}...   MODLOG#{sessionId} / REPORT#{msgId}#{ts}                         |
|  PARTICIPANT#{id}...        COMMENT#{sessionId} / {paddedTs}#{commentId}                      |
+-----------------------------------------------------------------------------------------------+
                |
+---------------+-------------------+--------------------+-------------------+
|      S3/CF    |    Transcribe     |   MediaConvert     |    Bedrock        |
|               | (+ diarization)   |                    |  (Nova Pro)       |
+---------------+-------------------+--------------------+-------------------+
```

---

## Existing Architecture Baseline (inherited from v1.4)

### DynamoDB Access Patterns (current)

| PK | SK | Entity | GSI Used |
|----|----|--------|----------|
| `SESSION#{id}` | `METADATA` | Session record | GSI1PK=`STATUS#{status}`, GSI1SK=`createdAt` |
| `SESSION#{id}` | `PARTICIPANT#{userId}` | Hangout participant | None (query by PK prefix) |
| `RESOURCE#{arn}` | `METADATA` | Pool resource | GSI1PK=`STATUS#AVAILABLE#{type}` |
| `REACTION#{sessionId}#{emojiType}#SHARD{n}` | `{time}#{reactionId}` | Reaction | GSI2 for time-range |
| `CHAT#{sessionId}` | `{ts}#{messageId}` | Chat message | None |

### Existing Lambda Handlers Relevant to v1.5

| Handler | Trigger | v1.5 Change |
|---------|---------|-------------|
| `recording-ended.ts` | EventBridge IVS Recording End | Add structured log statements |
| `start-transcribe.ts` | EventBridge `Upload Recording Available` | Add `ShowSpeakerLabels: true` |
| `transcribe-completed.ts` | EventBridge `aws.transcribe` | Parse speaker_labels, store speakerSegments |
| `transcode-completed.ts` | EventBridge MediaConvert COMPLETE | Add structured log statements |
| `store-summary.ts` | EventBridge `Transcript Stored` | Add structured log statements |
| `ivs-event-audit.ts` | EventBridge all aws.ivs | Existing — pattern to extend |

### Session Domain Model (current, `backend/src/domain/session.ts`)

The `Session` interface has 30+ fields. Key fields relevant to v1.5:

```
sessionId, userId, sessionType (BROADCAST|HANGOUT|UPLOAD), status
claimedResources { channel?, stage?, chatRoom }
transcriptStatus: 'pending' | 'processing' | 'available' | 'failed'
transcriptS3Path, transcript
aiSummary, aiSummaryStatus
mediaconvertJobId
recordingHlsUrl, recordingStatus
```

`ProcessingEventType` enum and `ProcessingEvent` interface already exist in `session.ts` — the
data model for a pipeline audit log is partially defined. This is the anchor for structured logging.

---

## Integration Points: New vs Modified Components

### New Lambda Handlers

| File | Trigger | Responsibility |
|------|---------|---------------|
| `bounce-user.ts` | POST /sessions/{id}/bounce | IVS Chat DisconnectUser + write MODLOG item |
| `report-message.ts` | POST /sessions/{id}/chat/{msgId}/report | Write MODLOG report item |
| `scan-stuck-sessions.ts` | EventBridge Scheduler rate(30 min) | Find stuck sessions, emit recovery events |
| `list-comments.ts` | GET /sessions/{id}/comments | Query COMMENT items for session |
| `create-comment.ts` | POST /sessions/{id}/comments | Write timestamped COMMENT item |

### Modified Lambda Handlers

| File | Change | Scope |
|------|--------|-------|
| `recording-ended.ts` | Add structured JSON log at invocation, MediaConvert submission, and error paths | Log-only — no behavior change |
| `transcode-completed.ts` | Add structured JSON log at invocation, transcribe submission, error paths | Log-only |
| `transcribe-completed.ts` | Parse `speaker_labels` JSON, reconstruct speaker segments, store `speakerSegments` on session | Functional change |
| `start-transcribe.ts` | Add `Settings.ShowSpeakerLabels = true`, `Settings.MaxSpeakerLabels = 10` to `StartTranscriptionJobCommand` | Functional change |
| `store-summary.ts` | Add structured JSON log at invocation and result paths | Log-only |

### New API Routes (wired in `api-stack.ts`)

| Method | Route | Auth | Handler |
|--------|-------|------|---------|
| POST | `/sessions/{sessionId}/bounce` | Cognito required | `bounce-user.ts` |
| POST | `/sessions/{sessionId}/chat/{msgId}/report` | Cognito required | `report-message.ts` |
| GET | `/sessions/{sessionId}/comments` | Cognito required | `list-comments.ts` |
| POST | `/sessions/{sessionId}/comments` | Cognito required | `create-comment.ts` |

New CDK resource path: `{msgId}` must be added under the existing `sessionChatResource` in `api-stack.ts`:

```typescript
const msgIdResource = sessionChatResource.addResource('{msgId}');
const reportResource = msgIdResource.addResource('report');
const sessionCommentsResource = sessionIdResource.addResource('comments');
```

### New DynamoDB Item Schemas (all in existing `vnl-sessions` table)

**Moderation log — bounce:**
```
PK:            MODLOG#{sessionId}
SK:            BOUNCE#{ISO-timestamp}#{targetUserId}
entityType:    MODERATION_EVENT
eventType:     BOUNCE
sessionId:     string
actorUserId:   string   (cognito:username of broadcaster)
targetUserId:  string   (cognito:username of bounced user)
reason?:       string
timestamp:     string   (ISO-8601)
```

**Moderation log — report:**
```
PK:            MODLOG#{sessionId}
SK:            REPORT#{messageId}#{ISO-timestamp}
entityType:    MODERATION_EVENT
eventType:     REPORT
sessionId:     string
reporterUserId:   string
messageId:     string   (IVS Chat message ID)
messageContent:   string   (copy for audit)
reason?:       string
timestamp:     string
```

**Comment (upload/video page):**
```
PK:            COMMENT#{sessionId}
SK:            {zeroPaddedSeconds}#{commentId}   e.g. "0000045.320#uuid-..."
entityType:    COMMENT
commentId:     string   (uuid)
sessionId:     string
userId:        string   (cognito:username)
text:          string
videoTimestamp:  number   (float seconds into video)
createdAt:     string   (ISO-8601)
```

Zero-padded SK (10 digits before decimal, 3 after) ensures lexicographic sort = chronological by
video position. This enables range queries: `KeyConditionExpression: 'PK = :pk AND SK BETWEEN :start AND :end'`
for efficiently fetching comments near a playhead position.

**Session METADATA — new fields (additive, backward compatible):**
```typescript
speakerSegments?: SpeakerSegment[]   // derived from Transcribe speaker_labels
speakerCount?: number                // from speaker_labels.speakers
```

Where `SpeakerSegment`:
```typescript
interface SpeakerSegment {
  speaker_label: string;   // "spk_0", "spk_1"
  start_time: string;      // seconds as string (Transcribe format, e.g. "4.87")
  end_time: string;
  text: string;            // reconstructed sentence/phrase text for this segment
}
```

### CDK Additions in `session-stack.ts`

```typescript
// scan-stuck-sessions Lambda + schedule
const scanStuckFn = new nodejs.NodejsFunction(this, 'ScanStuckSessions', {
  entry: '...scan-stuck-sessions.ts',
  timeout: Duration.minutes(5),
  environment: { TABLE_NAME: this.table.tableName },
});
this.table.grantReadWriteData(scanStuckFn);
scanStuckFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['events:PutEvents'],
  resources: ['arn:aws:events:*:*:event-bus/default'],
}));
new events.Rule(this, 'ScanStuckSessionsSchedule', {
  schedule: events.Schedule.rate(Duration.minutes(30)),
  targets: [new targets.LambdaFunction(scanStuckFn)],
  description: 'Scan for stuck sessions every 30 minutes and re-trigger recovery events',
});

// Explicit logGroup on pipeline Lambdas (follow ivs-event-audit.ts pattern)
// Add logGroup: new logs.LogGroup(...) to:
//   RecordingEnded, TranscodeCompleted, TranscribeCompleted, StoreSummary
```

### CDK IAM Additions

| Lambda | New Permission | Resource |
|--------|---------------|---------|
| `bounce-user.ts` | `ivschat:DisconnectUser` | `arn:aws:ivschat:*:*:room/*` |
| `bounce-user.ts` | DynamoDB read/write | vnl-sessions table |
| `report-message.ts` | DynamoDB read/write | vnl-sessions table |
| `scan-stuck-sessions.ts` | DynamoDB read | vnl-sessions table |
| `scan-stuck-sessions.ts` | `events:PutEvents` | default event bus |
| `list-comments.ts` | DynamoDB read | vnl-sessions table |
| `create-comment.ts` | DynamoDB read/write | vnl-sessions table |

### New Frontend Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `VideoPage.tsx` | `web/src/features/video/` | New `/video/:sessionId` route — full player with comments, transcript, reactions |
| `useVideoComments.ts` | `web/src/features/upload/` | Fetch all comments, filter by syncTime proximity |
| `CommentThread.tsx` | `web/src/features/upload/` | Render timestamped comments near playhead |
| `BounceButton.tsx` | `web/src/features/moderation/` | Broadcaster-only: POST /bounce |
| `ReportButton.tsx` | `web/src/features/moderation/` | Per-message: POST /chat/{msgId}/report |
| `useModerationActions.ts` | `web/src/features/moderation/` | API wiring for bounce + report |

### Modified Frontend Components

| Component | Change |
|-----------|--------|
| `MessageRow.tsx` | Add `ReportButton` on other users' messages; add `BounceButton` when viewer is broadcaster |
| `App.tsx` | Add `/video/:sessionId` route pointing to `VideoPage` |
| `useReplayPlayer.ts` | Return `player` instance + `qualities` state array for resolution selector |
| `UploadViewer.tsx` | Add `/video/:sessionId` redirect or supersede with `VideoPage` |
| `TranscriptDisplay.tsx` | Extend to optionally render diarized `speakerSegments` (grouped by speaker label) |

---

## Feature-Specific Architecture Decisions

### 1. Structured Logging

**Approach: inline structured JSON — do not add AWS Powertools/Middy dependency.**

The existing `ivs-event-audit.ts` already uses `console.log(JSON.stringify({...}))` as the
canonical pattern. AWS Powertools TypeScript would add ~400KB to cold-start payload and requires
`middy` middleware wiring not present in the codebase. For this milestone the inline approach is
the right fit.

**Log schema — apply to all pipeline handlers:**
```typescript
console.log(JSON.stringify({
  pipeline: 'vnl',
  stage: 'recording-ended',        // unique per handler
  sessionId,
  event: 'mediaconvert_submitted', // handler-defined event name
  jobId?,                          // event-specific context
  error?,                          // on error paths
  timestamp: new Date().toISOString(),
}));
```

**Log group structure:** Each NodejsFunction in CDK gets its own log group. To make log groups
long-lived and queryable, add `logGroup:` with explicit `RetentionDays` to each pipeline Lambda
in `session-stack.ts`, following the `IvsEventAuditLogGroup` pattern already there.

**CloudWatch Insights query across all pipeline stages:**
```
fields @timestamp, pipeline, stage, sessionId, event, error
| filter pipeline = 'vnl'
| sort @timestamp desc
| limit 200
```

### 2. Stuck Session Cron Recovery

**Trigger:** `events.Schedule.rate(Duration.minutes(30))` — consistent with existing
`ReplenishPoolSchedule` pattern in `session-stack.ts`.

**Query for stuck sessions — use GSI1 for `STATUS#ENDING`:**

Sessions stuck in the pipeline have `status = 'ending'` (set when IVS stream ends) and were
never transitioned to `'ended'` by `recording-ended.ts`. Query GSI1:

```typescript
const result = await docClient.send(new QueryCommand({
  TableName: tableName,
  IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :status',
  ExpressionAttributeValues: { ':status': 'STATUS#ENDING' },
}));

const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const stuck = result.Items?.filter(item =>
  item.createdAt < thirtyMinAgo &&
  (!item.transcriptStatus || item.transcriptStatus === 'processing')
) || [];
```

This avoids a full table scan. The GSI1PK=`STATUS#ENDING` partition is small in practice
(sessions transition out of ENDING quickly when the pipeline is healthy).

**Recovery action — EventBridge PutEvents (preferred over direct Lambda invocation):**

```typescript
// Re-trigger transcription for sessions that have recordingHlsUrl but stuck in processing
await eventBridgeClient.send(new PutEventsCommand({
  Entries: [{
    Source: 'custom.vnl',
    DetailType: 'Upload Recording Available',
    Detail: JSON.stringify({
      sessionId: session.sessionId,
      recordingHlsUrl: session.recordingHlsUrl,
      recoveryAttempt: true,
    }),
  }],
}));
```

For sessions without `recordingHlsUrl` (stuck before MediaConvert), emit a custom event
`'Session Recording Recovery'` on `custom.vnl` and wire an EventBridge rule to invoke
`recording-ended.ts` indirectly, or call shared repository functions directly from the cron Lambda.

**Why PutEvents over direct Lambda.invoke:** Decouples cron from handler implementation.
DLQ and retry semantics apply automatically. Consistent with pipeline architecture.

### 3. Speaker-Attributed Transcripts

**API change to `start-transcribe.ts`:**
```typescript
const transcribeParams = {
  ...existingParams,
  Settings: {
    ShowSpeakerLabels: true,
    MaxSpeakerLabels: 10,  // reasonable upper bound for video sessions
  },
};
```

**Transcribe output JSON structure (HIGH confidence — verified against AWS docs):**
```json
{
  "results": {
    "transcripts": [{ "transcript": "full plain text" }],
    "items": [
      {
        "start_time": "4.87",
        "end_time": "5.02",
        "alternatives": [{ "confidence": "0.99", "content": "Hello" }],
        "type": "pronunciation",
        "speaker_label": "spk_0"
      }
    ],
    "speaker_labels": {
      "speakers": 2,
      "segments": [
        {
          "start_time": "4.87",
          "end_time": "6.88",
          "speaker_label": "spk_0",
          "items": [
            { "start_time": "4.87", "end_time": "5.02", "speaker_label": "spk_0" }
          ]
        }
      ]
    }
  }
}
```

**Processing in `transcribe-completed.ts`:**
1. Parse `speaker_labels.segments` from the full Transcribe JSON (already fetched from S3).
2. For each segment, collect all `results.items` whose `start_time` falls within the segment
   time window. Join their `alternatives[0].content` to reconstruct segment text.
3. Build `speakerSegments: SpeakerSegment[]` array.
4. Call `updateTranscriptStatus(...)` with additional `speakerSegments` and `speakerCount` fields.

**Size guard:** If `JSON.stringify(speakerSegments).length > 50000` (50KB), truncate to the first
N segments that fit and store `speakerSegmentsPartial: true`. Full segments remain available via
`transcriptS3Path` in S3. Do not risk exceeding the 400KB DynamoDB item limit.

**Speaker-to-username mapping:** NOT implemented in v1.5. Transcribe assigns `spk_0`, `spk_1`,
etc. with no knowledge of which participant is which. Store generic labels; the frontend renders
"Speaker 1", "Speaker 2". Future milestone can add an owner-labeling UI.

**Frontend rendering:** Color-code segments by `speaker_label` consistently (stable hash of label
string → CSS color). Sync highlighted segment to video position using `speaker_label.start_time`
vs `player.getPosition()`.

### 4. Chat Moderation (Bounce + Report)

**IVS Chat DisconnectUser (HIGH confidence — verified against AWS IVS Chat API reference):**

```typescript
import { IvschatClient, DisconnectUserCommand } from '@aws-sdk/client-ivschat';

const ivschat = new IvschatClient({});
await ivschat.send(new DisconnectUserCommand({
  roomIdentifier: session.claimedResources.chatRoom,  // room ARN on session
  userId: targetUserId,                                // cognito:username
  reason: 'Bounced by broadcaster',
}));
```

Disconnects ALL connections by that `userId` from the room. The client receives a `disconnect`
event automatically. Does NOT prevent reconnection — `create-chat-token.ts` would need a block-list
check to enforce persistent ban (out of scope for v1.5 "bounce" which is a temporary kick).

**`bounce-user.ts` logic:**
1. Fetch session by `sessionId` from DynamoDB.
2. Verify caller's Cognito identity === `session.userId` (broadcaster-only gating).
3. Return 403 if caller is not the broadcaster.
4. Call `DisconnectUserCommand`.
5. Write MODLOG item to DynamoDB.
6. Return 200.

**`report-message.ts` logic:**
1. Parse `reporterUserId` from Cognito context, `messageId` from path, `messageContent` from body.
2. Guard: return 400 if `reporterUserId === messageOwnerUserId` (cannot report own messages).
3. Write MODLOG item to DynamoDB.
4. Return 200 (idempotent — duplicate reports just add items).

**Frontend — where bounce and report buttons appear:**
- `BounceButton`: rendered in `MessageRow.tsx` only when `authUser.userId === session.userId`
  (caller is broadcaster) AND message sender is not the broadcaster.
- `ReportButton`: rendered in `MessageRow.tsx` on all messages NOT from the current user.
  Hidden by default, revealed on hover (to keep the chat UI clean).

### 5. Upload Video Player Page (/video/:sessionId)

**Route:** The existing `/upload/:sessionId` route renders `UploadViewer.tsx` and already shows
the IVS player, transcript, and AI summary. The v1.5 target is a richer page at `/video/:sessionId`
that adds: resolution selector, async comments, and reactions.

**Decision: add `/video/:sessionId` as a new route; keep `/upload/:sessionId` as redirect.**
`UploadActivityCard` links should be updated to use `/video/:sessionId`. This avoids a conflicting
rewrite of existing `UploadViewer` mid-phase.

**IVS Player hook — extend `useReplayPlayer`, do not fork:**

`UploadViewer.tsx` uses `useReplayPlayer(url)` which returns `{ videoRef, syncTime }`. Extend it
to also return `{ player, qualities }`:

```typescript
// In useReplayPlayer.ts
const [player, setPlayer] = useState<any>(null);
const [qualities, setQualities] = useState<any[]>([]);

// After ivsPlayer.create():
ivsPlayer.addEventListener(window.IVSPlayer.PlayerEventType.QUALITY_CHANGED, () => {
  setQualities(ivsPlayer.getQualities());
});
// On load:
setPlayer(ivsPlayer);
```

This gives `VideoPage.tsx` access to `player.setQuality(quality)` for the resolution selector.
The change is non-breaking — existing callers that don't destructure `player` or `qualities` are
unaffected.

**Async comments — no new GSI needed:**

All comments for a session have `PK = COMMENT#{sessionId}`. Full list query:
```typescript
new QueryCommand({
  TableName: tableName,
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: { ':pk': `COMMENT#${sessionId}` },
})
```

Returns comments sorted by SK = zero-padded video timestamp. Filter to a ±30s window around
current `syncTime` in the frontend hook `useVideoComments`.

**`create-comment.ts` body:**
```typescript
const body = JSON.parse(event.body!);
const { text, videoTimestamp } = body;
// videoTimestamp: float seconds
const paddedTs = videoTimestamp.toFixed(3).padStart(14, '0');  // "0000045.320"
const commentId = uuidv4();
const sk = `${paddedTs}#${commentId}`;
```

---

## Data Flows

### Pipeline Audit Log Flow

```
IVS Recording End
    |
    v
recording-ended.ts
    -> log { stage: 'recording-ended', event: 'invoked', sessionId }
    -> submit MediaConvert
    -> log { stage: 'recording-ended', event: 'mediaconvert_submitted', jobId }
    |
    v
transcode-completed.ts
    -> log { stage: 'transcode-completed', event: 'transcribe_submitted', sessionId }
    |
    v
transcribe-completed.ts
    -> log { stage: 'transcribe-completed', event: 'transcript_stored', sessionId }
    -> parse speakerSegments
    -> log { stage: 'transcribe-completed', event: 'speaker_segments_stored', speakerCount }
    |
    v
store-summary.ts
    -> log { stage: 'store-summary', event: 'summary_stored', sessionId }
```

### Stuck Session Recovery Flow

```
EventBridge Scheduler (rate 30 min)
    |
    v
scan-stuck-sessions.ts
    -> Query GSI1 STATUS#ENDING
    -> Filter: createdAt < 30 min ago AND transcriptStatus missing or 'processing'
    -> For each stuck session:
         IF recordingHlsUrl present:
           PutEvents 'Upload Recording Available' (re-triggers transcription pipeline)
         IF recordingHlsUrl absent:
           PutEvents 'Session Recording Recovery' (re-triggers from recording-ended)
```

### Moderation Flow

```
Broadcaster clicks Bounce
    |
    v
POST /sessions/{id}/bounce { targetUserId }
    |
    v
bounce-user.ts
    -> verify caller === session.userId (403 if not broadcaster)
    -> IvschatClient.DisconnectUser(roomArn, targetUserId)
    -> DynamoDB PutItem MODLOG#{sessionId} / BOUNCE#{ts}#{userId}
    -> return 200

User clicks Report on message
    |
    v
POST /sessions/{id}/chat/{msgId}/report { reason, messageContent }
    |
    v
report-message.ts
    -> verify reporterUserId !== messageOwnerId (400 if self-report)
    -> DynamoDB PutItem MODLOG#{sessionId} / REPORT#{msgId}#{ts}
    -> return 200
```

### Upload Video Player Flow

```
User opens /video/:sessionId
    |
    v
VideoPage.tsx
    -> GET /sessions/{sessionId} (fetch session + speakerSegments + aiSummary)
    -> useReplayPlayer(session.recordingHlsUrl)
       -> returns { videoRef, syncTime, player, qualities }
    -> useVideoComments(sessionId)
       -> GET /sessions/{sessionId}/comments
       -> filter comments within ±30s of syncTime
    |
    v
User selects resolution
    -> player.setQuality(selectedQuality)

User posts comment at T=45.3s
    -> POST /sessions/{sessionId}/comments { text, videoTimestamp: 45.3 }
    -> create-comment.ts writes COMMENT#${sessionId} / "0000045.300#uuid"
    -> useVideoComments re-fetches and displays
```

---

## Recommended Project Structure Additions

```
backend/src/handlers/
+-- bounce-user.ts            (NEW) POST /sessions/{id}/bounce
+-- report-message.ts         (NEW) POST /sessions/{id}/chat/{msgId}/report
+-- scan-stuck-sessions.ts    (NEW) EventBridge Scheduler cron
+-- list-comments.ts          (NEW) GET /sessions/{id}/comments
+-- create-comment.ts         (NEW) POST /sessions/{id}/comments

web/src/features/
+-- moderation/
|   +-- BounceButton.tsx      (NEW)
|   +-- ReportButton.tsx      (NEW)
|   +-- useModerationActions.ts (NEW)
+-- video/
|   +-- VideoPage.tsx         (NEW) /video/:sessionId
+-- upload/
    +-- useVideoComments.ts   (NEW)
    +-- CommentThread.tsx     (NEW)
```

---

## Architectural Patterns

### Pattern 1: Inline Structured JSON Logging (extend existing)

**What:** Every pipeline handler emits `console.log(JSON.stringify({ pipeline, stage, event, ... }))`.
**When to use:** Any Lambda in the `custom.vnl` or `aws.ivs` pipeline that needs CloudWatch observability.
**Trade-offs:** Simple, zero dependencies, queryable with CloudWatch Insights. Less ergonomic
than Powertools but avoids a 400KB cold-start penalty.

### Pattern 2: GSI Query + In-Lambda Filter for Cron Scans

**What:** Query GSI1 for a bounded status partition, then filter by timestamp in Lambda.
**When to use:** When the population of interest (stuck sessions) is small and bounded by status.
**Trade-offs:** GSI query is efficient when `STATUS#ENDING` partition stays small (it should — sessions
cycle through ENDING quickly). Full table scan is unacceptable for a cron job as the table grows.

### Pattern 3: EventBridge PutEvents for Async Recovery

**What:** Cron Lambda emits custom events on `custom.vnl` to re-trigger existing pipeline handlers.
**When to use:** Recovery from stuck state; handler re-use without coupling.
**Trade-offs:** EventBridge DLQ and retry apply; decoupled from handler implementation.
Small delay (~ms) vs direct Lambda.invoke.

### Pattern 4: Co-located COMMENT Items on Shared PK

**What:** All comments for a session share `PK = COMMENT#{sessionId}`, sorted by video timestamp in SK.
**When to use:** Access pattern is always "all comments for this session, near this time".
**Trade-offs:** Single table partition per session; efficient key-based queries with optional SK range.
No GSI needed for v1.5 scale.

### Pattern 5: Extend `useReplayPlayer` Hook, Don't Fork

**What:** Add `player` and `qualities` to the return value of the existing hook.
**When to use:** New callers need IVS player internals; existing callers must not break.
**Trade-offs:** Non-breaking because new destructured values are optional. Avoids duplicate
player initialization logic.

---

## Anti-Patterns

### Anti-Pattern 1: Storing Full Transcribe JSON on DynamoDB Session Item

**What people do:** Write `JSON.stringify(transcribeOutput)` directly to a session attribute after
fetching it from S3.
**Why it's wrong:** Full Transcribe JSON for a 1-hour session is 2-5MB — exceeds DynamoDB's 400KB
item limit and causes silent write failures or `ItemCollectionSizeLimitExceededException`.
**Do this instead:** Parse the JSON in Lambda, extract only the compact `speakerSegments` array
(one entry per speaker turn, not per word). Keep `transcriptS3Path` pointing to full raw JSON.

### Anti-Pattern 2: Direct Lambda.invoke for Cron Recovery

**What people do:** Call `LambdaClient.send(new InvokeCommand({ FunctionName: 'RecordingEnded' }))` from the cron.
**Why it's wrong:** Bypasses EventBridge DLQ/retry semantics; creates tight coupling; `recording-ended.ts`
expects a specific IVS EventBridge event shape that is non-trivial to fake.
**Do this instead:** Emit a `custom.vnl` EventBridge event; let the existing rule routing handle
delivery. The cron stays decoupled from handler internals.

### Anti-Pattern 3: New DynamoDB Table for Moderation Log

**What people do:** Create `vnl-moderation` table for bounce/report records.
**Why it's wrong:** Requires separate IAM grants, adds CDK complexity, and DynamoDB doesn't support
cross-table joins — you can't efficiently get "session + its moderation events" in one request.
**Do this instead:** Use `PK: MODLOG#{sessionId}` in the existing `vnl-sessions` table. All
moderation events for a session are co-located and queryable with one DynamoDB Query call.

### Anti-Pattern 4: Polling IVS Chat for Bounce Enforcement

**What people do:** After writing a bounce flag to DynamoDB, check it on every incoming message
or let the user stay connected but drop their messages.
**Why it's wrong:** IVS Chat `DisconnectUser` already severs the WebSocket server-side. The client
receives a `disconnect` event immediately. No polling needed.
**Do this instead:** Call `DisconnectUser` — the user is gone from the room. For persistent bans,
gate `create-chat-token.ts` with a block-list check (not in v1.5 scope).

### Anti-Pattern 5: New Route `/video/:sessionId` That Duplicates `/upload/:sessionId` Entirely

**What people do:** Create `VideoPage.tsx` as a near-copy of `UploadViewer.tsx`.
**Why it's wrong:** Two components with the same IVS player lifecycle create duplicate code and
diverge in behavior. Existing `useReplayPlayer` already handles the player setup.
**Do this instead:** Extend `useReplayPlayer` to return the player instance and qualities, then
build `VideoPage.tsx` on top of it — sharing the player hook with `UploadViewer`.

---

## Build Order (Phase Dependencies)

```
Phase 25: Structured Pipeline Logging
  Modify: recording-ended.ts, transcode-completed.ts, transcribe-completed.ts, store-summary.ts
  CDK: add explicit logGroup to pipeline Lambdas in session-stack.ts
  No new Lambdas. No behavior change. Unblocks observability for all subsequent debugging.

Phase 26: Stuck Session Cron Recovery
  New: scan-stuck-sessions.ts
  CDK: EventBridge Scheduler rule in session-stack.ts
  Depends on Phase 25 (logging makes it possible to verify cron behavior in CloudWatch).

Phase 27: Speaker-Attributed Transcripts
  Modify: start-transcribe.ts (add ShowSpeakerLabels)
  Modify: transcribe-completed.ts (parse + store speakerSegments)
  Domain: extend Session interface with speakerSegments, speakerCount
  Frontend: extend TranscriptDisplay to render diarized segments
  Independent of Phase 26 (can run in parallel).

Phase 28: Chat Moderation (Bounce + Report)
  New: bounce-user.ts, report-message.ts
  CDK: new routes in api-stack.ts, ivschat:DisconnectUser IAM
  Frontend: BounceButton, ReportButton, useModerationActions, MessageRow changes
  Independent of Phases 26 and 27 (can run in parallel with Phase 27).

Phase 29: Upload Video Player Page
  New: create-comment.ts, list-comments.ts, VideoPage.tsx, useVideoComments.ts
  CDK: new /comments routes in api-stack.ts
  Modify: useReplayPlayer.ts (return player + qualities)
  App.tsx: add /video/:sessionId route
  Depends on: Phase 27 (for diarized transcript display on the page).
  Comments and resolution selector are independent of Phase 27.
```

Phases 27 and 28 are independent and can be developed simultaneously by different phases if needed.
Phase 29 can start comments/player work before Phase 27 is complete; speaker segments display is
the only Phase 27 dependency in Phase 29.

---

## Sources

- Codebase direct analysis: `backend/src/handlers/`, `backend/src/repositories/`, `infra/lib/stacks/`, `web/src/` (HIGH confidence)
- [Amazon Transcribe Diarization Batch Output](https://docs.aws.amazon.com/transcribe/latest/dg/diarization-output-batch.html) — HIGH confidence, JSON schema verified
- [IVS Chat DisconnectUser API Reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_DisconnectUser.html) — HIGH confidence, parameters and behavior verified
- [AWS Lambda Powertools TypeScript Logger](https://docs.aws.amazon.com/powertools/typescript/2.8.0/core/logger/) — considered and rejected for this milestone
- [EventBridge Scheduler invoke Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-eventbridge-scheduler.html) — HIGH confidence, matches existing replenish-pool pattern

---

*Architecture research for: VideoNowAndLater v1.5 Pipeline Reliability, Moderation & Upload Experience*
*Researched: 2026-03-10*
