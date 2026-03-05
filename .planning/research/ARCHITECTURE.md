# Architecture Research

**Domain:** AWS IVS live-video platform — Activity Feed & Intelligence (v1.2)
**Researched:** 2026-03-05
**Confidence:** HIGH (based on direct codebase analysis)

---

## Existing Architecture Baseline

The system is a single-table DynamoDB design with Lambda handlers, EventBridge-driven lifecycle
events, and two API surfaces: REST (API Gateway + Cognito) and internal (EventBridge).

### DynamoDB Access Patterns (Current)

| PK | SK | Entity | GSI |
|----|----|--------|-----|
| `SESSION#{id}` | `METADATA` | Session record | GSI1PK=`STATUS#{status}`, GSI1SK=`createdAt` |
| `RESOURCE#{arn}` | `METADATA` | Pool resource | GSI1PK=`STATUS#AVAILABLE#{type}` |
| `REACTION#{sessionId}#{emojiType}#SHARD{n}` | `{time}#{reactionId}` | Reaction | GSI2PK=`REACTION#{sessionId}`, GSI2SK=padded time |
| `CHAT#{sessionId}` | `{ts}#{messageId}` | Chat message | — |

### Session Domain Model (current fields, `backend/src/domain/session.ts`)

```
sessionId, userId, sessionType (BROADCAST|HANGOUT), status (creating|live|ending|ended),
claimedResources { channel?, stage?, chatRoom },
createdAt, startedAt, endedAt, version,
recordingS3Path, recordingDuration, thumbnailUrl, recordingHlsUrl,
recordingStatus (pending|processing|available|failed)
```

### Existing Lambda Handlers

| Handler | Trigger | Responsibility |
|---------|---------|---------------|
| `create-session.ts` | POST /sessions | Claim pool resource, create session record |
| `get-session.ts` | GET /sessions/{id} | Read session by ID |
| `join-hangout.ts` | POST /sessions/{id}/join | Generate IVS RealTime token; transition to LIVE |
| `end-session.ts` | POST /sessions/{id}/end | Transition session to ENDING |
| `stream-started.ts` | EventBridge IVS Stream Start | Scan by channel ARN, transition to LIVE |
| `stream-ended.ts` | EventBridge IVS Stream End | Transition to ENDING |
| `recording-started.ts` | EventBridge IVS Recording Start | Update recordingStatus=processing |
| `recording-ended.ts` | EventBridge IVS Recording End (broadcast+stage) | Transition to ENDED, set recording metadata, release pool |
| `list-recordings.ts` | GET /recordings | Scan for ended/ending sessions, return sorted |
| `create-reaction.ts` | POST /sessions/{id}/reactions | Persist sharded reaction, broadcast via IVS Chat |
| `get-reactions.ts` | GET /sessions/{id}/reactions | Query GSI2 for time-ranged reactions |
| `create-chat-token.ts` | POST /sessions/{id}/chat/token | Generate IVS Chat token |
| `send-message.ts` | POST /sessions/{id}/chat/messages | Store message to DynamoDB |
| `get-chat-history.ts` | GET /sessions/{id}/chat/messages | Query chat messages |
| `replenish-pool.ts` | EventBridge schedule (5-min) | Top up IVS channel/stage/room pool |
| `ivs-event-audit.ts` | EventBridge all aws.ivs | CloudWatch observability |

---

## System Overview

```
+-----------------------------------------------------------------+
|                     Frontend (React/Vite)                       |
|  HomePage  |  BroadcastPage  |  HangoutPage  |  ReplayPage     |
+-----------------------------+-----------------------------------+
                              | REST (API Gateway + Cognito auth)
+-----------------------------+-----------------------------------+
|                    API Lambda Handlers                          |
|  create-session  get-session  join-hangout  end-session         |
|  list-recordings  [NEW] list-activity  [NEW] get-session+AI    |
|  create-reaction  get-reactions  create-chat-token  send-msg    |
+--------+----------------------------+---------------------------+
         | DynamoDB                   | AWS SDKs
+--------+----------+   +------------+--------------------+
|  vnl-sessions      |   | IVS Channel | IVS RealTime Stage |
|  GSI1 (status)     |   | IVS Chat   | Amazon Transcribe   |
|  GSI2 (reactions)  |   | S3/CF      | Bedrock (Claude)    |
+-------------------+   +-----------------------------------------+
+----------------------------------------------------------------+
|         Event-Driven Handlers (EventBridge targets)            |
|  stream-started  stream-ended  recording-started               |
|  recording-ended (MODIFY: +reaction summary)                   |
|  [NEW] start-transcription  [NEW] store-transcript             |
+----------------------------------------------------------------+
```

