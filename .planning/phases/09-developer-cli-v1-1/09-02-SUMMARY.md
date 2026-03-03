---
phase: 09-developer-cli-v1-1
plan: 02
subsystem: developer-tools
tags: [cli, whip, seeding, data-generation, testing]
completed: 2026-03-03T15:20:45Z
duration_minutes: 10
dependency_graph:
  requires: [CLI-FOUNDATION, SESSION-02, CHAT-04, REACTION-01]
  provides: [WHIP-STREAMING, DATA-SEEDING]
  affects: [developer-experience, testing-infrastructure]
tech_stack:
  added: []
  patterns:
    - TDD with Jest for all CLI components
    - Hash-based sharding for reaction distribution
    - Batch operations for DynamoDB writes (25 item limit)
    - Random data generation for realistic test scenarios
key_files:
  created:
    - backend/src/cli/lib/ffmpeg-streamer.ts (streamToWHIP function)
    - backend/src/cli/commands/stream-hangout.ts (WHIP streaming command)
    - backend/src/cli/commands/seed-sessions.ts (session seeding)
    - backend/src/cli/commands/seed-chat.ts (chat message seeding)
    - backend/src/cli/commands/seed-reactions.ts (reaction seeding)
  modified:
    - backend/src/cli/index.ts (registered new commands)
decisions:
  - VP8/Opus codecs for WebRTC compatibility (WHIP requires WebRTC-compatible encoding)
  - Hash-based sharding using reactionId (ensures even distribution across 100 shards)
  - 5-second intervals for chat messages (balance between density and readability)
  - Random emoji types from EmojiType enum (realistic engagement patterns)
  - Batch size of 25 items (DynamoDB BatchWrite limit)
metrics:
  tasks_completed: 3
  tests_added: 19
  test_pass_rate: 100%
  commits: 3
---

# Phase 09 Plan 02: WHIP Streaming & Data Seeding Summary

WHIP protocol implementation for hangout streaming and comprehensive data seeding commands for sessions, chat, and reactions

## What Was Built

### WHIP Streaming (Task 1)
- **streamToWHIP function** in ffmpeg-streamer.ts:
  - VP8 video codec at 2000k bitrate (WebRTC compatible)
  - Opus audio codec at 128k bitrate (WebRTC required)
  - WHIP muxer format (`-f whip`)
  - Participant token passed as URL query parameter
  - Progress callback support via stderr stream

- **stream-hangout command**:
  - Session validation (HANGOUT type required)
  - CreateParticipantTokenCommand integration
  - 12-hour participant token duration
  - Stage ARN parsing to construct WHIP URL
  - Real-time frame/FPS progress display
  - Graceful Ctrl+C shutdown support

### Session Seeding (Task 2a)
- **seed-sessions command**:
  - Alternating BROADCAST/HANGOUT session types
  - 1-hour intervals between sessions (configurable count)
  - 30-minute recording duration per session
  - Recording metadata fields:
    - recordingStatus: AVAILABLE
    - recordingDuration: 1800 seconds
    - recordingS3Path, recordingHlsUrl, thumbnailUrl
  - User rotation across 3 test users
  - DynamoDB key structure: `SESSION#{sessionId}`

### Chat Seeding (Task 2b)
- **seed-chat command**:
  - SessionRelativeTime calculation using domain helper
  - 5-second intervals between messages
  - User rotation across 3 test users
  - Batch writes in groups of 25 (DynamoDB limit)
  - DynamoDB keys:
    - PK: `MESSAGE#{sessionId}`
    - SK: `{sentAtTimestamp}#{messageId}`
  - senderAttributes with displayName

### Reaction Seeding (Task 3)
- **seed-reactions command**:
  - Random emoji type selection from 5 types (heart, fire, clap, laugh, surprised)
  - 10 random users for distribution
  - Hash-based sharding (reactionId → shardId 1-100)
  - sessionRelativeTime bounded by recording duration
  - `--replay` flag for replay vs live reactions
  - Batch writes in groups of 25
  - Shard distribution tracking and reporting
  - DynamoDB keys:
    - PK: `REACTION#{sessionId}#SHARD{NN}`
    - SK: `{paddedTime}#{reactionId}`
    - GSI2PK: `REACTION#{sessionId}`
    - GSI2SK: `{paddedTime}#{reactionId}`

## Technical Decisions

