# Project Research Summary

**Project:** VideoNowAndLater v1.2 — Activity Feed & Intelligence
**Domain:** AWS IVS live-video platform — AI transcription pipeline, activity feed, homepage redesign
**Researched:** 2026-03-05
**Confidence:** HIGH (Phases 1-3); MEDIUM (Phase 4 — HLS/MediaConvert conflict unresolved; see critical gap)

## Executive Summary

VideoNowAndLater v1.2 adds an intelligence layer and social history surface on top of the completed v1.1 foundation. The milestone has five feature areas: reaction summary aggregation, hangout participant tracking, a homepage redesign (horizontal recording slider + activity feed), a transcription pipeline (Amazon Transcribe + S3), and an AI summary pipeline (Amazon Bedrock Claude). The recommended approach is an event-driven two-Lambda chain: a `start-transcription` Lambda fires as a second EventBridge target on the existing `RecordingEndRuleV2`, and a `store-transcript` Lambda is triggered by Transcribe's own EventBridge completion event and then calls Bedrock inline. All AI and transcript data is stored as new fields on the existing `SESSION#{id} / METADATA` DynamoDB item — no new tables are required. Two new npm packages are added to the backend (`@aws-sdk/client-transcribe`, `@aws-sdk/client-bedrock-runtime`); zero new frontend packages; zero new CDK library imports.

The most significant risk in this milestone is a direct conflict between the two research files on whether Amazon Transcribe accepts IVS HLS recordings directly. FEATURES.md (HIGH confidence, backed by official AWS Transcribe input format documentation) states that Transcribe does NOT accept HLS M3U8 and requires an AWS MediaConvert conversion step first. ARCHITECTURE.md (MEDIUM confidence, self-flagged as "requires verification") takes the opposite position — that Transcribe accepts `.m3u8` as a supported `MediaFormat`. These are mutually exclusive. The correct answer determines whether Phase 4 requires one Lambda and one EventBridge rule, or three Lambdas, two EventBridge rules, and a MediaConvert IAM role. The FEATURES.md position (MediaConvert required) must be treated as the working assumption until Phase 4 is verified against current AWS documentation.

The remaining four feature areas carry low-to-medium risk. Phases 1-2 (reaction summaries, participant tracking) are purely additive modifications to existing Lambda handlers with no new AWS services. Phase 3 (homepage redesign) is frontend-only with a new `GET /activity` endpoint following the established `list-recordings.ts` pattern. Phase 5 (AI summary) is straightforward once Phase 4's transcription pipeline is running. The phase ordering recommended independently by both FEATURES.md and ARCHITECTURE.md delivers three visible wins first, isolates the highest-risk infrastructure work in Phase 4, and allows homepage UI to launch with graceful "coming soon" placeholders for AI summaries.

## Key Findings

### Recommended Stack

The existing stack is unchanged for v1.2. Only two new npm packages are added to the backend, both at `^3.1000.0` to match the project's existing AWS SDK v3 monorepo version. No new CDK library packages are needed — all new infrastructure uses primitives already imported from `aws-cdk-lib`. No new frontend packages are required; the homepage redesign, recording slider, and AI summary display all use existing React and Tailwind.

**New backend packages:**
- `@aws-sdk/client-transcribe` — Batch transcription jobs from S3 recordings; fire-and-forget from Lambda; use `StartTranscriptionJobCommand`
- `@aws-sdk/client-bedrock-runtime` — Claude model invocation for AI summaries; use `InvokeModelCommand` (synchronous), NOT `InvokeModelWithResponseStreamCommand`

**New CDK infrastructure (no new CDK library imports):**
- `StartTranscription` NodejsFunction — second target on existing `RecordingEndRuleV2`
- `StoreTranscript` NodejsFunction — target for new `TranscribeJobCompleteRule`
- `TranscribeJobCompleteRule` EventBridge rule — listens for `aws.transcribe` / `Transcribe Job State Change` with status `COMPLETED` or `FAILED`

**AI model — two valid choices with minor differences:**
- `anthropic.claude-3-5-haiku-20241022-v1:0` (STACK.md recommendation) — smarter, ~$0.006/session
- `anthropic.claude-3-haiku-20240307-v1:0` (ARCHITECTURE.md and FEATURES.md recommendation) — slightly cheaper, well-documented

