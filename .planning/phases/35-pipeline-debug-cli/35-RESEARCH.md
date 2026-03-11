# Phase 35: Pipeline Debug CLI - Research

**Researched:** 2026-03-11
**Domain:** Node.js CLI scripts, AWS SDK v3, DynamoDB GetItem, EventBridge PutEvents
**Confidence:** HIGH

## Summary

Phase 35 delivers two standalone developer CLI scripts in a new `tools/` directory at the
project root. Both scripts are plain CommonJS `.js` files (no TypeScript compilation step, no
Lambda runtime requirement) that run directly with `node`. The existing `scripts/` directory
already contains multiple similar CJS scripts (`reprocess-session.js`, `generate-ai-summary.js`,
`trigger-transcription.js`) that follow the exact same pattern: require AWS SDK v3 clients, use
`DynamoDBDocumentClient.from()`, accept CLI args via `process.argv`, and print human-readable
output via `console.log`.

**debug-pipeline.js** performs a single DynamoDB `GetCommand` on `PK=SESSION#<id>, SK=METADATA`
against the `vnl-sessions` table and pretty-prints every pipeline-relevant field. **replay-pipeline.js**
publishes one targeted EventBridge `PutEventsCommand` to the default bus using the specific
Source/DetailType/Detail that the CDK rule for each stage expects. Both tools must use the AWS
SDK v3 default credential chain and respect `AWS_REGION` / default to `us-east-1`.

The project has AWS SDK v3 installed at the workspace root (`package.json` workspaces). Both
scripts can require clients from the project `node_modules` since they run in the repo context.
No new npm dependencies are needed.

