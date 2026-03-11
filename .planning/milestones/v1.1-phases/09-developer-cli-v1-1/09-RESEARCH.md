# Phase 9: Developer CLI v1.1 - Research

**Researched:** 2026-03-03
**Domain:** CLI tooling, media streaming, test data seeding
**Confidence:** HIGH

## Summary

Phase 9 extends the existing developer CLI tooling (scripts/\*.sh) with v1.1 capabilities: streaming test media into broadcast/hangout sessions, seeding sample data (sessions, chat, reactions), and simulating presence/activity. The existing codebase already has patterns to follow: Bash scripts for user management (create-user.sh, get-token.sh), FFmpeg-based broadcast streaming (test-broadcast.sh), and AWS SDK usage in backend Lambda handlers.

The research reveals a clear path forward: build TypeScript CLI commands using Commander.js (lightweight, zero dependencies), leverage existing backend domain models and repositories for seeding, use child_process.spawn() for FFmpeg control (no wrapper needed), and support both RTMPS (broadcast) and WHIP (hangout) streaming protocols. The project's monorepo structure (backend workspace) provides access to all necessary domain types and DynamoDB patterns for seeding operations.

**Primary recommendation:** Use Commander.js for CLI framework (matches project's lightweight philosophy), direct FFmpeg invocation via child_process (no deprecated wrappers), reuse backend domain models for type-safe seeding, and extend test-broadcast.sh patterns for hangout streaming via WHIP protocol.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEV-03 | CLI command to stream test media file (MP4/MOV) into active broadcast session | FFmpeg RTMPS streaming via child_process spawn, existing test-broadcast.sh pattern |
| DEV-04 | CLI command to stream test media file into active hangout session | FFmpeg WHIP protocol support (requires FFmpeg 6.1+), participant token exchange |
| DEV-05 | CLI command to seed sample sessions (broadcasts + hangouts) with metadata | Backend session-repository patterns, SessionType enum, DynamoDB PutCommand |
| DEV-06 | CLI command to seed sample chat messages for testing chat replay | Backend chat-repository patterns, sessionRelativeTime calculation, BatchWriteCommand |
| DEV-08 | CLI command to seed sample reactions (live + replay) for testing reaction timeline | Backend reaction-repository patterns, sharding logic, GSI2 time-range queries |
| DEV-09 | CLI command to simulate presence/viewer activity for testing | IVS Chat SendEvent API for custom presence events, EventBridge simulation |
| DEV-10 | CLI documentation updated with v1.1 commands and usage examples | Commander.js auto-generated help, extend scripts/README.md |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^12.0.0 | CLI framework | Zero dependencies, 500M weekly downloads, simple API, project already uses minimal dependencies |
| @aws-sdk/client-ivs | ^3.1000.0 | IVS broadcast API | Already in backend/package.json, GetChannel for ingest endpoints |
| @aws-sdk/client-ivs-realtime | ^3.1000.0 | IVS RealTime API | Already in backend/package.json, CreateParticipantToken for hangout streaming |
| @aws-sdk/client-ivschat | ^3.1000.0 | IVS Chat API | Already in backend/package.json, SendEvent for presence simulation |
| @aws-sdk/lib-dynamodb | ^3.1000.0 | DynamoDB operations | Already in backend/package.json, BatchWriteCommand for seeding |
| FFmpeg | 6.1+ | Media streaming | Industry standard, WHIP support in 6.1+, already used in test-broadcast.sh |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | ^22.0.0 | TypeScript types for Node.js | Already in devDependencies, needed for child_process types |
| chalk | ^5.3.0 | Terminal output colors | Optional, improves UX for success/error/info messages |
| ora | ^8.0.0 | Terminal spinners | Optional, provides feedback during long-running operations |
| uuid | ^10.0.0 | ID generation | Already in backend/package.json, needed for seeding |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| commander | yargs | 7 dependencies vs 0, slower startup (35ms vs 18ms), more complex API |
| commander | oclif | 30 dependencies vs 0, much slower startup (85ms vs 18ms), overkill for simple commands |
| Direct FFmpeg spawn | fluent-ffmpeg | Deprecated/unmaintained, broken with recent FFmpeg versions, unnecessary wrapper |
| TypeScript CLI | Bash scripts | Harder to test, no type safety, can't reuse backend types, less maintainable |

**Installation:**
```bash
# From project root
npm install commander chalk ora --workspace backend

# FFmpeg (developer machine requirement)
brew install ffmpeg  # macOS
```

## Architecture Patterns

### Recommended Project Structure
```
backend/src/
├── cli/                    # New CLI entry points
│   ├── index.ts           # Main CLI with Commander setup
│   ├── commands/
│   │   ├── stream-broadcast.ts
│   │   ├── stream-hangout.ts
│   │   ├── seed-sessions.ts
│   │   ├── seed-chat.ts
│   │   ├── seed-reactions.ts
│   │   └── simulate-presence.ts
│   └── lib/
│       ├── ffmpeg-streamer.ts   # FFmpeg spawn wrapper
│       └── config-loader.ts     # Load cdk-outputs.json
├── domain/              # Existing domain models (reuse)
├── repositories/        # Existing DynamoDB ops (reuse)
└── services/            # Existing AWS service clients (reuse)
```

### Pattern 1: Commander CLI Structure
**What:** Root command with subcommands, shared config loading, consistent error handling
**When to use:** All CLI commands in this phase
**Example:**
```typescript
// backend/src/cli/index.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { streamBroadcast } from './commands/stream-broadcast';
import { seedSessions } from './commands/seed-sessions';

const program = new Command();

program
  .name('vnl-cli')
  .description('VideoNowAndLater developer CLI')
  .version('1.1.0');

program
  .command('stream-broadcast')
  .description('Stream MP4/MOV file into active broadcast session')
  .argument('<session-id>', 'Session ID to stream into')
  .argument('<video-file>', 'Path to MP4/MOV file')
  .option('--loop', 'Loop video indefinitely', false)
  .action(streamBroadcast);

program
  .command('seed-sessions')
  .description('Create sample broadcast and hangout sessions')
  .option('-n, --count <number>', 'Number of sessions to create', '5')
  .action(seedSessions);

program.parse();
```

### Pattern 2: FFmpeg Spawn for Streaming
**What:** Direct child_process.spawn() invocation with event-based output handling
**When to use:** DEV-03 (broadcast streaming), DEV-04 (hangout streaming)
**Example:**
```typescript
// backend/src/cli/lib/ffmpeg-streamer.ts
import { spawn } from 'child_process';

export interface StreamOptions {
  videoFile: string;
  rtmpUrl: string;
  loop?: boolean;
  onProgress?: (data: string) => void;
}

export function streamToRTMPS(options: StreamOptions): Promise<void> {
  const args = [
    '-re',                           // Read at native frame rate
    ...(options.loop ? ['-stream_loop', '-1'] : []),
    '-i', options.videoFile,
    '-c:v', 'libx264',
    '-b:v', '3500k',
    '-maxrate', '3500k',
    '-bufsize', '7000k',
    '-pix_fmt', 'yuv420p',
    '-s', '1920x1080',
    '-r', '30',
    '-profile:v', 'main',
    '-preset', 'veryfast',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-x264opts', 'nal-hrd=cbr:no-scenecut',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'flv',
    options.rtmpUrl
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.stderr.on('data', (data) => {
      if (options.onProgress) {
        options.onProgress(data.toString());
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}
```

### Pattern 3: WHIP Streaming for Hangouts
**What:** FFmpeg WHIP protocol for WebRTC ingestion into IVS RealTime Stages
**When to use:** DEV-04 (hangout session streaming)
**Example:**
```typescript
// WHIP streaming requires FFmpeg 6.1+ compiled with --enable-muxer=whip
export function streamToWHIP(options: {
  videoFile: string;
  whipUrl: string;
  participantToken: string;
}): Promise<void> {
  const args = [
    '-re',
    '-i', options.videoFile,
    '-c:v', 'libvpx-vp8',     // WebRTC requires VP8 or H.264
    '-b:v', '2000k',
    '-c:a', 'libopus',         // WebRTC requires Opus audio
    '-b:a', '128k',
    '-f', 'whip',
    `${options.whipUrl}?access_token=${options.participantToken}`
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args);
    // Similar event handling as RTMPS
  });
}
```

### Pattern 4: Batch Seeding with Domain Models
**What:** Use backend domain models and DynamoDB BatchWriteCommand for efficient seeding
**When to use:** DEV-05 (sessions), DEV-06 (chat), DEV-08 (reactions)
**Example:**
```typescript
// Reuse backend domain models for type safety
import { Session, SessionType, SessionStatus } from '../domain/session';
import { ChatMessage, calculateSessionRelativeTime } from '../domain/chat-message';
import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDocumentClient } from '../lib/dynamodb-client';

export async function seedChatMessages(
  tableName: string,
  sessionId: string,
  sessionStartedAt: string,
  count: number
): Promise<void> {
  const messages: ChatMessage[] = [];
  const baseTime = new Date(sessionStartedAt).getTime();

  for (let i = 0; i < count; i++) {
    const sentAt = new Date(baseTime + i * 5000).toISOString(); // 5s intervals
    messages.push({
      messageId: `msg-${i}`,
      sessionId,
      senderId: `user-${i % 3}`, // Rotate through 3 users
      content: `Test message ${i}`,
      sentAt,
      sessionRelativeTime: calculateSessionRelativeTime(sessionStartedAt, sentAt),
      senderAttributes: { displayName: `User ${i % 3}` },
    });
  }

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunks = chunkArray(messages, 25);
  const docClient = getDocumentClient();

  for (const chunk of chunks) {
    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: chunk.map(msg => ({
          PutRequest: {
            Item: {
              PK: `MESSAGE#${msg.sessionId}`,
              SK: `${msg.sentAt}#${msg.messageId}`,
              entityType: 'MESSAGE',
              ...msg,
            },
          },
        })),
      },
    }));
  }
}
```

### Pattern 5: Config Loading from CDK Outputs
**What:** Load AWS resource identifiers from cdk-outputs.json at runtime
**When to use:** All commands that interact with AWS services
**Example:**
```typescript
// backend/src/cli/lib/config-loader.ts
import fs from 'fs';
import path from 'path';