Both are Haiku-class models and both cost ~$0.006/session. Either is correct for this summarization workload. Choose based on regional availability at implementation time.

CRITICAL manual step: Anthropic models require a one-time First Time Use (FTU) form in the Bedrock console before `InvokeModel` succeeds. This cannot be automated via CDK and must be documented as a pre-deployment step in Phase 5.

**Cost profile:** Transcribe dominates at ~$0.72 per 30-min broadcast and ~$0.12 per 5-min hangout. Bedrock is ~$0.006/session regardless of model. Total AI cost at 100 sessions/month is ~$73 (Transcribe) + ~$0.60 (Bedrock).

### Expected Features

Both FEATURES.md and ARCHITECTURE.md agree on the same five feature areas, their scope, and their ordering. The data model extensions to `SESSION#{id} / METADATA` are all additive optional fields — no DynamoDB migrations, no breaking changes to existing API consumers.

**Must have (table stakes for v1.2 launch):**
- Reaction summary counts aggregated at session end — social proof on recording cards without clicking into replay
- Hangout session duration and participant list on activity cards — Discord/Slack/Zoom all persist this group history
- Relative timestamps ("2 hours ago") on all activity cards — reuse existing `formatDate()` pattern
- Graceful degradation for AI pipeline — "Summary coming soon" placeholders; AI is async and takes 3-10 min post-recording

**Should have (competitive differentiators):**
- AI-generated 1-paragraph summary on recording cards — Prime Video X-Ray pattern; high perceived value at low cost
- Hangout activity cards with participant avatar row — no streaming competitor does group session history this way
- Horizontal recording slider replacing the current full-page grid — Netflix/YouTube shelf is the dominant video discovery pattern
- Activity feed below the slider showing all session types — two-zone homepage mirrors YouTube Shorts + long-form split

**Defer to v1.x / v2+:**
- Keyword search on transcripts (needs transcript corpus first)
- Full transcript viewer in replay (5,000+ words inline overwhelms the UI)
- Real-time transcription during live sessions (separate SDK and separate infrastructure)
- AI topic chapters (requires NLP topic modeling on top of transcription)
- Semantic content search (requires vector embeddings and OpenSearch)

**Anti-features — do not implement:**
- Per-user reaction breakdown (violates the anonymous-by-design reaction system)
- AI chat + transcript diarization (IVS Chat lacks speaker fidelity; hallucination risk)
- Speaker attribution on hangout activity cards (social pressure dynamics)

### Architecture Approach

All v1.2 changes extend the existing single-table DynamoDB design, existing EventBridge infrastructure, and the established Lambda handler pattern. New fields are added to `SESSION#{id} / METADATA` items. Hangout participants are stored as separate `SESSION#{id} / PARTICIPANT#{userId}` items (same PK, different SK prefix) to avoid write-lock contention with the existing optimistic locking in `updateSessionStatus()`. The transcription and AI pipeline uses fan-out (two Lambda targets on one EventBridge rule) followed by a linear async chain (Transcribe completion event triggers `store-transcript` Lambda, which calls Bedrock inline before returning).

**New Lambda handlers and precise integration points:**
1. `join-hangout.ts` (MODIFY) — add `addHangoutParticipant()` call after `ivsRealTimeClient.send()` returns, approximately line 65
2. `recording-ended.ts` (MODIFY) — add `computeAndStoreReactionSummary()` after `updateRecordingMetadata()`, approximately line 127; wrap in try/catch (pool release must always run regardless of this failure)
3. `start-transcription.ts` (NEW) — second target on `RecordingEndRuleV2`; job name convention `vnl-{sessionId}-{epochMs}` enables sessionId extraction from the completion event without extra DynamoDB reads
4. `store-transcript.ts` (NEW) — triggered by `TranscribeJobCompleteRule`; calls `GetTranscriptionJobCommand` to get transcript S3 URI; fetches JSON; extracts `results.transcripts[0].transcript`; calls Bedrock inline; writes both transcript and summary fields to session record
5. `list-activity.ts` (NEW) — `GET /activity` endpoint; DynamoDB scan for all session types with all new fields

