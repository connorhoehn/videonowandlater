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