---

## Integration Points: What Changes and Where

### 1. Hangout Participant Tracking

**Current state:** `backend/src/handlers/join-hangout.ts` generates a participant token and
transitions the session to LIVE on first join. No participant data is persisted to DynamoDB.

**Integration point:** `join-hangout.ts`, after line 65 — after `ivsRealTimeClient.send(command)`
returns successfully, before the response is built.

**What to add:** Call a new `addHangoutParticipant()` repository function. Stores the participant
join event as a separate DynamoDB item co-located under the session PK.

**New DynamoDB item pattern:**

```
PK:            SESSION#{sessionId}
SK:            PARTICIPANT#{userId}
entityType:    PARTICIPANT
sessionId:     string
userId:        string
participantId: string   (from response.participantToken.participantId)
joinedAt:      ISO timestamp
leftAt:        ISO timestamp | undefined  (nullable — set by EventBridge handler if added later)
```

Using `SESSION#{sessionId}` as PK with SK=`PARTICIPANT#{userId}` keeps participant items
co-located with the session. A single `Query` on PK with `begins_with(SK, 'PARTICIPANT#')` fetches
all participants. No new GSI needed.

**Why not a list on the session METADATA item:** Adding participants to the session item creates
write-contention — concurrent joins would all update the same versioned item. The existing
`updateSessionStatus()` uses optimistic locking (`#version = :currentVersion`). A concurrent second
participant join would cause a `ConditionalCheckFailedException`. Separate items with shared PK
avoid this entirely.

**Leave events (optional for v1.2):** IVS RealTime emits `IVS Participant Event` EventBridge events
(participant.left, participant.disconnected). A handler can update the participant item with
`leftAt`. This is deferred — participant count for the activity card can be derived from join items
alone, and `leftAt` is nullable.

---

### 2. Reaction Summary Counts

**Current state:** `backend/src/repositories/reaction-repository.ts` `getReactionCounts()` aggregates
across 100 shards (100 parallel DynamoDB queries per emoji type, 5 types = 500 queries per call).
This cost is unacceptable on every homepage load.

**Integration point:** `backend/src/handlers/recording-ended.ts`, after `updateRecordingMetadata()`
succeeds (around line 127).

**When to compute:** At session end — the recording-ended event. The session is complete, no more
reactions will arrive, and the cost is paid once rather than on every homepage request.

**What to add in `recording-ended.ts`:** After updating recording metadata, call a new
`computeAndStoreReactionSummary()` helper that:
1. Calls `getReactionCounts()` for all 5 emoji types in parallel.
2. Writes the result as `reactionSummary` map to the session METADATA item.

**New session METADATA fields:**

```
reactionSummary: {
  heart:     number,
  fire:      number,
  clap:      number,
  laugh:     number,
  surprised: number,
  totalCount: number
}
```

Stored as a DynamoDB map attribute on `SESSION#{id} / METADATA`. A new `updateReactionSummary()`
function is added to `backend/src/repositories/session-repository.ts` alongside the existing
`updateRecordingMetadata()`.

**Critical implementation note:** Wrap in try/catch, do NOT throw. Pool resource release is
time-critical — it must always execute. Reaction summary computation is best-effort; a failure
here should log and continue.

---

### 3. Transcription Pipeline — Trigger

**Current state:** `recording-ended.ts` fires when IVS emits a Recording End event. The EventBridge
event payload includes `recording_s3_key_prefix` — the S3 path prefix where the recording landed.
The handler already derives the HLS URL from this prefix.

**Integration point:** Add `backend/src/handlers/start-transcription.ts` as a second Lambda target
on the existing `RecordingEndRuleV2` EventBridge rule in `infra/lib/stacks/session-stack.ts`.

**Why not S3 event notifications:** The Recording End EventBridge event from IVS is the
authoritative "recording is complete" signal — it fires exactly once when all files are finalized.
S3 events would fire multiple times (once per file: HLS segments, thumbnails, manifests) before the
recording is assembled. Using the existing EventBridge rule avoids S3-trigger complexity and
provides the session context (ARN lookup) already solved in `recording-ended.ts`.

