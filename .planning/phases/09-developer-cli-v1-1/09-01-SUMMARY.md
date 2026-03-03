---
phase: 09-developer-cli-v1-1
plan: 01
subsystem: developer-tools
tags: [cli, ffmpeg, streaming, testing]
completed: 2026-03-03T15:08:05Z
duration_minutes: 5
dependency_graph:
  requires: [SESSION-02, IVS-01]
  provides: [CLI-FOUNDATION, BROADCAST-STREAMING]
  affects: [developer-experience]
tech_stack:
  added:
    - commander@^12.1.0 (CLI framework)
  patterns:
    - TDD with Jest for all CLI components
    - Promise-based FFmpeg streaming
    - Type-safe config loading from cdk-outputs.json
key_files:
  created:
    - backend/src/cli/index.ts (CLI entry point)
    - backend/src/cli/lib/config-loader.ts (deployment config loader)
    - backend/src/cli/lib/ffmpeg-streamer.ts (FFmpeg RTMPS wrapper)
    - backend/src/cli/commands/stream-broadcast.ts (broadcast streaming command)
  modified:
    - backend/package.json (commander dependency, bin entry, build script)
    - backend/tsconfig.json (NodeNext module resolution)
decisions:
  - Use Commander.js over alternatives (zero dependencies, 18ms startup vs 35ms+ for yargs/oclif)
  - Direct child_process.spawn over fluent-ffmpeg (deprecated wrapper, broken with recent FFmpeg)
  - Two-step IVS API calls (GetChannel for endpoint, GetStreamKey for key value)
  - NodeNext module resolution for ESM compatibility with Node.js 16+
metrics:
  tasks_completed: 3
  tests_added: 13
  test_pass_rate: 100%
  commits: 3
---

# Phase 09 Plan 01: CLI Foundation & Broadcast Streaming Summary

TypeScript CLI foundation with Commander.js and FFmpeg-based broadcast streaming capability for developer testing

## What Was Built

### CLI Infrastructure
- Commander.js-based CLI entry point (`vnl-cli`) with version 1.1.0
- Config loader that reads deployment settings from `cdk-outputs.json` (apiUrl, region, Cognito pools)
- Shebang header for direct CLI execution
- Package.json bin entry pointing to `dist/cli/index.js`
- TypeScript build configuration with NodeNext module resolution

### FFmpeg RTMPS Streaming
- `streamToRTMPS()` function using `child_process.spawn()` for FFmpeg control
- Encoding parameters matching `test-broadcast.sh` pattern:
  - Video: H.264 @ 3.5 Mbps, 1080p30, CBR with 2-second keyframe interval
  - Audio: AAC @ 160 kbps, 44.1 kHz stereo
- Loop support via `-stream_loop -1` flag
- Progress callback via stderr stream parsing
- Promise-based API with exit code error handling

### stream-broadcast Command
- Session lookup via `getSessionById` from session-repository
- Session type validation (BROADCAST required)
- IVS Channel API integration:
  1. `GetChannelCommand` to fetch ingest endpoint and stream key ARN
  2. `GetStreamKeyCommand` to fetch stream key value
- RTMPS URL construction: `rtmps://{endpoint}:443/app/{streamKey}`
- Real-time FFmpeg progress display (frame count, fps)
- Graceful Ctrl+C shutdown support

## Technical Decisions

**Commander.js Selection:**
- Zero dependencies vs 7+ for yargs, 30+ for oclif
- Fast startup (18ms vs 35ms+ for alternatives)
- Simple API sufficient for phase scope

**Direct FFmpeg Spawn:**
- fluent-ffmpeg deprecated and broken with FFmpeg 6.1+
- Direct spawn gives full control over args and event handling
- Test pattern already validated in test-broadcast.sh

**Two-Step IVS API Pattern:**
- GetChannelCommand returns stream key ARN (not value)
- Required GetStreamKeyCommand to resolve actual key
- AWS SDK type assertion needed (`as any`) due to incomplete type definitions

**Module Resolution:**
- NodeNext required for ESM compatibility
- Matches Node.js 16+ module system
- Enables future ES module migration

## Test Coverage

