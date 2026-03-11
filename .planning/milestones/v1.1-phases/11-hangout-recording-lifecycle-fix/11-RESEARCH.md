# Phase 11: Hangout Recording Lifecycle Fix - Research

**Researched:** 2026-03-03
**Domain:** AWS IVS RealTime Stage recording EventBridge events, Lambda handler field access, CDK EventBridge rule gaps
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HANG-14 | Hangout sessions record via server-side composition to S3 | Fix identified: recording-ended.ts:31 reads `event.detail.channel_name` which is undefined for IVS Participant Recording State Change events; Stage ARN is in `event.resources[0]`; PLUS a missing CDK EventBridge rule for `"IVS Participant Recording State Change"` detail-type |
| HANG-15 | Composite recording metadata processed via EventBridge (same pattern as broadcasts) | Blocked by HANG-14: once ARN detection and EventBridge rule are correct, `recordingStatus='available'` will be written by the existing `updateRecordingMetadata` path |
| HANG-16 | Hangout recordings appear in home feed alongside broadcast recordings | `RecordingFeed.tsx` and `getRecentRecordings` already handle sessionType='HANGOUT'; blocked only by HANG-14/15 not writing recording metadata |
</phase_requirements>

---

## Summary

Phase 11 addresses three related requirements all blocked by a single root-cause issue with a secondary infrastructure gap.

**Root cause (HANG-14):** The `recording-ended.ts` handler reads `event.detail.channel_name` at line 31 to extract the resource ARN. For IVS Low-Latency broadcast events (`"IVS Recording State Change"`), `channel_name` coincidentally contains an ARN value (this is a quirk — the IVS docs describe it as a human-readable name but the project originally put an ARN there). For IVS RealTime Stage recording events (`"IVS Participant Recording State Change"`), the `detail` object has NO `channel_name` field at all. The Stage ARN lives in `event.resources[0]`. The ARN detection logic that follows (`arnParts.split(':')`) then fails on `undefined`, causing the handler to classify it as "unknown resource type" and return early — hangout recording metadata is never written.

**Secondary infrastructure gap (HANG-14):** There is NO EventBridge rule in `session-stack.ts` for the `"IVS Participant Recording State Change"` detail-type. The existing `RecordingEndRuleV2` only captures `"IVS Recording State Change"` (broadcast events). Stage recording-end events are never routed to the `recordingEndedFn` Lambda at all. Both the CDK rule AND the handler logic must be fixed.

**S3 structure difference (HANG-14/15):** IVS RealTime participant recordings produce `multivariant.m3u8` as the HLS master playlist (not `master.m3u8`) and store thumbnails at `latest_thumbnail/high/thumb.jpg` (not `thumb-0.jpg`). The current handler builds URLs using broadcast-only assumptions — these must be corrected for Stage event paths.

**Downstream effects (HANG-15/16):** Once the EventBridge rule routes Stage events to the Lambda AND the ARN detection reads `resources[0]`, the existing `updateRecordingMetadata` path will set `recordingStatus='available'`. The home feed (`getRecentRecordings`) queries for `recordingStatus = 'available'` — once the metadata is written correctly, hangout recordings automatically appear. `RecordingFeed.tsx` already renders hangout sessions with a purple "Hangout" badge and routes them to `/hangout/{sessionId}`.

**Primary recommendation:** Add one CDK EventBridge rule for `"IVS Participant Recording State Change"`, fix `recording-ended.ts` to read `event.resources[0]` for Stage events, and update the HLS/thumbnail URL construction to use the Stage recording S3 structure. Update tests to use correct Stage event shapes.

---

## Standard Stack

This phase makes no new library introductions. All relevant stack is already deployed.

### Core (Existing — no changes)
| Component | Version | Purpose |
|-----------|---------|---------|
| AWS CDK (`aws-cdk-lib`) | Existing | Add new EventBridge rule for Stage recording events |
| AWS Lambda (Node.js 20.x) | Existing | Fix field access in recording-ended handler |
| Jest + ts-jest | Existing | Update recording-ended tests with correct Stage event shapes |
| `@aws-sdk/client-ivs-realtime` | Existing | Already used in replenish-pool.ts / join-hangout.ts |