**What `start-transcription.ts` does:**
1. Parse the resource ARN and determine broadcast vs stage (same logic as `recording-ended.ts`).
2. Derive the MP4 source path from `recording_s3_key_prefix`. IVS records raw MP4 alongside HLS:
   - Broadcast: `{prefix}/media/hls/` contains HLS; MP4 source is not directly provided.
   - Fallback: Use the HLS master playlist URI with Transcribe's MediaFormat=m3u8. Amazon Transcribe
     supports HLS as input format, so the existing HLS URL can be used directly. This avoids
     guessing the MP4 path.
3. Call `StartTranscriptionJobCommand` (AWS SDK `@aws-sdk/client-transcribe`).
4. Use `jobName = transcript-{sessionId}-{Date.now()}` for uniqueness.
5. Set output to the recordings S3 bucket under a `transcripts/` prefix.
6. Update session: `transcriptStatus=processing`, `transcriptJobName={jobName}`.

**New session METADATA fields for transcription:**

```
transcriptStatus:  'pending' | 'processing' | 'available' | 'failed'
transcriptJobName: string   (for audit and re-fetch)
transcriptText:    string   (inline for typical sessions; see storage note below)
```

**Storage consideration:** Transcripts for a 60-minute session are typically 20-60KB of plain text,
well under DynamoDB's 400KB item limit. For sessions over 3 hours, consider storing only the S3 URI
on the item and fetching on demand. For v1.2, storing inline is acceptable. Guard with a character
limit (truncate at 250,000 characters if needed).

---

### 4. Transcript Storage — `store-transcript.ts`

**Trigger:** Amazon Transcribe emits an EventBridge event when a job completes.
- Source: `aws.transcribe`
- Detail-type: `Transcribe Job State Change`
- Filter: `detail.TranscriptionJobStatus: [COMPLETED, FAILED]`

**New EventBridge rule needed in `session-stack.ts`:**
```
TranscribeJobCompleteRule:
  source: ['aws.transcribe']
  detail-type: ['Transcribe Job State Change']
  detail.TranscriptionJobStatus: ['COMPLETED', 'FAILED']
  target: store-transcript Lambda
```

**What `store-transcript.ts` does:**
1. Parse `TranscriptionJobName` from the event (`transcript-{sessionId}-{timestamp}` by convention).
2. Extract `sessionId` from the job name.
3. If status is FAILED: update `transcriptStatus=failed`, set `aiSummaryStatus=failed`, return.
4. If status is COMPLETED:
   a. Call `GetTranscriptionJobCommand` to retrieve the transcript output S3 URI.
   b. `S3.GetObject` to fetch transcript JSON.
   c. Extract transcript text: `data.results.transcripts[0].transcript`.
   d. Call `updateTranscriptFields()` on session-repository to store transcript + update status.
   e. Call Bedrock to generate AI summary (see section 5).
   f. Call `updateAiSummary()` on session-repository to store summary.

---

### 5. AI Summary Pipeline — Bedrock

**Trigger:** Inline within `store-transcript.ts`, after transcript is stored.

**Why inline rather than a separate Lambda/EventBridge step:** The transcript → summary dependency
is linear and guaranteed. Bedrock `InvokeModelCommand` returns within 2-5 seconds for a
summarization prompt. Keeping it in `store-transcript.ts` avoids an extra EventBridge rule and
DynamoDB Streams infrastructure.

**Failure isolation:** The Bedrock call is wrapped in its own try/catch. On failure:
- Set `aiSummaryStatus=failed`, log error.
- Do NOT throw. The transcript is already stored and valuable without the summary.

**Model:** `anthropic.claude-3-haiku-20240307-v1:0` (Bedrock model ID). Haiku is fast (1-2s
invocation), cheap, and sufficient for a 2-3 sentence summarization task. Sonnet/Opus are
unnecessary for this prompt complexity.

**Prompt structure:**
```
System: You are a video content summarizer. Summarize video call transcripts concisely.
User: Summarize the following transcript in 2-3 sentences, friendly tone:
{transcriptText}
```

**New session METADATA fields for AI summary:**

```
aiSummary:       string   (one paragraph, 2-3 sentences, ~100-200 words)
aiSummaryStatus: 'pending' | 'processing' | 'available' | 'failed'
aiModel:         string   (e.g., "anthropic.claude-3-haiku-20240307-v1:0" for audit)
```

**IAM required:** `store-transcript.ts` Lambda needs:
- `bedrock:InvokeModel` on `arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-*`

---

### 6. Homepage API — New and Modified Endpoints

