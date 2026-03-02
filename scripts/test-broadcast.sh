#!/bin/bash
# Usage: ./scripts/test-broadcast.sh <session-id> <video-file.mp4>
# Streams a video file to an IVS broadcast session for testing without a camera

set -e

SESSION_ID=$1
VIDEO_FILE=$2

if [[ -z "$SESSION_ID" || -z "$VIDEO_FILE" ]]; then
  echo "Usage: $0 <session-id> <video-file>"
  echo ""
  echo "Example: $0 abc123 test-video.mp4"
  exit 1
fi

if [[ ! -f "$VIDEO_FILE" ]]; then
  echo "Error: Video file not found: $VIDEO_FILE"
  exit 1
fi

# Fetch ingest endpoint and stream key from API
API_URL="${API_URL:-http://localhost:3000/api}"
TOKEN_FILE="${TOKEN_FILE:-./scripts/.token}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Error: Token file not found: $TOKEN_FILE"
  echo "Run ./scripts/get-token.sh first to generate auth token"
  exit 1
fi

TOKEN=$(cat "$TOKEN_FILE")

echo "Fetching ingest config for session: $SESSION_ID"
RESPONSE=$(curl -s -X POST "$API_URL/sessions/$SESSION_ID/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

INGEST_ENDPOINT=$(echo "$RESPONSE" | jq -r '.ingestEndpoint')
STREAM_KEY=$(echo "$RESPONSE" | jq -r '.streamKey')

if [[ "$INGEST_ENDPOINT" == "null" || "$STREAM_KEY" == "null" ]]; then
  echo "Error fetching ingest config: $RESPONSE"
  exit 1
fi

echo "Streaming to: rtmps://$INGEST_ENDPOINT:443/app/***"
echo "Press Ctrl+C to stop streaming"
echo ""

# Stream with FFmpeg
# -re: Read input at native frame rate
# -stream_loop -1: Loop video indefinitely
# Video encoding: H.264 at 3.5 Mbps, 1080p30
# Audio encoding: AAC at 160 kbps
ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" \
  -c:v libx264 -b:v 3500k -maxrate 3500k -bufsize 7000k \
  -pix_fmt yuv420p -s 1920x1080 -r 30 \
  -profile:v main -preset veryfast \
  -force_key_frames "expr:gte(t,n_forced*2)" \
  -x264opts "nal-hrd=cbr:no-scenecut" \
  -c:a aac -b:a 160k -ar 44100 -ac 2 \
  -f flv "rtmps://$INGEST_ENDPOINT:443/app/$STREAM_KEY"