### No New Installations Required
All dependencies are present. No `npm install` steps needed.

---

## Architecture Patterns

### Pattern 1: IVS Participant Recording State Change — EventBridge Rule (Missing)

The CDK stack currently has two EventBridge rules for broadcast lifecycle events but NONE for Stage recording events. A third rule is needed:

```typescript
// Source: Official AWS IVS RealTime EventBridge docs
// Add to session-stack.ts alongside recordingEndRule

const stageRecordingEndRule = new events.Rule(this, 'StageRecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Participant Recording State Change'],
    detail: {
      event_name: ['Recording End'],
    },
  },
  description: 'Capture IVS RealTime participant recording end events',
});
stageRecordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn));
```

**Why `event_name` not `recording_status`:** The `RecordingEndRuleV2` already uses `event_name` for the filter (the lesson learned from the legacy-rule tech debt). `recording_status` is not a field in the Participant Recording event; `event_name` is.

### Pattern 2: Stage ARN Extraction — Use `event.resources[0]`

The `"IVS Participant Recording State Change"` event puts the Stage ARN in `resources[0]`, not in `detail`:

```json
// Source: AWS IVS RealTime EventBridge docs (verified)
{
  "detail-type": "IVS Participant Recording State Change",
  "source": "aws.ivs",
  "resources": ["arn:aws:ivs:us-east-1:123456789012:stage/AbCdef1G2hij"],
  "detail": {
    "session_id": "st-ZyXwvu1T2s",
    "event_name": "Recording End",
    "participant_id": "xYz1c2d3e4f",
    "recording_s3_bucket_name": "bucket-name",
    "recording_s3_key_prefix": "<stage_id>/<session_id>/<participant_id>/2024-01-01T12-00-55Z",
    "recording_duration_ms": 547327
  }
}
```

The existing broadcast event (`"IVS Recording State Change"`) puts the channel ARN in `resources[0]` as well, though the handler currently reads `event.detail.channel_name` instead. The fix should unify both event types to use `event.resources[0]`:

```typescript
// BEFORE (broken — line 31 of recording-ended.ts):
const resourceArn = event.detail.channel_name;

// AFTER (correct — works for both broadcast and Stage events):
const resourceArn = event.resources[0];
```

**Why this is safe for broadcast events:** IVS Low-Latency Recording State Change events also put the Channel ARN in `resources[0]`. The `channel_name` field in broadcast events is the human-readable channel name, not the ARN. Reading `resources[0]` is both correct AND more semantically appropriate for both event types.

### Pattern 3: Stage Recording S3 Structure (Different from Broadcast)

IVS RealTime individual participant recordings have a different S3 structure than IVS Low-Latency broadcast recordings:

**Broadcast recording S3 structure** (IVS Low-Latency):
```
<recording_s3_key_prefix>/
  master.m3u8
  thumb-0.jpg
  (rendition folders)
```

**Stage/Participant recording S3 structure** (IVS RealTime):
```
<recording_s3_key_prefix>/
  events/
    recording-started.json
    recording-ended.json
  media/
    hls/
      multivariant.m3u8      ← master playlist (NOT master.m3u8)
      high/
        playlist.m3u8
        1.mp4, 2.mp4, ...
    thumbnails/
      high/
        1.jpg, 2.jpg, ...
    latest_thumbnail/
      high/
        thumb.jpg            ← latest thumbnail (NOT thumb-0.jpg)
```

The handler must detect the event type and build the correct URL:

```typescript
// For broadcast events ("IVS Recording State Change"):
const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;

// For Stage participant events ("IVS Participant Recording State Change"):
const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;
```

### Pattern 4: Unified Handler with Event Type Dispatch

The cleanest implementation wraps the existing handler to handle both event shapes:

