# Feature Research

**Domain:** Live video platform — activity feed, intelligence layer, AI summaries (v1.2)
**Researched:** 2026-03-05 (Updated for v1.2 milestone; v1.1 features preserved)
**Confidence:** HIGH (AWS official docs verified; platform UX patterns verified via multiple sources)

---

## Context: What v1.1 Already Ships

The following features are complete and must NOT be re-researched:

- Live broadcasting (IVS one-to-many) + auto-recording to S3
- Multi-participant hangouts (IVS RealTime, up to 5 participants)
- Real-time chat (IVS Chat) + chat persistence + synchronized replay
- Reactions (live floating emoji + replay timeline)
- Replay viewer with HLS playback, synchronized chat, reaction timeline
- Home feed: full-page grid of recordings (RecordingFeed component)
- Session lifecycle: creating -> live -> ending -> ended in DynamoDB

**v1.2 adds on top of this foundation.** All five new feature areas are additive.

---

## v1.2 Feature Landscape

### Table Stakes (Users Expect These)

Features that users will assume exist once they see the activity-aware design. Missing any of these makes the UI feel broken or half-finished.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Activity feed shows all session types | Once a feed exists, users expect both broadcasts AND hangouts in it — filtering one out creates confusion | LOW | Hangouts that have no recording tile need their own activity card representation |
| Hangout card shows who was there | Every group communication platform (Slack, Discord, Zoom) persists participant lists in history | MEDIUM | Requires tracking participant join events; must persist to DynamoDB in real time, not reconstructed after the fact |
| Session duration on activity cards | Users need temporal context ("this was a 45-minute session") — without duration, cards lack weight | LOW | Duration already stored as `recordingDuration` on BROADCAST sessions via recording-ended event; HANGOUT sessions must store `endedAt - startedAt` as a separate field or compute from existing timestamps |
| Timestamp / relative time on activity cards | "2 hours ago" / "yesterday" — absolute table stakes for any feed | LOW | Already implemented in `formatDate()` in RecordingFeed.tsx; reuse pattern |
| Reaction counts visible without opening replay | Users scrolling a feed expect to see social proof data (likes, reactions) on cards — clicking to find out is friction | MEDIUM | Requires aggregating per-type counts at session end and storing them on the session record; not readable in real-time from the raw reactions table |
| Horizontal recording slider for broadcasts | Netflix/Disney+/YouTube-style horizontal scrollable row is the dominant discovery pattern for video content since 2020 | MEDIUM | Scroll snap + peek pattern: 3-4 cards visible, right edge bleeds to signal more content; CSS `overflow-x: auto` + `scroll-snap-type` |
| AI summary visible at a glance | Once AI summaries exist on recording cards, users expect to read them before clicking play — burying them behind a click removes the value | MEDIUM | 1-2 line truncated preview on card; full text in replay info panel; must handle "summary unavailable" gracefully |

### Differentiators (Competitive Advantage)

