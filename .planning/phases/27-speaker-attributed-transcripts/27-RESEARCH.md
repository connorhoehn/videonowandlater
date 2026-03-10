# Phase 27: Speaker-Attributed Transcripts - Research

**Researched:** 2026-03-10
**Domain:** AWS Transcribe speaker diarization, S3 JSON storage, React transcript UI
**Confidence:** HIGH

## Summary

Phase 27 modifies the existing transcription pipeline to request speaker diarization from AWS Transcribe, parses the per-word `speaker_label` field to produce speaker-turn segments, stores them as compact JSON in S3, and extends `TranscriptDisplay.tsx` to render a chat-bubble-style view when diarized data is present.

All decisions are locked in CONTEXT.md. Research confirms the approach is correct and well-supported by the existing codebase patterns. No new AWS services, no new CDK stacks, and no new npm packages are required. The session repository already has the `updateTranscriptStatus` pattern to follow for the new `diarizedTranscriptS3Path` field.

The one area of Claude's Discretion is: whether to implement the speaker-segments API as a separate endpoint (`GET /sessions/{sessionId}/speaker-segments`) or a query param on the existing transcript endpoint (`?diarized=true`). Based on API Gateway constraints (adding a sub-resource is cleaner than query-param routing in CDK) and the fact that the data lives in a different S3 file, a separate endpoint is the cleaner choice.

**Primary recommendation:** Use a dedicated `GET /sessions/{sessionId}/speaker-segments` endpoint backed by a new `get-speaker-segments.ts` handler — same structure as `get-transcript.ts` but reading `diarizedTranscriptS3Path` from the session and returning the parsed segments array.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Transcribe job parameters (start-transcribe.ts)**
- Add `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 }` to `StartTranscriptionJobCommand`
- `MaxSpeakerLabels: 2` — matches typical two-participant recording; Transcribe handles single-speaker sessions fine

**Speaker segment parsing (transcribe-completed.ts)**
- Read `speaker_label` directly from each word item in `results.items[N]` (the `alternatives[0].speaker_label` field on each pronunciation item)
- Do NOT rely on the top-level `speaker_labels.segments` array — word-level attribution is more granular and already present on each item
- Group consecutive words with the same speaker label into turn segments: `{ speaker: 'spk_0', startTime, endTime, text }`
- Normalize speaker IDs to display labels: `spk_0` → `"Speaker 1"`, `spk_1` → `"Speaker 2"` — no username mapping (composite audio makes it impossible)

**Storage (transcribe-completed.ts)**
- Store compact `speakerSegments` array as JSON in S3 at `${sessionId}/speaker-segments.json` (same transcription bucket)
- Write `diarizedTranscriptS3Path` pointer on the session DynamoDB record — NEVER store segment arrays inline in DynamoDB (400KB item limit risk on long recordings)
- Keep existing `transcriptS3Path` and `transcriptStatus = 'available'` flow unchanged

**Backward compatibility**
- Sessions without `diarizedTranscriptS3Path` continue to use existing `TranscriptDisplay.tsx` plain transcript path — no error, no missing state
- `get-transcript` backend handler: add a separate `GET /sessions/{sessionId}/speaker-segments` endpoint (or extend existing endpoint with a `?diarized=true` query param) to serve the S3 JSON

**Frontend display (TranscriptDisplay.tsx)**
- Extend the existing `TranscriptDisplay.tsx` component (do NOT create a parallel component)
- Add a `diarizedTranscriptS3Path` prop (optional) — when present, fetch and render speaker turns; when absent, render existing plain segment view
- Speaker turns displayed as alternating blocks: left-aligned "Speaker 1" (blue accent), right-aligned "Speaker 2" (gray accent) — chat-bubble style to make attribution instantly clear
- Each turn shows the speaker label badge + segment start timestamp above the text block
- Active-segment highlighting from `currentTime` continues to work the same way (highlight the turn block containing the current timestamp)

