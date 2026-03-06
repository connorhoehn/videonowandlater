---
phase: 20-ai-summary-pipeline
verified: 2026-03-06T21:30:00Z
status: gaps_found
score: 4/5 must-haves verified
re_verification: true
previous_status: passed
previous_score: 5/5
gaps_closed: []
gaps_remaining:
  - "Transcript Stored event is not emitted by Phase 19's transcribe-completed handler — EventBridge rule has no trigger"
regressions: []
---

# Phase 20: AI Summary Pipeline — Verification Report (Re-verification)

**Phase Goal:** Every session with a stored transcript automatically receives an AI-generated one-paragraph summary via Bedrock/Claude, displayed on recording cards and the replay info panel

**Verified:** 2026-03-06T21:30:00Z
**Status:** GAPS FOUND — Critical blocker identified in event flow
**Previous Status:** PASSED (claimed) — Re-verification found unverified assumption
**Re-verification:** Yes — Previous verification missed critical prerequisite from Phase 19

## Critical Finding

**THE PHASE GOAL CANNOT BE ACHIEVED** due to a broken integration point with Phase 19:

The Phase 20 implementation assumes Phase 19's `transcribe-completed` handler emits a "Transcript Stored" EventBridge event after storing the transcript in DynamoDB. This event would trigger the EventBridge rule defined in session-stack.ts, which then invokes the store-summary Lambda.

**However:** The `transcribe-completed` handler does NOT emit this event. It only:
1. Fetches the transcript from S3
2. Updates the session record with `updateTranscriptStatus()`
3. Returns

**Result:** The store-summary Lambda never receives the "Transcript Stored" event, so it never triggers, and AI summaries are never generated.

## Goal Achievement Analysis

### Observable Truths Verification

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a transcript is stored, an AI-generated one-paragraph summary is automatically produced and stored on the session record with no manual intervention | ✗ FAILED | EventBridge rule exists and is configured correctly (session-stack.ts:591-598), BUT the "Transcript Stored" event is never emitted by Phase 19's transcribe-completed handler (verified: no EventBridgeClient import, no PutEventsCommand call). The rule matches on `source='custom.vnl'` + `detailType='Transcript Stored'`, but this event is never published. MISSING: Code in transcribe-completed.ts to emit the event after line 98 (successful transcript storage). |
| 2 | Recording cards on the homepage display a 2-line truncated AI summary (or "Summary coming soon" placeholder while the pipeline is still running) | ✓ VERIFIED | SummaryDisplay component (lines 26-28) renders "Summary coming soon..." when status === 'pending' or undefined. BroadcastActivityCard.tsx (line 62-67) and HangoutActivityCard.tsx import and render SummaryDisplay with truncate={true}. BUT: Sessions will never have aiSummaryStatus='available' because the pipeline never completes. Sessions will always show "Summary coming soon..." indefinitely. |
| 3 | The full AI summary is displayed in the replay info panel when viewing a recording | ✓ VERIFIED (Partial) | ReplayViewer.tsx (lines 334-339) renders SummaryDisplay with truncate={false}. Component exists and is wired correctly. BUT: aiSummary will always be undefined because the pipeline never completes, so placeholder text will always be shown. |
| 4 | If Bedrock fails, the transcript that was already stored is preserved — the failure sets aiSummaryStatus to "failed" but does not overwrite or lose the transcriptText field | ✓ VERIFIED (Theoretically) | store-summary.ts (lines 68-72) catches Bedrock errors and calls updateSessionAiSummary() with ONLY aiSummaryStatus='failed', never touching aiSummary or transcriptText fields. updateSessionAiSummary() (session-repository.ts) uses selective UpdateExpression. BUT: This code path is unreachable because the event never triggers. |
| 5 | "Summary coming soon" placeholder is shown on cards for sessions where the pipeline has not yet completed, rather than a blank or broken state | ✓ VERIFIED (Partial) | SummaryDisplay.tsx hardcodes placeholder text when status === 'pending'. BUT: Since the pipeline never completes, ALL sessions will show this placeholder indefinitely, even after sufficient time for summary generation to occur. This is not a graceful temporary state — it's permanent for all pre-Phase 20 sessions and all sessions generated after Phase 20-01. |

**Score:** 1/5 truths actually functional. 4/5 truths are code-verified but unreachable or non-functional due to missing event emission.

### Root Cause Analysis

**Phase 19 Verification Failure:** Phase 19's verification (19-VERIFICATION.md) claimed all requirements were satisfied, but it did not verify the END-TO-END event chain required by Phase 20. The TRNS requirements are:

- TRNS-01: Transcribe job started when recording available ✓
- TRNS-02: Job naming format for correlation ✓
- TRNS-03: Transcript text stored in DynamoDB ✓
- TRNS-04: Failures don't block pool release ✓