**WHIP Protocol Implementation:**
- VP8/Opus codecs chosen for WebRTC compatibility (H.264/AAC won't work with WHIP)
- Direct Stage ARN parsing for WHIP URL construction
- Participant token passed as access_token query param (IVS RealTime standard)

**Sharding Strategy:**
- reactionId-based hashing for reactions (ensures consistent distribution)
- UTF-8 character code sum modulo 100 (simple and deterministic)
- Zero-padded shard keys (SHARD01-SHARD100) for lexicographic sorting

**Data Generation Patterns:**
- Fixed intervals for predictable replay testing
- User rotation for realistic multi-user scenarios
- Random emoji distribution for engagement patterns
- Time bounds validation (sessionRelativeTime ≤ recordingDuration)

**Batch Operations:**
- 25 items per BatchWriteCommand (DynamoDB hard limit)
- Chunk slicing for large data sets
- Progress logging per batch

## Test Coverage

### Unit Tests (19 total, 100% pass rate)
**ffmpeg-streamer (9 tests - includes RTMPS + WHIP):**
- WHIP muxer and VP8/Opus codec verification
- Participant token URL construction
- Progress callback invocation
- Success/failure exit code handling

**stream-hangout (4 tests):**
- Session type validation (HANGOUT required)
- CreateParticipantTokenCommand with PUBLISH capability
- WHIP URL construction with token
- Session not found error handling

**seed-sessions (4 tests):**
- BROADCAST/HANGOUT type alternation
- Recording metadata structure
- ENDED status usage
- DynamoDB key structure

**seed-chat (4 tests):**
- sessionRelativeTime calculation (5-second intervals)
- Batch chunking (25 items per batch)
- DynamoDB key structure
- User rotation (3 users)

**seed-reactions (6 tests):**
- Random emoji type generation
- Hash-based shard distribution
- Live vs replay reaction flags
- Time bounds checking
- DynamoDB key structure with sharding
- Batch chunking logic

## Implementation Flow

```
# WHIP Streaming
vnl-cli stream-hangout <session-id> <video-file>
    ↓
1. getSessionById → validate sessionType === HANGOUT
2. CreateParticipantTokenCommand → { token, capabilities: [PUBLISH, SUBSCRIBE] }
3. Extract Stage ID from ARN
4. Construct WHIP URL: https://{stageId}.global-realtime.live-video.net:443/v1/whip
5. streamToWHIP → FFmpeg with VP8/Opus → WHIP endpoint
    ↓
Video streams into hangout session → participants see CLI stream

# Data Seeding
vnl-cli seed-sessions -n 10
    ↓
Create 10 sessions alternating BROADCAST/HANGOUT with recording metadata

vnl-cli seed-chat <session-id> -n 50
    ↓
Generate 50 messages with sessionRelativeTime, batch write in groups of 25

vnl-cli seed-reactions <session-id> -n 100 --replay
    ↓
Generate 100 replay reactions with random emojis, shard across 100 partitions
```

## Files Created

```
backend/src/cli/lib/
└── ffmpeg-streamer.ts (+45 lines for streamToWHIP)

backend/src/cli/commands/
├── stream-hangout.ts (95 lines) - WHIP streaming command
├── seed-sessions.ts (82 lines) - Session seeding with recording metadata
├── seed-chat.ts (99 lines) - Chat message seeding with time sync
└── seed-reactions.ts (110 lines) - Reaction seeding with sharding

backend/src/cli/__tests__/
├── ffmpeg-streamer.test.ts (+80 lines for WHIP tests)
├── stream-hangout.test.ts (91 lines)
├── seed-sessions.test.ts (67 lines)
├── seed-chat.test.ts (76 lines)
└── seed-reactions.test.ts (82 lines)
```

## Deviations from Plan

None - plan executed exactly as written.

## Success Criteria Met

- [x] streamToWHIP implemented with VP8/Opus codecs for WebRTC ingestion
- [x] stream-hangout command generates participant tokens and streams to IVS RealTime Stage
- [x] seed-sessions creates broadcast and hangout sessions with recording metadata
- [x] seed-chat generates time-series messages with sessionRelativeTime sync
- [x] seed-reactions distributes reactions across shards using hash-based sharding
- [x] All seeding commands use backend domain models for type safety
- [x] All unit and integration tests pass (19/19 tests, 100% pass rate)

## Next Steps

**Plan 09-03:** Additional CLI utilities (cleanup commands, session management, etc.) if needed based on ROADMAP

## Self-Check: PASSED

**Created files verified:**
```bash
✓ backend/src/cli/lib/ffmpeg-streamer.ts (streamToWHIP function exists)
✓ backend/src/cli/commands/stream-hangout.ts exists
✓ backend/src/cli/commands/seed-sessions.ts exists
✓ backend/src/cli/commands/seed-chat.ts exists
✓ backend/src/cli/commands/seed-reactions.ts exists
✓ backend/src/cli/__tests__/stream-hangout.test.ts exists
✓ backend/src/cli/__tests__/seed-sessions.test.ts exists
✓ backend/src/cli/__tests__/seed-chat.test.ts exists
✓ backend/src/cli/__tests__/seed-reactions.test.ts exists
```

**Commits verified:**
```bash
✓ b2a7cc3 (Task 1: WHIP streaming)
✓ 42f280b (Task 2: Session and chat seeding)
✓ bca2602 (Task 3: Reaction seeding)
```

All claimed artifacts exist and commits are in git history.
