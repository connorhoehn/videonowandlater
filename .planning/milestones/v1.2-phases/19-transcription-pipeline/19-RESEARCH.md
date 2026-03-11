# Phase 19: Transcription Pipeline — Research Update

**Researched:** 2026-03-05
**Domain:** EventBridge event choreography for downstream phase dependencies
**Confidence:** HIGH

## Summary

Phase 19 implementation is functionally complete and verified (2026-03-06). All four requirements (TRNS-01 through TRNS-04) are satisfied:
- MediaConvert job submission works (recording-ended.ts:164-255)
- Transcribe job submission works (transcode-completed.ts:23-109)
- Transcript storage works (transcribe-completed.ts:62-98)
- Failure handling is non-blocking (all handlers have try/catch pattern)

**Critical gap discovered:** Phase 19's `transcribe-completed.ts` handler successfully stores the transcript on the session record (line 98) but **does NOT emit the "Transcript Stored" EventBridge event** that Phase 20 (AI Summary Pipeline) depends on to trigger.

The EventBridge rule is already configured and waiting in `session-stack.ts:591-598`. The infrastructure is ready. Only the event emission is missing—a 15-line non-blocking code addition that completely unblocks Phase 20.

**Primary recommendation:** Add EventBridge event emission to `transcribe-completed.ts` immediately after successful `updateTranscriptStatus()` call (after line 98). This is purely additive; no architectural changes needed.

## Phase Requirements

| ID | Description | Phase 19 Status | Phase 20 Dependency |
|----|-------------|-----------------|-------------------|
| TRNS-01 | A Transcribe job is automatically started when a broadcast recording is confirmed available in S3 | ✓ SATISFIED | N/A |
| TRNS-02 | Transcription job name encodes the session ID (vnl-{sessionId}-{epochMs}) to enable correlation without extra DynamoDB reads | ✓ SATISFIED | N/A |
| TRNS-03 | Transcript text is stored on the session record in DynamoDB when the Transcribe job completes successfully | ✓ SATISFIED | Phase 20 reads transcript field from session |
| TRNS-04 | Transcription failures are recorded on the session record without blocking pool release or other session data | ✓ SATISFIED | N/A |

**Undocumented requirement (discovered in Phase 20 verification):** After storing transcript, emit EventBridge event with source='custom.vnl' and detailType='Transcript Stored' to trigger AI summary pipeline. **This requirement is NOT explicitly in REQUIREMENTS.md but is IMPLICIT in Phase 20's design.**

## Current Implementation State

### What Phase 19 Successfully Built

**All handler implementations exist and are verified:**

1. **recording-ended.ts:164-255** — Submits MediaConvert job when `recordingStatus='available'`
2. **transcode-completed.ts:23-109** — Submits Transcribe job when MediaConvert completes
3. **transcribe-completed.ts:62-98** — Fetches transcript from S3 and stores on session record via `updateTranscriptStatus('available', s3Uri, plainText)`

**All EventBridge rules are configured in CDK:**
- `session-stack.ts:456-492` — Rule for MediaConvert completion → transcode-completed Lambda
- `session-stack.ts:506-535` — Rule for Transcribe completion → transcribe-completed Lambda
- `session-stack.ts:591-598` — **Rule waiting for custom "Transcript Stored" event → store-summary Lambda (Phase 20)**

**Session domain model extended:**
- `backend/src/domain/session.ts:67-69` — Fields added: `transcriptStatus`, `transcriptS3Path`, `transcript`

**Repository function exists:**
- `backend/src/repositories/session-repository.ts:482-528` — `updateTranscriptStatus()` function

### The Gap: Missing Event Emission in transcribe-completed.ts

**Current code ends at line 98:**
```typescript
// Line 96-98 (current state)
const s3Uri = `s3://${transcriptionBucket}/${transcriptJsonPath}`;
await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);