**Current `GET /recordings`:** Returns all ended/ending sessions via a full-table Scan, sorted by
`endedAt` descending. Defined in `backend/src/handlers/list-recordings.ts`. The `getRecentRecordings()`
repository function in `session-repository.ts` already returns complete session objects, so new
fields (`reactionSummary`, `aiSummary`, `transcriptStatus`) will flow through automatically once
the pipeline populates them.

**No breaking change to `/recordings`:** The `Recording` interface in
`web/src/features/replay/RecordingFeed.tsx` (lines 8-17) is extended additively with optional
fields. Existing callers are unaffected.

**New `GET /activity` endpoint:**

The homepage redesign adds an activity feed below the recording slider — a chronological list of
all recent sessions (BROADCAST + HANGOUT), including sessions without available recordings (e.g.,
in-progress, failed, or hangouts without a recording). The existing `/recordings` endpoint is
insufficient because it filters by recordingStatus and only surfaces replay-ready content.

```
GET /activity
Query params: ?limit=20&type=ALL|BROADCAST|HANGOUT  (optional)
Response:     { items: ActivityItem[] }
```

This endpoint is the primary source for both the horizontal recording slider (broadcasts with
`recordingStatus=available`) and the activity feed list (all sessions). The frontend differentiates
rendering based on `sessionType` and `recordingStatus`.

**Hangout activity cards:** Hangout sessions appear as activity cards with participant list,
message count, and duration — not as recording tiles. The `/activity` endpoint serves both use
cases from a single call.

---

## New Components Summary

### New Lambda Functions

| File | Trigger | Responsibility |
|------|---------|---------------|
| `backend/src/handlers/start-transcription.ts` | EventBridge `RecordingEndRuleV2` (2nd target) | Start Amazon Transcribe job |
| `backend/src/handlers/store-transcript.ts` | EventBridge `aws.transcribe` Job State Change | Fetch transcript, store, invoke Bedrock |
| `backend/src/handlers/list-activity.ts` | GET /activity | Unified activity feed (all session types, all new fields) |

### Modified Lambda Functions

| File | Change | Location |
|------|--------|----------|
| `backend/src/handlers/join-hangout.ts` | Add participant persistence after token generation | After line 65 |
| `backend/src/handlers/recording-ended.ts` | Add reaction summary computation after metadata update | After line 127 |
| `backend/src/handlers/list-recordings.ts` | No logic change — new fields appear automatically | — |

### New Repository Functions (all in `backend/src/repositories/session-repository.ts`)

| Function | Purpose |
|----------|---------|
| `addHangoutParticipant()` | Write PARTICIPANT item under SESSION# PK |
| `getHangoutParticipants()` | Query PARTICIPANT items for a session |
| `updateReactionSummary()` | Write `reactionSummary` map to session METADATA |
| `updateTranscriptFields()` | Write `transcriptText`, `transcriptStatus`, `transcriptJobName` |
| `updateAiSummary()` | Write `aiSummary`, `aiSummaryStatus`, `aiModel` |
| `getRecentActivity()` | Scan all recent sessions (all types), sorted descending |

### New DynamoDB Schema Additions

All changes are to the existing `vnl-sessions` table. No new tables needed.

**Session METADATA item — new fields:**

```
# Reaction summary (computed at session end)
reactionSummary: Map {
  heart:      Number,
  fire:       Number,
  clap:       Number,
  laugh:      Number,
  surprised:  Number,
  totalCount: Number
}

# Transcription pipeline
transcriptStatus:  String  ('pending' | 'processing' | 'available' | 'failed')
transcriptJobName: String
transcriptText:    String  (inline; guard at 250,000 chars for sessions > ~3 hrs)

# AI summary
aiSummary:       String
aiSummaryStatus: String  ('pending' | 'processing' | 'available' | 'failed')
aiModel:         String  (model ID for audit)

# Denormalized participant count (written at session end for fast reads)
participantCount: Number
```

**New PARTICIPANT item type:**

```
PK:            SESSION#{sessionId}
SK:            PARTICIPANT#{userId}
entityType:    PARTICIPANT
sessionId:     String
userId:        String
participantId: String    (IVS RealTime participant ID from token response)
joinedAt:      ISO String
leftAt:        ISO String | undefined  (nullable)
```

No new GSI. Participants always accessed by PK=`SESSION#{id}`, SK beginning with `PARTICIPANT#`.

**Message count on session (recommendation):** Store `messageCount` as an atomic counter on the
session METADATA item, incremented by `send-message.ts` via `ADD messageCount :1`. This avoids
a chat history scan on every activity card. If this adds unwanted scope to an early phase, defer
to a later phase and show message count as N/A initially.