```typescript
// recording-ended.ts — unified handler

// Two separate TypeScript interfaces for each event shape:
interface BroadcastRecordingEndDetail {
  channel_name: string;     // Human-readable name (not used for ARN)
  stream_id: string;
  recording_status: 'Recording End' | 'Recording End Failure';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

interface StageParticipantRecordingEndDetail {
  session_id: string;
  event_name: 'Recording End';
  participant_id: string;
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

// The handler accepts the union type using `any` for the detail:
export const handler = async (
  event: EventBridgeEvent<string, any>
): Promise<void> => {
  // Determine resource ARN — same field for both event types:
  const resourceArn = event.resources[0];

  // Detect resource type from ARN — existing logic, unchanged:
  const arnParts = resourceArn.split(':');
  const resourcePart = arnParts[arnParts.length - 1]; // "channel/id" or "stage/id"
  const resourceType = resourcePart.split('/')[0];    // "channel" or "stage"

  // Determine recording status — different field names per event type:
  const isFailure = event['detail-type'] === 'IVS Recording State Change'
    ? event.detail.recording_status === 'Recording End Failure'
    : false; // Stage participant events don't have a failure variant in Recording End
  const finalStatus = isFailure ? 'failed' : 'available';

  // Build HLS URL and thumbnail — different S3 structure per resource type:
  const recordingS3KeyPrefix = event.detail.recording_s3_key_prefix;
  let recordingHlsUrl: string;
  let thumbnailUrl: string;

  if (resourceType === 'channel') {
    recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
    thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;
  } else {
    // Stage/participant recording:
    recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
    thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;
  }
  // ... rest of handler unchanged
};
```

### Pattern 5: Test Event Shapes — Use Correct Field Locations

The existing tests in `recording-ended.test.ts` are incorrect: they pass an ARN in `event.detail.channel_name` and leave `event.resources` as an empty array `[]`. After the fix, tests must:
1. Put ARNs in `event.resources[0]`
2. Use correct detail-type strings (`"IVS Recording State Change"` vs `"IVS Participant Recording State Change"`)
3. Omit `channel_name` for Stage events (use `session_id`, `participant_id` instead)

```typescript
// Correct Stage participant recording test event shape:
const stageEvent: EventBridgeEvent<'IVS Participant Recording State Change', StageParticipantRecordingEndDetail> = {
  'version': '0',
  'id': 'test-event-id',
  'detail-type': 'IVS Participant Recording State Change',
  'source': 'aws.ivs',
  'account': '123456789012',
  'time': '2024-01-01T00:05:00Z',
  'region': 'us-east-1',
  'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],  // ARN HERE
  'detail': {
    session_id: 'st-test123',
    event_name: 'Recording End',
    participant_id: 'participant-abc',
    recording_s3_bucket_name: 'my-recordings',
    recording_s3_key_prefix: 'stage-id/session-id/participant-id/2024-01-01T00-00-00Z',
    recording_duration_ms: 450000,
  },
};

// Correct broadcast recording test event shape (fix existing tests):
const broadcastEvent: EventBridgeEvent<'IVS Recording State Change', BroadcastRecordingEndDetail> = {
  // ...
  'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],  // ARN HERE
  'detail': {
    channel_name: 'My Channel Name',  // Human-readable NAME, not ARN
    stream_id: 'st_test_stream_id',
    recording_status: 'Recording End',
    recording_s3_bucket_name: 'my-recordings',
    recording_s3_key_prefix: 'prefix/',
    recording_duration_ms: 300000,
  },
};
```

### Anti-Patterns to Avoid

- **Do NOT read `event.detail.channel_name` as the ARN.** It is a human-readable name for broadcasts and absent entirely for Stage events. Always use `event.resources[0]`.
- **Do NOT assume `master.m3u8` for Stage recordings.** Stage participant recordings produce `media/hls/multivariant.m3u8` as the master playlist.
- **Do NOT add a separate Lambda handler for Stage events.** The existing `recordingEndedFn` Lambda can handle both event types with conditional URL building — a separate handler would duplicate session-lookup and pool-release logic.
- **Do NOT use IVS Composition API** for this phase. The stages are created with `autoParticipantRecordingConfiguration` (individual participant recording). There is no server-side composition to start/stop. The recording happens automatically per-participant.
- **Do NOT modify `getRecentRecordings` or `RecordingFeed.tsx`.** The home feed already queries `recordingStatus = 'available'` for all session types and `RecordingFeed.tsx` already has the `sessionType === 'HANGOUT'` badge. HANG-16 is fixed purely by writing the metadata correctly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Routing Stage events to Lambda | New Lambda function | Existing `recordingEndedFn` with new EventBridge rule | Avoids duplicating session-lookup, metadata-update, and pool-release logic |
| Stage ARN lookup | New repository method | Existing `findSessionByStageArn` | Already implements DynamoDB Scan for stage ARN |
| Metadata persistence | Custom DynamoDB update | Existing `updateRecordingMetadata` | Already handles partial updates and version increment |
| Home feed filtering | Query changes | Existing `getRecentRecordings` | Already filters on `recordingStatus = 'available'` for all session types |
| Hangout badge in feed | New UI component | Existing `RecordingFeed.tsx` | Already has `isHangout` purple badge at lines 68-116 |

