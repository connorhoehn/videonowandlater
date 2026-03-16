# Requirements: VideoNowAndLater v1.7

**Defined:** 2026-03-12
**Core Value:** Users can go live instantly — either broadcasting to viewers or hanging out in small groups — and every session is automatically preserved with its full chat and reaction context for later replay.

## v1.7 Requirements

### Tracing

- [x] **TRACE-01**: Developer can view X-Ray traces for all 5 pipeline Lambda functions (recording-ended, transcode-completed, on-mediaconvert-complete, transcribe-completed, store-summary) with active tracing enabled
- [x] **TRACE-02**: Each pipeline handler emits subsegments for downstream AWS SDK calls (DynamoDB, S3, Transcribe, Bedrock, MediaConvert, SQS) visible in X-Ray
- [x] **TRACE-03**: Each X-Ray segment is annotated with `sessionId` and `pipelineStage` so traces are searchable without log diving
- [x] **TRACE-04**: X-Ray service map shows connected pipeline stages from recording-ended through store-summary

### Validation

- [x] **VALID-01**: All 5 pipeline handlers validate required event fields with Zod at the start of processEvent() before any side effects
- [x] **VALID-02**: Schema validation failures route the event to DLQ (via batchItemFailures) without triggering SQS retries
- [x] **VALID-03**: start-transcribe error handling fixed — transient Transcribe API errors throw and trigger SQS retry instead of being silently swallowed
- [ ] **VALID-04**: Validation failures log structured error details (field name, received value, handler name) via Powertools Logger

### Idempotency

- [ ] **IDEM-01**: transcribe-completed handler is idempotent — duplicate SQS deliveries skip the S3 transcript write if a transcript is already stored for the session
- [ ] **IDEM-02**: store-summary handler is idempotent — duplicate SQS deliveries skip the Bedrock invocation if an AI summary is already available for the session
- [ ] **IDEM-03**: Idempotent no-ops return success (acknowledge SQS message) rather than throwing, preventing unnecessary retries

### DLQ Tooling

- [x] **DLQ-01**: Developer can list all messages in any pipeline DLQ via CLI tool with decoded session context (sessionId, event type, error)
- [x] **DLQ-02**: Developer can re-drive individual messages or bulk re-drive all messages from a DLQ back to its source queue
- [x] **DLQ-03**: Developer can delete a permanently-invalid message from a DLQ after investigation
- [x] **DLQ-04**: CLI tool reports approximate message count per DLQ for quick health check across all 5 queues

### UI Polish

- [x] **UI-01**: User can click a transcript segment to seek the video player to that timestamp
- [x] **UI-02**: AI summary panel displays distinct visual states for processing / available / failed (not the same plain text style for all)
- [x] **UI-03**: Activity feed cards display a video thumbnail when one is available for the session
- [x] **UI-04**: Activity feed cards display the recording duration in a human-readable format
- [x] **UI-05**: Activity feed cards accurately reflect the current pipeline processing state (transcribing, summarizing, complete, failed)
- [ ] **UI-06**: Stopping a broadcast or leaving a hangout requires confirmation to prevent accidental session termination
- [ ] **UI-07**: Hangout page has a reaction picker and floating reactions (parity with broadcast page)
- [ ] **UI-08**: Upload video page shows accurate pipeline stage progression while the video is still processing
- [ ] **UI-09**: Upload video page comment thread and transcript panel are fully functional (submit, display, timestamp correlation)

## v2 Requirements

### Tracing

- **TRACE-05**: X-Ray custom group with filter expression for pipeline-only traces (reduces noise from non-pipeline Lambdas)
- **TRACE-06**: X-Ray annotations on all non-pipeline Lambdas for full-system observability

### Idempotency

- **IDEM-04**: Powertools Idempotency utility with DynamoDB persistence layer replaces targeted guards (for scale)

### UI

- **UI-10**: Transcript search / filter — find a word and jump to its timestamp
- **UI-11**: Copy transcript to clipboard button
- **UI-12**: Activity feed pagination / infinite scroll as session count grows
- **UI-13**: Mobile-responsive broadcast layout

## Out of Scope

| Feature | Reason |
|---------|--------|
| EventBridge schema registry validation | EventBridge validation doesn't help SQS-delivered events which are the actual delivery path; Zod at Lambda boundary is the right layer |
| SQS FIFO queues for idempotency | FIFO throughput limits conflict with burst recording patterns; handler-level guards are correct approach |
| Automated DLQ re-drive on alarm trigger | Hides root cause; human investigation before re-drive is required |
| Real-time transcript streaming during live sessions | Requires Amazon Transcribe Streaming (different service, websocket, additional cost); out of scope |
| Video download button | S3 pre-signed URL approach introduces access-control complexity; defer |
| Activity feed follower/following filter | Requires social graph — milestone-level feature, not polish |
| Inline video title editing | Requires updateSession endpoint changes; defer |
| X-Ray on all Lambdas (not just pipeline) | Non-pipeline Lambdas have trivial logic; cost/complexity not justified for v1.7 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TRACE-01 | Phase 36 | Complete |
| TRACE-02 | Phase 36 | Complete |
| TRACE-03 | Phase 36 | Complete |
| TRACE-04 | Phase 36 | Complete |
| VALID-01 | Phase 37 | Complete |
| VALID-02 | Phase 37 | Complete |
| VALID-03 | Phase 37 | Complete |
| VALID-04 | Phase 37 | Pending |
| IDEM-01 | Phase 38 | Pending |
| IDEM-02 | Phase 38 | Pending |
| IDEM-03 | Phase 38 | Pending |
| DLQ-01 | Phase 39 | Complete |
| DLQ-02 | Phase 39 | Complete |
| DLQ-03 | Phase 39 | Complete |
| DLQ-04 | Phase 39 | Complete |
| UI-01 | Phase 40 | Complete |
| UI-02 | Phase 40 | Complete |
| UI-03 | Phase 40 | Complete |
| UI-04 | Phase 40 | Complete |
| UI-05 | Phase 40 | Complete |
| UI-06 | Phase 41 | Pending |
| UI-07 | Phase 41 | Pending |
| UI-08 | Phase 41 | Pending |
| UI-09 | Phase 41 | Pending |

**Coverage:**
- v1.7 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after initial definition*