### Claude's Discretion
- Exact Tailwind classes for speaker bubble styling (color shades, border radius, padding)
- Whether to use a new API endpoint or query param for fetching speaker segments
- Error handling when S3 fetch of speaker segments fails (graceful fallback to plain transcript)

### Deferred Ideas (OUT OF SCOPE)
- Username mapping for speaker labels ("Connor" instead of "Speaker 1") — impossible from composite audio; future phase if per-track audio is added
- More than 2 speakers — MaxSpeakerLabels: 2 is fixed for v1.5; revisit if hangouts expand beyond pairs
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPKR-01 | Transcription jobs submitted with `ShowSpeakerLabels: true` and `MaxSpeakerLabels: 2` | `start-transcribe.ts` already calls `StartTranscriptionJobCommand` — add `Settings` field to `transcribeParams` object |
| SPKR-02 | Transcript post-processor extracts per-word speaker labels and groups into speaker-turn segments | `transcribe-completed.ts` already fetches and parses `transcript.json` from S3 — extend the parse logic using word-level `alternatives[0].speaker_label` |
| SPKR-03 | Speaker segments stored in S3 as compact JSON; pointer on session as `diarizedTranscriptS3Path` | `transcriptionBucket` env var already present; follow same S3 write pattern with `PutObjectCommand`; `updateTranscriptStatus` repository pattern to follow for new field |
| SPKR-04 | Speakers labeled "Speaker 1" / "Speaker 2" | Simple normalization map: `spk_0` → `"Speaker 1"`, `spk_1` → `"Speaker 2"` in `transcribe-completed.ts` |
| SPKR-05 | Replay and upload video player pages display attributed transcript as alternating speaker turns with timestamps | `TranscriptDisplay.tsx` extension with optional `diarizedTranscriptS3Path` prop; `ReplayViewer.tsx` passes it from session data |
| SPKR-06 | Existing sessions without `diarizedTranscriptS3Path` fall back gracefully to plain transcript | Optional prop pattern — when absent, existing `segments` state and render path runs unchanged |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@aws-sdk/client-transcribe` | Already installed | `StartTranscriptionJobCommand` with `Settings.ShowSpeakerLabels` | Project already uses this in `start-transcribe.ts` |
| `@aws-sdk/client-s3` | Already installed | `PutObjectCommand` to write `speaker-segments.json`, `GetObjectCommand` to read it back | Used in `transcribe-completed.ts` and `get-transcript.ts` already |
| `@aws-lambda-powertools/logger` | ^2.31.0, already installed | Structured logging with `pipelineStage` key | Phase 25 established this pattern; all pipeline handlers use it |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `aws-cdk-lib/aws-apigateway` | Already installed | Add `speaker-segments` sub-resource to `sessionIdResource` in `api-stack.ts` | Need one new API Gateway route and Lambda integration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate `get-speaker-segments.ts` handler | `?diarized=true` query param on existing `get-transcript` handler | Separate handler is cleaner: independent IAM, independent CDK resource naming, avoids query-param routing complexity in API Gateway |
| Word-level `speaker_label` on items | `speaker_labels.segments` top-level array | Word-level is more granular and already on each pronunciation item; top-level segments are coarser and less reliable for grouping |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure
No new directories. All changes are modifications to existing files plus two new files:

```
backend/src/handlers/
├── start-transcribe.ts          # MODIFY: add Settings.ShowSpeakerLabels
├── transcribe-completed.ts      # MODIFY: add speaker segment parsing + S3 write
├── get-speaker-segments.ts      # NEW: GET /sessions/{id}/speaker-segments handler
└── __tests__/
    ├── start-transcribe.test.ts         # MODIFY: add test for ShowSpeakerLabels param
    ├── transcribe-completed.test.ts     # MODIFY: add speaker segment parse tests
    └── get-speaker-segments.test.ts     # NEW: handler tests

backend/src/repositories/
└── session-repository.ts        # MODIFY: add updateDiarizedTranscriptPath function