**What's missing from Phase 19:** No requirement for Phase 19 to emit an event after TRNS-03 completes. The transcription pipeline was designed to be terminal (store and return), not to emit downstream events.

**Phase 20 Planning Error:** Phase 20's plan assumes Phase 19 emits the event:
- 20-01-PLAN.md line 137: "Detail-type: `Transcript Stored` (emitted by Phase 19 store-transcript handler)"
- 20-01-SUMMARY.md line 137: "Transcript Stored" is "emitted by Phase 19 store-transcript handler"

**But Phase 19 has no "store-transcript handler"** — it only has transcribe-completed handler, which doesn't emit events.

### Required Artifacts Verification

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/domain/session.ts` | Session interface with aiSummary and aiSummaryStatus fields | ✓ EXISTS & SUBSTANTIVE | Lines 79-84: Both fields present with proper TypeScript types. WIRED: Used in all repository functions. |
| `backend/src/repositories/session-repository.ts` | updateSessionAiSummary() function | ✓ EXISTS & SUBSTANTIVE | Lines 539-587: Selective UpdateExpression construction. WIRED: Called by store-summary.ts. |
| `backend/src/handlers/store-summary.ts` | EventBridge-triggered Lambda with Bedrock integration | ✓ EXISTS & SUBSTANTIVE | 80 lines. Invokes Bedrock correctly. WIRED: Lambda exists in CDK and is configured as EventBridge target. BUT: Never triggered because event is not emitted. |
| `backend/src/handlers/__tests__/store-summary.test.ts` | Unit tests for store-summary handler | ✓ EXISTS & SUBSTANTIVE | 9 tests all passing. BUT: Tests inject the event directly; they don't verify the event is actually emitted by transcribe-completed. |
| `infra/lib/stacks/session-stack.ts` | CDK wiring for StoreSummary Lambda and EventBridge rule | ✓ EXISTS & SUBSTANTIVE | EventBridge rule at lines 591-598 correctly configured to match `source='custom.vnl'` and `detailType='Transcript Stored'`. Targets set correctly. BUT: Listens for event that is never published. |
| `web/src/features/replay/SummaryDisplay.tsx` | Reusable React component for summary display | ✓ EXISTS & SUBSTANTIVE | 51 lines. Status-based rendering works correctly. WIRED: Imported by activity cards and ReplayViewer. BUT: Will only ever show "pending" state since aiSummaryStatus never transitions to 'available'. |
| `web/src/features/activity/BroadcastActivityCard.tsx` | Activity card with integrated summary | ✓ EXISTS & SUBSTANTIVE | SummaryDisplay rendered with truncation. WIRED: Used in HomePage. BUT: Summary will always be "coming soon...". |
| `web/src/features/activity/HangoutActivityCard.tsx` | Hangout card with integrated summary | ✓ EXISTS & SUBSTANTIVE | SummaryDisplay rendered with truncation. BUT: Summary will always be "coming soon...". |
| `web/src/features/replay/ReplayViewer.tsx` | Replay viewer with full summary display | ✓ EXISTS & SUBSTANTIVE | SummaryDisplay rendered without truncation. BUT: Summary will always be undefined. |

**All artifacts exist and code is correct, but the triggering event is not emitted.**

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| EventBridge TranscriptStoreRule | store-summary Lambda | Lambda target configured | ✓ WIRED | Rule defined at session-stack.ts:591-598. Target added at line 596. Permission added at lines 601-604. BUT: Rule never matches because event is not emitted. |
| Phase 19 transcribe-completed | EventBridge | Event emission | ✗ NOT_WIRED | **CRITICAL GAP**: transcribe-completed.ts has no EventBridgeClient import, no event emission code. After line 98 (successful transcript storage), handler should emit "Transcript Stored" event but does not. |
| store-summary handler | Bedrock | InvokeModelCommand | ✓ WIRED | Code exists at lines 43-47. Imports BedrockRuntimeClient. BUT: Handler unreachable. |
| store-summary handler | updateSessionAiSummary() | Function call | ✓ WIRED | Called at lines 56 and 70. BUT: Handler unreachable. |
| updateSessionAiSummary() | Session domain | Type definitions | ✓ WIRED | Function signature matches Session fields. BUT: Never called in production. |
| SummaryDisplay | Activity Cards | Component import | ✓ WIRED | Imported and rendered. BUT: Always shows pending state. |

**Critical link NOT_WIRED:** transcribe-completed → EventBridge event emission

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AI-01 | 20-01 | An AI-generated one-paragraph summary is automatically produced from the session transcript via Bedrock/Claude | ✗ NOT_SATISFIED | store-summary.ts implements Bedrock invocation correctly (lines 26-52). BUT: Handler never triggers because "Transcript Stored" event is not emitted by Phase 19. Bedrock code is unreachable. |
| AI-02 | 20-01 | AI summary text is stored on the session record in DynamoDB | ✗ NOT_SATISFIED | updateSessionAiSummary() exists and is correctly implemented. BUT: Never called because event never triggers. |
| AI-03 | 20-02 | AI summary (truncated to 2 lines) is displayed on recording cards on the homepage | ✗ NOT_SATISFIED | SummaryDisplay component with line-clamp-2 exists. BUT: Sessions never have aiSummaryStatus='available', so cards always show "Summary coming soon..." |
| AI-04 | 20-02 | Full AI summary is displayed in the replay info panel | ✗ NOT_SATISFIED | ReplayViewer.tsx renders SummaryDisplay. BUT: aiSummary is always undefined. |
| AI-05 | 20-02 | "Summary coming soon" placeholder is shown on cards while the AI pipeline is still processing | ✓ SATISFIED | SummaryDisplay shows placeholder text. But this is not a temporary state — it's permanent because the pipeline never starts. |

**Result:** 1/5 requirements satisfied. 4/5 cannot be satisfied because the triggering event is not emitted.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| transcribe-completed.ts | 98 | No event emission after transcript storage | 🛑 BLOCKER | Handler stores transcript to DynamoDB but does not emit "Transcript Stored" event to EventBridge. Phase 20 pipeline never triggers. This is the root cause of the failure. |
| store-summary.ts | Lines 26-52 | Bedrock code unreachable due to missing trigger event | 🛑 BLOCKER | Handler and all tests are correct, but the handler never receives the triggering event. |
| 20-01-SUMMARY.md | Line 137 | Assumption documented but not verified | ⚠️ WARNING | Summary states "emitted by Phase 19 store-transcript handler" but Phase 19 has no such handler. |
| 20-VERIFICATION.md | Line 22 | Claimed verification of event emission without checking Phase 19 | 🛑 BLOCKER | Previous verification stated "EventBridge rule triggers on 'Transcript Stored' event" but never verified that Phase 19 emits this event. |

**Blockers:** 2 critical issues prevent goal achievement.

### Test Results

**Backend Test Suite:** 244/244 tests passing ✓
- store-summary.test.ts: 9/9 passing (BUT: These are unit tests that inject the event directly, not integration tests verifying event emission)

**Frontend Test Suite:** 21/21 tests passing ✓
- SummaryDisplay.test.tsx: 10/10 passing

**CAVEAT:** Tests pass because they mock inputs. Integration between Phase 19 → Phase 20 is not tested.

## What Would Fix This

To achieve the Phase 20 goal, Phase 19's `transcribe-completed.ts` must be updated to emit the "Transcript Stored" event after successfully storing the transcript:

```typescript
// After line 98 in transcribe-completed.ts
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// After updateTranscriptStatus() succeeds:
const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION });
try {
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
} catch (error: any) {
  console.error('Failed to emit Transcript Stored event:', error.message);
  // Non-blocking: don't throw, log for observability
}
```

Additionally:
1. Phase 19 VERIFICATION.md should be re-run to note the missing event emission
2. Phase 19 must be planning-updated to include event emission in its implementation
3. Phase 20 should NOT proceed until Phase 19's event emission is verified working

## Summary

### What Works (Code-wise)
- ✓ Session domain model has aiSummary and aiSummaryStatus fields
- ✓ updateSessionAiSummary() repository function is correctly implemented
- ✓ store-summary handler correctly invokes Bedrock and handles errors
- ✓ EventBridge rule is configured correctly in CDK
- ✓ Frontend components are wired to display summaries
- ✓ All unit tests pass

### What Doesn't Work (Integration-wise)
- ✗ Phase 19 does not emit "Transcript Stored" event
- ✗ EventBridge rule has nothing to match on
- ✗ store-summary handler never receives trigger
- ✗ Bedrock is never invoked
- ✗ Sessions never receive AI summaries
- ✗ Users always see "Summary coming soon..." regardless of time passed

### Root Cause
Missing event emission in Phase 19's `transcribe-completed.ts` handler after successful transcript storage.

### Status
**PHASE GOAL NOT ACHIEVED** — The AI summary pipeline does not function end-to-end. Phase 19 must be updated to emit the "Transcript Stored" event before Phase 20 can be marked complete.

---

_Verified: 2026-03-06T21:30:00Z by Claude (gsd-verifier)_
_Re-verification: Previous claim of "passed" status was incorrect due to unverified assumption about Phase 19 event emission_