### New EventBridge Rules

| Rule Name | Event Pattern | Target |
|-----------|--------------|--------|
| `TranscribeJobCompleteRule` | `source: aws.transcribe`, `detail.TranscriptionJobStatus: [COMPLETED, FAILED]` | `store-transcript.ts` |

Existing rules modified (in `infra/lib/stacks/session-stack.ts`):
- `RecordingEndRuleV2`: add `start-transcription.ts` as a second target alongside `recording-ended.ts`.

### New API Gateway Endpoints (in `infra/lib/stacks/api-stack.ts`)

| Method | Path | Auth | Handler |
|--------|------|------|---------|
| GET | `/activity` | None (public) | `list-activity.ts` |

Existing endpoints: no breaking changes. New fields on `/recordings` responses appear addively.

### New IAM Permissions

| Lambda | Permission | Resource |
|--------|-----------|---------|
| `start-transcription.ts` | `transcribe:StartTranscriptionJob` | `*` |
| `start-transcription.ts` | `s3:GetObject`, `s3:PutObject` | recordings bucket |
| `store-transcript.ts` | `transcribe:GetTranscriptionJob` | `*` |
| `store-transcript.ts` | `s3:GetObject` | recordings bucket (transcript output) |
| `store-transcript.ts` | `bedrock:InvokeModel` | `arn:aws:bedrock:*::foundation-model/anthropic.claude-3-haiku-*` |
| `store-transcript.ts` | `dynamodb:UpdateItem`, `dynamodb:GetItem` | vnl-sessions table |
| `list-activity.ts` | `dynamodb:Scan` | vnl-sessions table |
| `join-hangout.ts` (modified) | No new perms — already has DynamoDB read/write | — |
| `recording-ended.ts` (modified) | No new perms — already has DynamoDB read/write | — |

---

## Data Flows

### Hangout Participant Tracking

```
User clicks "Hangout" -> Homepage creates session
    |
    v
POST /sessions/{id}/join
    |
    v
join-hangout.ts:
  1. Validate session (existing)
  2. CreateParticipantTokenCommand -> IVS RealTime (existing)
  3. updateSessionStatus LIVE (existing, first join only)
  4. addHangoutParticipant() -> DynamoDB       [NEW]
     PK=SESSION#{id}, SK=PARTICIPANT#{userId}
  5. Return token + participantId
```

### Reaction Summary

```
IVS emits Recording End event
    |
    v
EventBridge -> recording-ended.ts (existing, unmodified flow up to pool release)
    |
    v
updateSessionStatus ENDED (existing)
    |
    v
updateRecordingMetadata (existing)
    |
    v
computeAndStoreReactionSummary() [NEW, best-effort]
  getReactionCounts() x 5 emoji types (parallel, ~500 DynamoDB queries)
  updateReactionSummary() -> session METADATA
    |
    v
releasePoolResources (existing — always runs, even if summary fails)
```

### Transcription + AI Summary Pipeline

```
IVS emits Recording End event
    |
    +-> EventBridge target 1: recording-ended.ts (existing, unchanged)
    |
    +-> EventBridge target 2: start-transcription.ts [NEW]
            |
            v
        StartTranscriptionJobCommand -> Amazon Transcribe
        (uses HLS URL as input; jobName=transcript-{sessionId}-{ts})
        updateTranscriptFields(transcriptStatus=processing, transcriptJobName)
            |
            | (async: Transcribe job takes 30s - 5 min)
            v
        Amazon Transcribe emits EventBridge: TranscribeJobStateChange
            |
            v
        EventBridge -> store-transcript.ts [NEW]
            |
            v
        GetTranscriptionJobCommand -> get transcript S3 URI
        S3.GetObject -> fetch transcript JSON
        extract transcriptText
        updateTranscriptFields(transcriptText, transcriptStatus=available) -> session METADATA
            |
            v [same function, after transcript stored]
        InvokeModelCommand -> Bedrock Claude Haiku
        prompt: "Summarize in 2-3 sentences: {transcriptText}"
        updateAiSummary(aiSummary, aiSummaryStatus=available) -> session METADATA
```

### Homepage Activity Feed

