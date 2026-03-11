---
phase: 19-transcription-pipeline
plan: 01-REV1
type: execute
wave: 1
depends_on: []
files_modified:
  - backend/src/handlers/transcribe-completed.ts
  - backend/src/handlers/__tests__/transcribe-completed.test.ts
autonomous: true
requirements: [TRNS-01, TRNS-02, TRNS-03, TRNS-04]
must_haves:
  truths:
    - "After transcript is successfully stored, a 'Transcript Stored' EventBridge event is emitted with source='custom.vnl' and detailType='Transcript Stored'"
    - "EventBridge event emission is non-blocking and does not prevent transcript storage"
    - "All tests pass with EventBridgeClient mocked"
  artifacts:
    - path: "backend/src/handlers/transcribe-completed.ts"
      provides: "EventBridge event emission after successful transcript storage"
      min_lines: 5
    - path: "backend/src/handlers/__tests__/transcribe-completed.test.ts"
      provides: "Unit tests for transcript storage and EventBridge event emission"
      min_lines: 30
  key_links:
    - from: "transcribe-completed.ts"
      to: "EventBridge rule (session-stack.ts:591-598)"
      via: "Emits event with Source='custom.vnl' and DetailType='Transcript Stored'"
      pattern: "Source.*custom\\.vnl"
    - from: "transcribe-completed.ts"
      to: "updateTranscriptStatus()"
      via: "Event emitted AFTER successful transcript storage"
      pattern: "await updateTranscriptStatus.*then.*PutEventsCommand"
---

<objective>
Fix critical bug in Phase 19's transcribe-completed.ts: the EventBridge event is emitted with wrong source identifier ('transcription-pipeline' instead of 'custom.vnl'), causing the event to not match the CDK rule and Phase 20's AI Summary pipeline to never be triggered. Correct the source to 'custom.vnl' and add comprehensive test coverage.

Purpose: Unblock Phase 20 (AI Summary Pipeline) by ensuring "Transcript Stored" events reach the EventBridge rule configured in session-stack.ts
Output: Corrected transcribe-completed.ts with proper event source + full test suite
</objective>

<execution_context>
@/Users/connorhoehn/.claude/get-shit-done/workflows/execute-plan.md
@/Users/connorhoehn/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/19-transcription-pipeline/19-RESEARCH.md

## Current Implementation Issue

**File:** backend/src/handlers/transcribe-completed.ts (lines 97 and 135)
**Current code:**
```typescript
Source: 'transcription-pipeline',  // WRONG
DetailType: 'Transcript Stored',   // CORRECT
```

**CDK rule expecting (session-stack.ts:591-598):**
```typescript
eventPattern: {
  source: ['custom.vnl'],          // EXPECTS THIS
  detailType: ['Transcript Stored'],
}
```

**Result:** Event is emitted but never matches the rule. Phase 20's store-summary.ts Lambda is never invoked.

## What Needs to Change

**Single fix:** Change `Source: 'transcription-pipeline'` to `Source: 'custom.vnl'` on lines 97 and 135.

