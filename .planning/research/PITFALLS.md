# Domain Pitfalls

**Domain:** AWS IVS Live Video Platform (Streaming + RealTime + Chat)
**Project:** VideoNowAndLater
**Researched:** 2026-03-01
**Confidence:** MEDIUM-HIGH (official AWS docs verified most claims; some operational patterns from training data flagged)

---

## Critical Pitfalls

Mistakes that cause rewrites, runaway costs, or broken core functionality.

### Pitfall 1: Treating IVS Streaming and IVS RealTime as the Same Service

**What goes wrong:** Developers assume IVS low-latency streaming (channels) and IVS RealTime (stages) share APIs, SDKs, token models, and recording mechanisms. They do not. These are two completely separate AWS services with different resource models, different SDKs, different pricing, and different recording architectures.

**Why it happens:** Both are under the "Amazon IVS" brand. The AWS console groups them together. Marketing says "IVS" without distinguishing which product.

**Consequences:**
- Architecture that assumes a single resource model breaks when the second mode is added
- Token management code written for one service cannot be reused for the other (IVS uses stream keys; RealTime uses participant tokens signed as JWTs)
- Recording works completely differently: IVS streaming has built-in auto-record to S3 via RecordingConfiguration; RealTime requires server-side composition to record
- Chat integration patterns differ between the two

**Prevention:**
- From Day 1, build two distinct backend modules: one for IVS streaming (channels, stream keys, recording configs) and one for IVS RealTime (stages, participant tokens, compositions)
- Share common infrastructure (DynamoDB sessions table, API Gateway, auth) but keep IVS-specific logic separated
- Use the correct SDK client for each: `@aws-sdk/client-ivs` for streaming, `@aws-sdk/client-ivs-realtime` for RealTime
- IVS Chat (`@aws-sdk/client-ivschat`) is a third, separate service that works with both

**Detection:** If you find yourself trying to "create a channel" for a multi-participant hangout, or "create a stage" for a one-to-many broadcast, the abstraction is wrong.

**Phase relevance:** Must be addressed in Phase 1 (infrastructure foundation). Getting this boundary wrong poisons every subsequent phase.

**Confidence:** HIGH -- verified via official AWS documentation showing completely separate API references, SDKs, and resource models.

---

### Pitfall 2: Hardcoding Recording Paths and Assuming Static Renditions

**What goes wrong:** Developers construct S3 paths to recorded HLS segments by hardcoding rendition names (e.g., always assuming a `720p30/` directory exists) or building static URL patterns. The recording breaks for replay because renditions and paths vary per stream.

**Why it happens:** The S3 prefix structure (`/ivs/v1/<account>/<channel>/<date>/<recording_id>`) looks predictable, so developers assume the inner structure is too.

**Consequences:**
- Replay viewer shows blank or 404s when a stream was recorded at a different resolution
- Playback URLs break when stream characteristics change between sessions
- Thumbnail paths fail silently

**Prevention:**
- AWS explicitly warns: "Do not make assumptions about static rendition paths or assume specific renditions will always be available"
- Always read the `events/recording-started.json` or `events/recording-ended.json` metadata files to discover available renditions dynamically
- Build a Lambda triggered by EventBridge "IVS Recording State Change" events that reads the metadata JSON and writes rendition info to DynamoDB for the replay API
- Never process recordings until the `recording-ended` event fires -- manifests and segments take time to fully write after `recording-started`

**Detection:** Replay works for some videos but not others, especially when streamers change settings or network conditions vary.

**Phase relevance:** Recording/replay phase. Must be built correctly from the start since replay is a core feature.

**Confidence:** HIGH -- directly from official AWS IVS recording documentation with explicit warnings.

---

### Pitfall 3: Exposing AWS Concepts in the UX Layer

**What goes wrong:** The frontend leaks AWS terminology like "channels," "stages," "rooms," "stream keys," "participant tokens" into the user experience. Users see empty channel lists, need to understand "joining a stage," or encounter "room not found" errors with AWS ARNs.

**Why it happens:** AWS IVS APIs return resources named with AWS conventions. Without deliberate abstraction, these names flow through the API layer directly into the UI.