backend/src/domain/
└── session.ts                   # MODIFY: add diarizedTranscriptS3Path?: string

infra/lib/stacks/
└── api-stack.ts                 # MODIFY: add speaker-segments route + Lambda

web/src/features/replay/
├── TranscriptDisplay.tsx        # MODIFY: add diarizedTranscriptS3Path prop + bubble render
└── ReplayViewer.tsx             # MODIFY: pass diarizedTranscriptS3Path from session
```

### Pattern 1: Settings Field on StartTranscriptionJobCommand
**What:** Add speaker diarization settings to existing Transcribe job submission
**When to use:** Always — for all new transcription jobs going forward

```typescript
// Source: start-transcribe.ts (existing pattern, extend transcribeParams)
const transcribeParams = {
  TranscriptionJobName: jobName,
  Media: { MediaFileUri: audioFileUri },
  OutputBucketName: process.env.TRANSCRIPTION_BUCKET!,
  OutputKey: `${sessionId}/transcript.json`,
  LanguageCode: 'en-US' as const,
  Settings: {
    ShowSpeakerLabels: true,
    MaxSpeakerLabels: 2,
  },
};
```

### Pattern 2: Word-Level Speaker Label Parsing
**What:** Group `results.items` pronunciation words by speaker into turn segments
**When to use:** In `transcribe-completed.ts` after the existing plainText extraction

```typescript
// Source: AWS Transcribe output format (HIGH confidence — documented API)
// Each item in results.items of type 'pronunciation' has:
// { type: 'pronunciation', start_time, end_time, alternatives: [{ content, speaker_label }] }
// Note: speaker_label may be undefined if diarization not requested or single-speaker

interface SpeakerSegment {
  speaker: string;        // 'Speaker 1' or 'Speaker 2'
  startTime: number;      // ms
  endTime: number;        // ms
  text: string;
}

// Grouping logic: flush segment when speaker changes OR gap > 1 second
const SPEAKER_LABEL_MAP: Record<string, string> = {
  spk_0: 'Speaker 1',
  spk_1: 'Speaker 2',
};
```

### Pattern 3: S3 Write in transcribe-completed.ts
**What:** Write speaker segments JSON to S3 at `${sessionId}/speaker-segments.json`
**When to use:** After successful parse — only write if segments array is non-empty

```typescript
// Source: existing transcribe-completed.ts uses S3Client + GetObjectCommand pattern
// Same pattern, use PutObjectCommand instead
import { PutObjectCommand } from '@aws-sdk/client-s3';

await s3Client.send(new PutObjectCommand({
  Bucket: transcriptionBucket,
  Key: `${sessionId}/speaker-segments.json`,
  Body: JSON.stringify(speakerSegments),
  ContentType: 'application/json',
}));
const diarizedS3Path = `${sessionId}/speaker-segments.json`;
// Then call repository: updateDiarizedTranscriptPath(tableName, sessionId, diarizedS3Path)
```

### Pattern 4: Repository Function (follow updateTranscriptStatus)
**What:** New `updateDiarizedTranscriptPath` function in session-repository.ts
**When to use:** Called from `transcribe-completed.ts` after S3 write succeeds

```typescript
// Source: session-repository.ts updateTranscriptStatus pattern (lines 479-525)
// Simple UpdateCommand with single field + version increment
export async function updateDiarizedTranscriptPath(
  tableName: string,
  sessionId: string,
  diarizedTranscriptS3Path: string
): Promise<void> {
  // UpdateCommand setting diarizedTranscriptS3Path + version increment
  // No conditional check needed — non-blocking, set-and-forget
}
```

### Pattern 5: New API Handler (follow get-transcript.ts)
**What:** `get-speaker-segments.ts` — reads session, fetches S3 JSON, returns array
**When to use:** Called from frontend `TranscriptDisplay.tsx` when `diarizedTranscriptS3Path` prop is present

```typescript
// Source: get-transcript.ts (exact structure to follow)
// 1. Extract sessionId from pathParameters
// 2. getSessionById() to check diarizedTranscriptS3Path exists
// 3. GetObjectCommand on transcriptionBucket with diarizedTranscriptS3Path as Key
// 4. Parse and return JSON: { sessionId, segments: SpeakerSegment[] }
// Return 404 with { error: 'Speaker segments not available' } if no diarizedTranscriptS3Path
```

### Pattern 6: Frontend Prop Extension (TranscriptDisplay.tsx)
**What:** Optional `diarizedTranscriptS3Path` prop that switches render mode
**When to use:** Always pass from ReplayViewer when session has the field

```typescript
// Source: TranscriptDisplay.tsx existing pattern (extend, do not rewrite)
interface TranscriptDisplayProps {
  sessionId: string;
  currentTime: number;
  authToken: string;
  diarizedTranscriptS3Path?: string;  // NEW: when present, fetch speaker-segments
}