```
User opens HomePage
    |
    v
GET /activity  [NEW endpoint]
    |
    v
list-activity.ts -> getRecentActivity() -> DynamoDB Scan
  FilterExpression: begins_with(PK, 'SESSION#') AND SK = 'METADATA'
  Sort: by endedAt or createdAt descending
  Returns: all session fields including reactionSummary, aiSummary, participantCount
    |
    v
Frontend:
  - Broadcast sessions w/ recordingStatus=available -> horizontal slider (HLS replay)
  - All sessions -> activity feed list below slider
  - HANGOUT sessions -> activity card with participants, messageCount, duration
  - BROADCAST sessions -> recording card with thumbnail, AI summary, reaction counts
```

---

## Recommended Project Structure Additions

```
backend/src/
  handlers/
    join-hangout.ts            # MODIFY: add participant persistence after token
    recording-ended.ts         # MODIFY: add reaction summary after metadata update
    start-transcription.ts     # NEW: trigger Transcribe job on recording end
    store-transcript.ts        # NEW: receive transcript + call Bedrock
    list-activity.ts           # NEW: unified activity feed endpoint
  repositories/
    session-repository.ts      # MODIFY: addHangoutParticipant, getHangoutParticipants,
                               #         updateReactionSummary, updateTranscriptFields,
                               #         updateAiSummary, getRecentActivity
  domain/
    session.ts                 # MODIFY: extend Session interface with new fields
  lib/
    transcribe-client.ts       # NEW: shared Transcribe SDK client (follows ivs-clients.ts)
    bedrock-client.ts          # NEW: shared Bedrock SDK client

infra/lib/stacks/
  session-stack.ts             # MODIFY: add start-transcription as 2nd target on
                               #         RecordingEndRuleV2; add TranscribeJobCompleteRule
  api-stack.ts                 # MODIFY: GET /activity + list-activity handler

web/src/
  features/replay/
    RecordingFeed.tsx          # MODIFY: extend Recording interface; render AI summary
                               #         + reaction counts
    ReplayViewer.tsx           # MODIFY: display aiSummary + reactionSummary in info panel
  pages/
    HomePage.tsx               # MODIFY: split feed into horizontal slider + activity feed
```

---

## Build Order: Dependency-Justified Phases

Dependencies determine ordering. Participant tracking and reaction summary are independent of the
AI pipeline. The AI pipeline depends on recordings. The homepage depends on all data being present
but can render progressively with empty states.

```
Phase 1: Participant Tracking
  Rationale: No external dependencies. Only touches join-hangout.ts and session-repository.ts.
  Deliverables:
  - Modify join-hangout.ts: persist PARTICIPANT item after token generation
  - Add addHangoutParticipant() to session-repository.ts
  - Add getHangoutParticipants() to session-repository.ts
  - Extend Session/domain types for participantCount
  Unblocks: Hangout activity card participant display

Phase 2: Reaction Summary at Session End
  Rationale: Depends only on existing reaction data and recording-ended.ts hook.
  Deliverables:
  - Modify recording-ended.ts: call computeAndStoreReactionSummary() post-metadata
  - Add updateReactionSummary() to session-repository.ts
  - Extend Session domain with reactionSummary field
  Unblocks: Reaction counts on recording cards

Phase 3: Transcription Pipeline
  Rationale: Depends on recordings being available (natural consequence of Phase 2 work
  in recording-ended.ts). Both can be done in same pass through session-stack.ts CDK changes.
  Deliverables:
  - New start-transcription.ts Lambda
  - New TranscribeJobCompleteRule EventBridge rule in session-stack.ts
  - Wire start-transcription as 2nd target on RecordingEndRuleV2
  - New store-transcript.ts Lambda (without Bedrock initially)
  - Add updateTranscriptFields() to session-repository.ts
  - IAM: transcribe:StartTranscriptionJob, s3 access
  Unblocks: AI summary (Phase 4)

Phase 4: AI Summary
  Rationale: Depends directly on transcript pipeline (Phase 3). Extends store-transcript.ts.
  Deliverables:
  - Extend store-transcript.ts: call Bedrock after storing transcript
  - Add updateAiSummary() to session-repository.ts
  - New bedrock-client.ts shared client
  - IAM: bedrock:InvokeModel
  - Extend Session domain with aiSummary, aiSummaryStatus, aiModel
  Unblocks: Summary display on cards and replay page

Phase 5: Homepage Redesign + Activity Feed API
  Rationale: Depends on Phases 1-4 for full data richness; can build with empty states earlier.
  Deliverables:
  - New list-activity.ts Lambda
  - GET /activity endpoint in api-stack.ts
  - Add getRecentActivity() to session-repository.ts
  - Extend Recording interface in RecordingFeed.tsx
  - Homepage layout: horizontal recording slider + activity feed below
  - Activity card component for hangouts
  - Replay page: display aiSummary + reactionSummary in info panel
```

