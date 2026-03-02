# Pitfalls Research

**Domain:** Adding S3 recording, reactions, and IVS RealTime Stages to existing IVS live video platform
**Researched:** 2026-03-02
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Recording Reconnect Window Creates Event Timing Delays

**What goes wrong:**
When using IVS's `recordingReconnectWindowSeconds` feature to merge disconnected streams, all Recording End events and metadata files are delayed by the full reconnect window duration (potentially up to 300 seconds). This means your application won't know when a recording actually finished until 5 minutes after the stream ended, breaking any UI that shows "recording complete" status or triggers post-processing workflows.

**Why it happens:**
IVS deliberately waits the full reconnect window before emitting Recording End events because it needs to verify no new stream will reconnect within that window. Developers enable reconnect windows for better UX but don't realize this affects EventBridge timing for all recording state transitions.

**How to avoid:**
1. Set reconnect window to minimum viable duration (30-60 seconds, not the 300 second maximum)
2. Use separate EventBridge rules for Recording Start (immediate) vs Recording End (delayed)
3. Track "stream ended" separately from "recording ended" in your session state machine
4. Display "Processing recording..." UI state during the reconnect window period
5. Design post-processing workflows to tolerate delayed triggers

**Warning signs:**
- Users report recordings don't appear in feed for several minutes after stream ends
- Post-processing Lambda functions timeout waiting for metadata files
- EventBridge logs show Recording End events 2-5 minutes after stream disconnect
- DynamoDB session state shows "live" when stream actually ended

**Phase to address:**
Phase 1 (Recording Infrastructure) — Document timing behavior, implement state machine with "processing" state, configure appropriate reconnect window duration based on expected disconnection patterns.

---

### Pitfall 2: Rapid Reconnects Prevent Stream Merge Despite Reconnect Window

**What goes wrong:**
Even with `recordingReconnectWindowSeconds` configured, rapid stream reconnects (mobile app backgrounding, network switching, SDK auto-reconnect) cause IVS to write new files to different S3 prefixes instead of merging into a single recording. The reconnect window only works if the previous broadcast finishes writing to S3 before the new broadcast starts — which typically requires 10+ seconds between streams.

**Why it happens:**
IVS needs time to flush buffers and write final segments to S3. When a new stream starts before this completes (< 10 seconds after disconnect), IVS treats it as a new broadcast session. This is especially common with mobile SDK auto-reconnect features and iOS backgrounding behavior.

**How to avoid:**
1. Disable SDK auto-reconnect features when using IVS recording with reconnect windows
2. Implement application-level reconnect logic with minimum 15-second delay
3. For mobile apps, handle backgrounding by pausing stream rather than disconnecting
4. Monitor S3 write completion via EventBridge Recording End events before allowing reconnect
5. Consider individual participant recording for RealTime sessions instead of composite
6. Document for users that rapid reconnects may create multiple recording files

**Warning signs:**
- S3 bucket contains multiple recording prefixes for what users expect as single session
- Metadata shows multiple recordings with < 10 second gaps between end/start times
- Mobile users report fragmented recordings after app backgrounding
- DynamoDB shows multiple sessions created when user expected continuous broadcast

**Phase to address:**
Phase 1 (Recording Infrastructure) — Disable SDK auto-reconnect, implement application-level reconnect with appropriate delays, add UI guidance for mobile backgrounding scenarios.

---

### Pitfall 3: Stream Format Changes Break Reconnect Window Merging

**What goes wrong:**
IVS refuses to merge streams within the reconnect window if video resolution, bitrate variance (> 50%), codec, frame rate, or audio format changes between disconnections. This breaks for Web Broadcast SDK (which dynamically adjusts quality) and when users switch between mobile cameras or devices mid-session.

**Why it happens:**
IVS requires identical stream formats for merging into a single recording. Web Broadcast SDK's adaptive bitrate feature intentionally changes quality based on network conditions. Mobile camera switching changes resolution. These are normal behaviors that conflict with recording merge requirements.

