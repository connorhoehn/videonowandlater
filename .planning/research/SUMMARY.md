# Project Research Summary

**Project:** VideoNowAndLater v1.1 (Recording, Reactions, RealTime Hangouts)
**Domain:** Live video streaming platform with replay, social reactions, and multi-participant hangouts
**Researched:** 2026-03-02
**Confidence:** HIGH

## Executive Summary

VideoNowAndLater v1.1 adds recording/replay, social reactions, and multi-participant hangouts to a validated v1.0 live streaming platform built on AWS IVS. The recommended approach leverages IVS's native recording capabilities (auto-record to S3 with EventBridge lifecycle events), DynamoDB single-table design with a new GSI for time-range queries, and IVS RealTime Stages for WebRTC-based group hangouts. This is an incremental expansion, not a greenfield build—the existing architecture (pre-warmed resource pools, session lifecycle management, DynamoDB access patterns) provides solid foundation.

The key risk is **temporal synchronization complexity**: chat messages, reactions, and video playback must stay synchronized during replay despite multiple timestamp sources (client clocks, server timestamps, video encoder timebases, HLS segment boundaries). YouTube's gold standard is chat scrolling in lockstep with video position. The mitigation is using IVS's `getTimeSync` API as the authoritative time source and storing video-relative timestamps (milliseconds from session start) rather than wall-clock times. Testing must include 60+ minute replays, not just 5-minute clips, as timestamp drift accumulates over duration.

Secondary risks include DynamoDB write throttling during viral reaction spikes (solution: shard partition keys across 10 partitions), mobile browser limitations rendering multi-participant grids (solution: max 3 simultaneous video streams on mobile), and IVS recording reconnect window timing delays (solution: explicit "Processing recording..." UI state for 30-60 second window). All mitigations are well-documented in AWS official docs and community best practices—no novel research required during implementation.

## Key Findings

### Recommended Stack

**No major stack changes required.** v1.1 integrates cleanly with the validated v1.0 stack. Only two new dependencies:

**Core additions:**
- **react-player (^2.16.0)**: HLS replay playback — Mux-maintained, native HLS support via hls.js, lightweight React API. Preferred over video.js (overkill for replay-only) and react-hls-player (less maintained).
- **@aws-sdk/client-s3 (^3)**: Presigned URLs for replay access if not using CloudFront. Matches existing AWS SDK v3 packages, no version conflicts.
- **aws-cdk-lib (existing ^2.170.0)**: All IVS recording constructs available (CfnRecordingConfiguration, CfnStorageConfiguration). Do NOT install @aws-cdk/aws-ivs-alpha (alpha stability, breaking changes risk).

**Critical integration point:** IVS Recording requires S3 bucket in same region as RecordingConfiguration. Regional mismatch causes silent failures with no clear error messages. CDK validation must enforce this.

### Expected Features

**Must have (table stakes):**
- Auto-record broadcasts to S3 with HLS + thumbnails + metadata JSON
- Replay viewer with HLS playback (standard HTML5 video controls)
- Home feed showing recent recordings (Instagram-style thumbnail grid)
- Live reactions (5-8 emoji types: heart, fire, clap, laugh) with floating animations
- Chat synchronized to replay timeline (YouTube pattern: auto-scroll as video plays)
- Multi-participant hangouts (5 participants max for quality UX, IVS supports 12)
- Participant join/leave notifications, active speaker highlighting
- Hangout recording via server-side composition or individual participant tracks

**Should have (competitive advantage):**
- Reaction summaries on replays ("142 fire emojis at 2:34")
- Pre-warmed resource pool (already validated in v1.0—extends to stages)
- Admin dashboard (real-time session/participant/reaction counts)
- Presence system ("X is watching")

**Defer (v2+):**
- Content moderation / AI filtering (massive scope)
- OAuth social login (username/password sufficient for v1)
- Multi-region deployment (cross-region complexity)
- Video clipping/highlights (complex UX, transcoding)
- Custom emoji upload (moderation nightmare)

**Critical dependency insight from FEATURES.md:** Recording infrastructure must work before reactions/chat can sync to replay timeline. Reaction system depends on video-relative timestamps from recording metadata. RealTime hangouts depend on recording for replay functionality. This defines phase ordering.