// Render logic: if diarizedTranscriptS3Path present AND speakerSegments loaded → bubble view
// else → existing segment view unchanged
```

### Anti-Patterns to Avoid
- **Storing segments in DynamoDB:** Speaker segment arrays for long recordings can exceed 400KB item limit — always S3 only.
- **Blocking on diarization failure:** If speaker segments S3 write fails, log and continue — don't block `transcriptStatus = 'available'` or the AI summary EventBridge event.
- **Replacing TranscriptDisplay:** Creating a parallel component duplicates state management, auto-scroll, and auth fetch logic — extend the existing component.
- **Using `speaker_labels.segments` top-level:** More coarse than word-level `alternatives[0].speaker_label` on each item; less reliable grouping.
- **Using `transcriptS3Path` format inconsistency:** `get-transcript.ts` line 59 uses `session.transcriptS3Path` directly as `Key` for GetObjectCommand with the bucket separate. Store `diarizedTranscriptS3Path` as a plain S3 key (e.g., `${sessionId}/speaker-segments.json`), NOT as a full `s3://bucket/key` URI, to match the actual usage pattern in `get-transcript.ts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Speaker label normalization | Custom speaker identity resolution | Simple hardcoded map `spk_0→Speaker 1, spk_1→Speaker 2` | Composite audio cannot map to usernames; AWS diarization provides only `spk_0`, `spk_1`, etc. |
| S3 presigned URL for speaker segments | Presigned URL generation + client-side fetch | Backend proxy endpoint (same as transcript) | Keeps auth model consistent; S3 bucket is private; existing pattern is backend-proxied GET |
| Real-time diarization | Custom audio processing | AWS Transcribe speaker diarization | Edge cases in silence detection, overlapping speech, variable audio quality |

## Common Pitfalls

### Pitfall 1: S3 Path Format Inconsistency
**What goes wrong:** `transcribe-completed.ts` stores `transcriptS3Path` as a full `s3://bucket/key` URI, but `get-transcript.ts` uses it directly as `Key` in `GetObjectCommand` — this appears to be a latent bug in the existing code (the GetObjectCommand would fail with a key like `s3://bucket/sessionId/transcript.json`). However, the actual stored value may just be the key `sessionId/transcript.json` depending on what `updateTranscriptStatus` received.
**Why it happens:** The variable is named `s3Uri` but used as just a key.
**How to avoid:** Store `diarizedTranscriptS3Path` as a plain S3 key (`${sessionId}/speaker-segments.json`) — not a full URI. Match what `get-transcript.ts` expects: just the key portion used in `GetObjectCommand.Key`.
**Warning signs:** If `get-transcript.ts` is working in production, `transcriptS3Path` must already be stored as just the key (not full URI). Inspect the actual DynamoDB value before assuming.