**Consequences:**
- Users confused by infrastructure terminology they should never see
- Product feels like a developer tool, not a consumer app
- Error messages expose internal architecture ("Stage ARN invalid" instead of "Unable to start your session")
- Violates the explicit project constraint: "No AWS concepts exposed to end users"

**Prevention:**
- Define a "Session" domain model in DynamoDB that maps to underlying IVS resources but uses user-facing concepts: "Go Live" (not "Create Channel"), "Join Hangout" (not "Join Stage"), "Chat" (not "Connect to Room")
- API responses should never include ARNs, channel IDs, or stage IDs -- map these server-side and return session-level identifiers
- Error handling middleware must catch AWS SDK errors and translate them to user-friendly messages
- Frontend components should reference sessions, not infrastructure

**Detection:** Grep the frontend codebase for "channel," "stage," "arn," "room" -- if these appear in user-visible strings, the abstraction is leaking.

**Phase relevance:** Must be established in the API/data model phase and enforced throughout. Retrofitting abstraction over leaked concepts is painful.

**Confidence:** HIGH -- this is a stated project constraint, and the pattern is well-understood.

---

### Pitfall 4: Not Pre-Warming IVS Resources (Cold Start Latency)

**What goes wrong:** When a user clicks "Go Live," the system creates an IVS channel or stage on demand. The AWS API call to create the resource, configure recording, and return stream keys/tokens takes 2-8 seconds. The user stares at a spinner instead of going live instantly.

**Why it happens:** On-demand creation is the simplest architecture. Pre-warming requires a resource pool with lifecycle management, which adds complexity.

**Consequences:**
- "Go Live" takes 5+ seconds instead of being instant
- Under load, API rate limits (5 TPS for most IVS operations, 50 TPS for CreateParticipantToken) cause failures when multiple users try to go live simultaneously
- Users retry, making the problem worse
- The "instant go-live" core value proposition is broken

**Prevention:**
- Build a resource pool that maintains N pre-created channels and stages in a "warm" state
- Use a DynamoDB table to track pool state: `AVAILABLE`, `IN_USE`, `COOLDOWN`, `RECYCLING`
- A scheduled Lambda (or EventBridge rule) replenishes the pool periodically
- When a user goes live, claim a warm resource from the pool (a single DynamoDB conditional write) instead of creating one
- When a session ends, return the resource to a cooldown state before recycling
- Monitor pool depth with CloudWatch alarms

**Detection:** Measure time from "Go Live" click to first frame rendered. If it exceeds 1 second, the pool is too small or not working.

**Phase relevance:** Must be designed in the infrastructure phase and implemented before the "Go Live" feature is user-facing. The pool pattern influences the entire data model.

**Confidence:** HIGH -- the project explicitly requires pre-warming, and IVS API rate limits (verified in official quotas docs) make on-demand creation untenable at scale.

---

### Pitfall 5: Runaway Costs from Forgotten Resources

**What goes wrong:** IVS channels and stages left running after sessions end, recording configurations creating unbounded S3 storage, or composition sessions (RealTime) running indefinitely rack up charges. A single forgotten composition can run for 24 hours (the max duration) before auto-stopping.

**Why it happens:**
- No automated cleanup when users disconnect unexpectedly (browser close, network loss)
- Recording to S3 has no IVS charge, but S3 storage and CloudFront delivery do accumulate
- RealTime compositions have a 24-hour max duration but no auto-stop when participants leave
- Pre-warmed resource pools, if not bounded, create more resources than needed

**Consequences:**
- Unexpected AWS bills, potentially in the hundreds or thousands of dollars
- S3 bucket fills with recordings nobody will watch
- CDK destroy does not clean up S3 bucket contents (only the bucket if empty)

**Prevention:**
- Implement a session timeout Lambda that checks for idle sessions (no active participants for N minutes) and tears down resources
- Set S3 lifecycle policies on the recording bucket: move to Glacier after 30 days, delete after 90 days (or whatever retention makes sense)
- Cap composition duration below 24 hours for your use case
- Add CloudWatch billing alarms at $10, $50, $100 thresholds
- For `cdk destroy`: use `RemovalPolicy.DESTROY` with `autoDeleteObjects: true` on S3 buckets in dev, but NOT in production
- Track all created IVS resources in DynamoDB so cleanup can enumerate them
- Pool manager must have a max pool size and refuse to create beyond it