**New repository functions (all in `session-repository.ts`):**
`addHangoutParticipant`, `getHangoutParticipants`, `updateReactionSummary`, `updateTranscriptFields`, `updateAiSummary`, `getRecentActivity`

**Key architectural patterns applied:**
- Fan-out via multiple EventBridge targets — two independent, parallel handlers on the same IVS Recording End event
- Linear async chain for sequential dependencies — Bedrock call inline in `store-transcript.ts` rather than a separate Lambda and EventBridge event
- Compute-once, read-many for aggregates — reaction counts computed once at session end (500 DynamoDB queries run once) rather than on every homepage load
- Co-located items on shared PK — `PARTICIPANT#{userId}` items under `SESSION#` PK require no new GSI and avoid version conflicts

### Critical Pitfalls

These are the v1.2-specific pitfalls identified from architecture analysis. V1.1 pitfalls (recording reconnect windows, mobile participant limits, token expiration, HLS player memory) are already resolved in the existing codebase.

1. **Reaction summary computation blocks pool release** — `computeAndStoreReactionSummary()` involves 500 DynamoDB queries (5 emoji types x 100 shards). Wrapping this in try/catch and ensuring `releasePoolResources()` always runs (in a `finally` block or sequentially after the try/catch) is mandatory. Pool resource availability for new sessions must never be gated on reaction aggregation.

2. **Participant write contention via list_append on session METADATA** — The existing `updateSessionStatus()` uses optimistic locking (`#version = :currentVersion`). Adding participants as a `list_append` to the session item causes `ConditionalCheckFailedException` when two participants join within the same second. Store each participant as a separate `PARTICIPANT#{userId}` item under the session PK — items are naturally idempotent on re-join and require no version coordination.

3. **Transcribe input format conflict — UNRESOLVED (see Research Flags)** — FEATURES.md says MediaConvert is required before Transcribe. ARCHITECTURE.md says Transcribe accepts HLS directly. The wrong assumption causes silent failures in the transcription pipeline with no recordings reaching Bedrock. Treat FEATURES.md (MediaConvert required) as the default assumption.

4. **Bedrock model access requires a manual console step** — `bedrock:InvokeModel` returns `AccessDeniedException` until the Anthropic First Time Use form is completed in the Bedrock console. This cannot be automated via CDK or CLI. Must be a clearly documented pre-deployment step in the Phase 5 plan.

5. **DynamoDB item size for long transcripts** — A 60-minute session transcript is 20-60KB of plain text; well under DynamoDB's 400KB item limit. For sessions exceeding approximately 3 hours, guard with a 250,000-character truncation limit and store only the S3 URI on the DynamoDB item, fetching the full text on demand.

## Implications for Roadmap

Both FEATURES.md and ARCHITECTURE.md independently converge on the same 5-phase ordering. This agreement across two separate research analyses is a strong signal that the dependency graph is correct.

### Phase 1: Hangout Participant Tracking

**Rationale:** No external service dependencies. Touches only `join-hangout.ts` and `session-repository.ts`. Produces the participant data required by Phase 3 hangout activity cards. Simplest scope and highest confidence of any phase in this milestone.

**Delivers:** `PARTICIPANT#{userId}` items written to DynamoDB on every hangout join; `participantCount` denormalized to session METADATA at session end; `addHangoutParticipant()` and `getHangoutParticipants()` repository functions; Session domain model extended with new optional fields.

**Addresses:** "Who was there" table-stakes expectation for group session history; data layer for hangout activity cards in Phase 3.

**Avoids pitfall:** Participant write contention — separate items per participant, not list_append on the version-locked session METADATA item.

**Research flag:** Standard patterns, no research-phase needed. DynamoDB co-located item pattern is established in this codebase. Integration point is precisely identified.

### Phase 2: Reaction Summary at Session End

**Rationale:** No new infrastructure. Extends the already-running `recording-ended.ts` handler with best-effort reaction aggregation. Produces `reactionSummary` data required by Phase 3 recording cards. Shipping before the homepage redesign ensures reaction counts are populated when the new cards launch.

**Delivers:** `computeAndStoreReactionSummary()` (try/catch wrapped, non-blocking) in `recording-ended.ts`; `updateReactionSummary()` repository function; `reactionSummary` map on session METADATA; reaction count display on the existing replay info panel.

