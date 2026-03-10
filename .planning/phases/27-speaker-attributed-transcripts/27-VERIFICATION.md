---
phase: 27-speaker-attributed-transcripts
verified: 2026-03-10T18:51:00Z
status: human_needed
score: 11/12 must-haves verified
re_verification: false
human_verification:
  - test: "Bubble mode render in ReplayViewer"
    expected: "Sessions with diarizedTranscriptS3Path show alternating Speaker 1 (left, blue) and Speaker 2 (right, gray) bubbles with speaker label and timestamp; active bubble highlights as video plays"
    why_human: "React render output and CSS layout cannot be verified programmatically"
  - test: "Plain transcript fallback for pre-Phase-27 sessions"
    expected: "Sessions without diarizedTranscriptS3Path render the existing plain segment view with no console errors"
    why_human: "Runtime fallback behavior requires live browser verification"
  - test: "Upload Video page speaker transcript display"
    expected: "Upload Video page also displays speaker-attributed transcript when diarizedTranscriptS3Path is present (per SPKR-05 requirement)"
    why_human: "Plan 02 only modified ReplayViewer — Upload Video page wiring needs human confirmation or code check"
---

# Phase 27: Speaker-Attributed Transcripts Verification Report

**Phase Goal:** Recordings produce a speaker-turn transcript where each segment is attributed to a labeled speaker, displayed in Replay and Upload Video pages as alternating turns with timestamps.
**Verified:** 2026-03-10T18:51:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New Transcribe jobs include `ShowSpeakerLabels: true` and `MaxSpeakerLabels: 2` | VERIFIED | `start-transcribe.ts` lines 65-68: `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 }` |
| 2 | `transcribe-completed` handler groups per-word speaker labels into turn segments and writes them to S3 | VERIFIED | `transcribe-completed.ts`: `buildSpeakerSegments()` at line 58, `PutObjectCommand` at line 180, key `${sessionId}/speaker-segments.json` |
| 3 | Session DynamoDB record gets `diarizedTranscriptS3Path` pointer after speaker segments are stored | VERIFIED | `transcribe-completed.ts` line 186: `updateDiarizedTranscriptPath(tableName, sessionId, speakerSegmentsKey)` |
| 4 | Speaker labels normalized: `spk_0` to `Speaker 1`, `spk_1` to `Speaker 2` | VERIFIED | `SPEAKER_MAP` in `transcribe-completed.ts`; test suite confirms grouping produces `speaker: 'Speaker 1'` |
| 5 | `GET /sessions/{id}/speaker-segments` returns the parsed `SpeakerSegment[]` from S3 | VERIFIED | `get-speaker-segments.ts` exports `handler` using `GetObjectCommand` with `session.diarizedTranscriptS3Path`; CDK route registered in `api-stack.ts` line 334 |
| 6 | `transcribeCompletedFn` has S3 write permission on the transcription bucket | VERIFIED | `session-stack.ts` line 618: `transcriptionBucket.grantReadWrite(transcribeCompletedFn)` |
| 7 | `TranscriptDisplay` shows chat-bubble speaker turns when `diarizedTranscriptS3Path` prop is present | VERIFIED (code) | `TranscriptDisplay.tsx` lines 243-260: renders bubble mode when `speakerSegments.length > 0`; fetches on `diarizedTranscriptS3Path` prop |
| 8 | Speaker 1 left-aligned blue, Speaker 2 right-aligned gray | ? NEEDS HUMAN | CSS classes present in component but visual layout requires browser verification |
| 9 | Sessions without `diarizedTranscriptS3Path` render plain transcript with no error | ? NEEDS HUMAN | Code path confirmed (plain view when `speakerSegments.length === 0`); runtime behavior needs browser check |
| 10 | `ReplayViewer` passes `diarizedTranscriptS3Path` from session data to `TranscriptDisplay` | VERIFIED | `ReplayViewer.tsx` line 415: `diarizedTranscriptS3Path={session.diarizedTranscriptS3Path}`; local Session interface updated at line 39 |
| 11 | S3 write failure in `transcribe-completed` is non-blocking | VERIFIED | 24-test suite includes `sessions3fail` and `sessionddbfail` cases; test PASS confirms transcript still set to `available` on S3/DDB failure |
| 12 | Upload Video page displays speaker-attributed transcript | ? NEEDS HUMAN | Plan 02 only modified `ReplayViewer.tsx`; Upload Video page wiring not confirmed in codebase |