**Detection:** Weekly bill review. CloudWatch cost anomaly detection. DynamoDB scan for sessions older than 24 hours still in `IN_USE` state.

**Phase relevance:** Infrastructure phase (lifecycle management), but must be continuously enforced. Add billing alarms in Phase 1.

**Confidence:** HIGH -- IVS pricing model verified via official docs; composition 24-hour limit verified in quotas.

---

### Pitfall 6: IVS Chat Tokens Are Single-Use and Short-Lived

**What goes wrong:** Developers create a chat token and try to reuse it for reconnection, or cache tokens for later use. The connection fails silently or with cryptic errors because IVS Chat tokens can only be used once and expire quickly.

**Why it happens:** The chat token model is different from typical JWT patterns where tokens are valid until expiration. IVS Chat tokens are consumed on first use.

**Consequences:**
- Chat reconnection after network blip fails
- Token caching strategy breaks chat for returning users
- Users see "connected" state but messages stop flowing

**Prevention:**
- Always generate a fresh chat token for every WebSocket connection attempt, including reconnections
- Build the token endpoint to be fast and cheap (it is just a CreateChatToken API call)
- Implement client-side reconnection logic that requests a new token before reconnecting
- Never store chat tokens in localStorage or session storage for reuse
- Rate limit is generous (200 TPS for CreateChatToken) so frequent token creation is fine

**Detection:** Chat works on first connection but fails after any disconnect/reconnect cycle.

**Phase relevance:** Chat implementation phase. Must be understood before writing any chat client code.

**Confidence:** HIGH -- verified in official IVS Chat messaging API documentation: "Tokens can only be used once" and "must be used within a brief period after creation."

---

## Moderate Pitfalls

### Pitfall 7: Region Mismatch Between IVS Resources

**What goes wrong:** Channel created in `us-east-1`, recording configuration in `us-west-2`, chat room in `eu-west-1`. Resources cannot reference each other across regions.

**Why it happens:** IVS control plane is regional. If the developer's default AWS region differs from where they created resources, or CDK stacks target different regions, resources end up scattered.

**Prevention:**
- Pin a single region in CDK configuration and use it consistently for ALL IVS resources (channels, stages, recording configs, chat rooms)
- Set the region explicitly in every AWS SDK client instantiation, never rely on defaults
- CDK: use `env: { region: 'us-west-2' }` on the stack, not ambient region
- Validate in CI that all IVS resources target the same region

**Detection:** "Resource not found" errors when associating a recording config with a channel, despite both existing.

**Confidence:** HIGH -- verified in official docs: "Channels created in one region are completely independent of channels in other regions."

---

### Pitfall 8: Browser-Based Publishing Instability

**What goes wrong:** The IVS Web Broadcast SDK and RealTime Web SDK work for demos but exhibit instability in production: streams drop, quality degrades unpredictably, reconnections fail.

**Why it happens:** AWS explicitly warns: "browser-based publishing is subject to the constraints and variability of browser environments." Browsers sandbox WebRTC, limit access to hardware encoders, and enforce resource constraints that native apps do not.

**Prevention:**
- AWS recommends: "If you need to prioritize stability, we generally recommend publishing from a non-browser source (e.g., OBS Studio or other dedicated encoders)"
- For the web-first approach this project requires, accept that browser publishing will be less stable than native
- Implement robust reconnection logic with exponential backoff
- Monitor WebRTC stats (the SDK exposes per-connection statistics) and proactively downgrade quality before the connection drops
- Test across Chrome, Firefox, Safari -- behavior varies significantly
- For IVS RealTime: max publish resolution from browser is 720p (hard limit)
- Provide clear user feedback when connection quality degrades

**Detection:** Stream quality complaints, frequent disconnections, inconsistent behavior across browsers.

**Confidence:** HIGH -- directly from official AWS IVS RealTime Web SDK documentation with explicit warnings.

---

### Pitfall 9: CDK IVS Support Is L1 Only (No High-Level Constructs)

**What goes wrong:** Developers expect to use ergonomic CDK L2 constructs for IVS (like `new ivs.Channel(this, 'MyChannel', { ... })` with sensible defaults). Instead, they find only auto-generated L1 `CfnChannel` constructs that mirror raw CloudFormation with no defaults, no validation, and no helper methods.