Features that genuinely differentiate this platform. Not expected, but highly valued once experienced.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hangout activity cards (non-recording tile) | Hangouts that don't have a playable recording should still show as rich social history — Discord/Slack show this, streaming platforms don't | HIGH | New card type: avatar row for participants, message count, duration, timestamp; requires dedicated backend data (participant snapshot, message count stored at session end) |
| AI-generated 1-paragraph summary on recording cards | Users can quickly decide if a recording is worth watching — Prime Video X-Ray Recaps uses same pattern with Amazon Bedrock | HIGH | Transcript → Bedrock/Claude → summary → stored on session record; pipeline is async (3-5 min delay typical); display "Summary coming soon" while processing |
| Reaction summary counts per type displayed on cards | "42 fire, 18 heart" — social proof that communicates session energy at a glance; YouTube/Twitch don't surface aggregate counts on cards | MEDIUM | Aggregate reactions at session end (Lambda triggered by recording-ended event); store as `reactionCounts: { fire: 42, heart: 18, ... }` on session record |
| Transcription pipeline for all recordings | Makes sessions searchable and enables AI summaries — no competitor at this scale ships auto-transcription of casual live sessions | HIGH | S3 recording → Lambda → Amazon Transcribe → transcript JSON → S3 → Lambda → parse plain text → DynamoDB; HLS fMP4 segments are NOT directly accepted by Transcribe; need MediaConvert or use the `media/` MP4 file within the S3 recording prefix |
| Activity feed (mixed broadcast + hangout) below recording slider | Two-zone home page: "Watch replays" (horizontal slider) + "What happened" (activity feed list) — mirrors the pattern YouTube uses with shorts vs. long-form | MEDIUM | Activity feed is a sorted list of session cards, NOT a grid; cards show type-specific metadata; broadcasts show thumbnail + duration + reaction count; hangouts show participant avatars + message count |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time transcription during live session | "See the transcript as it's happening" sounds useful | Amazon Transcribe Streaming requires a different SDK, WebSocket connections, and session management — doubles the transcription complexity with limited v1.2 payoff | Async batch transcription only; show transcript in replay page after recording ends |
| Full transcript display in replay viewer | "I want to read the whole transcript" seems natural | Transcripts for a 30-minute session are 5,000+ words; displaying them inline overwhelms the replay UI; users rarely read full transcripts | Show AI summary (1 paragraph) on card and replay page; link to raw transcript as a downloadable/expandable option only if users request it |
| AI chat summary (who said what) | Speaker-diarized chat-based summary sounds comprehensive | IVS Chat stores messages but does NOT preserve speaker attribution with enough fidelity for AI diarization; mixing transcript + chat creates hallucination risk | Transcript-only summary; mention "X participants were in this hangout" in the summary prompt for context |
| Per-user reaction breakdown | "Show me who reacted with what" — analytics-style detail | Reactions were designed as anonymous (volume signal, not identity signal); per-user breakdown contradicts the anonymous-by-default UX; also creates privacy concerns | Aggregate counts only: `{ fire: 42, heart: 18 }` — no per-user attribution |
| AI-powered content search | "Search for sessions where topic X was discussed" | Requires vector embedding + semantic search infrastructure (OpenSearch / Bedrock Knowledge Bases) — multi-week effort orthogonal to v1.2 | Store transcript text as plain string in DynamoDB; build keyword search in v2 once transcript corpus exists |
| Automatic video chapters from transcript | "Split the video into sections based on topic changes" | Requires topic modeling (NLP pipeline) on top of transcription; adds weeks of ML complexity | Ship 1-paragraph summary in v1.2; add chapters in v2 if users request structured navigation |
| Hangout participant message attribution on activity card | "Show who sent the most messages" — leaderboard data | Reveals private information about who was most active; creates social pressure dynamics; not standard in group chat history UIs | Show total message count only, not per-user breakdown |

---

## Feature Dependencies

```
[v1.1 Foundation] ──already-complete──> Session lifecycle, recordings, chat, reactions, replay

[v1.2 New Features]

Reaction Summary Counts
  └──requires──> Reactions stored per session (v1.1 complete)
  └──requires──> Session-end trigger (recording-ended Lambda, already exists)
  └──adds──> reactionCounts field on Session DynamoDB record
  └──surfaces-on──> Recording cards (horizontal slider)
  └──surfaces-on──> Replay info panel

Hangout Participant Tracking
  └──requires──> IVS RealTime join-hangout handler (v1.1 complete)
  └──requires──> New participant join/leave event capture (NEW: client calls API or EventBridge)
  └──adds──> participants list on Session DynamoDB record
  └──adds──> messageCount field on Session DynamoDB record (populated at session end)
  └──enables──> Hangout Activity Cards on homepage

Homepage Redesign
  └──requires──> Recordings exist (v1.1 complete)
  └──requires──> Hangout sessions exist (v1.1 complete)
  └──requires──> Hangout participant data (NEW: v1.2 Hangout Tracking)
  └──requires──> Reaction summary counts (NEW: v1.2 Reaction Summaries)
  └──replaces──> RecordingFeed full-page grid
  └──renders──> Horizontal recording slider (broadcasts only, with thumbnail + reaction count)
  └──renders──> Activity feed list (all session types, chronological)

Transcription Pipeline
  └──requires──> Recording available in S3 (recording-ended event, v1.1 complete)
  └──requires──> Recording S3 path stored on session (v1.1 complete)
  └──CRITICAL DEPENDENCY──> Recording must be in MP4 format for Transcribe
      Transcribe does NOT accept HLS M3U8 playlists
      IVS stores recordings as HLS (fMP4 segments + manifest)
      Options:
        A) Use AWS MediaConvert to convert HLS → MP4 after recording-ended (adds ~2 min latency)
        B) Point Transcribe at an individual fMP4 segment (partial transcript only)
        C) Use EventBridge + Lambda to download HLS and concatenate via FFmpeg Lambda layer (complex)
      Recommended: Option A (MediaConvert job triggered from recording-ended Lambda)
  └──adds──> transcriptS3Path field on Session DynamoDB record
  └──adds──> transcriptStatus field: pending | processing | available | failed

AI Summary Pipeline
  └──requires──> Transcript available (NEW: v1.2 Transcription Pipeline)
  └──requires──> Bedrock access enabled in AWS account (Claude Haiku model ID: anthropic.claude-3-haiku-20240307-v1:0)
  └──triggered-by──> Transcribe job completion EventBridge event
  └──adds──> aiSummary field on Session DynamoDB record (1 paragraph)
  └──adds──> aiSummaryStatus field: pending | processing | available | failed
  └──surfaces-on──> Recording cards (truncated, 1-2 lines)
  └──surfaces-on──> Replay info panel (full text)
```