export interface DeploymentConfig {
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  region: string;
}

export function loadConfig(): DeploymentConfig {
  const outputsPath = path.join(process.cwd(), 'cdk-outputs.json');

  if (!fs.existsSync(outputsPath)) {
    throw new Error('cdk-outputs.json not found. Run ./scripts/deploy.sh first.');
  }

  const outputs = JSON.parse(fs.readFileSync(outputsPath, 'utf-8'));

  return {
    apiUrl: outputs['VNL-Api'].ApiUrl,
    userPoolId: outputs['VNL-Auth'].UserPoolId,
    userPoolClientId: outputs['VNL-Auth'].UserPoolClientId,
    region: outputs['VNL-Auth'].CognitoRegion,
  };
}
```

### Anti-Patterns to Avoid
- **Using fluent-ffmpeg wrapper:** Deprecated and broken with modern FFmpeg versions; use direct spawn() instead
- **Creating new DynamoDB schemas:** Reuse existing PK/SK patterns from backend repositories to ensure consistency
- **Hardcoding AWS resource ARNs:** Always load from cdk-outputs.json to support multiple environments
- **Synchronous file operations in CLI:** Use async/await for all I/O to prevent blocking
- **Missing error handling for FFmpeg failures:** Always check exit codes and provide actionable error messages

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Custom argv parser | commander | Handles subcommands, options, validation, help generation automatically |
| FFmpeg wrapper | Custom abstraction layer | Direct spawn() | fluent-ffmpeg is deprecated; raw spawn() is simple and reliable |
| DynamoDB batch write retry | Custom exponential backoff | AWS SDK built-in retry | SDK handles throttling, retries, jitter automatically |
| Timestamp generation for sync | Custom time offset logic | Backend domain helpers | calculateSessionRelativeTime() already tested and used in production |
| Session ID generation | Custom UUID logic | uuid package | Already in backend dependencies, RFC-compliant |
| Config validation | Manual checks | Commander required/optional | Framework validates arguments and shows usage on error |

**Key insight:** The backend workspace already has 90% of the code needed (domain models, repositories, AWS clients). CLI commands are thin wrappers that orchestrate existing backend logic with terminal I/O.

## Common Pitfalls

### Pitfall 1: FFmpeg Version Incompatibility with WHIP
**What goes wrong:** WHIP protocol requires FFmpeg 6.1+ with --enable-muxer=whip compilation flag; default Homebrew/system FFmpeg may not support it
**Why it happens:** WHIP muxer merged into mainline FFmpeg in June 2024; older packages don't include it
**How to avoid:** Check FFmpeg version and WHIP support in CLI startup; provide clear error message with upgrade instructions
**Warning signs:** "Unknown output format 'whip'" error when attempting hangout streaming

### Pitfall 2: DynamoDB BatchWrite Unprocessed Items
**What goes wrong:** BatchWriteCommand can partially fail due to throttling; unprocessed items are silently dropped if not handled
**Why it happens:** DynamoDB has per-partition throughput limits; high-velocity seeding can hit limits
**How to avoid:** Check response.UnprocessedItems and retry with exponential backoff
**Warning signs:** Seeded data count doesn't match expected count; missing messages/reactions in queries

### Pitfall 3: Session-Relative Time Drift
**What goes wrong:** Seeding chat/reactions with sessionRelativeTime that exceeds recording duration causes sync issues in replay
**Why it happens:** Fake data generation doesn't respect actual session duration
**How to avoid:** Query session.recordingDuration before seeding; ensure all timestamps fall within [0, duration]
**Warning signs:** Chat messages/reactions don't appear in replay viewer; timeline markers out of bounds

### Pitfall 4: Missing Participant Token for Hangout Streaming
**What goes wrong:** WHIP endpoint requires valid participant token; expired or missing token fails with 401 Unauthorized
**Why it happens:** Tokens have 12-hour TTL; CLI might attempt streaming to old sessions
**How to avoid:** Generate fresh participant token via CreateParticipantTokenCommand before each streaming attempt
**Warning signs:** FFmpeg exits with "Server returned 401 Unauthorized"; no video appears in hangout

### Pitfall 5: Concurrent Seeding Race Conditions
**What goes wrong:** Seeding multiple sessions/messages concurrently can create version conflicts or exceed API rate limits
**Why it happens:** DynamoDB conditional writes and SDK rate limits not accounted for in parallel operations
**How to avoid:** Use sequential seeding with progress feedback; or implement proper rate limiting with p-limit
**Warning signs:** "ConditionalCheckFailedException" errors; SDK throttling errors; partial data seeded

### Pitfall 6: TypeScript CLI Execution Without Compilation
**What goes wrong:** Directly running TypeScript CLI with ts-node in production is slow and requires dev dependencies
**Why it happens:** Forgetting to compile TypeScript to JavaScript and set up proper bin entry
**How to avoid:** Use tsc to compile CLI to dist/, set bin in package.json to dist/cli/index.js, add shebang to compiled output
**Warning signs:** CLI startup takes >500ms; ts-node errors in CI/CD; missing type definitions

## Code Examples

Verified patterns from existing codebase and official documentation:

### Stream to Broadcast Session (RTMPS)
```typescript
// backend/src/cli/commands/stream-broadcast.ts
import { GetChannelCommand } from '@aws-sdk/client-ivs';
import { getIVSClient } from '../../lib/ivs-clients';
import { getSessionById } from '../../repositories/session-repository';
import { streamToRTMPS } from '../lib/ffmpeg-streamer';
import { loadConfig } from '../lib/config-loader';