### Pitfall 2: Missing S3 Write Permission on transcribeCompletedFn
**What goes wrong:** `transcribeCompletedFn` in `session-stack.ts` currently only has `transcriptionBucket.grantRead()` — no write permission. Speaker segments require a `PutObject` write.
**Why it happens:** The original `transcribe-completed.ts` only reads from S3 (fetches transcript.json written by Transcribe itself) — never writes.
**How to avoid:** Add `transcriptionBucket.grantWrite(transcribeCompletedFn)` (or `grantReadWrite`) in `session-stack.ts`. This is a required CDK change.
**Warning signs:** `AccessDenied` error on `PutObjectCommand` in CloudWatch logs.

### Pitfall 3: Speaker Label Absent on Single-Speaker Recordings
**What goes wrong:** When `MaxSpeakerLabels: 2` is set but only one speaker is detected, `speaker_label` may be `undefined` on some items, or all items may have `spk_0`. The grouping logic must handle `undefined` gracefully.
**Why it happens:** AWS Transcribe diarization is probabilistic — it won't force two labels if only one speaker is detected.
**How to avoid:** Guard with `if (!speakerLabel) continue` for pronunciation items missing `speaker_label`. If the result has only one distinct speaker, the output is still a valid (single-speaker) segments array — that's fine.
**Warning signs:** `speakerSegments` array with `undefined` speaker values causing frontend render errors.

### Pitfall 4: Active Segment Highlight Broken in Bubble Mode
**What goes wrong:** The existing `currentSegmentIndex` logic uses `segments.findIndex(seg => currentTime >= seg.startTime && currentTime <= seg.endTime)`. If speaker segments have different time boundaries than the original plain segments, the active-highlight logic needs to work against `speakerSegments` when in bubble mode.
**Why it happens:** The component maintains two data states (plain segments + speaker segments) and the useEffect watching `currentTime` needs to know which array to check.
**How to avoid:** When `speakerSegments` is loaded, run the `findIndex` against `speakerSegments` (not `segments`) in the active-segment useEffect. Use a separate `currentSpeakerSegmentIndex` state variable.
**Warning signs:** Active highlighting stops working or highlights wrong segment when diarized view is shown.

### Pitfall 5: CDK transcribeCompletedFn Already Has Log Group — Don't Duplicate
**What goes wrong:** `session-stack.ts` already has a named `TranscribeCompletedLogGroup`. Adding a duplicate in any new Lambda or re-declaring will cause a CDK naming conflict.
**Why it happens:** `logGroup` property on `NodejsFunction` creates an explicit log group construct — must use unique CDK logical IDs.
**How to avoid:** For `get-speaker-segments.ts` Lambda, follow the `get-transcript` pattern which has no explicit log group. The speaker-segments handler does not need the 30-day log group since it is not a pipeline handler.

### Pitfall 6: ReplayViewer Session Type Doesn't Include diarizedTranscriptS3Path
**What goes wrong:** The `Session` interface in `ReplayViewer.tsx` is a local inline type that doesn't include `diarizedTranscriptS3Path`. The fetch response will include it but TypeScript won't see it.
**Why it happens:** `ReplayViewer.tsx` has a local `Session` interface (line 24-39) separate from `backend/src/domain/session.ts`.
**How to avoid:** Add `diarizedTranscriptS3Path?: string` to the local `Session` interface in `ReplayViewer.tsx` AND to `backend/src/domain/session.ts`.

## Code Examples

### AWS Transcribe Speaker Diarization Output Format
```typescript
// Source: AWS Transcribe documentation (HIGH confidence)
// When ShowSpeakerLabels: true, pronunciation items have this shape:
{
  "type": "pronunciation",
  "start_time": "0.51",
  "end_time": "0.74",
  "alternatives": [
    {
      "confidence": "0.9996",
      "content": "Hello",
      "speaker_label": "spk_0"  // <-- present on each pronunciation item
    }
  ]
}

// Punctuation items do NOT have speaker_label:
{
  "type": "punctuation",
  "alternatives": [{ "confidence": "0.0", "content": "." }]
}

// top-level speaker_labels also present but coarser:
{
  "speaker_labels": {
    "segments": [...],  // DO NOT USE — use per-item speaker_label instead
    "speakers": 2
  }
}
```