**Test coverage to add:** Mock EventBridgeClient and verify:
1. Event is emitted with correct Source, DetailType, and Detail structure
2. Event emission is non-blocking (doesn't throw even if EventBridgeClient fails)
3. Transcript is stored before event is emitted (ordering)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix EventBridge event source in transcribe-completed.ts</name>
  <files>backend/src/handlers/transcribe-completed.ts</files>
  <action>
Update transcribe-completed.ts to emit events with the correct EventBridge source that matches the CDK rule.

Changes required:

1. Line 97: Change `Source: 'transcription-pipeline'` to `Source: 'custom.vnl'`
2. Line 135: Change `Source: 'transcription-pipeline'` to `Source: 'custom.vnl'`

Both occurrences are in PutEventsCommand calls (one for empty transcript case at line 97, one for normal case at line 135).

**Why:** The EventBridge rule in session-stack.ts:592 listens for events with `source: ['custom.vnl']`. Using 'transcription-pipeline' causes the event to not match the rule, so Phase 20's handler is never triggered.

The rest of the event structure is correct:
- DetailType: 'Transcript Stored' ✓
- Detail includes { sessionId, transcriptS3Uri, timestamp } ✓
- Non-blocking try/catch wrapper ✓

Only the Source field needs correction.

Preserve all other code, comments, and logging statements.
  </action>
  <verify>
`grep -n "Source: 'custom.vnl'" /Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/transcribe-completed.ts | wc -l` returns 2 (both lines 97 and 135 corrected); `grep -n "Source: 'transcription-pipeline'" /Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/transcribe-completed.ts | wc -l` returns 0 (old source completely removed)
  </verify>
  <done>Both EventBridge event emissions use Source='custom.vnl' to match the CDK rule eventPattern</done>
</task>

<task type="auto">
  <name>Task 2: Add test suite for transcribe-completed handler</name>
  <files>backend/src/handlers/__tests__/transcribe-completed.test.ts</files>
  <action>
Create new test file backend/src/handlers/__tests__/transcribe-completed.test.ts with comprehensive test coverage for the transcribe-completed handler.

Test structure (use Jest + existing mocking patterns from other handler tests):

1. **Setup section:** Mock EventBridgeClient, S3Client, DynamoDB document client

2. **Test: "stores transcript when Transcribe job completes successfully"**
   - Mock S3 to return valid transcribe output JSON with transcript text
   - Mock updateTranscriptStatus to resolve
   - Call handler with COMPLETED event
   - Verify updateTranscriptStatus called with ('available', s3Uri, plainText)
   - Verify plainText is the extracted transcript text

3. **Test: "emits Transcript Stored event with correct source and detail after storing transcript"**
   - Mock S3 and updateTranscriptStatus
   - Call handler with COMPLETED event
   - Verify EventBridgeClient.send called with PutEventsCommand
   - Verify Entries[0].Source === 'custom.vnl'
   - Verify Entries[0].DetailType === 'Transcript Stored'
   - Verify Entries[0].Detail includes sessionId
   - Verify event emission happens AFTER updateTranscriptStatus (check call order)

4. **Test: "event emission is non-blocking on EventBridge API error"**
   - Mock S3 and updateTranscriptStatus
   - Mock EventBridgeClient.send to throw error
   - Call handler
   - Verify handler completes without throwing (promise resolves)
   - Verify transcript was still stored (updateTranscriptStatus was called)
   - Verify error was logged

5. **Test: "handles empty transcript gracefully"**
   - Mock S3 to return JSON with empty transcript array
   - Call handler
   - Verify updateTranscriptStatus called with status='available' and plainText=''
   - Verify event is still emitted
   - Verify handler completes successfully

6. **Test: "updates session status to failed when Transcribe job fails"**
   - Call handler with FAILED status
   - Verify updateTranscriptStatus called with status='failed'
   - Verify handler completes without throwing

7. **Test: "parses sessionId correctly from job name format vnl-{sessionId}-{epochMs}"**
   - Call handler with job name "vnl-session-123-1234567890"
   - Verify sessionId extracted as "session-123" (everything between first and second hyphen)
   - Verify this sessionId is passed to all functions

8. **Test: "handles malformed job name gracefully"**
   - Call handler with job name "invalid-format"
   - Verify handler returns early without error
   - Verify no DynamoDB calls made

Use consistent mocking patterns from recording-ended.test.ts and other handler tests in the codebase. Keep tests focused and fast (<100ms total).
  </action>
  <verify>
`npm test -- backend/src/handlers/__tests__/transcribe-completed.test.ts 2>&1 | grep -E "PASS|FAIL|passed|failed" | tail -1` shows "PASS" or "passed"; `npm test -- backend/src/handlers/__tests__/transcribe-completed.test.ts 2>&1 | grep -E "^\s+✓|^\s+✗" | wc -l` returns >= 8 (test count); `grep -c "test\|it(" /Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/__tests__/transcribe-completed.test.ts` returns >= 8
  </verify>
  <done>Test file exists with at least 8 test cases covering normal flow, event emission, error handling, empty transcript, failure modes, job name parsing, and malformed names</done>
</task>

</tasks>

<verification>
Run all tests after changes:

```bash
cd /Users/connorhoehn/Projects/videonowandlater/backend
npm test -- transcribe-completed
```

Must show:
- All tests pass (0 failures)
- EventBridgeClient mock is used
- PutEventsCommand is mocked and verified in tests
- Source field shows 'custom.vnl' in test expectations

Verify the fix integrates with CDK rule:

```bash
grep -A 5 "TranscriptStoreRule" /Users/connorhoehn/Projects/videonowandlater/infra/lib/stacks/session-stack.ts | grep -E "source|detailType"
```

Should show:
- source: ['custom.vnl']
- detailType: ['Transcript Stored']

And verify transcribe-completed.ts now matches:

```bash
grep "Source: 'custom.vnl'" /Users/connorhoehn/Projects/videonowandlater/backend/src/handlers/transcribe-completed.ts
```

Should show exactly 2 matches (both event emission locations).
</verification>

<success_criteria>
- Source field changed from 'transcription-pipeline' to 'custom.vnl' on both lines 97 and 135
- No references to 'transcription-pipeline' source remain in transcribe-completed.ts
- Test file created with 8+ comprehensive test cases
- All tests pass (npm test exit code 0)
- EventBridgeClient and PutEventsCommand are mocked in tests
- Tests verify event emission happens after updateTranscriptStatus succeeds
- Tests verify non-blocking behavior on EventBridge API errors
- Event source='custom.vnl' now matches CDK rule eventPattern
- Phase 20's store-summary handler will now be triggered when transcript is stored
</success_criteria>

<output>
After completion, create `.planning/phases/19-transcription-pipeline/19-01-PLAN-REV1-SUMMARY.md` documenting:
- Source field fix applied (lines 97 and 135 changed)
- Test file created with test count and coverage areas
- Test execution results (npm test exit code)
- Verification that CDK rule pattern now matches event source
- Any deviations or issues encountered
</output>
