# Feature Research

**Domain:** AWS IVS live/recorded video platform — backend event hardening + UI polish
**Milestone:** v1.7 Event Hardening & UI Polish
**Researched:** 2026-03-12
**Confidence:** HIGH (based on direct codebase analysis + AWS service patterns)

---

## Feature Landscape

This milestone covers four distinct engineering tracks: two backend tracks (X-Ray tracing,
event schema validation + idempotency + DLQ re-drive) and one frontend track (UI polish across
four pages). Each track is analyzed separately below.

---

## Track A: AWS X-Ray Distributed Tracing

### Table Stakes

Features that every distributed-system operator expects from a tracing integration.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Traces visible in X-Ray console | Core value of enabling X-Ray — developer must be able to see segments | LOW | Lambda active tracing toggle in CDK + `XRAY_TRACE_ID` env var is auto-set |
| Segment per Lambda invocation | One segment = one handler execution is the standard unit | LOW | Auto-instrumented when active tracing is on in CDK |
| Subsegments for downstream AWS calls | DynamoDB, S3, EventBridge, Transcribe, Bedrock calls must appear as child segments | MEDIUM | AWS X-Ray SDK `captureAWSv3Client()` wraps SDK clients; must be applied to each client |
| Service map connecting pipeline stages | Visual graph showing recording-ended to transcode-completed to transcribe-completed to store-summary | MEDIUM | Emerges automatically once all 5 Lambdas emit segments to the same X-Ray group |
| Error/fault annotation on segment | Failed invocations must show as fault (5xx) or error (4xx) in X-Ray | LOW | Automatic when Lambda throws; manual annotation needed for caught errors |
| Trace propagation across SQS boundary | Trace ID must pass through SQS message so downstream handler continues the same trace | HIGH | SQS does not auto-propagate X-Ray context; Powertools Tracer handles this automatically when configured |

### Differentiators

Features beyond the basics that add real observability value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Custom annotations on every segment | `sessionId`, `pipelineStage` searchable in X-Ray without log diving | LOW | `tracer.putAnnotation('sessionId', sessionId)` via Powertools Tracer |
| Latency breakdown per pipeline stage | Understand which stage (MediaConvert submit, Transcribe, Bedrock) is slow | LOW | Subsegment timing is automatic once clients are wrapped |
| Powertools Tracer decorator pattern | Consistent trace structure across all handlers without manual segment management | MEDIUM | `@tracer.captureLambdaHandler()` decorator; integrates with existing Powertools Logger |
| Cold start annotation | Distinguish cold start latency from execution latency in X-Ray segments | LOW | Powertools Tracer adds this automatically |
| X-Ray group for pipeline Lambdas | Filter expression in X-Ray to show only pipeline traces, not all Lambdas | LOW | CDK: `new xray.CfnGroup()` with filter on annotation.pipelineStage |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full request/response body capture in traces | Debug what data each handler received | Transcript text + S3 URIs can be large; X-Ray has 64KB segment size limit; PII risk | Annotate with IDs only (sessionId, jobId); log bodies to CloudWatch where retention is controlled |
| X-Ray on every Lambda in the stack | Comprehensive observability | Per-trace cost at scale; non-pipeline Lambdas (get-session, list-activity) have trivial logic with no inter-service calls worth tracing | Apply X-Ray only to the 5 pipeline Lambdas where latency and failures matter |
| Custom X-Ray daemon configuration | Perceived control | Lambda manages the daemon; custom config adds infra complexity with no benefit in single-region single-account deployment | Use Lambda's built-in X-Ray daemon via active tracing flag |

---