### Architecture Approach

**Pattern: Extend existing single-table DynamoDB design with new GSI for time-series event queries.**

**Major components:**
1. **Recording Metadata Layer** — EventBridge rules capture IVS Recording Start/End events, Lambda handlers fetch recording-ended.json from S3, store playback URLs + duration + thumbnail paths in session items. Handles both Channel recordings (broadcasts) and Stage participant recordings (hangouts).
2. **Reaction Storage with GSI2** — New global secondary index (GSI2PK = SESSION#id, GSI2SK = sessionRelativeTimeMs) enables time-range queries for replay synchronization. Partition key sharding (10 shards) prevents DynamoDB throttling during viral reaction spikes.
3. **RealTime Stage Pool Management** — Extends existing pre-warmed pool pattern to IVS Stages with participant token generation. Stages configured with StorageConfiguration for auto-recording. Participant recordings aggregate into session metadata for multi-stream replay.

**Key architectural decision:** Use individual participant recording for hangouts, not composite recording. Provides flexibility for future editing, avoids composition quota limits (20 concurrent compositions per account), and maps cleanly to existing recording metadata pattern.

**Integration pattern validated from ARCHITECTURE.md:** DynamoDB conditional writes with version fields prevent race conditions from out-of-order EventBridge events. Idempotent handlers tolerate duplicate/delayed events. Correlation IDs link recording ARNs to session IDs at creation time for reliable lookups in event handlers.

### Critical Pitfalls

1. **Recording Reconnect Window Creates Event Timing Delays** — IVS waits the full reconnect window (up to 300 seconds) before emitting Recording End events. Users won't see "recording complete" for 5 minutes after stream ends. **Mitigation:** Set reconnect window to 30-60 seconds minimum, implement "Processing recording..." UI state, track "stream ended" separately from "recording ended" in session state machine.

2. **Chat and Reaction Timestamp Drift During Replay** — Multiple timestamp sources (client clocks, server times, video encoder timebases) create drift accumulating to 30-60+ seconds on longer recordings. Reactions appear before the moment they reference. **Mitigation:** Use IVS `getTimeSync` API as authoritative time source, store video-relative timestamps (ms from session start), implement periodic re-sync every 60-120 seconds, test explicitly with 60+ minute recordings.

3. **Reaction Write Throughput Exceeds DynamoDB Partition Capacity** — 100 viewers spamming reactions at 2/second = 200 writes/second sustained. Single partition maxes at 1,000 writes/second. Viral spikes cause throttling. **Mitigation:** Shard partition keys across 10 partitions (SESSION#id#0 through SESSION#id#9), use BatchWriteItem for bursts, configure On-Demand mode for MVP.

4. **RealTime Stage Participant Limits on Mobile Browsers** — Mobile devices can only handle 3 simultaneous video streams before CPU decode exhaustion causes crashes, artifacts, black screens. **Mitigation:** Never render more than 3 participant videos on mobile web, show active speaker + 2 recent speakers, use audio-only tracks for remaining participants, test on low-end Android.

5. **Regional Mismatch Between IVS Resources and S3 Buckets** — Recording configurations silently fail when S3 bucket is in different region than IVS channel/stage. **Mitigation:** CDK validation enforces same region, monitor EventBridge for Recording Start Failure events, integration tests verify actual recording functionality.

## Implications for Roadmap

Based on research, suggested phase structure follows dependency chain discovered in FEATURES.md + ARCHITECTURE.md:

### Phase 1: Recording Foundation (S3 + Metadata)
**Rationale:** Recording infrastructure is foundational. Chat/reactions can't sync to replay timeline without recording metadata (duration, sessionRelativeTime baseline). Must work before Phases 2-3.

**Delivers:**
- S3 bucket with IVS RecordingConfiguration (channels) and StorageConfiguration (stages)
- EventBridge rules for Recording Start/End events
- Lambda handlers store recording metadata (playbackUrl, duration, thumbnails) in session items
- Home feed listing recent replays with thumbnails
- Basic replay viewer (react-player with HLS URL)

**Addresses:**
- Table stakes: Auto-record broadcasts, replay viewer, home feed
- Pitfall 1 (reconnect window delays) — implement "processing" state
- Pitfall 5 (regional mismatch) — CDK validation

**Stack elements:**
- react-player for HLS playback
- @aws-sdk/client-s3 for metadata extraction (if needed)
- CfnRecordingConfiguration, CfnStorageConfiguration from aws-cdk-lib

**Research flag:** Standard patterns (AWS official docs). No deep research needed—follow IVS recording guide directly.

### Phase 2: Reactions + Chat Replay Sync
**Rationale:** Depends on Phase 1 recording metadata for sessionRelativeTime baseline. Reactions and chat share same time-series storage pattern (GSI2), so build together for consistency.

**Delivers:**
- GSI2 added to DynamoDB table (sessionRelativeTime sort key)
- Live reaction system (POST /reactions, floating emoji animations)
- Reaction storage with write sharding (10 partitions)
- Chat replay synchronized to video playback (using IVS Sync Time API)
- Reaction overlay on replay (filter by video currentTime)
- Server-side timestamps prevent clock drift

**Addresses:**
- Table stakes: Live reactions, chat-synchronized replay
- Differentiator: Reaction summaries on replays
- Pitfall 2 (timestamp drift) — use IVS getTimeSync API
- Pitfall 3 (write throttling) — partition key sharding
- Pitfall 12 (clock drift) — server-side timestamps

**Stack elements:**
- DynamoDB GSI2 for time-range queries
- react-player onProgress for video sync
- IVS Chat Sync Time API

**Research flag:** Needs research-phase for chat synchronization patterns (YouTube gold standard, timing mechanisms). Community patterns available but require validation.

### Phase 3: RealTime Hangouts
**Rationale:** Depends on Phase 1 (recording) and Phase 2 (chat/reactions) to provide full feature parity. Hangouts use same recording + reaction infrastructure. Last because most complex (multi-participant state, WebRTC, token management).

**Delivers:**
- Pre-warmed Stage pool with auto-recording enabled
- Session creation with sessionType: HANGOUT
- Participant token generation (POST /participant-token)
- Frontend participant grid (IVS Web Broadcast SDK)
- Active speaker detection, mute/camera toggles
- Mobile-specific rendering (max 3 video streams)
- Individual participant recordings aggregated to session metadata
- Multi-stream replay viewer

**Addresses:**
- Table stakes: Multi-participant hangouts, participant management, hangout recording
- Differentiator: Pre-warmed stage pool (instant join)
- Pitfall 4 (mobile limits) — 3 video stream cap
- Pitfall 7 (participant limits) — active speaker selection
- Pitfall 10 (token expiration) — 14-day TTL + exchange flow

**Stack elements:**
- IVS RealTime Stage with StorageConfiguration
- IVS Web Broadcast SDK (already installed)
- CreateParticipantToken API

**Research flag:** Needs research-phase for multi-participant grid layout (adaptive resolution, active speaker detection, mobile performance). WebRTC SFU patterns well-documented but specific to IVS RealTime SDK.

### Phase Ordering Rationale

- **Phase 1 first:** Recording is dependency for Phases 2-3. Can't sync reactions to replay without recording metadata. Can't show replay feed without recordings. Pure infrastructure—no UX complexity.
- **Phase 2 before Phase 3:** Reactions and chat replay are simpler than multi-participant WebRTC. Validates time-series storage pattern (GSI2) before applying to hangouts. Chat sync is table stakes for replay UX—must work before hangouts generate their own chat/reactions.
- **Phase 3 last:** Most complex (WebRTC state management, token lifecycle, mobile limitations). Benefits from recording + reaction infrastructure already working. Can reuse GSI2, recording handlers, chat sync patterns.

**Dependency validation from ARCHITECTURE.md:**
```
Recording Foundation → Reaction/Chat Sync → RealTime Hangouts
(provides metadata)    (uses metadata)      (generates both)
```

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Chat Replay Sync):** YouTube's synchronization mechanism (Sync Time API usage, re-sync strategy, handling disconnects). AWS Dev Community article exists but needs pattern validation.
- **Phase 3 (RealTime Hangouts):** Multi-participant grid performance optimization (adaptive resolution, volatility monitoring), active speaker detection (Web Audio API vs server-side), mobile participant limits (pagination/swiping UX).

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Recording Foundation):** Well-documented in AWS IVS official docs. EventBridge integration pattern is standard AWS pattern. S3 metadata extraction is straightforward.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All dependencies verified via npm registry and AWS SDK compatibility. react-player maintained by Mux (2025). AWS CDK constructs stable (L1/L2). |
| Features | HIGH | AWS IVS official docs verified for recording, chat, RealTime. YouTube/Instagram/Twitch UX patterns verified via 2026 sources. Table stakes vs differentiators clear. |
| Architecture | HIGH | Extends validated v1.0 patterns (pre-warmed pools, single-table DynamoDB, EventBridge lifecycle). GSI time-series pattern documented in AWS database blog. |
| Pitfalls | HIGH | Critical pitfalls sourced from AWS official docs (reconnect window, regional requirements, encryption). Mobile limits verified via WebRTC community research. Timestamp drift from IVS Sync Time API docs. |