---

## Common Pitfalls

### Pitfall 1: Missing EventBridge Rule for "IVS Participant Recording State Change"

**What goes wrong:** Developer reads the audit finding ("wrong EventBridge field") and only fixes `recording-ended.ts` line 31, without adding a CDK rule for the Stage recording event type. The handler still never receives Stage events because no rule routes them to the Lambda.

**Why it happens:** The audit description focuses on "wrong field used for ARN" — easy to miss that there is ALSO a missing EventBridge rule. The `RecordingEndRuleV2` already in `session-stack.ts` only captures `"IVS Recording State Change"` (broadcast), NOT `"IVS Participant Recording State Change"` (Stage participant).

**How to avoid:** Phase 11 has two independent fixes: (1) add CDK rule, (2) fix handler field. Both are required. Verify by checking `session-stack.ts` for `detailType: ['IVS Participant Recording State Change']` after the fix.

**Warning sign:** If only `recording-ended.ts` is changed and no CDK file is changed, the fix is incomplete.

### Pitfall 2: Assuming stage.m3u8 path is same as broadcast

**What goes wrong:** Handler builds `recordingHlsUrl` as `${cloudFrontDomain}/${prefix}/master.m3u8` for Stage events. CloudFront 403/404 because the file is `media/hls/multivariant.m3u8`.

**Why it happens:** The existing handler was built for broadcast recordings only. The path construction is correct for broadcasts (`master.m3u8`) but wrong for Stage participant recordings.

**How to avoid:** Use `resourceType === 'channel'` vs `resourceType === 'stage'` to select the appropriate URL template. Verified path structures from official AWS IVS RealTime docs.

### Pitfall 3: Tests still use `channel_name` ARN pattern

**What goes wrong:** Tests pass with `event.detail.channel_name = 'arn:aws:ivs:...:stage/xyz'` and `resources: []`. After the fix, the handler reads `event.resources[0]` — these old tests now set `resourceArn = undefined`, causing the ARN split to throw or detect "unknown" type.

**Why it happens:** The old test event shapes are technically wrong (they exploit the coincidental behavior of the old implementation). The fix must update ALL existing tests to put ARNs in `resources[0]`.

**How to avoid:** Update all five existing tests in `recording-ended.test.ts` to use correct event shapes. New Stage event tests must use `"IVS Participant Recording State Change"` detail-type and `session_id`/`participant_id` in detail.

### Pitfall 4: TypeScript Type Error on Union Event Detail

**What goes wrong:** `EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>` typed handler cannot accept Stage events because the detail type is different. TypeScript rejects the `handler(stageEvent)` call.

**Why it happens:** The handler's TypeScript signature is too narrow.

**How to avoid:** Broaden the handler signature to `EventBridgeEvent<string, any>` or use a discriminated union. The simplest approach: use `EventBridgeEvent<string, Record<string, any>>` to accept both event types without losing type safety on `resources[0]`.

### Pitfall 5: CDK Deploy Required for New EventBridge Rule

**What goes wrong:** Code changes are committed and tested but the new EventBridge rule doesn't exist in AWS. Stage recording events silently drop. Developers think the fix works in unit tests but recording lifecycle never completes in AWS.

**How to avoid:** Phase plan must include a `cdk deploy VNL-Session` step. The new `StageRecordingEndRule` is infrastructure-level — it does not exist until CloudFormation applies it.

---

## Code Examples

Verified patterns from official sources and project source code:

### Fix 1: New CDK EventBridge Rule for Stage Recording Events