## Track B: Event Schema Validation

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Validate required fields present | Handler must reject events missing `sessionId`, `jobId`, etc. before doing work | LOW | Runtime check at top of `processEvent()` + throw with descriptive message |
| Validate field types and formats | String where number expected causes downstream failures | LOW | `typeof` checks + regex for known formats (session UUID, S3 path) |
| Reject and DLQ malformed events | Invalid events must not be retried indefinitely; they must go to DLQ for inspection | LOW | Throw validation error causes SQS `batchItemFailures`; after maxReceiveCount, message moves to DLQ |
| Structured validation error logs | Error must include which field failed, what value was received, and which handler rejected it | LOW | Powertools Logger already present; add `validationError`, `fieldName`, `receivedValue` keys |
| Validation before any side effects | Must check schema before DynamoDB writes or AWS API calls | LOW | Move validation to top of function, before any `await` calls |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Zod schema definitions for each handler's event type | Single source of truth for what each handler expects; TypeScript inference for free | MEDIUM | `z.object({...}).parse(detail)` replaces ad-hoc `if (!field)` checks; requires `zod` dep |
| Schema version annotation on DLQ messages | Stuck events in DLQ include schema version so you know which contract was in effect | LOW | Add `schemaVersion: '1'` field to log output on validation failure |
| Validation coverage for recovery events | `scan-stuck-sessions` recovery event path also has a separate shape that must be validated | MEDIUM | `recording-ended.ts` already has a recovery path; validate its fields separately |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| JSON Schema / ajv for validation | Industry standard JSON Schema tooling | Heavy dep, verbose schemas, no TypeScript inference benefit | Zod gives inference + runtime validation in one package |
| Validate EventBridge schema registry integration | AWS-native schema validation at EventBridge level | EventBridge schema validation adds latency and complexity; does not help SQS-delivered events which are the actual delivery path | Validate in Lambda handler at the SQS boundary where the message is actually consumed |
| Exhaustive validation of all AWS-generated fields | Validate every field from IVS/MediaConvert/Transcribe event shapes | AWS-generated events are structurally stable; over-validating creates brittleness when AWS adds new optional fields | Validate only the fields each handler actually uses |

---

## Track C: DLQ Re-drive Tooling

### Table Stakes (Developer Experience)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| List messages in each DLQ | Can't fix what you can't see; operator must enumerate stuck events | MEDIUM | AWS SQS `ReceiveMessage` with `VisibilityTimeout=0` to peek without consuming; or `GetQueueAttributes` for depth |
| Show message body in readable form | DLQ messages are base64-encoded EventBridge envelope inside SQS body; need to decode and pretty-print | LOW | JSON.parse twice: SQS body then EventBridge event detail |
| Identify which session a stuck message belongs to | Need `sessionId` to correlate with DynamoDB state | LOW | Extract from message body; present in all pipeline event shapes |
| Re-drive single message to original queue | Replay a stuck event through its handler without losing the original SQS envelope | MEDIUM | `SendMessage` to original queue with same body; then `DeleteMessage` from DLQ |
| Delete a stuck message from DLQ | Operator must be able to discard a permanently-invalid event after investigation | LOW | `DeleteMessage` with receipt handle |
| Report message count per DLQ | Quick health check — "are any DLQs backed up?" | LOW | `GetQueueAttributes` with `ApproximateNumberOfMessages` |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Bulk re-drive all messages from a DLQ | Recover from an outage that caused many failures without running re-drive N times | MEDIUM | Loop over `ReceiveMessage` in batches of 10 until queue is drained; AWS also added `StartMessageMoveTask` API in 2022 |
| Dry-run mode for re-drive | Show what would be replayed without actually doing it | LOW | `--dry-run` flag; print messages but skip `SendMessage` + `DeleteMessage` |
| Correlation with `debug-pipeline.js` | After identifying stuck event's sessionId, immediately pull session state | MEDIUM | Combine DLQ inspection + existing `debug-pipeline.js` logic into a unified report |
| Queue URL auto-discovery from CDK outputs | Don't hard-code queue URLs; read from CloudFormation outputs | LOW | `aws cloudformation describe-stacks --query` to get queue URLs |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Automated re-drive on alarm trigger | Auto-recover without human intervention | Automated re-drive hides root cause; if the original bug is still present, re-drive will DLQ again in a loop | Alarm alerts human; human uses tooling to inspect and decide; fix root cause first |
| Re-drive to a different handler | Test a message against a new version of the handler | Complex routing, high risk of duplicate processing | Deploy the fix, then use normal re-drive to original queue |
| Store DLQ message history in DynamoDB | Audit trail of what was in the DLQ | Adds operational complexity; CloudWatch Logs already captures the failure; DLQ is ephemeral by design | Use CloudWatch Logs Insights to query handler failures by sessionId |