console.log('Transcript stored for session:', { sessionId, s3Uri });
// Handler returns here with no event emitted
```

**EventBridge rule waiting (session-stack.ts:591-598):**
```typescript
const transcriptStoreRule = new events.Rule(this, 'TranscriptStoreRule', {
  eventPattern: {
    source: ['custom.vnl'],
    detailType: ['Transcript Stored'],
  },
  targets: [new targets.LambdaFunction(storeSummaryFn)],
  description: 'Trigger AI summary generation when transcript is stored',
});
```

**Phase 20 expectation (from 20-VERIFICATION.md lines 130-155):**
After successfully storing the transcript, emit:
- Source: `'custom.vnl'`
- DetailType: `'Transcript Stored'`
- Detail: `{ sessionId, transcriptText: plainText }`

This event is the trigger for Phase 20's `store-summary.ts` handler.

## Required Code Addition

**File:** `backend/src/handlers/transcribe-completed.ts`
**Location:** After line 98 (immediately after successful `updateTranscriptStatus` call)
**Scope:** Non-blocking try/catch block (matches existing error handling pattern)

### Code to Add

```typescript
// Emit "Transcript Stored" event to trigger Phase 20 AI summary pipeline
try {
  const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });
  await ebClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'custom.vnl',
      DetailType: 'Transcript Stored',
      Detail: JSON.stringify({
        sessionId,
        transcriptText: plainText,
      }),
    }],
  }));
  console.log('Transcript Stored event emitted:', { sessionId });
} catch (error: any) {
  console.error('Failed to emit Transcript Stored event:', error.message);
  // Non-blocking: don't throw, log for observability
}
```

### Required Imports

Add at the top of transcribe-completed.ts:
```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
```

### Design Pattern

This follows the existing non-blocking error handling pattern used throughout Phase 19:
- Event emission failure does NOT throw
- Transcript is already successfully stored (updateTranscriptStatus already succeeded)
- Event emission is best-effort for downstream pipelines
- Failure is logged for observability; handler completes successfully regardless

This ensures Phase 19 behavior remains non-blocking: even if EventBridge emission fails, the transcript persists in DynamoDB and the handler succeeds.

## Why This Gap Exists

1. **Requirements definition missing explicit signal:** REQUIREMENTS.md (lines 100-113) defines TRNS-01 through TRNS-04 as "store transcript" but doesn't explicitly state "emit event to trigger downstream phase"

2. **Verification missed downstream dependency:** Phase 19's verification (2026-03-06) checked that "transcript stored on session" (line 98 executed successfully) but didn't verify that Phase 20's trigger event was emitted

3. **Phase 20 was blocked before verification:** Phase 20's planning likely happened in parallel with Phase 19's verification, discovering the missing event after Phase 19 was marked complete

4. **CDK infrastructure ready:** The EventBridge rule was already built in Phase 19-02's CDK work, showing the dependency was understood at infrastructure level but not reflected in the handler implementation

## Standard Stack

### AWS Services Required

| Service | Component | Version | Why |
|---------|-----------|---------|-----|
| AWS Transcribe | Batch transcription | Managed | Speech-to-text for audio content |
| AWS MediaConvert | Format conversion | Managed | Convert IVS HLS to MP4 for Transcribe input |
| AWS EventBridge | Event routing | Managed (CDK native) | Route completion events between handlers; emit custom events to Phase 20 |
| AWS DynamoDB | Session storage | Existing table | Persist transcript metadata and text |
| AWS S3 | Transcript archive | Existing buckets | Store Transcribe JSON output; fetch in handler |
| AWS Lambda | Orchestration | Node.js 20.x | Event handlers connecting services |

### SDK Libraries

| Library | Purpose | When Used |
|---------|---------|-----------|
| @aws-sdk/client-eventbridge | EventBridge API client (PutEventsCommand) | Emit "Transcript Stored" event from transcribe-completed.ts |
| @aws-sdk/client-transcribe | Transcribe API client (StartTranscriptionJobCommand) | Already used by transcode-completed.ts |
| @aws-sdk/client-mediaconvert | MediaConvert API client (CreateJobCommand) | Already used by recording-ended.ts |
| @aws-sdk/client-s3 | S3 API client (GetObjectCommand) | Already used by transcribe-completed.ts |
| @aws-sdk/lib-dynamodb | DynamoDB document client | Already used by session-repository.ts |

## Architecture Patterns

### Event Choreography Pattern

```
Recording Available → MediaConvert Job
  ↓ (EventBridge: MediaConvert Job State Change)