**Addresses:** Per-type reaction counts on recording cards (table stakes for social proof); eliminates 10,000 DynamoDB queries per homepage load that would result from computing counts at read time.

**Avoids pitfall:** Reaction summary must never block pool release — wrap in try/catch, ensure `releasePoolResources()` runs in `finally`.

**Research flag:** Standard patterns, no research-phase needed. `getReactionCounts()` already exists in `reaction-repository.ts`. Integration point precisely identified.

### Phase 3: Homepage Redesign + Activity Feed API

**Rationale:** Frontend-heavy phase. Depends on Phases 1-2 for full data richness but can build the layout with empty/loading states and ship independently. No new AWS services. The `GET /activity` endpoint follows the established `list-recordings.ts` pattern exactly.

**Delivers:** Two-zone homepage (horizontal recording slider + activity feed list); hangout activity cards (participant avatars, message count, duration); BROADCAST recording cards with reaction counts and AI summary placeholders; `GET /activity` API endpoint; `list-activity.ts` Lambda; `getRecentActivity()` repository function.

**Addresses:** Homepage redesign replacing current full-page grid (competitive differentiator); unified BROADCAST + HANGOUT history surface.

**Avoids pitfall:** Use pre-computed `reactionSummary` from Phase 2 — never call `getReactionCounts()` inside the activity list handler.

**Research flag:** CSS scroll-snap and peek pattern is well-documented; no research-phase needed. One open question to decide before writing the plan: whether `GET /activity` should be authenticated or public (the current `GET /recordings` auth posture). Also decide whether `messageCount` is tracked atomically in `send-message.ts` or computed at session end.

### Phase 4: Transcription Pipeline

**Rationale:** Highest infrastructure risk. Introduces two new Lambda handlers, a new EventBridge rule, new IAM permissions, and an external AWS service (Transcribe) with an unresolved input format conflict. Must be fully operational before Phase 5 (AI summary) can begin. Isolated as its own phase so that Phases 1-3 can ship and be validated while Phase 4's conflict is resolved.

**Delivers:** `start-transcription.ts` Lambda (second target on `RecordingEndRuleV2`); `TranscribeJobCompleteRule` EventBridge rule; `store-transcript.ts` Lambda (transcript storage only, without Bedrock initially); `transcriptStatus`, `transcriptJobName`, `transcriptText` fields on session records; IAM permissions for Transcribe and S3.

**If FEATURES.md is correct (MediaConvert required):** Phase 4 also requires a MediaConvert job Lambda, a `MediaConvertCompleteRule` EventBridge rule, an IAM role for MediaConvert, and updated CDK in `session-stack.ts`. This approximately doubles the scope.

**If ARCHITECTURE.md is correct (HLS accepted directly):** Phase 4 is simpler — pass the existing HLS URL directly to `StartTranscriptionJobCommand` with `MediaFormat: 'mp4'` ... actually `MediaFormat` would need to be the correct value for HLS. Verify the exact parameter as part of the research-phase.

**Addresses:** Transcription of all recordings (differentiator; foundation for AI summaries).

**Avoids pitfall:** S3 event trigger anti-pattern — IVS recording is multi-file (HLS segments, thumbnails, manifests); S3 events fire multiple times before assembly is complete. The existing `RecordingEndRuleV2` is the authoritative single trigger.

**CRITICAL research flag: REQUIRES research-phase before plan-phase.** The HLS/MediaConvert conflict must be resolved against current AWS Transcribe documentation before writing the Phase 4 implementation plan. Default assumption: MediaConvert is required (FEATURES.md position, backed by official AWS docs).

### Phase 5: AI Summary Pipeline

**Rationale:** Strictly blocked by Phase 4. Extends `store-transcript.ts` with an inline Bedrock call. No new EventBridge rules, no new Lambda handlers beyond what Phase 4 delivers. Lowest new infrastructure risk of any phase once transcription is working.

**Delivers:** `bedrock:InvokeModel` call within `store-transcript.ts`; `aiSummary`, `aiSummaryStatus`, `aiModel` fields on session records; AI summary truncated display (2 lines) on recording cards; full summary in replay info panel; `bedrock-client.ts` shared client module.