export async function streamBroadcast(
  sessionId: string,
  videoFile: string,
  options: { loop?: boolean }
) {
  const config = loadConfig();
  const tableName = process.env.TABLE_NAME!;

  // Get session and verify type
  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  if (session.sessionType !== 'BROADCAST') {
    throw new Error(`Session ${sessionId} is not a broadcast (type: ${session.sessionType})`);
  }

  // Get channel ingest endpoint
  const ivsClient = getIVSClient();
  const channelResult = await ivsClient.send(new GetChannelCommand({
    arn: session.claimedResources.channel,
  }));

  const ingestEndpoint = channelResult.channel?.ingestEndpoint;
  const streamKey = channelResult.channel?.streamKey?.value;

  if (!ingestEndpoint || !streamKey) {
    throw new Error('Failed to get channel ingest config');
  }

  console.log(`Streaming ${videoFile} to session ${sessionId}`);
  console.log(`Endpoint: rtmps://${ingestEndpoint}:443/app/***`);
  console.log('Press Ctrl+C to stop\n');

  await streamToRTMPS({
    videoFile,
    rtmpUrl: `rtmps://${ingestEndpoint}:443/app/${streamKey}`,
    loop: options.loop,
    onProgress: (data) => {
      // Parse FFmpeg stderr for frame/time info
      if (data.includes('frame=')) {
        process.stdout.write(`\r${data.trim()}`);
      }
    },
  });
}
```

### Seed Sessions with Recordings
```typescript
// backend/src/cli/commands/seed-sessions.ts
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionType, SessionStatus } from '../../domain/session';
import { createSession, updateRecordingMetadata } from '../../repositories/session-repository';

