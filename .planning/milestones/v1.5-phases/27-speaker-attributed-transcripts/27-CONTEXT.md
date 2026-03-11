# Phase 27: Speaker-Attributed Transcripts - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Modify the transcription pipeline to request speaker diarization from Transcribe, then parse and store speaker-turn segments in S3. Update `TranscriptDisplay.tsx` to render alternating speaker-labeled turns. Existing sessions without diarization data fall back gracefully to plain transcript. Upload Video page (Phase 29-30) will also use this component — but that page itself is out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Transcribe job parameters (start-transcribe.ts)
- Add `Settings: { ShowSpeakerLabels: true, MaxSpeakerLabels: 2 }` to `StartTranscriptionJobCommand`
- `MaxSpeakerLabels: 2` — matches typical two-participant recording; Transcribe handles single-speaker sessions fine

### Speaker segment parsing (transcribe-completed.ts)
- Read `speaker_label` directly from each word item in `results.items[N]` (the `alternatives[0].speaker_label` field on each pronunciation item)
- Do NOT rely on the top-level `speaker_labels.segments` array — word-level attribution is more granular and already present on each item
- Group consecutive words with the same speaker label into turn segments: `{ speaker: 'spk_0', startTime, endTime, text }`
- Normalize speaker IDs to display labels: `spk_0` → `"Speaker 1"`, `spk_1` → `"Speaker 2"` — no username mapping (composite audio makes it impossible)

### Storage (transcribe-completed.ts)
- Store compact `speakerSegments` array as JSON in S3 at `${sessionId}/speaker-segments.json` (same transcription bucket)
- Write `diarizedTranscriptS3Path` pointer on the session DynamoDB record — NEVER store segment arrays inline in DynamoDB (400KB item limit risk on long recordings)
- Keep existing `transcriptS3Path` and `transcriptStatus = 'available'` flow unchanged

### Backward compatibility
- Sessions without `diarizedTranscriptS3Path` continue to use existing `TranscriptDisplay.tsx` plain transcript path — no error, no missing state
- `get-transcript` backend handler: add a separate `GET /sessions/{sessionId}/speaker-segments` endpoint (or extend existing endpoint with a `?diarized=true` query param) to serve the S3 JSON

### Frontend display (TranscriptDisplay.tsx)
- Extend the existing `TranscriptDisplay.tsx` component (do NOT create a parallel component)
- Add a `diarizedTranscriptS3Path` prop (optional) — when present, fetch and render speaker turns; when absent, render existing plain segment view
- Speaker turns displayed as alternating blocks: left-aligned "Speaker 1" (blue accent), right-aligned "Speaker 2" (gray accent) — chat-bubble style to make attribution instantly clear
- Each turn shows the speaker label badge + segment start timestamp above the text block
- Active-segment highlighting from `currentTime` continues to work the same way (highlight the turn block containing the current timestamp)

### Claude's Discretion
- Exact Tailwind classes for speaker bubble styling (color shades, border radius, padding)
- Whether to use a new API endpoint or query param for fetching speaker segments
- Error handling when S3 fetch of speaker segments fails (graceful fallback to plain transcript)

</decisions>

<specifics>
## Specific Ideas

- Speaker bubbles should feel like a two-participant iMessage / WhatsApp conversation — left vs right alignment makes speaker attribution visually instant without reading labels
- The timestamp badge per turn (not per word) keeps it readable — one timestamp at the top of each speaker turn block

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TranscriptDisplay.tsx` (`web/src/features/replay/TranscriptDisplay.tsx`): Already fetches transcript, parses `results.items`, groups by 1-second pause, highlights active segment, auto-scrolls — extend this, don't rewrite
- `TranscriptDisplayProps`: `{ sessionId, currentTime, authToken }` — add optional `diarizedTranscriptS3Path?: string`
- `start-transcribe.ts`: Already calls `StartTranscriptionJobCommand` — add `Settings` field
- `transcribe-completed.ts`: Already processes Transcribe output and writes to DynamoDB — add speaker segment parsing + S3 write here

### Established Patterns
- S3 storage: transcription bucket env var `TRANSCRIPTION_BUCKET`, same pattern as `transcriptS3Path`
- DynamoDB session update: `UpdateCommand` with `updateSessionTranscriptStatus` pattern in `session-repository.ts`
- Backend transcript API: `GET /sessions/{sessionId}/transcript` handler in `get-transcript.ts` — follow same structure for speaker segments endpoint
- Auth headers: `Authorization: Bearer ${authToken}` — already in `TranscriptDisplay.tsx`
- Powertools Logger: module-scope init + `appendPersistentKeys({ sessionId })` (Phase 25 pattern)

### Integration Points
- `ReplayViewer.tsx` passes `transcriptStatus` and renders `<TranscriptDisplay>` when `transcriptStatus === 'available'` — needs to also pass `diarizedTranscriptS3Path` from session data
- `UploadViewer.tsx` will use the same extended `TranscriptDisplay` component (Phase 29-30 wires it in)
- `session-stack.ts` CDK: `get-transcript` Lambda already exists — new speaker-segments endpoint needs its own route or extends same Lambda

</code_context>

<deferred>
## Deferred Ideas

- Username mapping for speaker labels ("Connor" instead of "Speaker 1") — impossible from composite audio; future phase if per-track audio is added
- More than 2 speakers — MaxSpeakerLabels: 2 is fixed for v1.5; revisit if hangouts expand beyond pairs

</deferred>

---

*Phase: 27-speaker-attributed-transcripts*
*Context gathered: 2026-03-10*