transcode-completed.ts → Transcribe Job
  ↓ (EventBridge: Transcribe Job State Change)
transcribe-completed.ts → [Store transcript] → [EMIT CUSTOM EVENT: Transcript Stored]
  ↓ (EventBridge: Transcript Stored event)
Phase 20: store-summary.ts → Bedrock API → AI Summary
```

Each stage listens for previous stage's completion via EventBridge. Custom `custom.vnl` events bridge AWS service notifications to internal business logic.

### Non-Blocking Error Pattern

All operations in Phase 19 wrap in try/catch. Failures:
1. Log error with context (sessionId, operation)
2. Update session state to reflect failure (if applicable)
3. Do NOT throw
4. Allow handler to complete successfully

Example from transcribe-completed.ts:
```typescript
try {
  // ... fetch transcript and update session
  await updateTranscriptStatus(tableName, sessionId, 'available', s3Uri, plainText);
} catch (error: any) {
  console.error('Failed to fetch or store transcript:', error.message);
  try {
    await updateTranscriptStatus(tableName, sessionId, 'failed');
  } catch (updateError: any) {
    console.error('Failed to update transcript status:', updateError.message);
  }
  // No rethrow — handler completes successfully
}
```

The new EventBridge emission code follows this exact pattern. Event emission failure is logged but doesn't prevent handler success.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Custom event notification to Phase 20 | SNS topic or direct Lambda invoke | EventBridge custom events + CDK rule | EventBridge manages event routing, retry, DLQ; custom solutions lose observability and fan-out capability |
| Event delivery reliability | Custom retry loops in Lambda | EventBridge DLQ + retry configuration (already in CDK) | EventBridge rule targets have deadLetterQueue and retryAttempts configured; custom code is fragile |
| Event correlation across phases | Manual sessionId passing in multiple places | Encode sessionId in event Detail and extract in Phase 20 | Single source of truth; less error-prone than manual threading |

## Common Pitfalls

### Pitfall 1: Emitting Event Before Storing Transcript

**What goes wrong:** Phase 20 tries to fetch the transcript from the session record but `transcriptStatus` is still `'processing'` or transcript field is `undefined`. Phase 20 fails or falls back to empty summary.

**Why it happens:** Reordering code during development without understanding the strict ordering: store first, signal downstream after.

**How to avoid:** **Event emission MUST come AFTER successful `updateTranscriptStatus()` call.** The event is a signal that the data is ready; Phase 20 reads immediately upon receiving the event.

**Warning signs:** Phase 20 handler logs "Transcript not available for session" or retrieves empty/incomplete transcript.

### Pitfall 2: Wrong EventBridge Source or DetailType

**What goes wrong:** Event is emitted but EventBridge rule doesn't match. Phase 20's handler never invoked. No errors in logs.

**Why it happens:** Copy-paste error or typo in string constants.

**How to avoid:** Match exactly the eventPattern in session-stack.ts:592-595:
- Source: `'custom.vnl'` (not `'custom'`, not `'vnl'`, not `'custom/vnl'`)
- DetailType: `'Transcript Stored'` (exact case, including spaces)

**Warning signs:** Transcript stored successfully but Phase 20's handler never triggered. Check CloudWatch event processing logs for "Matched Rules: 0".

### Pitfall 3: Forgetting Non-Blocking Pattern on Event Emission

**What goes wrong:** EventBridge API call fails (transient error, throttle, etc.). Exception thrown. Handler fails. Lambda runtime reports failure. Transcript stored but event never emitted. Phase 20 never triggered.

**Why it happens:** Developer treats event emission like a critical operation instead of best-effort. Doesn't wrap in try/catch.

**How to avoid:** Wrap event emission in try/catch. Log error but don't throw. Transcript is already safely stored; event emission is bonus signal for downstream.

**Warning signs:** EventBridgeClient.send() throws exception in Lambda logs. Phase 19 handler shows failure even though transcript exists in DynamoDB.

### Pitfall 4: JSON.stringify with Undefined plainText

**What goes wrong:** plainText is undefined or null. Detail JSON becomes `{ sessionId, transcriptText: undefined }`. Phase 20 receives event with undefined text field.

**Why it happens:** No validation of plainText before stringifying.

**How to avoid:** The existing code already handles this at line 78-87: checks if plainText is empty and still proceeds. JSON.stringify works fine with empty string. Worst case: `transcriptText: ''` is a valid empty string that Phase 20 can handle.

**Warning signs:** Phase 20 handler receives event with `Detail.transcriptText === undefined`.

### Pitfall 5: Not Including sessionId in Event Detail

**What goes wrong:** Phase 20 receives event but can't correlate it to a session. Needs to make extra DynamoDB query.

**Why it happens:** Minimal event payload to "save space" or misunderstanding what Phase 20 needs.

**How to avoid:** Always include sessionId in event Detail. Phase 20 needs it immediately to fetch the session record. Event Detail: `{ sessionId, transcriptText: plainText }`.

**Warning signs:** Phase 20 handler makes extra DynamoDB scans to find which session the transcript belongs to.

## Code Examples

### EventBridge Event Emission (REQUIRED)

**Verified source:** Phase 20 VERIFICATION.md:130-155

```typescript
// Add this to transcribe-completed.ts after line 98
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// After updateTranscriptStatus() succeeds:
try {
  const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });
  await ebClient.send(new PutEventsCommand({
    Entries: [{
      Source: 'custom.vnl',
      DetailType: 'Transcript Stored',
      Detail: JSON.stringify({
        sessionId,
        transcriptText: plainText,
      }),
    }],
  }));
  console.log('Transcript Stored event emitted:', { sessionId });
} catch (error: any) {
  console.error('Failed to emit Transcript Stored event:', error.message);
  // Non-blocking: don't throw, log for observability
}
```

### EventBridge Rule Configuration (ALREADY EXISTS)

**Source:** `infra/lib/stacks/session-stack.ts:591-598`

```typescript
const transcriptStoreRule = new events.Rule(this, 'TranscriptStoreRule', {
  eventPattern: {
    source: ['custom.vnl'],
    detailType: ['Transcript Stored'],
  },
  targets: [new targets.LambdaFunction(storeSummaryFn)],
  description: 'Trigger AI summary generation when transcript is stored',
});
```

This rule is already deployed. It's listening for the event. The handler just needs to emit it.

### Job Name Parsing Pattern (Already Implemented)

**Source:** `transcribe-completed.ts:37-44`

```typescript
// Extract sessionId from job name (format: vnl-{sessionId}-{epochMs})
const jobNameParts = jobName.split('-');
if (jobNameParts.length < 3 || jobNameParts[0] !== 'vnl') {
  console.warn('Cannot parse sessionId from job name:', jobName);
  return;
}