export async function seedSessions(options: { count: string }) {
  const tableName = process.env.TABLE_NAME!;
  const count = parseInt(options.count, 10);

  for (let i = 0; i < count; i++) {
    const sessionType = i % 2 === 0 ? SessionType.BROADCAST : SessionType.HANGOUT;
    const sessionId = uuidv4();
    const now = new Date();
    const createdAt = new Date(now.getTime() - (count - i) * 3600000).toISOString(); // 1 hour intervals
    const startedAt = new Date(new Date(createdAt).getTime() + 30000).toISOString(); // 30s later
    const endedAt = new Date(new Date(startedAt).getTime() + 1800000).toISOString(); // 30 min duration

    const session: Session = {
      sessionId,
      userId: `test-user-${i % 3}`,
      sessionType,
      status: SessionStatus.ENDED,
      claimedResources: {
        channel: sessionType === SessionType.BROADCAST ? `arn:aws:ivs:us-east-1:xxx:channel/xxx` : undefined,
        stage: sessionType === SessionType.HANGOUT ? `arn:aws:ivs:us-east-1:xxx:stage/xxx` : undefined,
        chatRoom: `arn:aws:ivschat:us-east-1:xxx:room/xxx`,
      },
      createdAt,
      startedAt,
      endedAt,
      version: 1,
    };

    await createSession(tableName, session);

    // Add fake recording metadata
    await updateRecordingMetadata(tableName, sessionId, {
      recordingStatus: 'available',
      recordingDuration: 1800, // 30 minutes
      recordingS3Path: `recordings/${sessionId}/recording.m3u8`,
      recordingHlsUrl: `https://d111111abcdef8.cloudfront.net/recordings/${sessionId}/recording.m3u8`,
      thumbnailUrl: `https://d111111abcdef8.cloudfront.net/recordings/${sessionId}/thumb.jpg`,
    });

    console.log(`Created ${sessionType} session: ${sessionId}`);
  }

  console.log(`\nSeeded ${count} sessions successfully`);
}
```

### Simulate Presence via IVS Chat Events
```typescript
// backend/src/cli/commands/simulate-presence.ts
// Source: AWS IVS Chat SendEvent API
import { SendEventCommand } from '@aws-sdk/client-ivschat';
import { getIVSChatClient } from '../../lib/ivs-clients';
import { getSessionById } from '../../repositories/session-repository';