---

## Track D: Idempotency Gap Coverage

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `transcribe-completed` is idempotent | Handler can be retried without creating duplicate AI summary jobs or corrupting transcript | MEDIUM | Currently no explicit guard; must check if transcript already stored before overwriting |
| `store-summary` is idempotent | Bedrock invocation on retry must not overwrite a good summary with a new one | MEDIUM | Check `aiSummaryStatus === 'available'` before invoking Bedrock; if already available, skip and return |
| `recording-ended` recovery path is idempotent | Recovery event re-submits MediaConvert; must not double-submit if job already running | MEDIUM | Check `transcriptStatus !== 'processing'` and `mediaconvertJobId` not already set before submitting |
| Idempotency guards return cleanly | When duplicate detected, log it and return (not throw); SQS should not retry a successful idempotent no-op | LOW | Distinguish "already done" (return success) from "transient error" (throw for retry) |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Powertools Idempotency utility | DynamoDB-backed idempotency with TTL; avoids hand-rolling state checks | HIGH | `@aws-lambda-powertools/idempotency` + `DynamoDBPersistenceLayer`; requires separate idempotency table or TTL-keyed items in existing table |
| Idempotency key documented per handler | Each handler has a clear definition of what constitutes a "duplicate" invocation | LOW | Comment in handler: "idempotency key = sessionId + jobId"; makes auditing easy |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Powertools Idempotency on all 5 handlers | Comprehensive protection | High overhead (extra DynamoDB table, per-invocation reads/writes); most handlers already have natural idempotency via `ConflictException` from Transcribe or conditional DynamoDB writes | Apply to handlers that actually lack protection (`transcribe-completed`, `store-summary`); skip handlers that are already safe |
| SQS FIFO with content-based deduplication | Idempotency at queue level | FIFO queues have throughput limits (300 msg/s vs Standard queues near-unlimited); BROADCAST/HANGOUT recordings can be high-burst | Keep Standard queues; idempotency in handler is the correct layer |

---

## Track E: UI Polish — Transcript / AI Summary Display

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Processing state shown while transcript not ready | User opening replay before pipeline completes must see a clear "processing" state, not a broken component | LOW | `TranscriptDisplay` shows "Transcript not available yet" on 404; upgrade to show pipeline stage from session metadata |
| Transcript synced to playback position | Active segment highlighted as video plays — core value of the transcript panel | LOW | Already implemented; verify scroll-into-view works correctly on long transcripts |
| Speaker bubble layout for diarized sessions | Two-speaker layout visually distinguishes participants | LOW | Already implemented in `TranscriptDisplay` bubble mode |
| Summary status variants styled consistently | "Summary coming soon" vs "Summary unavailable" vs actual text must look intentional | LOW | `SummaryDisplay` uses plain text for all states; add distinct visual treatment per status |
| Transcript panel and summary panel co-exist without layout conflict | Video + transcript + summary must fit on screen without scrolling wars | MEDIUM | Current layout on `VideoPage` collapses them behind a toggle; needs layout review |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Click-to-seek from transcript segment | Click a transcript line to jump video to that timestamp | LOW | `video.currentTime = segment.startTime / 1000`; requires passing a seek callback from player to transcript |
| Transcript search / filter | Find a word in the transcript and jump to it | MEDIUM | Client-side filter over `segments` array; highlight matching segments |
| Retry button when transcript failed | Give user a clear action when pipeline failed | LOW | Show button that displays support info or links to re-drive tooling |
| Copy transcript to clipboard | Share or save transcript text | LOW | `navigator.clipboard.writeText(segments.map(s => s.text).join('\n'))` |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time transcript streaming during live session | Show words as speaker says them in live mode | Live transcription requires Amazon Transcribe Streaming (different service, websocket protocol, additional cost); IVS provides no transcription hook | Transcription is post-session only; display "transcript available after session ends" in live UI |
| Translate transcript to other languages | International users | Scope expansion; requires Amazon Translate integration | Defer to future milestone |