**Why it happens:** AWS has not yet promoted IVS CDK constructs beyond L1. An `@aws-cdk/aws-ivs-alpha` package exists but is experimental and may lack features.

**Prevention:**
- Plan for writing custom L2-like wrapper constructs in your CDK code that encapsulate common patterns (channel + recording config + event rules)
- Use `aws-cdk-lib/aws_ivs` for `CfnChannel`, `CfnRecordingConfiguration`, `CfnPlaybackKeyPair`
- Reference CloudFormation documentation (not CDK docs) for available properties since L1 constructs map 1:1 to CloudFormation
- Build a `VideoInfraConstruct` that creates channel + recording config + chat room as a unit
- Consider building a `ResourcePool` custom construct that manages pool lifecycle

**Detection:** CDK synth fails with missing required properties that L2 constructs would have defaulted.

**Confidence:** HIGH -- verified in official CDK API docs: "There are no official hand-written (L2) constructs for this service yet."

---

### Pitfall 10: Recording Merge Failures with Web Broadcast SDK

**What goes wrong:** `recordingReconnectWindowSeconds` is set to merge fragmented streams into a single recording, but merging fails when using the Web Broadcast SDK. Each reconnection creates a new recording prefix instead of appending to the existing one.

**Why it happens:** The Web Broadcast SDK dynamically adjusts bitrate and quality based on network conditions. IVS recording merge requires that reconnected streams have identical video dimensions, frame rate, codecs, and bitrate within 50% of the original. Browser-based streams rarely meet these constraints.

**Prevention:**
- Do not rely on `recordingReconnectWindowSeconds` for browser-originated streams
- Instead, handle "fragmented recordings" at the application layer: track multiple recording prefixes per session in DynamoDB and stitch them together in the replay viewer
- If merge is critical, use a native encoder (OBS, FFmpeg) that maintains constant output parameters
- For the replay viewer, build logic to play multiple recordings sequentially with seamless transitions

**Detection:** EventBridge fires multiple `recording-started` events for what the user perceives as a single continuous stream.

**Confidence:** HIGH -- official AWS docs explicitly state: "Recording to same S3 prefix may fail due to dynamic bitrate/quality changes" when using Web Broadcast SDK.

---

### Pitfall 11: IVS RealTime Recording Requires Server-Side Composition

**What goes wrong:** Developers assume IVS RealTime (stages) has the same auto-record-to-S3 feature as IVS low-latency streaming. It does not. To record a RealTime session, you must start a server-side composition that composites all participant streams into a single output, then routes that to S3 or an IVS channel.

**Why it happens:** IVS streaming's recording is simple (attach a RecordingConfiguration to a channel). Developers expect the same pattern for stages.

**Consequences:**
- Hangout sessions are not recorded at all
- When composition is added late, the architecture must be reworked to start compositions when sessions begin
- Composition has its own quotas: max 5 per stage, max 2 destinations, 24-hour max duration
- Composition adds cost (you pay for composition processing time)

**Prevention:**
- Design the session lifecycle to automatically start a composition when a RealTime hangout begins, if recording is desired
- Use composition destinations wisely: S3 for archival, IVS channel for live broadcasting a hangout to a larger audience
- Budget for composition costs separately from stage costs
- Monitor composition state -- if it fails, recording stops silently

**Detection:** Hangout sessions have no corresponding recordings in S3.

**Confidence:** HIGH -- verified via IVS RealTime quotas showing separate composition resources, and absence of auto-record feature in RealTime documentation.

---

### Pitfall 12: API Rate Limits That Bite at Scale

**What goes wrong:** IVS control plane API calls are rate-limited at 5 TPS for most operations (CreateChannel, CreateStage, DeleteChannel, etc.). During a usage spike, the resource pool cannot replenish fast enough, or batch operations exceed the rate limit.

**Why it happens:** IVS is designed for relatively low-frequency control plane operations. The rate limits are not adjustable.

**Consequences:**
- `ThrottlingException` errors when creating/deleting resources
- Pool replenishment fails, leaving no warm resources for new sessions
- Batch cleanup scripts that delete channels in a loop hit rate limits and fail partway through