### Dependency Notes

- **Reaction summaries require session-end trigger:** The recording-ended Lambda already fires at session end — this is where aggregation logic should live. Do NOT add a separate Lambda; extend the existing handler.
- **Hangout tracking requires a capture point at join time:** The `join-hangout` handler already runs when a participant joins. This is the correct place to append to a `participants` array on the session record. No new EventBridge event needed — modify the existing handler.
- **Transcription pipeline blocks AI summaries:** AI summary cannot start until transcript exists. The pipeline is serial: recording-ended → MediaConvert → Transcribe → summary. Plan 5-10 minutes from recording end to summary available.
- **Homepage redesign depends on reaction counts:** Cards in the horizontal slider should show reaction counts. If reaction aggregation ships after the redesign, cards will show empty reaction slots initially — acceptable, but plan the phase order accordingly (aggregation first, then redesign).
- **AI summary has no hard dependency on homepage redesign:** Summary can be displayed on existing cards or new cards — the surface changes independently of the pipeline.

---

## MVP Definition

### Launch With (v1.2 Core):

- [ ] **Reaction summary counts aggregated at session end** — Extend recording-ended Lambda to query all reactions for the session and write `reactionCounts: { fire: N, heart: N, ... }` to the session record. Display per-type counts on replay info panel and recording cards.
- [ ] **Hangout participant tracking** — Modify join-hangout handler to append `userId` to a `participants` array on the session record. At session end, write `messageCount` by querying chat message count. Store `durationMs` computed from `endedAt - startedAt`.
- [ ] **Hangout activity cards on homepage** — New card type in the activity feed: avatar row (first 4 participants + overflow count), message count, duration, timestamp. Rendered in the activity feed list below the recording slider.
- [ ] **Homepage redesign: horizontal slider + activity feed** — Replace RecordingFeed grid with two zones: (1) horizontal scrollable slider of BROADCAST recordings (3-4 visible, scroll snap, thumbnail peek), (2) chronological activity feed list below (all session types).
- [ ] **Transcription pipeline** — recording-ended → MediaConvert MP4 conversion → Transcribe job start → EventBridge completion → parse transcript text → store on session record. Handle failure gracefully (transcript unavailable state).
- [ ] **AI summary pipeline** — transcript available → invoke Bedrock Claude Haiku → 1-paragraph summary → store on session record. Display truncated (2 lines) on cards, full text in replay panel.

### Add After Validation (v1.x):

- [ ] **Keyword search on transcripts** — Once a corpus of transcripts exists, add DynamoDB full-text search or OpenSearch integration. Trigger: user research shows discovery pain.
- [ ] **Transcript display in replay viewer** — Expandable full transcript panel. Trigger: user feedback requesting full text access.
- [ ] **AI topic chapters** — Divide recording into topics based on transcript. Trigger: recordings average >15 minutes and users report navigation difficulty.
- [ ] **Reaction timeline heatmap on recording cards** — Show a sparkline of when reactions peaked during the recording. Trigger: reaction data proves high engagement indicator.