```typescript
// Source: Verified against official AWS IVS RealTime EventBridge docs and session-stack.ts pattern
// Add to session-stack.ts after the existing recordingEndRule definition (line ~196):

const stageRecordingEndRule = new events.Rule(this, 'StageRecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Participant Recording State Change'],
    detail: {
      event_name: ['Recording End'],
    },
  },
  description: 'Capture IVS RealTime participant recording end events for hangout sessions',
});
stageRecordingEndRule.addTarget(new targets.LambdaFunction(recordingEndedFn));
```

### Fix 2: recording-ended.ts — Read ARN from resources[0] and fix URL construction

```typescript
// Source: Verified against AWS IVS EventBridge docs (both Low-Latency and RealTime)
// Replace line 31 of recording-ended.ts:

// BEFORE (broken):
const resourceArn = event.detail.channel_name;

// AFTER (correct — resources[0] contains channel ARN for broadcast, stage ARN for hangout):
const resourceArn = event.resources[0];
```

```typescript
// Also in recording-ended.ts, update the URL construction block
// (currently around lines 90-94 where recordingHlsUrl and thumbnailUrl are built):

// BEFORE (broadcast-only assumption):
const recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
const thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;

// AFTER (conditional on resource type):
let recordingHlsUrl: string;
let thumbnailUrl: string;
if (resourceType === 'channel') {
  // IVS Low-Latency broadcast recording structure
  recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/master.m3u8`;
  thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/thumb-0.jpg`;
} else {
  // IVS RealTime Stage participant recording structure
  recordingHlsUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/hls/multivariant.m3u8`;
  thumbnailUrl = `https://${cloudFrontDomain}/${recordingS3KeyPrefix}/media/latest_thumbnail/high/thumb.jpg`;
}

// recording_status field exists on broadcast events (Recording End / Recording End Failure)
// Stage participant events use event_name only; treat all Stage "Recording End" as successful
const finalStatus = event.detail.recording_status === 'Recording End Failure'
  ? 'failed'
  : 'available';
```

### Fix 3: Updated TypeScript Interface and Handler Signature

```typescript
// recording-ended.ts — updated interfaces