**Prevention:**
- Pre-warm resources during off-peak hours, not on-demand during spikes
- Implement exponential backoff and retry logic for all IVS control plane calls
- Use `CreateParticipantToken` wisely -- it has a higher limit (50 TPS) but still finite
- Pool replenishment Lambda should pace itself: create at most 4 resources per second with jitter
- For batch operations (cleanup, migration), add deliberate delays between API calls
- Never call control plane APIs from the hot path of user requests -- always use pre-provisioned resources

**Detection:** CloudWatch `ThrottlingException` metrics on IVS API calls. Pool depth dropping to zero.

**Confidence:** HIGH -- rate limits verified in official IVS service quotas documentation.

---

## Minor Pitfalls

### Pitfall 13: Chat Message Rate Limit Per Connection

**What goes wrong:** A single WebSocket connection can send at most 10 messages per second. In an active chat with rapid-fire messaging, users hit the limit and messages are silently dropped.

**Prevention:**
- Client-side rate limiting with a message queue that batches sends
- Show users a cooldown indicator when approaching the limit
- For reactions (which can spike), aggregate client-side and send periodic summaries instead of individual reaction events

**Confidence:** HIGH -- verified in IVS Chat service quotas: "Rate of messaging requests per connection: 10 TPS (not adjustable)."

---

### Pitfall 14: Participant Token Attributes Visible to All Participants

**What goes wrong:** Developers store sensitive user data (email, user ID, role information) in IVS RealTime participant token `attributes`, not realizing these are exposed to every other participant in the stage.

**Prevention:**
- Only store display-safe information in token attributes (display name, avatar URL)
- Never include PII, internal user IDs, or role-based access information
- Use your own backend API for sensitive participant metadata, keyed by the token's `user_id`
- Token attributes are limited to 1 KB total

**Confidence:** HIGH -- official docs explicitly warn: "Do NOT store personally identifying, confidential, or sensitive information" in attributes.

---

### Pitfall 15: S3 Recording Bucket CORS and CloudFront Misconfiguration

**What goes wrong:** Recorded HLS video plays in some contexts but fails in the browser with CORS errors, or plays with significant buffering because CloudFront is not configured correctly.

**Prevention:**
- S3 bucket must have CORS configuration allowing your frontend origin
- CloudFront distribution must attach the "CORS-S3Origin" request policy and "SimpleCORS" response header policy
- Use Origin Access Control (OAC), not the older Origin Access Identity (OAI)
- Recorded objects are private by default -- direct S3 URLs will fail with "access denied"
- Test playback from the actual frontend domain, not just the CloudFront URL directly

**Confidence:** HIGH -- verified in official IVS recording documentation.

---

### Pitfall 16: CDK Destroy Does Not Clean Up S3 Contents

**What goes wrong:** Running `cdk destroy` removes the CloudFormation stack but fails if the S3 recording bucket contains any objects. The stack deletion hangs or fails, leaving orphaned resources.

**Prevention:**
- In development: use `RemovalPolicy.DESTROY` and `autoDeleteObjects: true` on the S3 bucket
- In production: use `RemovalPolicy.RETAIN` so recordings survive stack updates
- Document the manual cleanup step for development: empty the bucket before destroying
- Consider a separate "storage" stack that is not destroyed with the main application stack

**Confidence:** HIGH -- standard CDK behavior, well-documented.

---

### Pitfall 17: EventBridge Recording Events Delayed by Reconnect Window

**What goes wrong:** The `recording-ended` EventBridge event is delayed by the value of `recordingReconnectWindowSeconds`. If set to 60 seconds, the "recording ended" notification arrives at least 60 seconds after the stream actually stops. Replay metadata updates are delayed.

**Prevention:**
- Account for this delay in UX: the replay may not appear instantly after a stream ends
- Use a reasonable `recordingReconnectWindowSeconds` value (30-60 seconds is typical)
- Show a "processing" state in the replay viewer for recently ended sessions
- Do not set this value excessively high just to handle reconnections -- it delays all recording end events

**Confidence:** HIGH -- verified in official IVS recording documentation.

---

### Pitfall 18: Stream Key Exposure in Browser Context

**What goes wrong:** For IVS low-latency streaming, the ingest URL and stream key must be provided to the broadcaster. If broadcasting from a browser, the stream key is visible in JavaScript memory and network requests.