### Future Consideration (v2+):

- [ ] **Real-time transcription during live session** — Streaming Transcribe API, separate infrastructure. Defer until live session UX is mature.
- [ ] **Semantic content search** — Vector embeddings + OpenSearch. Requires large transcript corpus to be valuable.
- [ ] **AI-generated highlight clips** — Identify high-reaction moments from transcript + reaction data. Complex ML pipeline.
- [ ] **Personalized activity feed ranking** — Algorithm to surface sessions the user would find most relevant. Requires engagement data corpus.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Dependency Risk | Priority |
|---------|------------|---------------------|-----------------|----------|
| Reaction summary counts at session end | HIGH | LOW | LOW | P1 |
| Hangout participant tracking | HIGH | LOW | LOW | P1 |
| Hangout activity cards on homepage | HIGH | MEDIUM | MEDIUM | P1 |
| Homepage redesign (slider + feed) | HIGH | MEDIUM | MEDIUM | P1 |
| Transcription pipeline (Transcribe) | MEDIUM | HIGH | HIGH | P1 |
| AI summary pipeline (Bedrock) | HIGH | MEDIUM | HIGH (blocked by transcription) | P1 |
| Display summary on cards + replay | MEDIUM | LOW | MEDIUM | P1 |
| Keyword search on transcripts | MEDIUM | HIGH | LOW | P2 |
| Full transcript viewer in replay | LOW | MEDIUM | LOW | P2 |
| Reaction heatmap sparkline on cards | LOW | MEDIUM | LOW | P3 |
| AI topic chapters | LOW | HIGH | LOW | P3 |

**Priority key:**
- P1: Must have for v1.2 launch — these define the milestone
- P2: Should have, add when P1 is stable
- P3: Nice to have, defer to v2

---

## Detailed Feature Specs

### Hangout Activity Card: What Users Expect to See

Based on Discord, Slack, and Clubhouse patterns for group session history:

**Card Contents (ordered by user importance):**
1. **Session type badge** — "Hangout" (purple, consistent with existing badge in RecordingFeed)
2. **Participant avatar row** — Initials-based avatars for first 4 participants; "+N" overflow indicator if >4 joined (e.g., "+2 more")
3. **Duration** — "42 min" — formatted as X min (under 60) or X hr Y min
4. **Message count** — "64 messages" — social signal of engagement
5. **Relative timestamp** — "3 hours ago" — reuse existing `formatDate()` pattern
6. **Creator / host** — Small text: "Started by [username]"
7. **Optional: "No recording available" indicator** — If hangout didn't produce a playable recording, card should not navigate to replay; tapping should either do nothing or show a modal explaining recordings aren't available for this session

**What to NOT show on hangout cards:**
- Individual participant message counts (privacy)
- Full participant list beyond 4 avatars (clutters card)
- Thumbnail (hangouts may not have one, or it may show a participant face unexpectedly)
- Play button (no video to play unless recording exists)

**Data requirements for hangout card (new fields needed on Session):**
```typescript
participants: string[];         // array of userIds who joined
messageCount: number;           // total messages in session
durationMs: number;             // computed: endedAt - startedAt
```

### Reaction Summary Counts: Storage and Display

**Storage format (new field on Session record):**
```typescript
reactionCounts: {
  heart: number;
  fire: number;
  clap: number;
  laugh: number;
  surprised: number;
  // ...one key per emoji type in the curated set
};
```

**When to aggregate:** Triggered by recording-ended Lambda (same handler that updates `recordingStatus = 'available'`). Query all reactions for the session using `getReactionsInTimeRange(tableName, sessionId, 0, Date.now(), 10000)` and tally by `emojiType`.

**Display on recording card:** Show the top 2-3 emoji types by count as inline chips: "42 🔥 18 ❤️" — small, below the card metadata. If no reactions, hide the section (do not show "0 reactions").

**Display on replay info panel:** Full breakdown by type in a row of pills or small counter badges.

### Transcription Pipeline: Architecture

**Critical constraint:** Amazon Transcribe does NOT accept HLS M3U8 playlists. IVS recordings are stored as HLS. An intermediate conversion step is required.