---

## Track F: UI Polish — Upload Video Player

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Processing state while video is not ready | User reaching `/video/:sessionId` before upload pipeline finishes must see pipeline progress, not a broken player | LOW | `VideoPage` already shows "Video still processing" with `SessionAuditLog`; verify all pipeline stages appear correctly |
| Quality selector functional | Users expect to choose video quality on an upload player | LOW | `QualitySelector` exists; confirm it works with the transcoded HLS output from `transcription-bucket` |
| Comments anchored to video timestamps | Timestamped comments are the core differentiator; must display and submit correctly | MEDIUM | `CommentThread` exists; verify `syncTime === 0` guard works correctly and timestamps render |
| Reactions visible on video page | Reactions are part of the engagement model | LOW | `ReplayReactionPicker` + `ReactionSummaryPills` exist; verify count display after page load |
| AI summary visible when available | The pipeline effort to generate summaries must surface to users | LOW | `SummaryDisplay` is integrated; ensure "pending" state does not look broken |
| Back navigation to home | User must be able to leave the video page | LOW | Back button exists in header |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Transcript panel for uploaded videos | Same transcript UX as replay — adds depth to upload page | MEDIUM | `VideoInfoPanel` wraps `TranscriptDisplay` behind a toggle; surface it more prominently |
| Auto-scroll comments near current video position | Comments panel shows comments near current playback time | MEDIUM | Filter/sort comments by `sessionRelativeMs` proximity to `syncTime` |
| Inline video title editing | Creator can rename their upload | MEDIUM | Requires `updateSession` API endpoint; defer if not in scope |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Video download button | Users want to save videos | S3 pre-signed URL approach creates security and access-control complexity | Defer to future milestone as a CDN-gated feature |
| Chapters / markers on seek bar | YouTube-style chapter navigation | Requires chapter metadata storage + HLS marker spec; high complexity for low immediate value | Transcript click-to-seek achieves similar goal with less complexity |

---

## Track G: UI Polish — Activity Feed / Home

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Pipeline processing state accurately reflected in cards | If a session is `transcriptStatus: 'processing'`, the card must say so, not show a broken thumbnail or missing badge | LOW | `SessionAuditLog` is integrated in cards in compact mode; verify it shows the correct last-event label |
| Thumbnail shown when available | Activity cards with a thumbnail are more engaging than text-only cards | LOW | `thumbnailUrl` is stored on session; `BroadcastActivityCard`/`HangoutActivityCard` need to display it if present |
| Live sessions appear at top of feed | Live sessions have time-sensitive urgency and must not be buried | LOW | `LiveBroadcastsSlider` already surfaces live sessions; confirm ordering is correct relative to activity feed |
| UPLOAD sessions appear in feed | Upload sessions are in the type system; verify `UploadActivityCard` is complete | LOW | `UploadActivityCard` exists; audit for missing fields vs broadcast/hangout cards |
| Empty state for no sessions | First-time user must see an actionable empty state | LOW | `ActivityFeed` returns "No activity yet"; verify this renders correctly |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Reaction summary pills on activity cards | Quickly shows engagement level without clicking through | LOW | `ReactionSummaryPills` exists; verify it receives correct `reactionSummary` data from list-activity response |
| AI summary teaser on card | 2-line summary excerpt gives users a reason to click | LOW | `SummaryDisplay` with `truncate=true` is ready; confirm it is wired in all three card types |
| Duration display on cards | Users want to know how long a session was before clicking | LOW | `recordingDuration` is stored; add formatted duration to card metadata row |
| Pagination / infinite scroll | Feed grows over time | MEDIUM | `list-activity` likely returns all sessions; needs `lastEvaluatedKey` DynamoDB pagination |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Follower/following feed | "Show me sessions from people I follow" | Requires social graph (new DynamoDB schema, new endpoints); scope explosion | Home feed shows all sessions (global feed) for v1 |
| Real-time feed updates via WebSocket | New sessions appear without refresh | WebSocket adds infrastructure complexity disproportionate to value | 30-second poll or manual refresh is sufficient |

