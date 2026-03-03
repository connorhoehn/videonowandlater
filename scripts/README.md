# Developer Scripts

## Test Broadcast with FFmpeg

Stream a video file to a broadcast session for testing without a camera.

### Prerequisites

- FFmpeg installed (`brew install ffmpeg` on macOS)
- jq installed (`brew install jq` on macOS)
- Auth token file at `./scripts/.token` (generate with `./scripts/get-token.sh`)
- Test video file (MP4 or MOV)

### Usage

```bash
./scripts/test-broadcast.sh <session-id> <video-file>
```

### Example

```bash
# Create session
SESSION_ID=$(curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer $(cat ./scripts/.token)" \
  -H "Content-Type: application/json" \
  -d '{"sessionType":"BROADCAST"}' | jq -r '.sessionId')

# Stream video
./scripts/test-broadcast.sh $SESSION_ID test-video.mp4
```

### Notes

- Script loops video indefinitely (Ctrl+C to stop)
- Encodes at 1080p30, 3.5 Mbps bitrate (IVS recommended settings)
- Uses RTMPS for secure streaming
- Streams will automatically transition session to LIVE when IVS detects the stream
- Stop streaming to trigger session cleanup (session transitions to ENDED after 5 minutes)

### Environment Variables

- `API_URL`: API base URL (default: `http://localhost:3000/api`)
- `TOKEN_FILE`: Path to auth token file (default: `./scripts/.token`)

## Developer CLI (v1.1)

The TypeScript CLI provides media streaming and data seeding tools for testing.

### Installation

```bash
cd backend
npm run build
npm link  # Makes vnl-cli globally available
```

Or run without linking:
```bash
cd backend
npm run cli -- <command> [args]
```

### Commands

#### Stream to Broadcast
Stream test video file into active broadcast session:
```bash
vnl-cli stream-broadcast <session-id> <video-file.mp4>

# Loop video indefinitely
vnl-cli stream-broadcast <session-id> test-video.mp4 --loop
```

Requirements: FFmpeg 6.0+ installed (`brew install ffmpeg`)

#### Stream to Hangout
Stream test video into multi-participant hangout session:
```bash
vnl-cli stream-hangout <session-id> <video-file.mp4>
```

Requirements: FFmpeg 6.1+ with WHIP support (`brew upgrade ffmpeg`)

#### Seed Sessions
Create sample broadcast and hangout sessions with recording metadata:
```bash
vnl-cli seed-sessions -n 10   # Creates 10 sessions (5 broadcasts, 5 hangouts)
```

#### Seed Chat Messages
Generate time-series chat messages for replay testing:
```bash
vnl-cli seed-chat <session-id> -n 50   # Creates 50 messages at 5-second intervals
```

#### Seed Reactions
Generate reactions with timeline synchronization:
```bash
# Live reactions
vnl-cli seed-reactions <session-id> -n 100

# Replay reactions
vnl-cli seed-reactions <session-id> -n 100 --replay
```

#### Simulate Presence
Send custom presence events for viewer count testing:
```bash
vnl-cli simulate-presence <session-id> --viewers 42
```

### Environment Variables

CLI commands require environment configuration:

```bash
export TABLE_NAME=VNL-App-SessionsTable-xxx  # From cdk-outputs.json
export AWS_REGION=us-east-1
```

Or source from cdk-outputs.json automatically (handled by config-loader).

### Testing

Run CLI tests:
```bash
cd backend
npm test -- backend/src/cli
```