Phases 2 and 3 share the `session-stack.ts` CDK file and can be done in the same CDK pass.
Phase 5 frontend can begin while Phases 3-4 are running — build the layout with empty/loading
states for AI and reaction fields; content appears as the pipeline delivers it to session records.

---

## Architectural Patterns

### Pattern 1: Fan-Out via Multiple EventBridge Targets

The existing `RecordingEndRuleV2` in `session-stack.ts` has one target. CDK supports multiple
Lambda targets on the same rule. Adding `start-transcription.ts` as a second target fires both
`recording-ended.ts` and `start-transcription.ts` in parallel from the same IVS event.

**When to use:** When two functions both need the same event, are fully independent, and have no
shared write paths.

**Trade-off:** Both functions must be idempotent. EventBridge retries independently for each
target on failure, so a failed transcription job does not block recording metadata storage.

### Pattern 2: Linear Async Chain for Sequentially Dependent Steps

The transcript -> AI summary dependency is linear. Rather than emitting a custom EventBridge event
after storing the transcript (which requires a custom event bus and additional rule), calling
Bedrock directly inside `store-transcript.ts` is simpler and sufficient.

**When to use:** When Step B always follows Step A, and failure of B must not invalidate A.

**Implementation:** Try/catch around the Bedrock call. On failure, set `aiSummaryStatus=failed`,
log, and return. The transcript is stored and usable even without the summary.

### Pattern 3: Compute-Once, Read-Many for Aggregates

Reaction counts across 100 shards require 500 DynamoDB queries to compute. Computing at session-end
converts a 500-query per-page-load into a single attribute access on the session item. This is the
correct pattern for any aggregate that: (a) stops changing at a well-defined point, and (b) is read
frequently.

### Pattern 4: Co-locate Related Items on Shared PK

Hangout participants are stored as `SESSION#{id} / PARTICIPANT#{userId}` items. All participants
for a session are fetched with a single `Query` on PK — no GSI needed. Session METADATA
(`SESSION#{id} / METADATA`) is fetched separately with `GetItem`.

**When to use:** When child entities always belong to a parent and are always accessed through
that parent. Avoids GSI for simple parent-child relationships.

---

## Anti-Patterns

### Anti-Pattern 1: Triggering Transcription from S3 Events

**What people do:** Wire S3 event notifications to fire when IVS writes recording files, then
trigger Transcribe from there.

**Why it's wrong:** IVS recordings are multi-file (HLS segments, thumbnails, manifest files). S3
events fire multiple times before the recording is assembled. The EventBridge `Recording End` event
from IVS is the authoritative "recording is complete" signal — it fires once when all files are
finalized.

**Do this instead:** Use the existing `RecordingEndRuleV2` as the sole trigger for
`start-transcription.ts`.

### Anti-Pattern 2: Computing Reaction Counts on Every Homepage Load

**What people do:** Call `getReactionCounts()` inside `list-recordings.ts` or `list-activity.ts`
for each session returned.

**Why it's wrong:** 5 emoji types x 100 shards = 500 DynamoDB queries per session. With 20 sessions
on the homepage, that is 10,000 DynamoDB queries per page load.

**Do this instead:** Compute once at session end, store as `reactionSummary` map on the session
item. Homepage reads the pre-computed value in a single attribute access.

### Anti-Pattern 3: Storing Participants as a List on the Session METADATA Item

**What people do:** Add `participants: string[]` to the session item and use
`list_append` to push userId on join.

**Why it's wrong:** Even though `list_append` itself does not conflict, the existing
`updateSessionStatus()` function uses an optimistic lock (`#version = :currentVersion`). Any
concurrent update to the session item will increment `version`, causing the next join to fail its
version check. Two participants joining within the same second will conflict.

**Do this instead:** Write each participant as a separate item with PK=`SESSION#{id}`,
SK=`PARTICIPANT#{userId}`. No version conflicts, and items are naturally idempotent on re-join.

### Anti-Pattern 4: Blocking Pool Release on Reaction Summary Computation

**What people do:** Make `recording-ended.ts` await the full reaction count computation before
releasing pool resources.

**Why it's wrong:** Pool resource release is time-critical — released channels and stages become
available for new sessions immediately. Blocking for 2-5 seconds on 500 DynamoDB queries delays
pool replenishment unnecessarily.