**Primary recommendation:** Write both tools as plain CommonJS `.js` files in `tools/`. Use
`process.argv` for arg parsing (no third-party arg-parser needed given the small surface). Use
`DynamoDBDocumentClient` for debug and `EventBridgeClient` for replay. Hard-code table name as
`vnl-sessions` (matches the literal in `session-stack.ts`) with an optional `--table` override.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEVEX-01 | `tools/debug-pipeline.js --sessionId <id>` prints all pipeline fields from DynamoDB | GetCommand on `PK=SESSION#<id>, SK=METADATA`; fields catalogued in Session domain model |
| DEVEX-02 | `tools/replay-pipeline.js --sessionId <id> --from <stage>` publishes correct EventBridge event for stages: recording-ended, mediaconvert, transcribe, summary | EventBridge sources/detailTypes and detail shapes documented below per stage |
| DEVEX-03 | Both tools use AWS SDK v3 credential chain; `AWS_REGION` or `us-east-1` default | `DynamoDBClient` / `EventBridgeClient` with no explicit credentials constructor arg — SDK resolves chain automatically |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-dynamodb` | ^3.1000.0 (already installed) | DynamoDB low-level client | Required by DynamoDBDocumentClient |
| `@aws-sdk/lib-dynamodb` | ^3.1000.0 (already installed) | DynamoDBDocumentClient for marshalling | Already used in all backend handlers |
| `@aws-sdk/client-eventbridge` | ^3.1003.0 (already installed) | EventBridge PutEvents | Already used in scan-stuck-sessions.ts, transcribe-completed.ts |

### No New Dependencies
All required AWS SDK v3 packages are already present in `backend/package.json` and hoisted to
the workspace root. Both scripts can `require('@aws-sdk/...')` without adding anything to
`package.json`.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure
```
tools/
├── debug-pipeline.js      # DEVEX-01: DynamoDB read + pretty-print
└── replay-pipeline.js     # DEVEX-02: EventBridge PutEvents
```

These live at the repo root alongside `scripts/`, not inside `backend/src/`.

### Pattern 1: CJS Script with DynamoDBDocumentClient
**What:** Require AWS SDK v3 CJS clients, call `DynamoDBDocumentClient.from(new DynamoDBClient(...))`, send `GetCommand`.
**When to use:** For debug-pipeline.js.

```javascript
// Source: scripts/reprocess-session.js (existing project pattern)
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const region = process.env.AWS_REGION ?? 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const result = await docClient.send(new GetCommand({
  TableName: 'vnl-sessions',
  Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
}));
if (!result.Item) {
  console.error(`Session not found: ${sessionId}`);
  process.exit(1);
}
```

### Pattern 2: EventBridgeClient PutEvents
**What:** Publish to the default event bus using `EventBridgeClient.send(new PutEventsCommand(...))`.
**When to use:** For replay-pipeline.js.

```javascript
// Source: backend/src/handlers/scan-stuck-sessions.ts (existing project pattern)
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const region = process.env.AWS_REGION ?? 'us-east-1';
const ebClient = new EventBridgeClient({ region });
await ebClient.send(new PutEventsCommand({
  Entries: [{ Source, DetailType, Detail: JSON.stringify(detail) }],
}));
```

### Pattern 3: Argument Parsing via process.argv
**What:** Parse named `--flag value` pairs from `process.argv.slice(2)`.
**When to use:** Both tools. No third-party parser needed for two flags each.

```javascript
// Source: project scripts pattern (no arg-parser library used)
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}
```

### Anti-Patterns to Avoid
- **TypeScript + tsc compilation:** These are dev tools. No build step. Plain CJS `.js` only.
- **ESM syntax (`import`/`export`):** Node.js CJS is what the existing `scripts/*.js` use. Stay consistent.
- **Hardcoding credentials:** Never put AWS keys in the script. SDK v3 credential chain handles env vars, `~/.aws/credentials`, and IAM roles automatically when no credentials are provided to the client constructor.
- **Using `marshall`/`unmarshall` manually:** `DynamoDBDocumentClient` handles marshalling automatically.

---

## DynamoDB Field Inventory

The complete set of pipeline-relevant fields the `debug-pipeline.js` report should display,
sourced from `backend/src/domain/session.ts` and `session-repository.ts`:

### Session Identity
| Field | Description |
|-------|-------------|
| `sessionId` | UUID |
| `userId` | cognito:username |
| `sessionType` | `BROADCAST` / `HANGOUT` / `UPLOAD` |
| `status` | `creating` / `live` / `ending` / `ended` |
| `createdAt` | ISO timestamp |
| `startedAt` | ISO timestamp (optional) |
| `endedAt` | ISO timestamp (optional) |
| `version` | optimistic-lock counter |

### Recording
| Field | Description |
|-------|-------------|
| `recordingStatus` | `pending` / `processing` / `available` / `failed` |
| `recordingHlsUrl` | CloudFront HLS URL |
| `recordingS3Path` | Raw S3 key prefix |
| `recordingDuration` | Duration in ms |
| `thumbnailUrl` | CloudFront thumbnail URL |

### Pipeline State (key fields for DEVEX-01)
| Field | Description |
|-------|-------------|
| `mediaconvertJobId` | MediaConvert job ID (set by recording-ended when job submitted) |
| `transcriptStatus` | `null` / `pending` / `processing` / `available` / `failed` |
| `transcriptS3Path` | S3 key for transcript.json |
| `diarizedTranscriptS3Path` | S3 key for speaker-segments.json |
| `transcript` | Plain text transcript (truncated for display) |
| `aiSummaryStatus` | `pending` / `available` / `failed` |
| `aiSummary` | AI-generated summary text (truncated for display) |
| `recoveryAttemptCount` | Number of recovery attempts (0–3) |

### Upload-specific
| Field | Description |
|-------|-------------|
| `uploadStatus` | `pending` / `processing` / `converting` / `available` / `failed` |
| `convertStatus` | `pending` / `processing` / `available` / `failed` |
| `mediaConvertJobName` | Upload pipeline job name (different from `mediaconvertJobId`) |

**Note:** Two distinct MediaConvert tracking fields exist:
- `mediaconvertJobId` — used by the transcription pipeline (broadcast/hangout), set in `recording-ended.ts`
- `mediaConvertJobName` — used by the upload pipeline, set in `on-mediaconvert-complete.ts`

The debug tool should display both and label them clearly.

---

## EventBridge Event Payloads for replay-pipeline.js

The CDK stack defines these EventBridge rules. replay-pipeline.js must emit events that satisfy
each rule's event pattern. All four stages target the default EventBridge bus.

### Stage: `recording-ended`
**What it resumes:** Submits MediaConvert job for a stuck broadcast/hangout session.
**Rule:** `RecordingRecoveryRule` in session-stack.ts.
**Event pattern match:**
```json
{ "source": ["custom.vnl"], "detail-type": ["Recording Recovery"] }
```
**Event to publish:**
```javascript
// Source: backend/src/handlers/scan-stuck-sessions.ts — recoverSession()
{
  Source: 'custom.vnl',
  DetailType: 'Recording Recovery',
  Detail: JSON.stringify({
    sessionId,
    recoveryAttempt: true,
    recoveryAttemptCount: 1,         // CLI can use 0 or 1 — not critical for dev use
    recordingHlsUrl: session.recordingHlsUrl,
    recordingS3Path: session.recordingS3Path,
  }),
}
```
**Consumed by:** `recording-ended.ts` via the SQS queue (routes recovery path by checking `event.detail.recoveryAttempt === true`).
**CLI must:** fetch session from DynamoDB first to populate `recordingHlsUrl` and `recordingS3Path`.

### Stage: `mediaconvert`
**What it resumes:** Simulates MediaConvert COMPLETE event → triggers transcode-completed.ts → starts Transcribe job.
**Rule:** `TranscodeCompletedRule`.
**Event pattern match:**
```json
{
  "source": ["aws.mediaconvert"],
  "detail-type": ["MediaConvert Job State Change"],
  "detail": { "status": ["COMPLETE", "ERROR", "CANCELED"], "userMetadata": { "phase": ["19-transcription"] } }
}
```
**Event to publish:**
```javascript
// Source: transcode-completed.ts handler — reads detail.jobId, detail.status, detail.userMetadata
{
  Source: 'aws.mediaconvert',
  DetailType: 'MediaConvert Job State Change',
  Detail: JSON.stringify({
    status: 'COMPLETE',
    jobId: session.mediaconvertJobId ?? 'manual-replay',
    userMetadata: { sessionId, phase: '19-transcription' },
    outputGroupDetails: [{
      outputDetails: [{
        outputFilePaths: [
          `s3://vnl-transcription-vnl-session/${sessionId}/${sessionId}recording.mp4`
        ],
      }],
    }],
  }),
}
```
**Important:** `outputFilePaths` must end with `.mp4` — `transcode-completed.ts` does `.find(p => p.endsWith('.mp4'))`. The actual path pattern from MediaConvert is `s3://<transcriptionBucket>/<sessionId>/<sessionId>recording.mp4`.

### Stage: `transcribe`
**What it resumes:** Simulates Transcribe COMPLETED event → triggers transcribe-completed.ts → fetches transcript from S3, publishes "Transcript Stored".
**Rule:** `TranscribeCompletedRule`.
**Event pattern match:**
```json
{
  "source": ["aws.transcribe"],
  "detail-type": ["Transcribe Job State Change"],
  "detail": { "TranscriptionJobStatus": ["COMPLETED", "FAILED"] }
}
```
**Event to publish:**
```javascript
// Source: transcribe-completed.ts handler — reads detail.TranscriptionJobName + status
// Job name format: vnl-{sessionId}-{epochMs} (required for sessionId extraction)
{
  Source: 'aws.transcribe',
  DetailType: 'Transcribe Job State Change',
  Detail: JSON.stringify({
    TranscriptionJobStatus: 'COMPLETED',
    TranscriptionJobName: `vnl-${sessionId}-${Date.now()}`,
  }),
}
```
**Important:** `transcribe-completed.ts` parses sessionId from job name via `/^vnl-([a-z0-9-]+)-\d+$/`. The CLI must construct the job name in this format.
**Prerequisite:** Transcript JSON must already exist at `s3://vnl-transcription-vnl-session/<sessionId>/transcript.json`, otherwise the handler will fail on S3 GetObject.

### Stage: `summary`
**What it resumes:** Publishes "Transcript Stored" → triggers store-summary.ts → calls Bedrock, stores AI summary.
**Rule:** `TranscriptStoreRule`.
**Event pattern match:**
```json
{ "source": ["custom.vnl"], "detail-type": ["Transcript Stored"] }
```
**Event to publish:**
```javascript
// Source: transcribe-completed.ts — the event it emits on success
{
  Source: 'custom.vnl',
  DetailType: 'Transcript Stored',
  Detail: JSON.stringify({
    sessionId,
    transcriptS3Uri: `s3://vnl-transcription-vnl-session/${sessionId}/transcript.json`,
  }),
}
```
**CLI must:** The transcriptS3Uri can be constructed from the known bucket pattern, or read from session's `transcriptS3Path` field (which stores `s3://bucket/sessionId/transcript.json`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DynamoDB item marshalling | Manual AttributeValue parsing | `DynamoDBDocumentClient` | Handles all type conversions automatically |
| AWS credential resolution | Read `~/.aws/credentials` manually | SDK v3 default credential chain | Already correct per DEVEX-03 requirement; handled automatically when no credentials passed to client constructor |
| CLI arg parsing library | `yargs`, `commander`, `minimist` | `process.argv.slice(2)` loop | Two flags per script; no third-party dependency justified |

---

## Common Pitfalls

### Pitfall 1: EventBridge Source Must Match Rule Pattern Exactly
**What goes wrong:** Publishing with wrong `Source` or `DetailType` means the rule doesn't match and the event is silently dropped.
**Why it happens:** EventBridge pattern matching is case-sensitive. `'Custom.VNL'` does not match `'custom.vnl'`.
**How to avoid:** Copy Source/DetailType verbatim from the CDK rule definition. See event payloads above — all are verified against session-stack.ts.
**Warning signs:** `PutEvents` returns 200 with `FailedEntryCount: 0` but the downstream Lambda never fires.

### Pitfall 2: transcribe Stage Requires Transcript File to Already Exist in S3
**What goes wrong:** replay `--from transcribe` fires the Transcribe state-change event, but `transcribe-completed.ts` tries to fetch `transcript.json` from S3 and fails with NoSuchKey.
**Why it happens:** This stage replays the *completion* event, not the job submission. The transcript file must have been produced by a real Transcribe job.
**How to avoid:** Document this prerequisite in the tool's help text. The tool should print a warning before publishing the event.
**Warning signs:** CloudWatch logs for `transcribe-completed` show S3 NoSuchKey error.

### Pitfall 3: mediaconvert Stage MP4 Path Must End with .mp4
**What goes wrong:** `transcode-completed.ts` does `outputPaths.find(p => p.endsWith('.mp4'))` and returns `undefined` if the path doesn't match.
**Why it happens:** MediaConvert appends the output `NameModifier` (`recording`) plus the container extension. The real path is `<sessionId>recording.mp4`.
**How to avoid:** Use the path pattern `s3://<transcriptionBucket>/<sessionId>/<sessionId>recording.mp4` exactly.

### Pitfall 4: Two Different MediaConvert Job Fields
**What goes wrong:** Confusing `mediaconvertJobId` (broadcast transcription pipeline) with `mediaConvertJobName` (upload pipeline).
**Why it happens:** These were added in different phases for different pipelines and have slightly different casing.
**How to avoid:** Display both in debug output with clear labels. When constructing the mediaconvert replay event, use `session.mediaconvertJobId` (not `mediaConvertJobName`).

### Pitfall 5: Recording-Ended Recovery Requires Session to Have recordingS3Path
**What goes wrong:** The recovery path in `recording-ended.ts` checks `recoverySession.recordingS3Path` and exits with a warning if missing.
**Why it happens:** `recordingS3Path` is only set on sessions that have had their recording metadata updated.
**How to avoid:** The replay tool should check for `recordingS3Path` before publishing the recovery event and print a clear error if absent.

### Pitfall 6: SQS-Buffered Delivery Adds Latency
**What goes wrong:** After `replay-pipeline.js` publishes an event, the downstream Lambda doesn't execute immediately — it goes through the SQS queue (Phase 31 migration).
**Why it happens:** All 5 pipeline handlers now trigger via EventBridge → SQS → Lambda. The SQS poll interval is up to 20 seconds.
**How to avoid:** Print a note in the tool output: "Event published. Lambda execution may take up to 20 seconds due to SQS buffering."

---

## Code Examples

### debug-pipeline.js — Core Read Pattern
```javascript
// Source: adapted from scripts/reprocess-session.js
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const region = process.env.AWS_REGION ?? 'us-east-1';
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

const result = await docClient.send(new GetCommand({
  TableName: 'vnl-sessions',
  Key: { PK: `SESSION#${sessionId}`, SK: 'METADATA' },
}));
if (!result.Item) {
  console.error(`ERROR: Session not found: ${sessionId}`);
  process.exit(1);
}
const session = result.Item;
```

### replay-pipeline.js — EventBridge Publish Pattern
```javascript
// Source: adapted from backend/src/handlers/scan-stuck-sessions.ts
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const region = process.env.AWS_REGION ?? 'us-east-1';
const ebClient = new EventBridgeClient({ region });
const response = await ebClient.send(new PutEventsCommand({
  Entries: [{ Source, DetailType, Detail: JSON.stringify(detail) }],
}));
if (response.FailedEntryCount > 0) {
  console.error('ERROR: EventBridge rejected the event:', response.Entries[0].ErrorMessage);
  process.exit(1);
}
console.log('Event published successfully.');
```

### Argument Parsing Pattern (Both Tools)
```javascript
// Source: project convention from scripts/*.js
function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventBridge → Lambda direct invocation | EventBridge → SQS → Lambda | Phase 31 (v1.6) | replay-pipeline.js events go through SQS queue; up to 20s delivery latency |
| `recording-ended.ts` recovery via SNS requeue | EventBridge `Recording Recovery` event with `recoveryAttempt: true` | Phase 26 (v1.5) | replay `--from recording-ended` must use the recovery event format |

---

## Open Questions

1. **transcriptionBucket name at runtime**
   - What we know: The bucket name is `vnl-transcription-${stackName.toLowerCase()}` where stackName is `VNL-Session`. Existing scripts hardcode `vnl-transcription-vnl-session`.
   - What's unclear: Whether the table name / bucket names are ever customized for different environments.
   - Recommendation: Hardcode `vnl-sessions` and `vnl-transcription-vnl-session` with an optional `--table` / `--bucket` override, matching the pattern of existing scripts.

2. **Should replay-pipeline.js increment `recoveryAttemptCount`?**
   - What we know: `scan-stuck-sessions.ts` atomically increments the counter before publishing. The counter caps at 3.
   - What's unclear: Whether a developer using the CLI tool wants their manual replay counted against the cap.
   - Recommendation: Do NOT increment the counter in the CLI tool. The tool is for developer use only; it should not consume recovery slots. Skip the DynamoDB UpdateCommand and just publish the event.

---

## Sources

### Primary (HIGH confidence)
- `backend/src/handlers/recording-ended.ts` — recovery event format and path (`recoveryAttempt === true` branch)
- `backend/src/handlers/transcode-completed.ts` — mediaconvert stage event shape and MP4 path matching
- `backend/src/handlers/transcribe-completed.ts` — transcribe stage event shape and job name regex
- `backend/src/handlers/store-summary.ts` — summary stage event shape (`Transcript Stored`)
- `backend/src/handlers/scan-stuck-sessions.ts` — canonical recovery PutEvents shape
- `infra/lib/stacks/session-stack.ts` — CDK rule patterns: Sources, DetailTypes, and SQS queue targets
- `backend/src/domain/session.ts` — complete Session field inventory
- `scripts/reprocess-session.js` — CJS script pattern for DynamoDBDocumentClient usage

### Secondary (MEDIUM confidence)
- `backend/package.json` — AWS SDK v3 package versions (all clients already installed)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; no new dependencies
- Architecture: HIGH — EventBridge event payloads verified directly against handler source and CDK rule patterns
- Pitfalls: HIGH — verified against actual handler code paths (mp4 path matching, job name regex, S3 prerequisite)

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain; AWS SDK v3 APIs change slowly)