**Addresses:** AI-generated 1-paragraph summary (highest-value differentiator); "Summary unavailable" graceful degradation on cards when the pipeline fails.

**Avoids pitfall:** Bedrock call is try/catch isolated — a Bedrock failure must not lose the already-stored transcript. Model ARN scoped to specific model in IAM (not wildcard). Synchronous `InvokeModelCommand` only — streaming adds complexity with no benefit in this batch pipeline.

**Research flag:** Confirm Bedrock model availability in deployment region before writing CDK. Confirm whether Anthropic FTU form is still required as of implementation date. Both are fast lookups, not a full research-phase.

### Phase Ordering Rationale

- Phases 1-2 have zero new AWS service dependencies and deliver visible wins (participant data, reaction counts) that Phase 3 UI depends on — they must ship first
- Phase 3 can technically begin before Phases 1-2 complete (build with empty states) but the full feature requires their data — plan Phase 3 to start after Phase 2 is deployed
- Phase 4 is isolated specifically because it contains the unresolved Transcribe HLS conflict; isolating it protects Phases 1-3 from scope uncertainty
- Phase 5 is strictly blocked on Phase 4 — the dependency is hard, not just recommended
- The ordering guarantees progressive delivery: Phases 1-3 ship visible UX improvements weeks before the AI pipeline is complete; users see the new homepage and activity cards immediately

### Research Flags

**Requires research-phase before plan-phase:**
- **Phase 4 (Transcription Pipeline):** Resolve the HLS/MediaConvert conflict before writing the implementation plan. Check the current [Amazon Transcribe supported input formats](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html) page. If HLS is NOT supported, Phase 4 scope expands to include MediaConvert. The FEATURES.md position (MediaConvert required) is the default assumption — verify before implementing either path.

**Standard patterns, skip research-phase:**
- **Phase 1 (Participant Tracking):** DynamoDB co-located items pattern is established; `join-hangout.ts` integration point is at a specific line.
- **Phase 2 (Reaction Summary):** `recording-ended.ts` integration point is at a specific line; `getReactionCounts()` already exists.
- **Phase 3 (Homepage Redesign):** CSS scroll-snap is well-documented; `list-activity.ts` follows `list-recordings.ts` pattern. Two pre-plan decisions needed (auth posture, messageCount tracking approach) but neither requires external research.
- **Phase 5 (AI Summary):** Bedrock `InvokeModelCommand` pattern is fully documented in STACK.md with working TypeScript. Confirm model availability in deployment region before CDK wiring — this is a single-page check, not a research session.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified against npm registry; IAM patterns verified against AWS docs; SDK v3 monorepo version compatibility confirmed; no new CDK library needed |
| Features | HIGH | Transcribe input format constraints backed by official AWS docs; UX patterns verified against Discord, Slack, YouTube, Prime Video; dependency graph is internally consistent across both research files |
| Architecture | HIGH | Based on direct codebase analysis of existing handlers; integration points identified to specific file lines; DynamoDB patterns match established codebase conventions; fan-out and linear-chain patterns are well-documented AWS patterns |
| Pitfalls | HIGH (Phases 1-3) / MEDIUM (Phases 4-5) | V1.1 pitfalls are resolved in the existing codebase; v1.2-specific pitfalls (reaction contention, participant write contention, Bedrock FTU) are derived from direct code analysis; Transcribe/MediaConvert pitfall is the primary open question |

**Overall confidence:** HIGH for Phases 1-3; MEDIUM for Phase 4 until the HLS/MediaConvert conflict is resolved; HIGH for Phase 5 once Phase 4 is verified.

### Gaps to Address

- **CRITICAL — Transcribe HLS input format conflict:** FEATURES.md (HIGH confidence, official AWS docs) says Transcribe does NOT accept HLS M3U8. ARCHITECTURE.md (MEDIUM confidence, self-flagged as "requires verification") says Transcribe accepts HLS m3u8 directly. Before Phase 4 plan-phase, verify against [Amazon Transcribe supported input formats](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html). Treat FEATURES.md as the working assumption: MediaConvert is required. If ARCHITECTURE.md turns out to be correct, Phase 4 scope shrinks significantly.