**Prevention:**
- Stream keys should be fetched just-in-time from your API, not embedded in frontend code
- Use short-lived sessions: when a broadcast ends, the channel should be recycled (new stream key)
- With the resource pool pattern, each "Go Live" gets a different channel with a different stream key
- Consider using IVS RealTime (participant tokens) for browser-originated streams instead, since tokens are more naturally scoped and expire

**Confidence:** MEDIUM -- standard security practice; IVS stream keys do not expire on their own (one key per channel).

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation | Severity |
|-------------|---------------|------------|----------|
| CDK Infrastructure Setup | L1-only constructs require verbose CloudFormation-style code (Pitfall 9) | Build custom wrapper constructs early; reference CF docs not CDK docs | Moderate |
| CDK Infrastructure Setup | Region mismatch across resources (Pitfall 7) | Pin region explicitly in stack env, validate in CI | Moderate |
| CDK Infrastructure Setup | S3 bucket blocks cdk destroy (Pitfall 16) | Set RemovalPolicy.DESTROY + autoDeleteObjects in dev | Minor |
| Resource Pool | API rate limits during pool replenishment (Pitfall 12) | Pace creation at 4/sec with jitter; replenish off-peak | Moderate |
| Resource Pool | Runaway resource creation costs (Pitfall 5) | Hard cap on pool size; CloudWatch billing alarms | Critical |
| Resource Pool | Cold start if pool is empty (Pitfall 4) | Monitor pool depth; alarm at low watermark | Critical |
| IVS Streaming (Broadcast) | Stream key exposure in browser (Pitfall 18) | JIT fetch, recycle channels, prefer RealTime for browser | Minor |
| IVS Streaming (Broadcast) | Browser publishing instability (Pitfall 8) | Reconnection logic, quality monitoring, user feedback | Moderate |
| IVS RealTime (Hangouts) | Confusing RealTime with Streaming APIs (Pitfall 1) | Separate backend modules from Day 1 | Critical |
| IVS RealTime (Hangouts) | No auto-record -- must use composition (Pitfall 11) | Start composition automatically with session lifecycle | Critical |
| IVS RealTime (Hangouts) | Token attributes leak PII (Pitfall 14) | Only store display-safe data in attributes | Minor |
| Chat Implementation | Single-use token model breaks reconnection (Pitfall 6) | Always request fresh token on every connect/reconnect | Critical |
| Chat Implementation | 10 msg/sec per-connection limit (Pitfall 13) | Client-side rate limiting, reaction aggregation | Minor |
| Recording/Replay | Hardcoded rendition paths break replay (Pitfall 2) | Read metadata JSON, never assume paths | Critical |
| Recording/Replay | Merge failures with Web Broadcast SDK (Pitfall 10) | Handle fragmented recordings at app layer | Moderate |
| Recording/Replay | EventBridge delay on recording-ended (Pitfall 17) | Show "processing" state, use reasonable reconnect window | Minor |
| Recording/Replay | CORS/CloudFront misconfiguration (Pitfall 15) | OAC + CORS policies from day one | Moderate |
| UX/Frontend | AWS concepts leaking to users (Pitfall 3) | Session abstraction layer in API, error translation | Critical |
| Cost Management | Forgotten resources, unbounded storage (Pitfall 5) | Idle session cleanup, S3 lifecycle, billing alarms | Critical |

---

## Sources

- AWS IVS Low-Latency Streaming User Guide: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/ (HIGH confidence)
- AWS IVS Low-Latency Service Quotas: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/service-quotas.html (HIGH confidence)
- AWS IVS RealTime Service Quotas: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html (HIGH confidence)
- AWS IVS Chat Service Quotas: https://docs.aws.amazon.com/ivs/latest/ChatUserGuide/service-quotas.html (HIGH confidence)
- AWS IVS Recording to S3 Guide: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html (HIGH confidence)
- AWS IVS RealTime Participant Tokens: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html (HIGH confidence)
- AWS IVS Chat Messaging API Reference: https://docs.aws.amazon.com/ivs/latest/chatmsgapireference/welcome.html (HIGH confidence)
- AWS CDK IVS Constructs: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ivs-readme.html (HIGH confidence)
- AWS IVS Pricing/Costs: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/costs.html (HIGH confidence)
- AWS IVS RealTime Web SDK docs: https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/broadcast-web.html (HIGH confidence)