const sessionId = jobNameParts[1];
```

This pattern is robust: validates format before extracting, handles malformed names gracefully without crashing.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| EventBridge rule triggers Lambda directly | Custom events emitted from Lambda for downstream coordination | Phase 19 | Decouples phases; allows multiple downstream consumers; enables event replay and debugging |
| Synchronous phase calls | Asynchronous event choreography with EventBridge | Phase 5+ | Each phase completes independently; failures don't cascade; easier to test in isolation |
| Throwing errors to fail handler | Non-blocking try/catch + session state updates | Phase 5+ (recording-ended pattern) | Session cleanup always proceeds; partial failures don't orphan resources |

## Open Questions

1. **What if Phase 20 doesn't receive the event?**
   - Phase 19 stores the transcript successfully (session record is updated)
   - Phase 20 can still be triggered manually or by a separate scheduled job
   - Current design: assume event delivery; don't block Phase 19 on event acknowledgment

2. **Should the event include more metadata (s3Uri, duration, language)?**
   - EventBridge rule only matches Source and DetailType, doesn't use Detail fields for routing
   - Phase 20 can fetch session record to get all metadata
   - Current design: minimal Detail (sessionId, transcriptText) — sufficient for Phase 20 to proceed

3. **What if plainText is very large (>256KB)?**
   - Transcribe output JSON is fetched from S3; plainText is extracted string
   - EventBridge Detail field has a 256KB limit
   - Current design: Include plainText in event (typical transcripts are <256KB)
   - Future: If transcripts exceed limit, move plainText to separate S3 location and only include s3Uri in event

## Validation Architecture

Test framework: Jest (npm test in backend/)

### How to Validate This Change

**Unit test addition** (new test in transcribe-completed.ts tests):
```typescript
test('emits Transcript Stored event after storing transcript', async () => {
  // Mock EventBridgeClient.send
  // Call handler
  // Verify PutEventsCommand was called with correct Source, DetailType, Detail
  // Verify Detail.sessionId matches
  // Verify Detail.transcriptText matches plainText
});