**How to avoid:**
1. **Do not use Web Broadcast SDK with recording reconnect windows** — AWS documentation explicitly warns this combination doesn't work
2. For mobile SDK, disable adaptive quality when recording is enabled
3. Lock camera resolution at stream start (don't allow mid-stream camera switching)
4. Validate stream parameters match when reconnecting at application level
5. For RealTime Stages, use individual participant recording instead of composite recording
6. Consider reconnect windows only for controlled environments (OBS, fixed-quality encoders)

**Warning signs:**
- Web Broadcast SDK users consistently get separate recordings despite reconnect window
- S3 metadata shows format mismatch errors in recording event logs
- Mobile users switching cameras create new recordings
- Different network conditions (WiFi -> Cellular) create recording splits

**Phase to address:**
Phase 1 (Recording Infrastructure) — Choose recording strategy based on SDK (disable reconnect windows for Web SDK, lock quality for mobile SDK), document limitations clearly in developer CLI.

---

### Pitfall 4: Chat and Reaction Timestamp Drift During Replay

**What goes wrong:**
Chat messages and reactions become increasingly out of sync with video playback over time, with drift accumulating to 30-60+ seconds on longer recordings. Reactions appear before the moment they reference, chat messages lag behind video, and the experience degrades significantly for 30+ minute replays.

**Why it happens:**
Multiple timestamp sources create drift: client clocks when recording reactions, server timestamps for chat messages, video encoder timestamps (which may use different time bases), HLS segment boundaries (which don't align with message timestamps), and MP4 container assumptions about synchronization. Each introduces sub-millisecond to multi-second errors that compound over duration.

**How to avoid:**
1. **Use single authoritative time source:** IVS provides `getTimeSync` API specifically for this — use it for all chat and reaction timestamps
2. Store both wall-clock time (for display) and video-relative time (for synchronization) for every event
3. Implement periodic re-synchronization during replay (every 60-120 seconds)
4. Use video player's `currentTime` as source of truth, not wall-clock elapsed time
5. For reactions, timestamp relative to video playback position, not server time
6. Test synchronization explicitly with 60+ minute recordings, not just short clips
7. Add developer CLI command to verify timestamp alignment across recording duration

**Warning signs:**
- Manual testing of 5-minute clip looks fine, but 30+ minute replays show obvious drift
- Chat replay appears to "pause" during stream disconnects, then rushes to catch up
- Reactions fire seconds before the actual moment being referenced
- User reports of "chat doesn't match what's happening in the video"
- Timestamp comparison shows linear drift accumulating over time

**Phase to address:**
Phase 2 (Replay with Chat/Reactions) — Implement video-relative timestamps using IVS Sync Time API, add re-sync mechanism, create CLI test command for long-duration synchronization validation.

---

### Pitfall 5: Regional Mismatch Between IVS Resources and S3 Buckets

**What goes wrong:**
Recording configurations silently fail with `CREATE_FAILED` state when S3 bucket is in a different region than IVS channel/stage, but AWS CLI returns success in us-east-1. Recordings never appear, EventBridge shows Recording Start Failure events, and no clear error message explains the root cause.

**Why it happens:**
IVS requires S3 buckets in the same region for recording to work, but in us-east-1 specifically, the CLI's asynchronous validation returns success before discovering the region mismatch. For IVS RealTime individual participant recording, the requirement is absolute.

**How to avoid:**
1. Create all IVS resources (channels, stages) and S3 recording buckets in the same region
2. Add CDK validation to verify S3 bucket region matches IVS stack region
3. Use CDK Aspects to enforce region consistency across recording infrastructure
4. Add integration test that verifies recording actually works, not just that resources exist
5. Monitor EventBridge for Recording Start Failure events in production
6. Document region requirements clearly for any multi-region expansion

**Warning signs:**
- CDK deploy succeeds but EventBridge shows Recording Start Failure
- S3 bucket is empty despite active broadcasts
- Recording configuration shows CREATE_FAILED in console despite CLI success
- Cross-region resource references in CDK stack

**Phase to address:**
Phase 1 (Recording Infrastructure) — Add CDK validation for region matching, implement EventBridge monitoring for recording failures, create integration test for actual recording functionality.

---

### Pitfall 6: S3 Encryption Configuration Breaks IVS Recording

**What goes wrong:**
IVS recording fails silently when S3 bucket uses KMS-S3 encryption or bucket settings like Object Ownership are configured incorrectly. Recording configuration accepts the bucket but Recording Start Failure events appear in EventBridge when streams begin.

**Why it happens:**
IVS auto-record feature only supports SSE-S3 (Server-side encryption with Amazon S3 managed keys), not KMS encryption. Object Ownership must be set to "Bucket owner enforced" or "Bucket owner preferred." These are common S3 security hardening settings that conflict with IVS requirements.

**How to avoid:**
1. Configure S3 recording buckets with SSE-S3 encryption only (not KMS)
2. Set Object Ownership to "Bucket owner enforced" in CDK bucket definition
3. Document encryption limitations for security compliance discussions
4. Add CDK validation to check bucket encryption configuration matches IVS requirements
5. Monitor EventBridge for Recording Start Failure events with encryption-related errors
6. For organizations requiring KMS: encrypt after recording completes via S3 lifecycle policy

**Warning signs:**
- Bucket exists, permissions configured, but recordings never appear
- EventBridge shows Recording Start Failure mentioning encryption
- Security team applied organization-wide KMS encryption policy to all S3 buckets
- Recording works in dev (SSE-S3) but fails in production (KMS)

**Phase to address:**
Phase 1 (Recording Infrastructure) — Configure buckets correctly in CDK, add validation, document encryption requirements, implement post-recording encryption if needed for compliance.

---

### Pitfall 7: RealTime Stage Participant Limits on Mobile Browsers

**What goes wrong:**
Mobile web browsers experience video artifacts, black screens, complete crashes, or severe performance degradation when rendering more than 3 simultaneous RealTime Stage participants, even though the stage supports up to 12 participants. Desktop shows all participants fine, but mobile users have broken experiences.

**Why it happens:**
Mobile devices use significantly more CPU to decode video than desktop. Most mobile browsers can only handle 3 simultaneous video streams before exhausting decode capabilities. This is a hardware limitation, not a network bandwidth issue.

**How to avoid:**
1. **Never render more than 3 participant video streams on mobile web** — this is non-negotiable
2. Implement mobile-specific UI with pagination/swiping between groups of 3 participants
3. Show active speaker + 2 most recent speakers on mobile
4. Use audio-only tracks for remaining participants (preserve audio, skip video decode)
5. For Android native requirements: integrate IVS RealTime Android SDK, don't rely on mobile web
6. Add device detection to apply appropriate participant rendering limits
7. Test explicitly on low-end Android devices, not just flagship iPhones

**Warning signs:**
- Mobile users report "can only see 2-3 people" in hangouts with 5+ participants
- Browser crashes or tab reloads during multi-participant sessions
- Video artifacts (green squares, frozen frames) on mobile but not desktop
- Mobile CPU pegged at 100% during RealTime sessions
- User complaints about battery drain during hangouts

**Phase to address:**
Phase 3 (RealTime Hangouts) — Implement mobile-specific participant rendering with 3-stream limit, audio-only for additional participants, pagination/active speaker detection for participant selection.

---

### Pitfall 8: Race Conditions Between Recording Events and Session State

**What goes wrong:**
EventBridge Recording Start/End events arrive in unpredictable order relative to API calls that update session state in DynamoDB. Lambda functions processing recording events try to update sessions that don't exist yet, or mark sessions as "ended" before the session's final chat messages are persisted, creating orphaned data.

**Why it happens:**
EventBridge delivery is "best effort" with no ordering guarantees. Events may arrive seconds or hours late, or in reverse order. Stream start, session creation, recording start, chat persistence, and recording end all happen asynchronously without coordination.

**How to avoid:**
1. Use DynamoDB conditional writes with version fields for all session state updates
2. Implement idempotent event handlers that tolerate missing or out-of-order data
3. Add retry logic with exponential backoff for "session not found" scenarios
4. Use DynamoDB Streams to trigger dependent workflows, not EventBridge directly
5. Design session state machine to handle backwards transitions (ended -> recording)
6. Store all EventBridge events in DynamoDB for debugging/replay, don't just process
7. Add correlation IDs linking recording ARNs to session IDs at session creation time

**Warning signs:**
- Lambda CloudWatch logs show "session not found" errors processing recording events
- DynamoDB contains recordings with no associated session metadata
- Sessions stuck in "live" state despite recording completion events
- Race condition manifests only under load, works fine in manual testing
- Chat messages for ended sessions get rejected

**Phase to address:**
Phase 1 (Recording Infrastructure) — Implement conditional writes with version fields, design idempotent event handlers, add correlation IDs, create event replay mechanism for debugging.

---

### Pitfall 9: Reaction Write Throughput Exceeds DynamoDB Partition Capacity

**What goes wrong:**
During popular live streams with many simultaneous viewers sending reactions (hearts, fire emojis), DynamoDB write throttling occurs because all reactions for a session hit the same partition key. Reaction writes fail, users see errors, and the reaction experience degrades exactly when it matters most (viral moments).

**Why it happens:**
DynamoDB partitions support 1,000 write units/second maximum. Partitioning reactions by session ID creates a hot partition during popular streams. 100 viewers spamming reactions at 2/second = 200 writes/second sustained, with spikes to 500+ during key moments. Single-partition design can't scale past ~1,000 concurrent active reactors.

**How to avoid:**
1. **Implement write sharding:** Append random suffix (0-9) to partition key: `SESSION#${id}#${shard}`
2. Fan-out writes across 10 shards distributes load: 10k writes/sec capacity instead of 1k
3. Use DynamoDB BatchWriteItem for reaction bursts (up to 25 items per request)
4. Consider DynamoDB On-Demand mode for unpredictable viral spikes
5. For replay reactions: shard by both session ID and timestamp window (e.g., 10-minute buckets)
6. Monitor CloudWatch for WriteThrottleEvents metric and ProvisionedThroughputExceededException
7. Load test with realistic viral spike patterns (500+ simultaneous users spamming reactions)

**Warning signs:**
- Reaction submissions work fine with 10 users, fail with 100+ concurrent users
- CloudWatch shows WriteThrottleEvents during popular streams
- Users report reactions "not going through" during exciting moments
- SDK clients show ProvisionedThroughputExceededException errors
- Reaction count aggregations are lower than expected

**Phase to address:**
Phase 2 (Reaction System) — Implement write sharding strategy, use batch writes, configure On-Demand mode for MVP (optimize later), add load testing for viral scenarios.

---

### Pitfall 10: RealTime Participant Token Expiration During Long Hangouts

**What goes wrong:**
Participant tokens for RealTime Stages expire after 12 hours by default (max 14 days), forcefully disconnecting users from ongoing hangouts. No automatic refresh mechanism exists, requiring users to manually rejoin, which breaks the "persistent hangout" experience.

**Why it happens:**
IVS RealTime tokens are time-limited security credentials. Default 12-hour TTL assumes shorter sessions. No built-in token refresh flow exists in the SDK — applications must implement token exchange manually.

**How to avoid:**
1. Set token duration to 14 days (maximum allowed) for hangout sessions: `duration: 20160` minutes
2. Implement token exchange flow using SDK's `exchangeToken` API before expiration
3. Track token expiration time in client state, trigger refresh at 90% of TTL
4. Backend API endpoint to generate fresh tokens for existing participants
5. Handle token expiration errors gracefully with automatic refresh attempt
6. For very long sessions (24+ hours): implement automatic re-authentication
7. Display "refreshing connection" UI during token exchange, not abrupt disconnection

**Warning signs:**
- Users get kicked from hangouts after exactly 12 hours
- No reconnection mechanism after token expiration
- Token expiration errors appear in browser console
- Long hangout sessions (podcasts, study sessions) break unexpectedly
- Users must create new session to rejoin after expiration

**Phase to address:**
Phase 3 (RealTime Hangouts) — Set token duration to maximum, implement token exchange flow with 90% TTL refresh trigger, add backend token refresh endpoint.

---

### Pitfall 11: HLS Player Memory Leak During Long Replay Sessions

**What goes wrong:**
Video player memory usage grows unbounded during long replay sessions (60+ minutes), eventually causing browser tab crashes, especially on mobile devices. Memory increases linearly with playback duration even when users aren't seeking backward.

**Why it happens:**
HLS.js default `backBufferLength` is `Infinity`, meaning played video segments remain in memory forever. For a 2-hour recording with 6-second segments (1,200 segments), this accumulates gigabytes of memory for content that will never be replayed. Mobile browsers crash much sooner than desktop.

**How to avoid:**
1. **Set backBufferLength to 10 seconds** for replay-only streams (no DVR seeking)
2. For streams with seek functionality: set to 60 seconds (balances seek UX and memory)
3. Explicitly call `hls.destroy()` when unmounting video player component
4. Monitor memory usage during development using browser DevTools memory profiler
5. Test with 60+ minute recordings, not just 5-minute clips
6. For mobile: implement aggressive buffer management (5-second back buffer)
7. Add memory usage telemetry to detect degradation in production

**Warning signs:**
- Browser tab crashes after 30-60 minutes of continuous playback
- Chrome Task Manager shows video player tab using 2+ GB RAM
- Mobile browsers crash much sooner than desktop
- Performance degradation (sluggish seeking) after extended playback
- Works fine in 5-minute test videos, crashes in production with hour-long streams

**Phase to address:**
Phase 2 (Replay Viewer) — Configure HLS.js with appropriate backBufferLength, implement proper cleanup on unmount, add memory profiling to testing checklist.

---

### Pitfall 12: Client-Server Clock Drift in Reaction Timestamps

**What goes wrong:**
Reactions timestamped using client-side JavaScript `Date.now()` drift from server time over session duration, causing reaction replay synchronization issues. Clock drift of 50ms per 10 minutes accumulates to multiple seconds over hour-long sessions, making reactions appear at wrong moments during replay.

**Why it happens:**
Client clocks drift from server clocks due to NTP adjustments, timezone changes, manual clock changes, and different clock crystals. Mobile devices are especially prone to drift. Using client timestamps for synchronization ignores this reality.

**How to avoid:**
1. **Use server timestamps for all reactions** — send reaction type only, server adds timestamp
2. Implement client-server time synchronization handshake at session start
3. Store offset between client and server time, adjust all client timestamps before sending
4. Re-synchronize periodically (every 5-10 minutes) to detect drift
5. For replay: use video-relative timestamps (milliseconds from video start), not wall-clock time
6. Validate timestamp sanity server-side (reject timestamps > 5 seconds from server time)
7. Add developer CLI command to detect and report clock drift

**Warning signs:**
- Reaction timestamps occasionally show future time relative to stream events
- Reaction replay synchronization degrades over longer sessions
- Mobile users show worse drift than desktop users
- Timestamps jump backwards/forwards when users cross timezones
- Reaction count aggregations show reactions "before" stream started

**Phase to address:**
Phase 2 (Reaction System) — Use server timestamps for reactions, implement clock drift detection, add validation for timestamp sanity, create CLI drift detection utility.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip reconnect window, create new session on disconnect | Simpler state machine, no merge complexity | User gets multiple fragmented recordings instead of one continuous stream | Never for user-facing sessions; acceptable only for ephemeral testing |
| Use client-side timestamps for reactions | No server round-trip needed, feels more responsive | Clock drift causes replay sync issues over time | Never; 50ms server latency is imperceptible, drift accumulates to seconds |
| Store reactions in single partition per session | Simple schema, easy queries | Write throttling during viral moments breaks reactions | Only if guaranteed < 100 concurrent viewers per session |
| Use Web Broadcast SDK with recording enabled | Easy browser-based streaming | Reconnect window merging doesn't work, adaptive quality creates recording splits | Only if fragmented recordings acceptable; requires user documentation |
| Render all RealTime participants on mobile | Feature parity with desktop | Browser crashes, battery drain, terrible UX | Never; mobile hardware limitations are real |
| Use wall-clock time for chat replay sync | Simple math: timestamp - stream_start_time | Drift accumulates, disconnections break sync | Only for MVP with < 10 minute streams; must fix before 30+ minute replays |
| Skip conditional writes in DynamoDB event handlers | Faster to implement, fewer lines of code | Race conditions cause data inconsistency, orphaned records | Never in production; acceptable only for prototype/demo |
| Set backBufferLength=Infinity for video player | HLS.js default, don't need to configure | Memory leak causes browser crashes on long replays | Never; always set explicit buffer limit |
| Use default 12-hour token duration | AWS default, no config needed | Users kicked from long hangouts unexpectedly | Only if all sessions guaranteed < 12 hours; use 14-day max otherwise |
| Skip write sharding for reactions | Simpler schema, easier to understand | DynamoDB throttling during popular streams | Only if guaranteed < 200 reactions/second total across all sessions |

---

## Integration Gotchas

Common mistakes when connecting IVS components.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| IVS Recording + S3 | Different regions for bucket and channel | Create all resources in same region, add CDK validation to enforce |
| IVS Recording + S3 | KMS encryption on bucket | Use SSE-S3 only, apply KMS post-recording via lifecycle if needed |
| IVS Recording + Reconnect Window | Enable with Web Broadcast SDK | Disable reconnect window for Web SDK (adaptive quality breaks merge) |
| IVS Recording + EventBridge | Expect immediate Recording End events | Account for reconnect window delay (up to 5 minutes), use separate "processing" state |
| IVS Chat + Replay Sync | Use wall-clock timestamps | Use IVS `getTimeSync` API for video-relative timestamps |
| RealTime Stage + Composite Recording | Expect individual tracks | Composite mixes all participants into single track (can't separate post-recording) |
| RealTime Stage + Token Expiration | Assume tokens last "long enough" | Set 14-day max duration and implement token exchange flow |
| RealTime Stage + Mobile Web | Render all participants like desktop | Limit to 3 simultaneous video streams, use audio-only for others |
| DynamoDB + Reaction Writes | Single partition key per session | Shard writes across 10 partitions to handle viral spike load |
| DynamoDB + Recording Events | Process EventBridge directly | Use conditional writes with version fields, handle out-of-order delivery |
| HLS.js + Long Replays | Use default configuration | Set backBufferLength=10s for replay-only, 60s for seek-enabled |
| Video Player + React Components | Skip cleanup on unmount | Always call `hls.destroy()` to prevent memory leaks |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Single partition for reactions per session | Reaction write failures during popular streams | Shard partition key across 10 partitions | > 200 reactions/second on single session |
| No back buffer limit in HLS player | Browser crashes after 30-60 minutes playback | Set backBufferLength=10s (replay) or 60s (DVR) | > 30 minutes continuous playback |
| Rendering all RealTime participants on mobile | Video artifacts, black screens, crashes | Limit to 3 simultaneous video streams | > 3 participants on mobile web |
| Unbounded EventBridge event storage | DynamoDB storage costs grow unexpectedly | TTL on event records after 90 days | > 100k events/month |
| No pagination in replay feed | Slow page loads as recording count grows | Implement infinite scroll with 20 items per page | > 100 recordings in feed |
| Synchronous recording metadata extraction | Lambda timeouts on large video files | Process asynchronously via S3 event trigger | > 500 MB video files |
| No CDN for S3 recordings | High S3 bandwidth costs, slow playback | Use CloudFront distribution for S3 bucket | > 1k replay views/day |
| Loading full chat history on replay start | Slow initial load for long sessions | Lazy load chat as video plays, 2-minute windows | > 1k chat messages in session |
| No reaction aggregation | Counting reactions requires scanning thousands of items | Maintain count aggregates in session metadata | > 100 reactions per session |
| Composite recording for all hangouts | Storage costs for unused multi-participant layouts | Use individual participant recording, composite on-demand | > 10 hangouts/day |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Client-generated participant tokens | Anyone can join any RealTime Stage with forged tokens | Generate tokens server-side only, validate userId in token matches requester |
| No expiration on chat room tokens | Stolen tokens grant permanent access to session chat | Use IVS Chat token TTL, match to session duration, rotate on reconnect |
| Exposing IVS channel ARNs to clients | Users can enumerate and view all channels | Use opaque session IDs in URLs, map server-side to ARNs |
| Recording bucket public read access | All session recordings publicly accessible | Use pre-signed URLs with short TTL, verify user permission before generating |
| No rate limiting on reaction submissions | Abuse/spam fills DynamoDB, costs spike | Rate limit to 5 reactions/second per user per session |
| Including user tokens in recording metadata | Credentials leak in S3 metadata, accessible to bucket readers | Strip all auth tokens from metadata before writing to S3 |
| Storing reactions with user credentials | Leaked database reveals session participation | Store only userId references, join with user data at query time |
| Cross-session replay token reuse | User can replay any session's chat/reactions with old token | Include sessionId in token claims, validate match on replay requests |
| No validation on recording S3 paths | Path traversal allows overwriting other recordings | Use IVS-generated paths only, never construct from user input |
| Trusting client timestamps for billing | Users manipulate duration for cost reduction | Use server-side stream start/end times from EventBridge for authoritative duration |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No "processing recording" state | Users confused why recording doesn't appear immediately after stream ends | Show "Processing..." state for reconnect window duration, then "Available" |
| Hiding fragmented recordings | Multiple recordings appear for what user thought was single session | Merge display of related recordings with < 5 minute gap between them |
| No indication of token refresh | Sudden disconnect from hangout with no warning | Show "Refreshing connection..." when exchanging tokens |
| Reaction spam shows every individual reaction | Overwhelming visual noise during popular moments | Aggregate reactions into flowing animations with count badges |
| Chat replay plays at real speed | Boring dead zones with no messages for minutes | Condense empty periods, maintain sync for message clusters |
| No seek to reaction clusters | Users can't find the "good parts" | Show reaction density heatmap on seek bar, jump to popular moments |
| Loading spinner during buffer management | Playback pauses when evicting old segments | Manage buffer silently, only show spinner for network issues |
| Mobile showing "loading..." for > 3 participants | Users think it's broken | Show "Viewing 3 of 8 participants - swipe for more" |
| Raw AWS error messages | "ProvisionedThroughputExceededException" confuses users | Map to friendly errors: "Too many reactions right now, try again" |
| No indication recording is happening | Users don't realize session is being recorded | Persistent "REC" indicator in UI during live session |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Recording setup:** Often missing EventBridge rules for Recording Failure events — verify monitoring exists
- [ ] **Recording setup:** Often missing S3 encryption validation — verify SSE-S3 only, not KMS
- [ ] **Recording setup:** Often missing region matching validation — verify bucket and channel in same region
- [ ] **Reconnect window:** Often missing documentation of event delays — verify docs explain 2-5 min processing time
- [ ] **Reconnect window:** Often missing disable for Web SDK — verify only enabled for controlled encoders
- [ ] **Replay sync:** Often missing IVS Sync Time API usage — verify not using Date.now() for timestamps
- [ ] **Replay sync:** Often missing periodic re-sync — verify drift correction every 60-120 seconds
- [ ] **Replay sync:** Often missing long-duration testing — verify tested with 60+ minute recordings, not just clips
- [ ] **Reaction system:** Often missing write sharding — verify partition key includes shard suffix
- [ ] **Reaction system:** Often missing server-side timestamps — verify clients don't generate timestamps
- [ ] **Reaction system:** Often missing rate limiting — verify max 5 reactions/second per user
- [ ] **Reaction replay:** Often missing video-relative timestamps — verify milliseconds from video start, not wall-clock
- [ ] **RealTime hangouts:** Often missing mobile participant limits — verify max 3 video streams on mobile web
- [ ] **RealTime hangouts:** Often missing token expiration handling — verify 14-day TTL and exchange flow implemented
- [ ] **RealTime tokens:** Often missing token refresh before expiration — verify refresh at 90% of TTL
- [ ] **Chat replay:** Often missing lazy loading — verify not loading entire chat history upfront
- [ ] **Video player:** Often missing backBufferLength config — verify set to 10s or 60s, not Infinity
- [ ] **Video player:** Often missing cleanup on unmount — verify hls.destroy() called in useEffect cleanup
- [ ] **DynamoDB events:** Often missing conditional writes — verify version fields prevent race conditions
- [ ] **DynamoDB events:** Often missing idempotency — verify handlers tolerate duplicate/out-of-order events
- [ ] **S3 recordings:** Often missing CloudFront distribution — verify CDN for bandwidth cost optimization
- [ ] **Recording metadata:** Often missing viewer count tracking — verify EventBridge viewer metrics captured
- [ ] **Session state machine:** Often missing "processing" state — verify handles reconnect window delay period
- [ ] **Error handling:** Often missing friendly error mapping — verify no raw AWS errors shown to users
- [ ] **Mobile UI:** often missing camera/microphone permission error states — verify graceful handling of NotAllowedError

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Fragmented recordings from reconnect failures | MEDIUM | Implement S3 concatenation Lambda, merge recordings with < 5 min gap, update metadata to link fragments |
| Timestamp drift in replay sync | HIGH (requires re-processing) | Extract actual video timestamps from HLS segments, recalculate all chat/reaction offsets, update database |
| DynamoDB write throttling from reactions | LOW | Switch table to On-Demand mode immediately, implement write sharding for future sessions |
| Memory leak crashes in production | LOW | Deploy HLS.js config change with backBufferLength, monitor memory usage telemetry |
| RealTime token expiration kicked users | MEDIUM | Generate new token server-side, send via WebSocket, client calls exchangeToken(), user stays connected |
| Recording in wrong region | HIGH (data migration) | Copy recordings to correct region bucket with S3 Batch Operations, update metadata, delete originals |
| KMS-encrypted bucket blocks recording | LOW | Create new SSE-S3 bucket, update recording configuration, document S3 access for old recordings |
| Race condition created orphaned data | MEDIUM | Daily cleanup job: DynamoDB scan for orphans, attempt to reconcile via correlation IDs, archive if unmatched |
| Mobile users rendered too many participants | LOW | Deploy hotfix limiting streams, add device detection, provide "too many participants" graceful degradation |
| Chat replay out of sync | MEDIUM | Re-calculate timestamps using IVS Sync Time API, database migration to update all historical messages |
| Reaction spam overwhelming UI | LOW | Deploy aggregation UI change, add rate limiting server-side, may need to moderate historical spam |
| No CDN causing high bandwidth costs | MEDIUM | Create CloudFront distribution, update video URLs in metadata, parallel serve from both during migration |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Recording reconnect event delays | Phase 1: Recording Infrastructure | EventBridge events for 5-min stream show delayed Recording End, UI shows "processing" state |
| Rapid reconnects prevent merge | Phase 1: Recording Infrastructure | Mobile app background/foreground test creates single recording, not multiple |
| Stream format changes break merge | Phase 1: Recording Infrastructure | Web SDK disabled for recording sessions, mobile SDK locks quality |
| Regional mismatch S3/IVS | Phase 1: Recording Infrastructure | CDK deploy fails if bucket region ≠ stack region |
| S3 encryption breaks recording | Phase 1: Recording Infrastructure | Integration test verifies recording appears in S3, bucket shows SSE-S3 |
| Chat/reaction timestamp drift | Phase 2: Replay + Reactions | 60-min replay test shows < 100ms drift, uses IVS Sync Time API |
| Race conditions in session state | Phase 1: Recording Infrastructure | Concurrent events test shows no orphaned data, conditional writes prevent overwrites |
| Reaction write throughput | Phase 2: Reaction System | Load test with 500 concurrent users spamming reactions succeeds, no throttling |
| RealTime participant limits mobile | Phase 3: RealTime Hangouts | 5-participant hangout on Android Chrome shows 3 videos + 2 audio-only |
| Token expiration in hangouts | Phase 3: RealTime Hangouts | 12+ hour hangout test shows automatic token refresh, no disconnections |
| HLS player memory leak | Phase 2: Replay Viewer | 90-min continuous playback shows stable < 200 MB memory, no crashes |
| Client-server clock drift | Phase 2: Reaction System | Server generates all timestamps, client drift detection logs warnings |

---

## Sources

### IVS Recording Documentation
- [IVS Auto-Record to Amazon S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html)
- [IVS Recording Configuration API](https://docs.aws.amazon.com/ivs/latest/LowLatencyAPIReference/API_CreateRecordingConfiguration.html)
- [IVS Individual Participant Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-individual-participant-recording.html)
- [IVS Composite Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-composite-recording.html)
- [IVS Not Creating Recording - AWS re:Post](https://repost.aws/questions/QU3lYfDrW7SjOrDtv2zps_Tw/ivs-interactive-video-service-not-creating-recording)
- [Auto Recording Amazon IVS Live Streams to S3](https://dev.to/aws/auto-recording-amazon-ivs-live-streams-to-s3-m64)
- [Optimizing Amazon IVS live-to-VOD with live input interruptions](https://aws.amazon.com/blogs/media/optimizing-amazon-ivs-live-to-vod-with-live-input-interruptions/)

### IVS EventBridge Integration
- [Using Amazon EventBridge with IVS Low-Latency Streaming](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html)
- [Using Amazon EventBridge with IVS Real-Time Streaming](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/eventbridge.html)
- [Amazon EventBridge Pipes batching and concurrency](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes-batching-concurrency.html)

### IVS RealTime Stages
- [Real-time streaming - Amazon IVS](https://ivs.rocks/real-time/)
- [IVS Broadcast SDK: Publishing & Subscribing](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/web-publish-subscribe.html)
- [Publishing and Subscribing - IVS Web Broadcast SDK](https://aws.github.io/amazon-ivs-web-broadcast/docs/v1.12.0/real-time-sdk-guides/stages)
- [Real Time Streaming - Stage broadcast to IVS Channel](https://repost.aws/questions/QUgvzuOYfIReWfwpNq8XOzWg/real-time-streaming-stage-broadcast-to-ivs-channel)

### IVS Token Management
- [ParticipantToken API Reference](https://docs.aws.amazon.com/ivs/latest/RealTimeAPIReference/API_ParticipantToken.html)
- [CreateParticipantToken API](https://docs.aws.amazon.com/ivs/latest/RealTimeAPIReference/API_CreateParticipantToken.html)
- [IVS Broadcast SDK: Token Exchange](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/broadcast-mobile-token-exchange.html)

### Chat and Reaction Synchronization
- [Amazon IVS Live Stream Playback with Chat Replay using the Sync Time API](https://dev.to/aws/amazon-ivs-live-stream-playback-with-chat-replay-using-the-sync-time-api-1d6a)
- [Chat out of sync - Twitch issue](https://github.com/lay295/TwitchDownloader/issues/1285)
- [Timestamp Drifting In Live Capture Situations](https://www.leadtools.com/help/sdk/multimedia/filters/timestamp-drifting-in-live-capture-situations.html)
- [Client/server clock sync issue](https://www.gamedev.net/forums/topic/707830-clientserver-clock-sync-issue-confirmation-and-solutions/)

### S3 and Storage Optimization
- [Extracting Video Metadata using Lambda and Mediainfo](https://aws.amazon.com/blogs/compute/extracting-video-metadata-using-lambda-and-mediainfo/)
- [Number of views a stored video gets](https://repost.aws/questions/QUdqEfK1XIQp61KgFA8V86uw/number-of-views-a-stored-video-gets)
- [S3 Cost Optimization in 2026](https://go-cloud.io/s3-cost-optimization/)
- [Petabyte-Scale Cost Optimization: How a Video Hosting platform Saved 70% on S3](https://aws.amazon.com/blogs/aws-cloud-financial-management/petabyte-scale-cost-optimization-how-a-video-hosting-platform-saved-70-on-s3/)

### DynamoDB Best Practices
- [Design patterns for high-volume, time-series data in Amazon DynamoDB](https://aws.amazon.com/blogs/database/design-patterns-for-high-volume-time-series-data-in-amazon-dynamodb/)
- [Best practices for handling time series data in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-time-series.html)
- [Understanding & Handling Race Conditions at DynamoDB](https://awsfundamentals.com/blog/understanding-and-handling-race-conditions-at-dynamodb)
- [Handling Concurrency in Amazon DynamoDB with Optimistic Locking](https://codewithmukesh.com/blog/handle-concurrency-in-amazon-dynamodb-with-optimistic-locking/)

### HLS Video Playback
- [An HLS.js cautionary tale: QoE and video player memory](https://www.mux.com/blog/an-hls-js-cautionary-tale-qoe-and-video-player-memory)
- [HLS.js memory increase issue when playing live streaming](https://github.com/video-dev/hls.js/issues/5402)
- [Possible memory leak w/ multiple Hls players](https://github.com/video-dev/hls.js/issues/1220)
- [Reducing Latency in HLS Streaming: Key Tips](https://www.fastpix.io/blog/reducing-latency-in-hls-streaming)

### WebRTC Multi-Participant Performance
- [How Many Users Can Fit in a WebRTC Call?](https://bloggeek.me/how-many-users-webrtc-call/)
- [Tips to improve WebRTC video call browser performance](https://www.daily.co/blog/tips-to-improve-performance/)
- [What Is WebRTC SFU and Why Every Modern Video Application Uses It](https://clanmeeting.com/guide/what-is-webrtc-sfu/)
- [How To Implement Multipoint Video Using WebRTC: Small Groups](https://bloggeek.me/webrtc-multipoint-small-groups/)

### WebRTC Permissions and Error Handling
- [MediaDevices: getUserMedia() method - MDN](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Getting started with media devices - WebRTC](https://webrtc.org/getting-started/media-devices/)
- [Errors in WebRTC getUserMedia API calls](https://dialogue-io.github.io/2016/06/16/errors-in-webrtc-getusermedia-api-calls/)

---

*Pitfalls research for: Adding S3 recording, reactions, and IVS RealTime Stages to existing IVS live video platform*

*Researched: 2026-03-02*