**Overall confidence:** HIGH

### Gaps to Address

- **HLS.js memory leak mitigation:** Research identifies issue (backBufferLength=Infinity causes crashes) but doesn't specify exact configuration for react-player. Needs validation during Phase 2 implementation. Default to `backBufferLength: 10` for replay-only, test with 90-minute recordings.

- **Reaction aggregation UI:** "142 fire emojis at 2:34" pattern described as differentiator but no specific implementation guidance. Needs UX research during Phase 2 planning. Consider seek bar heatmap (TikTok pattern) or timeline markers (YouTube pattern).

- **Active speaker detection accuracy:** Web Audio API vs IVS server-side audio levels not compared quantitatively. Test both approaches during Phase 3, fallback to simpler approach (border highlight on volume threshold) for MVP.

- **Token refresh flow:** IVS RealTime SDK's `exchangeToken` API documented but refresh trigger timing (90% of TTL?) needs validation. Monitor token expiration errors during Phase 3 testing, adjust refresh window if needed.

## Sources

### Primary (HIGH confidence)

**AWS IVS Official Documentation:**
- [IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)
- [IVS RealTime Stage Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-composite-recording.html)
- [IVS EventBridge Integration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html)
- [IVS Participant Tokens](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/getting-started-distribute-tokens.html)
- [IVS Service Quotas](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/service-quotas.html)