**Do this instead:** Wrap reaction summary computation in try/catch (best-effort, non-blocking),
and ensure pool release always runs in the `finally` block or sequentially after the try/catch.

### Anti-Pattern 5: Using a Separate DynamoDB Table for AI/Transcript Data

**What people do:** Create a new `vnl-transcripts` table or `vnl-ai-summaries` table to store
AI pipeline results.

**Why it's wrong:** This requires cross-table joins (not natively supported in DynamoDB), complicates
IAM, and adds CDK infrastructure. All AI/transcript fields fit on the session item (< 400KB),
and the access pattern is always "get everything about a session."

**Do this instead:** Add fields directly to the `SESSION#{id} / METADATA` item in the existing
`vnl-sessions` table.

---

## Scaling Considerations

| Scale | Architecture Adjustment |
|-------|------------------------|
| Current (< 1K sessions) | Scan-based queries for activity feed are acceptable; no GSI optimization needed |
| 1K-10K sessions | `getRecentActivity()` scan becomes expensive; add GSI3: PK=`ENTITY#SESSION`, SK=`{endedAt}` for efficient time-ordered session queries |
| 10K+ sessions | Transcribe costs scale linearly with audio hours; add session duration guard (skip transcription for sessions under 30s or over 4 hours) |
| High hangout concurrency | Separate PARTICIPANT items are already concurrency-safe; no hot-partition risk |

---

## Integration Points Reference (Quick Lookup)

| Task | File | Function/Location | Type |
|------|------|-------------------|------|
| Persist participant join | `backend/src/handlers/join-hangout.ts` | After `ivsRealTimeClient.send()`, line ~65 | Modify |
| Participant repo fn | `backend/src/repositories/session-repository.ts` | New `addHangoutParticipant()` | Add |
| Compute reaction summary | `backend/src/handlers/recording-ended.ts` | After `updateRecordingMetadata()`, line ~127 | Modify |
| Store reaction summary | `backend/src/repositories/session-repository.ts` | New `updateReactionSummary()` | Add |
| Trigger Transcribe | `backend/src/handlers/start-transcription.ts` | New handler | New file |
| Wire 2nd EB target | `infra/lib/stacks/session-stack.ts` | Add target to `RecordingEndRuleV2` | Modify |
| Transcribe complete rule | `infra/lib/stacks/session-stack.ts` | New `TranscribeJobCompleteRule` | Modify |
| Store transcript + Bedrock | `backend/src/handlers/store-transcript.ts` | New handler | New file |
| Transcript repo fns | `backend/src/repositories/session-repository.ts` | New `updateTranscriptFields()`, `updateAiSummary()` | Add |
| Activity feed endpoint | `backend/src/handlers/list-activity.ts` | New handler | New file |
| Wire /activity | `infra/lib/stacks/api-stack.ts` | Add GET /activity resource + handler | Modify |
| Activity repo fn | `backend/src/repositories/session-repository.ts` | New `getRecentActivity()` | Add |
| Extend domain model | `backend/src/domain/session.ts` | Add new fields to Session interface | Modify |
| Homepage layout | `web/src/pages/HomePage.tsx` | Split into slider + activity feed | Modify |
| Extend recording card | `web/src/features/replay/RecordingFeed.tsx` | Extend Recording interface, add AI/reaction display | Modify |
| Replay info panel | `web/src/features/replay/ReplayViewer.tsx` | Display aiSummary + reactionSummary | Modify |

---

## Sources

- Codebase direct analysis: `backend/src/handlers/`, `backend/src/repositories/`, `infra/lib/stacks/`, `web/src/` (HIGH confidence — read directly)
- Amazon Transcribe EventBridge events: source `aws.transcribe`, detail-type `Transcribe Job State Change` (HIGH confidence — official AWS documentation)
- Amazon Transcribe HLS input support: Transcribe accepts `.m3u8` as `MediaFormat` input (MEDIUM confidence — requires verification against current Transcribe docs before implementation)
- AWS Bedrock Claude model IDs: `anthropic.claude-3-haiku-20240307-v1:0` (MEDIUM confidence — model availability should be verified in the target deployment region before CDK wiring)
- DynamoDB single-table design: co-located items on shared PK for parent-child relationships (HIGH confidence — established AWS pattern)
- IVS recording S3 structure: `{prefix}/media/hls/master.m3u8` confirmed from existing `recording-ended.ts` (HIGH confidence — read from live code)

---

*Architecture research for: VideoNowAndLater v1.2 Activity Feed & Intelligence*
*Researched: 2026-03-05*