**Recommended approach (MediaConvert):**
```
recording-ended event
  └─> Lambda: start MediaConvert job
        Input: s3://bucket/{prefix}/media/hls/master.m3u8
        Output: s3://bucket/{prefix}/media/mp4/recording.mp4
        └─> EventBridge: MediaConvert job complete
              └─> Lambda: start Transcribe job
                    MediaFileUri: s3://bucket/{prefix}/media/mp4/recording.mp4
                    OutputBucketName: same S3 bucket
                    OutputKey: {prefix}/transcript/transcript.json
                    └─> EventBridge: Transcribe job state change (COMPLETED)
                          └─> Lambda: parse transcript, extract plain text
                                └─> DynamoDB: store transcriptText on session
                                      └─> invoke Bedrock/Claude
                                            └─> DynamoDB: store aiSummary on session
```

**Status tracking fields added to Session:**
- `transcriptStatus`: `'pending' | 'processing' | 'available' | 'failed'`
- `transcriptS3Path`: S3 key to transcript JSON
- `transcriptText`: Plain text extracted from transcript JSON (stored on session for Bedrock access; consider size: a 30-min session produces ~5,000-8,000 words / 30-50 KB)
- `aiSummaryStatus`: `'pending' | 'processing' | 'available' | 'failed'`
- `aiSummary`: 1-paragraph plain text string

**Transcribe output format:** JSON with `results.transcripts[0].transcript` containing the full plain text. Extract this field; do not store the full JSON on the DynamoDB session record (too large — store only the S3 path to the full JSON).

**Bedrock model recommendation:** `anthropic.claude-3-haiku-20240307-v1:0` (Claude 3 Haiku via Bedrock Converse API). Fast, inexpensive, well-suited for summarization. Must be enabled in the AWS account/region before use (manual console step or CDK `bedrock:CreateFoundationModelAgreement` equivalent).

**Prompt pattern for summary:**
```
You are summarizing a live video session recording.

Transcript:
{transcriptText}

Session metadata:
- Duration: {duration}
- Participant count: {participantCount} (if hangout)
- Type: {BROADCAST or HANGOUT}

Write a single paragraph (2-4 sentences) summarizing what was discussed or happened in this session. Be conversational and concise. Do not begin with "In this session" or "The transcript shows". If the transcript is unclear or very short, write a brief neutral summary based on available context.
```

**Failure handling:**
- MediaConvert failure → set `transcriptStatus = 'failed'` on session; do not block replay availability
- Transcribe failure → same; summary stays pending
- Bedrock failure → set `aiSummaryStatus = 'failed'`; display "Summary unavailable" on card

### Homepage Redesign: Layout Specification

**Two-zone layout:**