**AWS SDK & CDK:**
- [AWS CDK CfnRecordingConfiguration API](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_ivs/CfnRecordingConfiguration.html)
- [DynamoDB Global Secondary Indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html)
- [DynamoDB Time-Series Patterns](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-time-series.html)

### Secondary (MEDIUM confidence)

**Community Best Practices:**
- [Amazon IVS Live Stream Playback with Chat Replay using Sync Time API](https://dev.to/aws/amazon-ivs-live-stream-playback-with-chat-replay-using-the-sync-time-api-1d6a) — Chat synchronization pattern
- [An HLS.js cautionary tale: QoE and video player memory](https://www.mux.com/blog/an-hls-js-cautionary-tale-qoe-and-video-player-memory) — Memory leak mitigation
- [Large WebRTC Video Grids: Managing CPU and Network Constraints](https://www.agora.io/en/blog/large-webrtc-video-grids-managing-cpu-and-network-constraints/) — Mobile participant limits
- [Design Facebook's Live Comments System](https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-live-comments) — Reaction architecture patterns

**Platform UX Research (2026 sources):**
- YouTube timed reactions, Instagram floating emoji, Twitch emote system
- TikTok FYP discovery algorithm, Instagram Reels video-first patterns
- Zoom/Meet multi-participant grid layouts, active speaker detection

### Tertiary (LOW confidence, needs validation)

- Reaction aggregation heatmap UI — inferred from TikTok/YouTube patterns, no specific implementation guide
- Token refresh timing (90% of TTL) — inferred from standard OAuth refresh practices, not IVS-specific documentation

---

**Research completed:** 2026-03-02

**Ready for roadmap:** Yes

**Recommended next steps:**
1. Use this SUMMARY.md as context for roadmap creation (3-phase structure suggested)
2. Plan Phase 2 research-phase for chat replay synchronization patterns
3. Plan Phase 3 research-phase for multi-participant grid performance optimization
4. Address gaps (HLS.js config, reaction aggregation UI) during phase planning