---

## Track H: UI Polish — Broadcast / Hangout Live Session

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Broadcast controls work when live (mute, camera, screen share) | Basic live session controls are non-negotiable | LOW | All controls exist in `BroadcastPage`; audit for broken states (e.g., button shows wrong state after toggle) |
| Hangout controls work (mute, camera, leave) | Same as broadcast — basic controls | LOW | `HangoutPage` has mute/camera toggles; verify a leave/end session button is present and functional |
| Error state for failed stream start | "Go Live" can fail; user must see a clear error not a spinner forever | LOW | `error` state from `useBroadcast` is shown in a banner; verify error text is user-readable |
| Viewer count accurate | Broadcaster needs to know how many people are watching | LOW | `useViewerCount` polls every 10s; verify count updates during live session |
| Chat visible and functional during live | Chat is the primary interaction mechanism | LOW | `ChatPanel` is integrated; audit edge cases (empty state, connection error state) |
| End session / leave confirmation | Accidental clicks on "Stop Broadcast" or "Leave" must be preventable | MEDIUM | No confirmation dialog currently exists; add a confirm step |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Stream quality overlay readable at a glance | Broadcaster can see bitrate/health without developer tools | LOW | `StreamQualityOverlay` + `StreamQualityDashboard` exist; verify health score thresholds and color coding |
| Mobile-responsive broadcast layout | Broadcasters on mobile devices | MEDIUM | `isMobile` detection exists; audit that controls are usable on small screens |
| Hangout reactions | Hangout participants can react just like broadcast viewers — parity gap | MEDIUM | `BroadcastPage` has `ReactionPicker`; `HangoutPage` currently lacks it |
| Spotlight feature visible to broadcaster | Show who is currently featured during broadcast | LOW | `SpotlightBadge` exists in broadcast; confirm it renders correctly when a creator is spotlighted |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Picture-in-picture for broadcaster | Broadcaster continues using desktop while live | Browser PiP API is complex and inconsistently supported; IVS SDK does not natively support PiP | Defer; the current fixed-layout broadcast page is sufficient |
| Recording duration timer on broadcast page | Show duration of current broadcast | Requires tracking `broadcastStartedAt` and computing elapsed time client-side | Viewer count + LIVE badge is sufficient signal; defer |

---

## Feature Dependencies

```
X-Ray tracing
    requires --> Lambda active tracing enabled in CDK (session-stack.ts)
    requires --> X-Ray SDK / Powertools Tracer added to Lambda bundles
    requires --> Subsegment wrapping of AWS SDK clients per handler

Event schema validation
    requires --> Zod (new dep) OR hand-rolled validation at top of processEvent()
    enhances --> DLQ re-drive (validated events produce better error messages in DLQ)

DLQ re-drive tooling
    requires --> DLQ URLs / queue names (already in CDK; need to surface via CLI)
    enhances --> debug-pipeline.js (existing tool covers session-level state)
    depends-on --> existing SQS DLQs (shipped in v1.6 Phase 31)

Idempotency hardening
    requires --> understanding which handlers lack guards (transcribe-completed, store-summary)
    conflicts-with --> Powertools Idempotency library (adds DynamoDB dep; targeted guards preferred)

UI polish -- transcript display
    requires --> existing TranscriptDisplay component (already built)
    requires --> existing SummaryDisplay component (already built)
    enhances --> upload video player (transcript panel shared via VideoInfoPanel)

UI polish -- activity feed
    requires --> reactionSummary field on session (already stored)
    requires --> thumbnailUrl field on session (already stored)
    enhances --> broadcast/hangout cards (same card components)
```

### Dependency Notes