```
┌──────────────────────────────────────────────────────────┐
│  videonow          [Go Live]  [Hangout]          [Logout] │  <- sticky header (unchanged)
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Recent Broadcasts                                       │  <- section label
│  ┌────┐ ┌────┐ ┌────┐ ┌──                               │  <- horizontal slider
│  │    │ │    │ │    │ │  (peek of next card)             │
│  └────┘ └────┘ └────┘ └──                               │
│                                                          │
│  Activity                                                │  <- section label
│  ┌─────────────────────────────────────────────────┐    │  <- activity card row
│  │ [Hangout] • ●● ●● ●● + 2 more   42 min  64 msg │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ [Broadcast] • [thumb] Title  3:42  🔥42 ❤️18   │    │
│  └─────────────────────────────────────────────────┘    │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

**Recording slider:**
- BROADCAST sessions with `recordingStatus = 'available'` only
- 3-4 cards visible; right edge bleeds ~20-30px to signal horizontal scroll
- CSS `scroll-snap-type: x mandatory` + `scroll-snap-align: start` per card
- No navigation arrows on mobile; add on desktop hover (optional for v1.2)
- Card width: ~40-45% of viewport on mobile, ~25% on desktop
- Each card: thumbnail + duration badge + top-2 reaction counts + relative time

**Activity feed:**
- All session types (BROADCAST and HANGOUT) that have ended
- Sorted descending by `endedAt`
- BROADCAST cards: compact horizontal — small thumbnail left, session owner + duration + reaction counts right
- HANGOUT cards: participant avatar row + message count + duration (described above)
- No inline video playback — tap navigates to replay (BROADCAST only)
- HANGOUT cards with recording: show play indicator; without recording: no play indicator, just history

**API changes needed:**
- `GET /recordings` currently returns only ended sessions; rename concept to "activity" or add a separate `GET /activity` endpoint that returns both BROADCAST and HANGOUT sessions
- Activity endpoint should include: `participants`, `messageCount`, `durationMs`, `reactionCounts`, `aiSummary`, `aiSummaryStatus` in response
- Horizontal slider needs recordings with `recordingStatus = 'available'` — can filter client-side from activity response or add a `GET /recordings` query param for `?type=BROADCAST&status=available`

---

## Competitor Feature Analysis

| Feature | YouTube / Twitch | Discord / Slack | Our Approach |
|---------|-------------------|-----------------|--------------|
| Group session history | No group call history; only channel activity | Full thread history with participants | Activity feed with per-session hangout cards showing participant row |
| Recording card description | Auto-generated title/chapter markers (YouTube) | No video descriptions | AI-generated 1-paragraph summary from transcript (Bedrock/Claude) |
| Reaction summary on cards | Not shown on cards; only live count | Message reactions shown on messages | Per-type reaction counts shown on recording cards and replay panel |
| Homepage layout | Horizontal shelf rows by category (Netflix pattern) | Recent conversations list | Two-zone: horizontal slider (broadcasts) + activity feed list (all types) |
| Transcript access | Auto-captions visible during playback | No video transcription | Store transcript async; surface summary on card; full text accessible in replay |
| Session duration | Shown on VOD cards | Shown in voice channel history | Shown on all activity cards |

---

## Phase Ordering Implications for Roadmap

The five v1.2 feature areas have clear phase sequencing constraints:

**Phase 1: Reaction Summary Counts** (no new deps; extends existing recording-ended Lambda)
- Aggregate reactions at session end
- Store `reactionCounts` on session record
- Display on existing replay info panel
- LOW risk: purely additive to existing handlers

**Phase 2: Hangout Participant Tracking** (extends existing join-hangout handler)
- Track participants array, message count, duration on session record
- Produces data needed for hangout activity cards
- MEDIUM risk: must be careful about DynamoDB write patterns (array append vs. SetAdd)

**Phase 3: Homepage Redesign** (depends on Phases 1 and 2 for full feature, but can ship skeleton)
- Horizontal slider (broadcasts only) can ship independently
- Activity feed cards use data from Phases 1 and 2
- MEDIUM risk: frontend-heavy, no new backend infrastructure

**Phase 4: Transcription Pipeline** (highest infrastructure risk)
- New AWS services: MediaConvert + Transcribe
- New CDK resources: IAM roles, EventBridge rules, Lambda handlers
- CRITICAL: MediaConvert HLS→MP4 conversion is required before Transcribe
- HIGH risk: multi-step async pipeline with failure modes at each stage

**Phase 5: AI Summary Pipeline** (strictly after Phase 4)
- Extends transcription pipeline with Bedrock invocation
- Requires Bedrock foundation model access enabled in AWS account
- Bedrock Converse API is the correct interface (not legacy InvokeModel)
- MEDIUM risk: prompt engineering + response parsing; model ID must be correct

**This ordering:**
- Gets visible wins (reaction counts, hangout cards, homepage redesign) deployed early
- Defers the highest-risk infrastructure work (Transcribe + Bedrock) to later phases
- Allows homepage redesign to ship with "Summary coming soon" placeholders while pipeline is built
- Avoids all-or-nothing delivery

---

## Data Model Extensions Required

### Session record (DynamoDB) — new fields for v1.2:

```typescript
// Reaction summaries (Phase 1)
reactionCounts?: {
  [emojiType: string]: number;   // e.g., { fire: 42, heart: 18, clap: 5 }
};

// Hangout participant tracking (Phase 2)
participants?: string[];          // array of userIds who joined
messageCount?: number;            // total chat messages in session

// Note: durationMs = endedAt - startedAt (computable from existing fields)

// Transcription pipeline (Phase 4)
transcriptStatus?: 'pending' | 'processing' | 'available' | 'failed';
transcriptS3Path?: string;        // s3://bucket/prefix/transcript/transcript.json