### Speaker Segment Grouping Logic
```typescript
// Source: Based on CONTEXT.md locked decision + Transcribe format
interface SpeakerSegment {
  speaker: string;    // 'Speaker 1' or 'Speaker 2'
  startTime: number;  // ms
  endTime: number;    // ms
  text: string;
}

const SPEAKER_MAP: Record<string, string> = {
  spk_0: 'Speaker 1',
  spk_1: 'Speaker 2',
};

const speakerSegments: SpeakerSegment[] = [];
let currentSegment: SpeakerSegment | null = null;

for (const item of transcribeOutput.results.items) {
  if (item.type !== 'pronunciation') {
    // Punctuation: append to current segment text if present
    if (currentSegment && item.alternatives[0]?.content) {
      currentSegment.text += item.alternatives[0].content;
    }
    continue;
  }

  const alt = item.alternatives[0];
  const speakerLabel = alt?.speaker_label;
  if (!speakerLabel) continue;  // Skip if diarization absent on this word

  const speaker = SPEAKER_MAP[speakerLabel] ?? `Speaker ${speakerLabel}`;
  const startMs = parseFloat(item.start_time) * 1000;
  const endMs = parseFloat(item.end_time) * 1000;
  const word = alt.content;

  const speakerChanged = currentSegment && currentSegment.speaker !== speaker;
  const longPause = currentSegment && startMs - currentSegment.endTime > 1000;

  if (!currentSegment || speakerChanged || longPause) {
    if (currentSegment) speakerSegments.push(currentSegment);
    currentSegment = { speaker, startTime: startMs, endTime: endMs, text: word };
  } else {
    currentSegment.text += ' ' + word;
    currentSegment.endTime = endMs;
  }
}
if (currentSegment) speakerSegments.push(currentSegment);
```

### Frontend Bubble Render (TranscriptDisplay.tsx extension)
```typescript
// Source: CONTEXT.md locked decision + project Tailwind pattern
// Speaker 1 = left-aligned blue, Speaker 2 = right-aligned gray
// Recommended Tailwind classes (Claude's discretion):

// Speaker 1 (left):
// <div className="flex justify-start">
//   <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-blue-50 border border-blue-200 px-4 py-3">
//     <div className="text-xs font-semibold text-blue-600 mb-1">Speaker 1 · {formatTime(seg.startTime)}</div>
//     <div className="text-sm text-gray-800">{seg.text}</div>
//   </div>
// </div>

// Speaker 2 (right):
// <div className="flex justify-end">
//   <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gray-100 border border-gray-200 px-4 py-3">
//     <div className="text-xs font-semibold text-gray-500 mb-1 text-right">Speaker 2 · {formatTime(seg.startTime)}</div>
//     <div className="text-sm text-gray-800">{seg.text}</div>
//   </div>
// </div>

// Active highlight: add ring-2 ring-blue-400 or ring-gray-400 depending on speaker
```

### CDK Speaker Segments API Route (api-stack.ts)
```typescript
// Source: api-stack.ts existing transcript pattern (lines 303-331)
// Add after sessionTranscriptResource block:

const sessionSpeakerSegmentsResource = sessionIdResource.addResource('speaker-segments');

const getSpeakerSegmentsHandler = new NodejsFunction(this, 'GetSpeakerSegmentsHandler', {
  entry: path.join(__dirname, '../../../backend/src/handlers/get-speaker-segments.ts'),
  handler: 'handler',
  runtime: Runtime.NODEJS_20_X,
  environment: {
    TABLE_NAME: props.sessionsTable.tableName,
    TRANSCRIPTION_BUCKET: 'vnl-transcription-vnl-session',
  },
  depsLockFilePath: path.join(__dirname, '../../../package-lock.json'),
});

props.sessionsTable.grantReadData(getSpeakerSegmentsHandler);
getSpeakerSegmentsHandler.addToRolePolicy(new iam.PolicyStatement({
  actions: ['s3:GetObject'],
  resources: ['arn:aws:s3:::vnl-transcription-vnl-session/*'],
}));

sessionSpeakerSegmentsResource.addMethod('GET', new apigateway.LambdaIntegration(getSpeakerSegmentsHandler), {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

### CDK S3 Write Permission (session-stack.ts)
```typescript
// Source: session-stack.ts existing pattern
// Currently: transcriptionBucket.grantRead(transcribeCompletedFn)  (line 618)
// Change to:
transcriptionBucket.grantReadWrite(transcribeCompletedFn);
// This is the only CDK change needed in session-stack.ts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain transcript only | Speaker-attributed turns | Phase 27 | Replay shows who said what, not just what was said |
| `transcriptS3Path` pointer | Add `diarizedTranscriptS3Path` pointer | Phase 27 | Enables backward-compatible feature flag per session |