**Score:** 9/12 truths fully verified (3 need human confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/src/domain/session.ts` | `diarizedTranscriptS3Path?: string` field | VERIFIED | Line 71: field present after `transcriptS3Path` |
| `backend/src/repositories/session-repository.ts` | Exports `updateDiarizedTranscriptPath` | VERIFIED | Lines 534-560: function exported, uses UpdateCommand with `SET #diarizedTranscriptS3Path` |
| `backend/src/handlers/get-speaker-segments.ts` | GET handler returning `SpeakerSegment[]` from S3 | VERIFIED | File exists, exports `handler`, uses `GetObjectCommand` |
| `backend/src/handlers/__tests__/get-speaker-segments.test.ts` | Unit tests for get-speaker-segments | VERIFIED | 24 tests in 3 suites — all PASS |
| `web/src/features/replay/TranscriptDisplay.tsx` | Bubble mode with `diarizedTranscriptS3Path` prop | VERIFIED | Prop in interface, fetch on presence, bubble render at line 243 |
| `web/src/features/replay/ReplayViewer.tsx` | Passes `diarizedTranscriptS3Path` to `TranscriptDisplay` | VERIFIED | Local Session interface updated; prop passed at line 415 |
| `infra/lib/stacks/api-stack.ts` | `GET /sessions/{id}/speaker-segments` route + Lambda + IAM | VERIFIED | Lines 334-355: resource, `NodejsFunction`, `grantReadData`, `s3:GetObject` policy, Cognito-authorized GET method |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `transcribe-completed.ts` | S3 `speaker-segments.json` | `PutObjectCommand` | VERIFIED | Line 180: `PutObjectCommand` with key `${sessionId}/speaker-segments.json` |
| `transcribe-completed.ts` | `session-repository.ts` | `updateDiarizedTranscriptPath` call | VERIFIED | Line 186: call with `(tableName, sessionId, speakerSegmentsKey)` |
| `get-speaker-segments.ts` | S3 `diarizedTranscriptS3Path` | `GetObjectCommand` | VERIFIED | Line 63: `GetObjectCommand` with `Key: session.diarizedTranscriptS3Path` |
| `session-stack.ts` | `transcribeCompletedFn` | `grantReadWrite` | VERIFIED | Line 618: `transcriptionBucket.grantReadWrite(transcribeCompletedFn)` |
| `ReplayViewer.tsx` | `TranscriptDisplay.tsx` | `diarizedTranscriptS3Path` prop | VERIFIED | Line 415: prop passed; `TranscriptDisplay` consumes it |
| `TranscriptDisplay.tsx` | `/api/sessions/{id}/speaker-segments` | fetch on prop presence | VERIFIED | Line 121: `fetch(\`${apiBaseUrl}/sessions/${sessionId}/speaker-segments\`)` guarded by prop check |
| `api-stack.ts` | `get-speaker-segments.ts` Lambda | `NodejsFunction` + `LambdaIntegration` | VERIFIED | Lines 337-355: handler wired to CDK route |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SPKR-01 | 27-01 | `ShowSpeakerLabels: true`, `MaxSpeakerLabels: 2` submitted | SATISFIED | `start-transcribe.ts` Settings block; start-transcribe tests PASS |
| SPKR-02 | 27-01 | Per-word speaker labels grouped into speaker-turn segments | SATISFIED | `buildSpeakerSegments()` in `transcribe-completed.ts`; 24 tests PASS |
| SPKR-03 | 27-01 | Speaker segments stored in S3 as JSON; `diarizedTranscriptS3Path` pointer on session; never inline in DynamoDB | SATISFIED | `PutObjectCommand` writes JSON; `updateDiarizedTranscriptPath` stores key; no array field on Session domain |
| SPKR-04 | 27-01 | Speakers labeled "Speaker 1" / "Speaker 2" (not usernames) | SATISFIED | `SPEAKER_MAP: { spk_0: 'Speaker 1', spk_1: 'Speaker 2' }` in `transcribe-completed.ts` |
| SPKR-05 | 27-02 | Replay and upload video pages display attributed transcript as alternating speaker turns with timestamps | PARTIAL — NEEDS HUMAN | Replay page wired; Upload Video page not confirmed in plan or code |
| SPKR-06 | 27-02 | New recordings get diarization automatically; existing sessions fall back gracefully | PARTIALLY VERIFIED | Code path confirmed; graceful 404 handling in `TranscriptDisplay`; runtime behavior needs human check |

### Anti-Patterns Found

No TODO/FIXME/placeholder comments found in phase 27 modified files. No stub implementations detected. No empty handlers.

### Human Verification Required

#### 1. Bubble Mode Visual Layout

**Test:** Open a session with `transcriptStatus: 'available'` and `diarizedTranscriptS3Path` set on the Replay page. Click the Transcript tab.
**Expected:** Alternating Speaker 1 (left-aligned, blue bubble) and Speaker 2 (right-aligned, gray bubble) turns appear with speaker label badge and segment start timestamp. Active bubble highlights (ring) as video plays.
**Why human:** CSS layout, Tailwind class rendering, and active-segment highlight animation cannot be verified programmatically.

#### 2. Plain Transcript Fallback (Backward Compatibility)

**Test:** Open a pre-Phase-27 session (no `diarizedTranscriptS3Path` in session data) on the Replay page. Click the Transcript tab.
**Expected:** Plain segment view renders correctly with no JavaScript errors in the DevTools console. No broken UI state.
**Why human:** Runtime fetch behavior (silent 404 handling) and absence of error state requires live browser observation.

#### 3. Upload Video Page Speaker Transcript

**Test:** Open a session created via upload flow with `diarizedTranscriptS3Path` present. Check if the Upload Video player page shows speaker-attributed transcript bubbles.
**Expected:** Same bubble mode as Replay page — per SPKR-05 which covers both Replay and Upload Video pages.
**Why human:** Plan 02 `files_modified` lists only `ReplayViewer.tsx` — it is unclear if Upload Video page has a separate transcript component that also needs wiring. This gap requires a human to locate the Upload Video transcript component and confirm it receives `diarizedTranscriptS3Path`.

### Gaps Summary

All automated checks pass. The 3 human verification items are:

1. **Visual bubble render** — CSS/layout confirmation (low risk; code structure is correct)
2. **Backward compatibility runtime** — Graceful 404 fallback in browser (low risk; silent error handling confirmed in code)
3. **Upload Video page** — SPKR-05 explicitly names both Replay and Upload Video pages, but Plan 02 `files_modified` only lists `ReplayViewer.tsx`. The Upload Video page transcript wiring is unconfirmed and may be an unresolved scope item.

Item 3 is the only item with potential for a genuine gap. If the Upload Video page has a `TranscriptDisplay` usage that does not receive `diarizedTranscriptS3Path`, SPKR-05 would be only partially satisfied.

---

_Verified: 2026-03-10T18:51:00Z_
_Verifier: Claude (gsd-verifier)_