### Unit Tests (13 total, 100% pass rate)
**config-loader (3 tests):**
- Successful cdk-outputs.json parsing
- Missing file error handling
- Malformed JSON error handling

**ffmpeg-streamer (5 tests):**
- Correct FFmpeg args construction
- Loop flag inclusion
- Progress callback invocation
- Success resolution (exit code 0)
- Error rejection (non-zero exit)

**stream-broadcast (5 tests):**
- Session fetch and BROADCAST validation
- Session not found error
- Non-BROADCAST type rejection
- GetChannelCommand with correct ARN
- RTMPS URL construction with loop option

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] IVS SDK type incompleteness**
- **Found during:** Task 3 - stream-broadcast implementation
- **Issue:** AWS SDK Channel type missing `streamKey` property despite API returning it
- **Fix:** Type assertion (`as any`) to access runtime property
- **Files modified:** backend/src/cli/commands/stream-broadcast.ts
- **Commit:** 33a2d76

**2. [Rule 1 - Bug] Two-step stream key retrieval**
- **Found during:** Task 3 - IVS API exploration
- **Issue:** GetChannelCommand returns stream key ARN, not value
- **Fix:** Added GetStreamKeyCommand call to resolve key value
- **Files modified:** backend/src/cli/commands/stream-broadcast.ts
- **Commit:** 33a2d76

## Implementation Flow

```
vnl-cli stream-broadcast <session-id> <video-file> [--loop]
    ↓
stream-broadcast command
    ↓
1. Load TABLE_NAME from env
2. getSessionById(sessionId) → Session
3. Validate session.sessionType === BROADCAST
4. GetChannelCommand(channel ARN) → ingestEndpoint, streamKeyArn
5. GetStreamKeyCommand(streamKeyArn) → streamKey value
6. Construct rtmpUrl: rtmps://{endpoint}:443/app/{streamKey}
7. streamToRTMPS({ videoFile, rtmpUrl, loop, onProgress })
    ↓
FFmpeg process spawned with RTMPS encoding args
    ↓
Video streams to IVS Channel → viewers see content
```

## Files Created

```
backend/src/cli/
├── index.ts (32 lines) - CLI entry point with Commander setup
├── lib/
│   ├── config-loader.ts (42 lines) - cdk-outputs.json parser
│   └── ffmpeg-streamer.ts (69 lines) - FFmpeg spawn wrapper
├── commands/
│   └── stream-broadcast.ts (97 lines) - Broadcast streaming command
└── __tests__/
    ├── config-loader.test.ts (60 lines)
    ├── ffmpeg-streamer.test.ts (117 lines)
    └── stream-broadcast.test.ts (194 lines)
```

## Success Criteria Met

- [x] Commander.js installed and CLI infrastructure created with bin entry
- [x] config-loader reads cdk-outputs.json and extracts deployment config
- [x] FFmpeg RTMPS streaming wrapper spawns ffmpeg with correct args from test-broadcast.sh
- [x] stream-broadcast command validates session type and calls IVS GetChannel API
- [x] Developer can run `vnl-cli stream-broadcast <session-id> <video-file>` (requires build + npm link)
- [x] All unit and integration tests pass (13/13)

## Next Steps

**Plan 09-02:** Implement hangout streaming via WHIP protocol (FFmpeg 6.1+ required)
**Plan 09-03:** Add seeding commands for sessions, chat, and reactions

## Self-Check: PASSED

**Created files verified:**
```bash
✓ backend/src/cli/index.ts exists
✓ backend/src/cli/lib/config-loader.ts exists
✓ backend/src/cli/lib/ffmpeg-streamer.ts exists
✓ backend/src/cli/commands/stream-broadcast.ts exists
✓ backend/src/cli/__tests__/config-loader.test.ts exists
✓ backend/src/cli/__tests__/ffmpeg-streamer.test.ts exists
✓ backend/src/cli/__tests__/stream-broadcast.test.ts exists
```

**Commits verified:**
```bash
✓ 94bb5fb (Task 1: CLI foundation)
✓ 66a91c8 (Task 2: FFmpeg streamer)
✓ 33a2d76 (Task 3: stream-broadcast command)
```

All claimed artifacts exist and commits are in git history.