**Deprecated/outdated:**
- None — the existing transcript pipeline continues to work unchanged alongside diarization.

## Open Questions

1. **Is `transcriptS3Path` stored as full S3 URI or just key?**
   - What we know: `transcribe-completed.ts` constructs `s3Uri = 's3://bucket/key'` and passes to `updateTranscriptStatus`; `get-transcript.ts` uses `session.transcriptS3Path` as `Key` in `GetObjectCommand`
   - What's unclear: If the full URI is stored as key, `GetObjectCommand` with `Key: 's3://bucket/...'` would fail — either there's a bug that hasn't surfaced (maybe the handler isn't being tested live), OR the stored value is actually just the key portion
   - Recommendation: Before writing `diarizedTranscriptS3Path`, inspect an actual DynamoDB session item to see what format `transcriptS3Path` stores. Store `diarizedTranscriptS3Path` as plain key `${sessionId}/speaker-segments.json` regardless.

2. **Transcribe output field: `alternatives[0].speaker_label` vs `speaker_label` directly on item**
   - What we know: CONTEXT.md says to use `alternatives[0].speaker_label`; AWS docs show `speaker_label` is on each `alternatives` entry
   - What's unclear: Some AWS examples show `speaker_label` at the item level (not inside alternatives)
   - Recommendation: Access both paths defensively: `item.alternatives[0]?.speaker_label ?? (item as any).speaker_label`; use whichever is non-null.

## Sources

### Primary (HIGH confidence)
- Codebase: `backend/src/handlers/start-transcribe.ts` — exact `StartTranscriptionJobCommand` call site to modify
- Codebase: `backend/src/handlers/transcribe-completed.ts` — exact parse/store location for speaker segments
- Codebase: `backend/src/handlers/get-transcript.ts` — exact template for `get-speaker-segments.ts`
- Codebase: `backend/src/repositories/session-repository.ts` — `updateTranscriptStatus` pattern for new repository function
- Codebase: `infra/lib/stacks/session-stack.ts` — CDK location for adding `transcriptionBucket.grantReadWrite`
- Codebase: `infra/lib/stacks/api-stack.ts` lines 303-331 — CDK template for new speaker-segments route
- Codebase: `web/src/features/replay/TranscriptDisplay.tsx` — component to extend with bubble view
- Codebase: `web/src/features/replay/ReplayViewer.tsx` — call site to pass `diarizedTranscriptS3Path`
- Codebase: `backend/src/domain/session.ts` — Session type to extend with `diarizedTranscriptS3Path`

### Secondary (MEDIUM confidence)
- AWS Transcribe diarization output format — confirmed from multiple Transcribe documentation examples that `speaker_label` appears on `alternatives[0]` for each pronunciation item when `ShowSpeakerLabels: true`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, no new dependencies
- Architecture: HIGH — all patterns traced directly to existing working code in the project
- Pitfalls: HIGH for CDK write permission and path format (directly observable from code); MEDIUM for speaker_label field location (needs live test verification)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (AWS Transcribe API is stable; internal patterns don't change)