test('handles EventBridge emission failure gracefully', async () => {
  // Mock EventBridgeClient.send to throw error
  // Call handler
  // Verify handler completes without throwing
  // Verify error is logged
  // Verify transcript was still stored (updateTranscriptStatus succeeded before event emission)
});
```

**Integration test** (after Phase 20 is implemented):
```bash
# Trigger a full transcription pipeline
# Verify: recording-ended → MediaConvert → transcode-completed → Transcribe → transcribe-completed
# Verify: Phase 20 store-summary handler is triggered
# Verify: AI summary is generated and stored
```

### Current Test Status

Phase 19's test suite is complete (169 tests passing). EventBridge emission is new functionality that will need new test cases. These can be added in Phase 19's follow-up or included in Phase 20's integration tests.

## Sources

### Primary (HIGH confidence)

- **Phase 20 VERIFICATION.md (lines 130-155)** — "What Would Fix This" section documents exact event structure needed
- **session-stack.ts:591-598** — EventBridge rule already configured, shows expected event format
- **Phase 19 PLAN.md (19-01)** — Task list for Phase 19 implementation; event emission was not explicitly listed as a task (oversight)
- **Phase 19 VERIFICATION.md** — Verification shows transcribe-completed.ts at line 98 storing transcript, no mention of event emission

### Secondary (MEDIUM confidence)

- **REQUIREMENTS.md (lines 100-113)** — TRNS-01 through TRNS-04 don't explicitly mention event emission to Phase 20, but AI-01 through AI-05 depend on transcript being available (implicit dependency chain)
- **AWS SDK EventBridge documentation** — PutEventsCommand structure, Source/DetailType/Detail fields, standard patterns

## Metadata

**Confidence breakdown:**
- Event structure and location: HIGH — Explicitly documented in Phase 20 verification
- Code placement (after line 98): HIGH — Matches existing pattern in transcribe-completed.ts
- Required imports: HIGH — Standard EventBridge SDK pattern
- Non-blocking error handling: HIGH — Consistent with Phase 19 patterns throughout codebase

**Research date:** 2026-03-05
**Valid until:** 2026-03-12 (stable, low churn expected)

**Critical path:** This is a blocking dependency for Phase 20. Adding this event emission is the minimum required to unblock Phase 20 implementation.

**Effort estimate:** 15 lines of code + imports; no architectural changes; non-blocking code path; low risk of introducing new bugs.