// AI summary pipeline (Phase 5)
aiSummaryStatus?: 'pending' | 'processing' | 'available' | 'failed';
aiSummary?: string;               // 1-paragraph plain text
```

### Frontend Recording type extension (RecordingFeed / new ActivityFeed):

```typescript
interface ActivityItem {
  sessionId: string;
  sessionType: 'BROADCAST' | 'HANGOUT';
  userId: string;
  createdAt: string;
  endedAt?: string;
  // Broadcast fields
  thumbnailUrl?: string;
  recordingDuration?: number;
  recordingStatus?: 'pending' | 'processing' | 'available' | 'failed';
  recordingHlsUrl?: string;
  // Reaction summary (Phase 1)
  reactionCounts?: Record<string, number>;
  // Hangout participant fields (Phase 2)
  participants?: string[];
  messageCount?: number;
  // AI summary (Phase 5)
  aiSummary?: string;
  aiSummaryStatus?: 'pending' | 'processing' | 'available' | 'failed';
}
```

---

## Sources

### AWS Official Documentation (HIGH confidence)

- [Amazon Transcribe: Data input and output](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html) — confirmed supported formats (MP4 yes, HLS/M3U8 no)
- [Amazon Transcribe: StartTranscriptionJob API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html)
- [Amazon Transcribe: EventBridge monitoring](https://docs.aws.amazon.com/transcribe/latest/dg/monitoring-events.html) — Transcribe job state change events
- [IVS Individual Participant Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-individual-participant-recording.html) — confirmed HLS fMP4 segment format
- [IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html) — recording structure confirmed
- [IVS RealTime Participant Events](https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ivs-realtime/list-participant-events.html) — JOINED, LEFT, SUBSCRIBE_STARTED event types
- [AWS Lambda S3 event triggers](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)

### AWS Blog Posts (MEDIUM confidence)

- [Create summaries of recordings using generative AI with Amazon Bedrock and Amazon Transcribe](https://aws.amazon.com/blogs/machine-learning/create-summaries-of-recordings-using-generative-ai-with-amazon-bedrock-and-amazon-transcribe/) — confirmed Bedrock + Transcribe pipeline pattern
- [Amazon Prime Video: AI-powered Video Recaps using Bedrock](https://www.aboutamazon.com/news/entertainment/ai-plot-summary-video-recaps-prime-video) — confirmed UX pattern for AI summary on video cards
- [IVS and MediaConvert post-processing workflow](https://aws.amazon.com/blogs/media/awse-using-amazon-ivs-and-mediaconvert-in-a-post-processing-workflow/) — confirmed MediaConvert as conversion path after IVS recording

### Community Sources (MEDIUM confidence, multiple sources agree)

- [Create call center transcript summary using AWS Bedrock Converse API and Lambda (Claude Haiku)](https://dev.to/bhatiagirish/create-call-center-transcript-summary-using-aws-bedrock-converse-api-and-lambda-anthropic-haiku-20cj) — confirmed model ID `anthropic.claude-3-haiku-20240307-v1:0`
- [Activity Feed Design: Ultimate Guide (GetStream)](https://getstream.io/blog/activity-feed-design/) — confirmed activity feed UX patterns
- [Horizontal Scrolling Lists in Mobile — Best Practices](https://uxdesign.cc/best-practices-for-horizontal-lists-in-mobile-21480b9b73e5) — confirmed peek + scroll snap pattern
- [How to invoke Lambda on IVS stage participant events](https://repost.aws/questions/QUkcK0cdo2QB-bkhJyBOLAUg/how-do-i-invoke-a-lambda-function-on-ivs-stage-participant-event) — confirmed IVS EventBridge does not emit a "participant joined" event directly; application-level tracking required

### v1.1 Research Preserved (HIGH confidence, verified 2026-03-02)

All v1.1 research (IVS capabilities, reaction systems, synchronized replay, discovery feeds) remains valid. See git history for previous FEATURES.md for full v1.1 source citations.

---

*Feature research for: v1.2 Activity Feed & Intelligence layer on live video platform*
*Researched: 2026-03-05*
*Supersedes: v1.1 FEATURES.md (2026-03-02)*