interface BroadcastRecordingEndDetail {
  channel_name: string;          // Human-readable channel name (NOT used for ARN)
  stream_id: string;
  recording_status: 'Recording End' | 'Recording End Failure';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

interface StageParticipantRecordingEndDetail {
  session_id: string;
  event_name: 'Recording End';
  participant_id: string;
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
}

// Handler signature: use string for detail-type, Record<string, any> for detail
export const handler = async (
  event: EventBridgeEvent<string, Record<string, any>>
): Promise<void> => { ... }
```

### Fix 4: Corrected Test Event Shapes

```typescript
// recording-ended.test.ts — Stage participant recording event (NEW test):
const stageEvent = {
  'version': '0',
  'id': 'stage-event-id',
  'detail-type': 'IVS Participant Recording State Change',
  'source': 'aws.ivs',
  'account': '123456789012',
  'time': '2024-01-01T00:05:00Z',
  'region': 'us-east-1',
  'resources': ['arn:aws:ivs:us-east-1:123456789012:stage/hangout123'],  // Stage ARN here
  'detail': {
    session_id: 'st-test-session',
    event_name: 'Recording End',
    participant_id: 'participant-abc',
    recording_s3_bucket_name: 'my-recordings',
    recording_s3_key_prefix: 'stage-id/session-id/participant-id/2024-01-01T00-00-00Z',
    recording_duration_ms: 450000,
  },
};

// recording-ended.test.ts — Fixed broadcast event (UPDATE existing tests):
const broadcastEvent = {
  // ...
  'resources': ['arn:aws:ivs:us-east-1:123456789012:channel/test123'],  // ARN in resources
  'detail': {
    channel_name: 'My Channel Name',  // Human-readable NAME, not ARN
    stream_id: 'st_test_stream_id',
    recording_status: 'Recording End',
    recording_s3_bucket_name: 'my-recordings',
    recording_s3_key_prefix: 'prefix/',
    recording_duration_ms: 300000,
  },
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Broadcast-only recording handler | Unified broadcast+stage handler | Phase 11 | Hangout recordings now write metadata |
| `event.detail.channel_name` for ARN | `event.resources[0]` | Phase 11 | Correct for both event types |
| `master.m3u8` path for all recordings | `master.m3u8` for channels, `media/hls/multivariant.m3u8` for stages | Phase 11 | Stage HLS URLs are playable |
| EventBridge only on `"IVS Recording State Change"` | Also captures `"IVS Participant Recording State Change"` | Phase 11 | Stage events reach Lambda |

**Verified event structures (HIGH confidence, from official AWS docs):**

**IVS Low-Latency broadcast "Recording End" (detail-type: `"IVS Recording State Change"`):**
- Channel ARN in `event.resources[0]`
- `event.detail.channel_name` = human-readable channel NAME (not ARN)
- `event.detail.recording_status` = `"Recording End"` or `"Recording End Failure"`
- S3 HLS path: `{prefix}/master.m3u8`
- S3 thumbnail path: `{prefix}/thumb-0.jpg`

**IVS RealTime Stage individual participant "Recording End" (detail-type: `"IVS Participant Recording State Change"`):**
- Stage ARN in `event.resources[0]`
- NO `channel_name` field in `detail`
- `event.detail.event_name` = `"Recording End"`
- `event.detail.session_id`, `event.detail.participant_id` in detail
- S3 HLS path: `{prefix}/media/hls/multivariant.m3u8`
- S3 thumbnail path: `{prefix}/media/latest_thumbnail/high/thumb.jpg`

---

## Scope Clarification: autoParticipantRecording vs Composition

The stages in this project use `autoParticipantRecordingConfiguration` (set in `replenish-pool.ts` lines 180-184):

```typescript
autoParticipantRecordingConfiguration: {
  storageConfigurationArn: recordingConfigArn,
  mediaTypes: ['AUDIO_VIDEO'],
},
```

This is **individual participant recording** — each participant's stream is recorded separately to S3 automatically. This is NOT the IVS Composition API (which would require calling `StartComposition`/`StopComposition` explicitly and would produce a single composite file).

The REQUIREMENTS.md says HANG-14 is "server-side composition to S3" and HANG-15 mentions "composite recording" but the actual implementation uses `autoParticipantRecordingConfiguration`. The Phase 11 goal (and audit gap) is specifically about fixing the EventBridge field so the EXISTING recording mechanism works end-to-end. There is no need to introduce the IVS Composition API.

For Phase 11: fix the EventBridge routing and field access to make the existing autoParticipantRecording lifecycle complete correctly. The word "composite" in requirements is aspirational — the implementation uses per-participant auto-recording which is simpler and already deployed.

---

## Open Questions

1. **Which participant's recording appears in the home feed?**
   - What we know: Each participant gets a separate recording at a different S3 key prefix (their participant ID is part of the path). `findSessionByStageArn` returns the session — but which participant's `recording_s3_key_prefix` do we use for the session's `recordingHlsUrl`?
   - What's unclear: If a hangout has 3 participants, recording-ended fires 3 times (once per participant). The last write wins for `recordingHlsUrl`. The session will end up with one participant's recording URL.
   - Recommendation: For Phase 11, accept "last writer wins" behavior — use the `participant_id` from the event. This is adequate for v1.1. In a future phase, could create per-participant recording entries or use the host's recording specifically.

2. **Does recording-ended fire after session status is ENDING or ENDED?**
   - What we know: The handler calls `updateSessionStatus(tableName, sessionId, SessionStatus.ENDED, 'endedAt')`. There's a `canTransition` check: ENDING → ENDED is valid, but ENDED → ENDED is not.
   - What's unclear: For multiple participants, the first participant's recording-end event transitions the session to ENDED. Subsequent participant recording-end events will find status=ENDED and `canTransition(ENDED, ENDED) = false`, throwing an error (caught and logged as non-blocking).
   - Recommendation: The non-blocking catch on `updateSessionStatus` already handles this correctly. Metadata updates will still fire because the status update error is caught before the metadata update block. Confirm this in the handler control flow (lines 83-110).

---

## Validation Architecture

> `workflow.nyquist_validation` is not set in `.planning/config.json` — this section is included based on the existing Jest test infrastructure detected in the project.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest + ts-jest |
| Config file | `backend/jest.config.js` |
| Quick run command | `cd /path/to/backend && NODE_OPTIONS=--experimental-vm-modules jest src/handlers/__tests__/recording-ended.test.ts` |
| Full suite command | `cd /path/to/backend && NODE_OPTIONS=--experimental-vm-modules jest` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HANG-14 | Stage ARN read from `resources[0]`, not `detail.channel_name` | unit | `jest recording-ended.test.ts -t "detects Stage ARN"` | Existing file — needs update |
| HANG-14 | Stage event routes to handler (CDK rule) | CDK unit/manual | `npx cdk synth VNL-Session` for rule presence | CDK tests not in scope |
| HANG-14 | Stage recording uses `multivariant.m3u8` path | unit | `jest recording-ended.test.ts -t "Stage HLS URL"` | New test case needed |
| HANG-15 | `recordingStatus='available'` written after Stage recording-end | unit | `jest recording-ended.test.ts -t "updates recording metadata for Stage"` | Existing test — needs update |
| HANG-16 | Home feed query returns hangout sessions (`getRecentRecordings`) | unit | Existing session-repository tests | Existing — no changes needed |

### Wave 0 Gaps
- [ ] Update `recording-ended.test.ts` — all 5 existing tests must move ARN from `detail.channel_name` to `resources[0]`
- [ ] Add new test cases for `"IVS Participant Recording State Change"` event shape in `recording-ended.test.ts`
- [ ] Verify `findSessionByStageArn` mock in test setup correctly returns a session for Stage ARN lookup

---

## Sources

### Primary (HIGH confidence)
- AWS Official Docs: [Using Amazon EventBridge with IVS Real-Time Streaming](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/eventbridge.html) — full JSON schemas for "IVS Participant Recording State Change" Recording End event; Stage ARN in `resources[0]` confirmed; `session_id`, `event_name`, `participant_id` fields in detail confirmed
- AWS Official Docs: [IVS Individual Participant Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-individual-participant-recording.html) — S3 directory structure confirmed: `media/hls/multivariant.m3u8` for HLS master, `media/latest_thumbnail/high/thumb.jpg` for thumbnail
- Project source: `backend/src/handlers/recording-ended.ts` line 31 — `event.detail.channel_name` bug confirmed
- Project source: `infra/lib/stacks/session-stack.ts` — no `"IVS Participant Recording State Change"` rule exists; only `"IVS Recording State Change"` on `RecordingEndRuleV2`
- Project source: `backend/src/handlers/replenish-pool.ts` lines 180-184 — stages created with `autoParticipantRecordingConfiguration` (not Composition API)
- Project source: `web/src/features/replay/RecordingFeed.tsx` lines 68-116 — HANGOUT badge and routing already implemented; no frontend changes needed for HANG-16
- Project source: `backend/src/repositories/session-repository.ts` lines 210-246 — `getRecentRecordings` already queries `recordingStatus = 'available'` for all session types

### Secondary (MEDIUM confidence)
- Project audit: `.planning/v1.1-MILESTONE-AUDIT.md` — integration findings verified by cross-referencing source files; HANG-14 evidence at lines 47-53

### Tertiary (LOW confidence)
- None — all critical findings verified against project source code or official AWS docs

---

## Metadata

**Confidence breakdown:**
- Bug location (recording-ended.ts line 31): HIGH — verified directly in source code
- Missing CDK EventBridge rule: HIGH — verified no `detailType: ['IVS Participant Recording State Change']` exists in session-stack.ts
- Stage event field structure: HIGH — verified from official AWS IVS RealTime EventBridge docs
- Stage S3 file structure (multivariant.m3u8 path): HIGH — verified from official AWS IVS RealTime Individual Participant Recording docs
- Home feed impact (HANG-16): HIGH — verified `RecordingFeed.tsx` already handles HANGOUT sessions; `getRecentRecordings` is type-agnostic
- Open question (multi-participant recording URL conflict): MEDIUM — expected behavior based on handler control flow; not tested end-to-end

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (AWS IVS EventBridge schemas are stable; project source verified at commit point)