- **X-Ray requires CDK change first.** Lambda `tracing: lambda.Tracing.ACTIVE` must be set before any tracer code runs. CDK change is the prerequisite for all X-Ray handler work.
- **Schema validation before DLQ re-drive.** Better validation errors make DLQ message triage faster; do validation first in the same phase if possible.
- **Idempotency is independent of X-Ray.** These can be phased separately without coupling.
- **UI polish tracks are independent of backend tracks.** Frontend and backend work can be parallelized across phases.
- **`transcribe-completed` and `store-summary` are the priority idempotency targets.** `recording-ended` has partial protection via MediaConvert job ID storage; `transcode-completed` has `ConflictException` guard on Transcribe. The two with no guard are `transcribe-completed` (S3 overwrite risk) and `store-summary` (Bedrock reinvocation risk).

---

## MVP Definition for v1.7

### Launch With (all of these are in scope)

- [ ] X-Ray active tracing on all 5 pipeline Lambdas with subsegment-wrapped AWS clients
- [ ] Schema validation at top of each `processEvent()` in all 5 handlers
- [ ] `transcribe-completed` and `store-summary` idempotency guards
- [ ] DLQ inspection + re-drive CLI tool (list, show, re-drive, delete)
- [ ] UI: transcript click-to-seek + summary status distinct styling
- [ ] UI: activity feed cards show thumbnail, duration, accurate pipeline state
- [ ] UI: broadcast/hangout end-session confirmation dialog + hangout reactions parity
- [ ] UI: upload video player — processing state accurate, comments + transcript panels complete

### Defer to v1.8

- [ ] Powertools Idempotency utility (DynamoDB-backed) — targeted guards are sufficient
- [ ] Transcript translation — requires Amazon Translate integration
- [ ] Activity feed pagination — useful but not blocking
- [ ] Follower/following feed — social graph is a milestone-level feature
- [ ] Video download — access-control complexity, defer

---

## Feature Prioritization Matrix

| Feature | User / Dev Value | Implementation Cost | Priority |
|---------|-----------------|---------------------|----------|
| X-Ray tracing on pipeline Lambdas | HIGH (operational) | MEDIUM | P1 |
| Schema validation at handler boundaries | HIGH (reliability) | LOW | P1 |
| `transcribe-completed` + `store-summary` idempotency | HIGH (correctness) | LOW | P1 |
| DLQ inspection + re-drive CLI | HIGH (operational) | MEDIUM | P1 |
| UI: transcript click-to-seek | MEDIUM (UX) | LOW | P1 |
| UI: summary status distinct styling | MEDIUM (UX) | LOW | P1 |
| UI: activity card thumbnails + duration | HIGH (UX) | LOW | P1 |
| UI: end-session confirm dialog | MEDIUM (safety) | LOW | P1 |
| UI: hangout reactions parity with broadcast | MEDIUM (parity) | MEDIUM | P2 |
| UI: transcript search / filter | LOW (UX) | MEDIUM | P2 |
| Activity feed pagination | MEDIUM (UX) | MEDIUM | P2 |
| X-Ray custom group / filter expression | LOW (nice-to-have) | LOW | P2 |
| Powertools Idempotency utility | LOW (overkill for this scale) | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.7 launch
- P2: Add if phase capacity allows
- P3: Defer to future milestone

---

## Sources

- Direct code analysis: `backend/src/handlers/recording-ended.ts`, `transcode-completed.ts`, `transcribe-completed.ts`, `store-summary.ts`, `on-mediaconvert-complete.ts`
- Direct code analysis: `web/src/features/replay/TranscriptDisplay.tsx`, `SummaryDisplay.tsx`
- Direct code analysis: `web/src/features/activity/ActivityFeed.tsx`, `SessionAuditLog.tsx`
- Direct code analysis: `web/src/features/upload/VideoPage.tsx`
- Direct code analysis: `web/src/features/broadcast/BroadcastPage.tsx`, `web/src/features/hangout/HangoutPage.tsx`
- Direct code analysis: `infra/lib/stacks/session-stack.ts`, `monitoring-stack.ts`
- Direct code analysis: `tools/debug-pipeline.js`, `tools/replay-pipeline.js`
- Project context: `.planning/PROJECT.md` v1.7 requirements and v1.6 shipped features

---

*Feature research for: VideoNowAndLater v1.7 Event Hardening & UI Polish*
*Researched: 2026-03-12*