- **Bedrock model ID and regional availability:** STACK.md recommends `anthropic.claude-3-5-haiku-20241022-v1:0`; ARCHITECTURE.md and FEATURES.md recommend `anthropic.claude-3-haiku-20240307-v1:0`. Both are valid. Confirm which is available in the deployment region before writing Phase 5 CDK. Confirm whether the Anthropic FTU form is still required as of the implementation date. Document the manual Bedrock console step prominently in Phase 5's plan.

- **messageCount tracking approach:** ARCHITECTURE.md recommends an atomic `ADD messageCount :1` counter in `send-message.ts` to avoid a full chat scan at session end for activity card display. This is a `send-message.ts` change not otherwise in scope for any phase. Decide in Phase 3 plan: (a) add the counter to `send-message.ts` as part of Phase 3, (b) scan chat messages at session end in `recording-ended.ts`, or (c) show message count as N/A initially. Option (a) is cleanest long-term; option (c) is lowest risk.

- **`GET /activity` authentication posture:** ARCHITECTURE.md specifies `None (public)` for the `/activity` endpoint. Verify whether activity feed data (participant lists, message counts) warrants authentication, or whether the current `GET /recordings` public posture applies equally here. Decide before Phase 3 plan-phase.

## Sources

### Primary (HIGH confidence)
- [Amazon Transcribe supported input formats](https://docs.aws.amazon.com/transcribe/latest/dg/how-input.html) — HLS/M3U8 NOT listed as supported format (FEATURES.md position)
- [Amazon Transcribe StartTranscriptionJob API](https://docs.aws.amazon.com/transcribe/latest/APIReference/API_StartTranscriptionJob.html) — required parameters, output patterns, job name constraints
- [Amazon Transcribe EventBridge monitoring](https://docs.aws.amazon.com/transcribe/latest/dg/monitoring-events.html) — `Transcribe Job State Change` event structure and detail fields
- [Bedrock Runtime InvokeModel — Claude TypeScript example](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-runtime_example_bedrock-runtime_InvokeModel_AnthropicClaude_section.html) — `anthropic_version`, payload structure, `content[0].text` response parsing
- [Amazon Bedrock supported models](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) — model IDs and regional availability
- [Simplified Bedrock model access (Sept 2025)](https://aws.amazon.com/blogs/security/simplified-amazon-bedrock-model-access/) — auto-enablement; Anthropic FTU form still required
- Codebase direct analysis: `backend/src/handlers/`, `backend/src/repositories/`, `infra/lib/stacks/` — integration points confirmed at specific lines; IAM and EventBridge patterns read from live CDK

### Secondary (MEDIUM confidence)
- [IVS and MediaConvert post-processing workflow](https://aws.amazon.com/blogs/media/awse-using-amazon-ivs-and-mediaconvert-in-a-post-processing-workflow/) — confirmed MediaConvert as conversion path after IVS recording
- [Create summaries of recordings using Bedrock + Transcribe](https://aws.amazon.com/blogs/machine-learning/create-summaries-of-recordings-using-generative-ai-with-amazon-bedrock-and-amazon-transcribe/) — confirmed Bedrock + Transcribe pipeline pattern
- [Amazon Transcribe pricing](https://aws.amazon.com/transcribe/pricing/) — $0.024/min standard batch, per-second billing
- [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) — Claude 3.5 Haiku ~$0.80/M input, ~$4.00/M output
- [Activity Feed Design Guide (GetStream)](https://getstream.io/blog/activity-feed-design/) — activity feed UX patterns
- [Horizontal Scrolling Lists in Mobile Best Practices](https://uxdesign.cc/best-practices-for-horizontal-lists-in-mobile-21480b9b73e5) — peek + scroll-snap pattern

### Tertiary (LOW confidence — needs validation before implementation)
- ARCHITECTURE.md claim that Transcribe accepts HLS m3u8 directly — SELF-FLAGGED by the researcher as "MEDIUM confidence — requires verification against current Transcribe docs before implementation." Do not implement Phase 4 based on this claim without explicit verification. The researcher's own caveat demotes this to LOW confidence for implementation decisions.

---
*Research completed: 2026-03-05*
*Supersedes: v1.1 SUMMARY.md (2026-03-02)*
*Ready for roadmap: yes — with Phase 4 gated on Transcribe HLS format verification*