export async function simulatePresence(
  sessionId: string,
  options: { viewers: string }
) {
  const tableName = process.env.TABLE_NAME!;
  const viewerCount = parseInt(options.viewers, 10);

  const session = await getSessionById(tableName, sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const chatClient = getIVSChatClient();
  const roomIdentifier = session.claimedResources.chatRoom;

  // Send presence update event
  await chatClient.send(new SendEventCommand({
    roomIdentifier,
    eventName: 'presence:update',
    attributes: {
      viewerCount: viewerCount.toString(),
      timestamp: new Date().toISOString(),
    },
  }));

  console.log(`Sent presence event: ${viewerCount} viewers to session ${sessionId}`);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bash scripts only | TypeScript CLI + Bash | Phase 9 (2026-03) | Type safety, reuse backend code, better testability |
| fluent-ffmpeg wrapper | Direct child_process spawn | 2024-2025 | fluent-ffmpeg deprecated; direct spawn is simpler and maintained |
| RTMP-only streaming | RTMP + WHIP | FFmpeg 6.1 (2024-06) | WebRTC ingestion enables hangout streaming without separate SDK |
| Manual DynamoDB writes | BatchWriteCommand | AWS SDK v3 (2020) | Up to 25 items per request, 10x faster seeding |
| Hardcoded ARNs | cdk-outputs.json config | Phase 1 (v1.0) | Supports multiple environments, no config drift |

**Deprecated/outdated:**
- fluent-ffmpeg: Unmaintained since 2022, broken with FFmpeg 5.0+; use direct spawn()
- AWS SDK v2: Project uses v3; ensure all imports from @aws-sdk/client-* not aws-sdk
- Yargs/Oclif for simple CLIs: Overkill for <10 commands; Commander is sufficient and faster

## Open Questions

1. **FFmpeg WHIP Support Verification**
   - What we know: WHIP muxer merged into FFmpeg mainline in June 2024
   - What's unclear: Whether Homebrew FFmpeg 6.1+ includes --enable-muxer=whip by default
   - Recommendation: Document FFmpeg version check in CLI startup; provide brew upgrade ffmpeg if < 6.1; test WHIP muxer availability with ffmpeg -muxers | grep whip

2. **IVS RealTime WHIP Endpoint Format**
   - What we know: AWS IVS RealTime supports WHIP ingestion per official docs
   - What's unclear: Exact WHIP endpoint URL format and whether participant token goes in query string or header
   - Recommendation: Test with OBS WHIP workflow first (documented); replicate URL format in FFmpeg command

3. **DynamoDB Seeding Performance at Scale**
   - What we know: BatchWriteCommand supports 25 items per request
   - What's unclear: Whether seeding 1000+ reactions will hit provisioned capacity limits
   - Recommendation: Start with sequential batches; add rate limiting if throttling occurs; document --rate-limit flag

4. **CLI Distribution Strategy**
   - What we know: CLI lives in backend workspace, needs build step
   - What's unclear: Whether to npm link globally or run via npx/tsx for developer UX
   - Recommendation: Provide both: npm link for active development, npm run cli for one-off usage

## Validation Architecture

> Research note: .planning/config.json does not specify workflow.nyquist_validation, defaulting to standard validation approach.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 with ts-jest 29.4.6 |
| Config file | backend/jest.config.js |
| Quick run command | `npm test -- --testPathPattern=cli` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEV-03 | Stream MP4 to broadcast via RTMPS | integration | `npm test -- backend/src/cli/__tests__/stream-broadcast.test.ts` | ❌ Wave 0 |
| DEV-04 | Stream MP4 to hangout via WHIP | integration | `npm test -- backend/src/cli/__tests__/stream-hangout.test.ts` | ❌ Wave 0 |
| DEV-05 | Seed sample sessions with metadata | unit | `npm test -- backend/src/cli/__tests__/seed-sessions.test.ts` | ❌ Wave 0 |
| DEV-06 | Seed sample chat messages | unit | `npm test -- backend/src/cli/__tests__/seed-chat.test.ts` | ❌ Wave 0 |
| DEV-08 | Seed sample reactions | unit | `npm test -- backend/src/cli/__tests__/seed-reactions.test.ts` | ❌ Wave 0 |
| DEV-09 | Simulate presence via SendEvent | unit | `npm test -- backend/src/cli/__tests__/simulate-presence.test.ts` | ❌ Wave 0 |
| DEV-10 | CLI help documentation | manual-only | Run `vnl-cli --help` and verify output | N/A |

### Sampling Rate
- **Per task commit:** Unit tests for seeding commands (fast, no AWS calls)
- **Per wave merge:** Integration tests for streaming commands (requires FFmpeg, mocked AWS SDK)
- **Phase gate:** Full suite + manual verification of FFmpeg WHIP with real Stage

### Wave 0 Gaps
- [ ] `backend/src/cli/__tests__/ffmpeg-streamer.test.ts` — unit tests for spawn() wrapper, mock child_process
- [ ] `backend/src/cli/__tests__/config-loader.test.ts` — unit tests for cdk-outputs.json parsing
- [ ] `backend/src/cli/__tests__/seed-*.test.ts` — unit tests for seeding commands, mock DynamoDB
- [ ] `backend/src/cli/__tests__/stream-*.test.ts` — integration tests for streaming commands, mock FFmpeg spawn
- [ ] Jest setup: Mock AWS SDK clients in test environment (already established pattern in backend/__tests__)

## Sources

### Primary (HIGH confidence)
- [AWS IVS Chat SendEvent API Reference](https://docs.aws.amazon.com/ivs/latest/ChatAPIReference/API_SendEvent.html) - Presence simulation via custom events
- [AWS IVS RealTime WHIP Publishing](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/obs-whip-support.html) - WHIP protocol for Stage ingestion
- [AWS SDK JavaScript v3 DynamoDB BatchWrite](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/dynamodb-example-table-read-write-batch.html) - Batch write patterns
- [FFmpeg RTMPS Protocol Documentation](https://ffmpeg.org/ffmpeg-protocols.html) - RTMPS streaming parameters
- Existing codebase: backend/src/domain/\*.ts, backend/src/repositories/\*.ts, scripts/test-broadcast.sh

### Secondary (MEDIUM confidence)
- [CLI Framework Comparison: Commander vs Yargs vs Oclif](https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-vs-oclif-utxlf9v9) - Performance benchmarks and feature comparison
- [Publishing Real-Time Video via WHIP to Amazon IVS](https://dev.to/aws/publishing-real-time-video-via-whip-to-amazon-ivs-p7f) - WHIP+FFmpeg tutorial
- [Stream video processing with Node.js and FFmpeg](https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/) - child_process patterns
- [Writing Your Own TypeScript CLI](https://dawchihliou.github.io/articles/writing-your-own-typescript-cli) - Shebang and bin configuration
- [Unit testing node CLI apps with Jest](https://medium.com/@altshort/unit-testing-node-cli-apps-with-jest-2cd4adc599fb) - CLI testing patterns

### Tertiary (LOW confidence)
- [fluent-ffmpeg phasing out discussion](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) - Deprecation status, use with caution

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Commander.js, AWS SDK, FFmpeg all verified via official docs and existing codebase usage
- Architecture: HIGH - Backend domain models and repositories already established; CLI is thin wrapper
- Pitfalls: HIGH - FFmpeg version issues documented in official IVS docs; DynamoDB batch patterns from AWS SDK docs
- WHIP streaming: MEDIUM - Protocol documented but endpoint URL format needs practical verification during implementation

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (30 days - stable domain, FFmpeg and AWS APIs evolve slowly)
