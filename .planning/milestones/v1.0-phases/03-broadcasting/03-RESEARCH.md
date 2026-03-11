# Phase 3: Broadcasting - Research

**Researched:** 2026-03-02
**Domain:** AWS IVS Low-Latency Streaming, WebRTC Media APIs, Browser Broadcasting
**Confidence:** HIGH

## Summary

Phase 3 enables users to broadcast live video from their browser camera to viewers watching via low-latency HLS. The standard stack combines AWS IVS Web Broadcast SDK (for broadcaster camera access and RTMPS streaming) with IVS Player SDK (for viewer playback). IVS handles all the complex video infrastructure: ingest, transcoding, adaptive bitrate, recording to S3, and EventBridge notifications for stream lifecycle.

The broadcaster flow is: request camera permissions → attach preview → add camera/mic devices to IVS client → call `startBroadcast(streamKey)`. The viewer flow is: initialize IVS Player → load playback URL → play. Both SDKs handle adaptive bitrate automatically based on network conditions.

Critical architectural decisions: use EventBridge "Recording State Change" events (not polling) to detect when broadcasts end and recordings are ready; never poll GetStream API for viewer count (15-second update latency, rate limits); IVS channels must be created with recording enabled at channel creation time (cannot be toggled later); stream keys are only returned once during CreateChannel and must be stored in pool items.

**Primary recommendation:** Use IVS Web Broadcast SDK v1.32.0+ for broadcasting and IVS Player SDK v1.49.0+ for playback. Follow the established pattern from Phase 2 of EventBridge-driven state management. Never hand-roll video streaming, recording, or ABR logic.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BCAST-01 | User can go live with a single action (broadcast mode, one-to-many) | IVS Web Broadcast SDK provides single `startBroadcast(streamKey)` call; streamKey from pool item claims channel |
| BCAST-02 | User sees self-view preview before and during broadcast | `client.attachPreview(videoElement)` provides local camera preview; separate from broadcast stream |
| BCAST-03 | Viewers can watch a live broadcast with IVS Player (low-latency HLS) | IVS Player SDK plays channel's playback URL; <3-5 second latency; adaptive bitrate built-in |
| BCAST-04 | Live viewer count is visible to broadcaster and viewers | GetStream API returns `viewerCount` field (15-second update latency); polling required but rate-limited |
| BCAST-05 | Stream quality auto-adapts to network conditions (IVS ABR) | IVS Web Broadcast SDK and Player SDK both implement ABR automatically; no custom code needed |
| BCAST-06 | Live indicator shows which sessions are currently broadcasting | EventBridge "Stream Start" / "Stream End" events update session state; query sessions with `status: LIVE` |
| POOL-06 | Resources are released back to pool and recycled when sessions end | EventBridge "Recording End" event triggers cleanup Lambda; transitions session to ENDED, updates pool status to AVAILABLE |
| SESS-03 | Sessions clean up gracefully (stop recording, release pool resources, finalize chat) | "Recording End" event guarantees recording finished writing to S3; cleanup Lambda handles state transitions |
| DEV-06 | CLI command (or documented approach) to stream MP4/MOV into a broadcast via RTMPS/FFmpeg | FFmpeg with `-f flv rtmps://` command streams to channel's ingest endpoint + stream key; well-documented pattern |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| amazon-ivs-web-broadcast | 1.32.0+ | Browser camera capture and RTMPS streaming | Official AWS SDK; only library that broadcasts to IVS channels; handles WebRTC device access, encoding, adaptive bitrate |
| amazon-ivs-player | 1.49.0 | Low-latency HLS playback for viewers | Required for <5 second latency; third-party HLS players cannot achieve IVS low-latency performance |
| @aws-sdk/client-ivs | 3.1000.0+ | Backend Channel/Stream API operations | Standard AWS SDK v3; used for GetStream (viewer count), StopStream (admin termination) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| FFmpeg | 4.4+ | Stream video files to IVS for testing | DEV-06 requirement; enables testing broadcasts without camera; standard encoder for RTMPS |
| webrtc-adapter | 9.0+ | Browser WebRTC polyfills | Optional; normalizes getUserMedia API across browsers; fixes Safari constraints; already handled by IVS SDK internally |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| IVS Web Broadcast SDK | Custom WebRTC + MediaRecorder | IVS SDK provides RTMPS ingest, adaptive bitrate, reconnection logic; custom solution would be 1000+ lines and miss edge cases |
| IVS Player SDK | video.js / hls.js | Third-party players cannot achieve IVS low-latency (<5s); standard HLS adds 20-30s latency |
| EventBridge events | Polling GetStream/GetChannel | EventBridge is push-based, reliable, and cost-effective; polling adds latency and rate-limit risk |

**Installation:**

```bash
# Web frontend
npm install amazon-ivs-web-broadcast amazon-ivs-player

# Backend (already installed in Phase 2)
# @aws-sdk/client-ivs already in backend/package.json

# FFmpeg (developer machine)
brew install ffmpeg  # macOS
apt-get install ffmpeg  # Linux
# or download from https://ffmpeg.org/download.html
```

## Architecture Patterns

### Recommended Project Structure

```
web/src/
├── features/
│   ├── broadcast/           # Broadcaster experience
│   │   ├── BroadcastPage.tsx
│   │   ├── useBroadcast.ts  # Hook: camera access, IVS client lifecycle
│   │   ├── CameraPreview.tsx
│   │   └── BroadcastControls.tsx
│   └── viewer/              # Viewer experience
│       ├── ViewerPage.tsx
│       ├── usePlayer.ts     # Hook: IVS Player lifecycle
│       └── VideoPlayer.tsx
backend/src/
├── handlers/
│   ├── start-broadcast.ts   # POST /sessions/:id/start - returns ingest config
│   ├── stop-broadcast.ts    # POST /sessions/:id/stop - transitions to ending
│   ├── get-viewer-count.ts  # GET /sessions/:id/viewers - cached GetStream
│   └── recording-ended.ts   # EventBridge trigger - cleanup on Recording End
└── services/
    └── broadcast-service.ts # GetStream wrapper, viewer count caching
```

### Pattern 1: Browser Broadcast Lifecycle

**What:** Initialize IVS client, request permissions, attach devices, start/stop broadcast
**When to use:** BCAST-01, BCAST-02 requirements
**Example:**

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/broadcast-web-getting-started.html
import IVSBroadcastClient, { BASIC_FULL_HD_LANDSCAPE } from 'amazon-ivs-web-broadcast';

// Hook: useBroadcast.ts
export function useBroadcast(sessionId: string) {
  const [client, setClient] = useState<IVSBroadcastClient | null>(null);
  const [isLive, setIsLive] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);

  // Initialize client on mount
  useEffect(() => {
    const broadcastClient = IVSBroadcastClient.create({
      streamConfig: BASIC_FULL_HD_LANDSCAPE, // 1080p, 3.5 Mbps, adaptive
      ingestEndpoint: '', // Fetch from backend API
    });
    setClient(broadcastClient);

    return () => {
      broadcastClient.stopBroadcast();
      // Client cleanup handled automatically
    };
  }, []);

  // Attach preview
  useEffect(() => {
    if (client && previewRef.current) {
      client.attachPreview(previewRef.current);
    }
  }, [client]);

  const startBroadcast = async () => {
    if (!client) return;

    // Get camera/mic
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1920, height: 1080 },
      audio: true,
    });

    // Add to broadcast
    client.addVideoInputDevice(cameraStream, 'camera1', { index: 0 });
    const audioTracks = cameraStream.getAudioTracks();
    if (audioTracks.length > 0) {
      const micStream = new MediaStream([audioTracks[0]]);
      client.addAudioInputDevice(micStream, 'mic1');
    }

    // Fetch stream key from backend
    const response = await fetch(`/api/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { streamKey } = await response.json();

    // Start broadcast
    await client.startBroadcast(streamKey);
    setIsLive(true);
  };

  const stopBroadcast = async () => {
    if (client) {
      await client.stopBroadcast();
      setIsLive(false);
    }
  };

  return { previewRef, startBroadcast, stopBroadcast, isLive };
}
```

### Pattern 2: Viewer Playback with IVS Player

**What:** Load HLS stream, handle player events, display live indicator
**When to use:** BCAST-03 requirement
**Example:**

```typescript
// Source: https://aws.github.io/amazon-ivs-player-docs/1.49.0/web/
// Note: IVS Player SDK uses script tag or npm; for npm, assets must be served

// Hook: usePlayer.ts
export function usePlayer(playbackUrl: string) {
  const [player, setPlayer] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    // Initialize player (assumes IVSPlayer loaded via script tag)
    const ivsPlayer = IVSPlayer.create();
    ivsPlayer.attachHTMLVideoElement(videoRef.current);

    // Event listeners
    ivsPlayer.addEventListener(IVSPlayer.PlayerState.PLAYING, () => {
      setIsPlaying(true);
    });
    ivsPlayer.addEventListener(IVSPlayer.PlayerState.ENDED, () => {
      setIsPlaying(false);
    });
    ivsPlayer.addEventListener(IVSPlayer.PlayerEventType.ERROR, (error: any) => {
      console.error('Player error:', error);
    });

    // Load stream
    ivsPlayer.load(playbackUrl);
    ivsPlayer.play();

    setPlayer(ivsPlayer);

    return () => {
      ivsPlayer.pause();
      ivsPlayer.delete();
    };
  }, [playbackUrl]);

  return { videoRef, player, isPlaying };
}
```

### Pattern 3: EventBridge-Driven Session Cleanup

**What:** Subscribe to IVS Recording State Change events, trigger cleanup Lambda on Recording End
**When to use:** POOL-06, SESS-03 requirements
**Example:**

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html
// CDK: infra/lib/broadcast-stack.ts

import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// EventBridge rule for Recording End
const recordingEndedRule = new events.Rule(this, 'RecordingEndedRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      recording_status: ['Recording End'],
    },
  },
});

recordingEndedRule.addTarget(new targets.LambdaFunction(cleanupLambda));

// Lambda handler: backend/src/handlers/recording-ended.ts
import type { EventBridgeEvent } from 'aws-lambda';

interface RecordingEndDetail {
  channel_name: string;
  stream_id: string;
  recording_status: 'Recording End';
  recording_s3_bucket_name: string;
  recording_s3_key_prefix: string;
  recording_duration_ms: number;
  recording_session_id: string;
}

export const handler = async (event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>) => {
  const { channel_name, recording_s3_key_prefix, recording_duration_ms } = event.detail;

  // Find session by channel ARN (stored in session record)
  const session = await findSessionByChannelArn(channel_name);
  if (!session) {
    console.warn('No session found for channel:', channel_name);
    return;
  }

  // Update session: transition to ENDED, store recording metadata
  await updateSession(session.sessionId, {
    status: 'ENDED',
    endedAt: new Date().toISOString(),
    recording: {
      s3KeyPrefix: recording_s3_key_prefix,
      durationMs: recording_duration_ms,
    },
  });

  // Release pool resources back to AVAILABLE
  await releasePoolResources(session.channelId, session.stageArn, session.chatRoomArn);

  console.log('Session cleanup complete:', session.sessionId);
};
```

### Pattern 4: Viewer Count with Caching

**What:** Poll GetStream API with caching to avoid rate limits
**When to use:** BCAST-04 requirement
**Example:**

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/APIReference/API_GetStream.html
// backend/src/services/broadcast-service.ts

import { IVSClient, GetStreamCommand } from '@aws-sdk/client-ivs';
import { getAwsClient } from '../utils/aws-clients';

interface ViewerCountCache {
  [channelArn: string]: { count: number; timestamp: number };
}

const cache: ViewerCountCache = {};
const CACHE_TTL_MS = 15000; // 15 seconds (matches IVS update frequency)

export async function getViewerCount(channelArn: string): Promise<number> {
  const now = Date.now();
  const cached = cache[channelArn];

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const ivs = getAwsClient(IVSClient);
    const response = await ivs.send(new GetStreamCommand({ channelArn }));
    const count = response.stream?.viewerCount ?? 0;

    cache[channelArn] = { count, timestamp: now };
    return count;
  } catch (error: any) {
    if (error.name === 'ResourceNotFoundException' || error.name === 'ChannelNotBroadcasting') {
      // Stream is offline
      cache[channelArn] = { count: 0, timestamp: now };
      return 0;
    }
    throw error;
  }
}

// Handler: backend/src/handlers/get-viewer-count.ts
export const handler: APIGatewayProxyHandler = async (event) => {
  const sessionId = event.pathParameters?.id;
  const session = await getSession(tableName, sessionId);

  if (!session || !session.channelArn) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Session not found' }) };
  }

  const viewerCount = await getViewerCount(session.channelArn);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ viewerCount }),
  };
};
```

### Pattern 5: FFmpeg Testing Stream

**What:** Stream MP4/MOV file to IVS channel via RTMPS for testing
**When to use:** DEV-06 requirement
**Example:**

```bash
# Source: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/getting-started-set-up-streaming.html
# scripts/test-broadcast.sh

#!/bin/bash
# Usage: ./scripts/test-broadcast.sh <session-id> <video-file.mp4>

SESSION_ID=$1
VIDEO_FILE=$2

if [[ -z "$SESSION_ID" || -z "$VIDEO_FILE" ]]; then
  echo "Usage: $0 <session-id> <video-file>"
  exit 1
fi

# Fetch ingest endpoint and stream key from API
API_URL="http://localhost:3000/api"
TOKEN=$(node scripts/get-token.js) # DEV-02 token generation

RESPONSE=$(curl -s -X POST "$API_URL/sessions/$SESSION_ID/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

INGEST_ENDPOINT=$(echo "$RESPONSE" | jq -r '.ingestEndpoint')
STREAM_KEY=$(echo "$RESPONSE" | jq -r '.streamKey')

if [[ "$INGEST_ENDPOINT" == "null" || "$STREAM_KEY" == "null" ]]; then
  echo "Error fetching ingest config: $RESPONSE"
  exit 1
fi

# Stream with FFmpeg
ffmpeg -re -stream_loop -1 -i "$VIDEO_FILE" \
  -c:v libx264 -b:v 3500k -maxrate 3500k -bufsize 7000k \
  -pix_fmt yuv420p -s 1920x1080 -r 30 \
  -profile:v main -preset veryfast \
  -force_key_frames "expr:gte(t,n_forced*2)" \
  -x264opts "nal-hrd=cbr:no-scenecut" \
  -c:a aac -b:a 160k -ar 44100 -ac 2 \
  -f flv "rtmps://$INGEST_ENDPOINT:443/app/$STREAM_KEY"
```

### Anti-Patterns to Avoid

- **Polling GetStream for every viewer:** Rate limits at 5 TPS; use 15-second cache or CloudWatch metrics instead
- **Not waiting for Recording End event:** S3 recording files are still being written during broadcast; playback will fail if accessed too early
- **Toggling recording after channel creation:** IVS requires recording config at CreateChannel time; cannot be enabled/disabled later
- **Assuming stream is live if channel exists:** Channel can be created but not streaming; check GetStream or EventBridge "Stream Start" event
- **Using standard HLS players:** Third-party players add 20-30s latency; IVS Player SDK required for <5s low-latency
- **Ignoring adaptive bitrate warnings:** IVS SDK automatically degrades quality on poor networks; don't override ABR settings unless you have specific requirements

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Video streaming to viewers | Custom HLS segmenting, DASH, WebRTC peer connections | AWS IVS Channels | IVS handles transcoding, multi-bitrate renditions, global CDN distribution, <5s latency; custom solution would cost $100K+ to build and maintain |
| Adaptive bitrate logic | Network quality detection, manual bitrate switching | IVS Web Broadcast SDK + Player SDK | Both SDKs include battle-tested ABR algorithms; custom ABR would require continuous network monitoring, complex heuristics, and buffer management |
| Recording to S3 | MediaRecorder + multipart upload, segment stitching | IVS Auto-Record to S3 | IVS automatically records all renditions, generates thumbnails, handles reconnection merging, writes HLS playlists; custom recording would miss edge cases like network interruptions |
| RTMPS ingest server | Custom RTMP server (nginx-rtmp, node-media-server) | IVS Channels | IVS provides global ingest endpoints, automatic failover, stream authentication via stream keys; custom RTMP server would need geographic distribution, security hardening, and scaling |
| Stream state management | Polling channel status every second | EventBridge + IVS events | EventBridge delivers "Stream Start", "Stream End", "Recording End" events reliably; polling adds cost, latency, and rate limit risks |

**Key insight:** Video streaming infrastructure is deceptively complex. IVS handles thousands of edge cases: network interruptions, encoder crashes, bitrate spikes, viewer buffering, recording consistency, thumbnail generation, and global distribution. Building a custom solution would take 6-12 months and still lack production-grade reliability.

## Common Pitfalls

### Pitfall 1: Not Storing Stream Key During Channel Creation

**What goes wrong:** CreateChannel API returns `streamKey` in response, but subsequent GetChannel calls do NOT include it. If stream key is lost, channel must be deleted and recreated.

**Why it happens:** IVS security model: stream keys are sensitive credentials returned only once during creation.

**How to avoid:** Store `streamKey` in DynamoDB pool item during replenishment (Phase 2 already does this). Never rely on fetching stream key later.

**Warning signs:** GetChannel response has no `streamKey` field; frontend errors "missing stream key" when starting broadcast.

### Pitfall 2: Using StreamConfig Multiple Times

**What goes wrong:** IVS Web Broadcast SDK only respects `streamConfig` passed to the first `IVSBroadcastClient.create()` call. Subsequent instances ignore `maxFramerate` or `maxBitrate` settings if different from the first client.

**Why it happens:** SDK limitation: global singleton for encoder settings.

**How to avoid:** Set `streamConfig` once in a singleton hook or context provider. Do not create multiple clients with different configs.

**Warning signs:** Second broadcaster on same page always uses first broadcaster's video quality settings.

### Pitfall 3: Accessing Recording Before "Recording End" Event

**What goes wrong:** S3 files appear in bucket during broadcast, but HLS manifest and segments are incomplete until "Recording End" event fires. Playing recording mid-stream causes playback errors.

**Why it happens:** IVS writes segments continuously; manifest is finalized only after stream ends and reconnection window expires.

**How to avoid:** Wait for EventBridge "IVS Recording State Change" with `recording_status: "Recording End"` before exposing replay to users (Phase 5).

**Warning signs:** Replay playback fails with "manifest not found" or "segment missing" errors; recordings work 5 minutes after broadcast but not immediately.

### Pitfall 4: Port 4443 Blocked by VPN/Firewall

**What goes wrong:** IVS Web Broadcast SDK requires outbound port 4443 for RTMPS. If blocked, `startBroadcast()` hangs or fails with connection timeout.

**Why it happens:** Corporate VPNs, hotel WiFi, or restrictive firewalls often block non-standard ports.

**How to avoid:** Document port 4443 requirement in broadcaster onboarding. Provide error message suggesting VPN disable. Consider fallback to standard port 443 if IVS adds support.

**Warning signs:** Broadcast works on home network but fails at office; timeout errors after 30-60 seconds; no stream appears in IVS console.

### Pitfall 5: Safari Intel Mac Green Artifacts

**What goes wrong:** Viewers watching Safari broadcasts from Intel Mac users see green screen artifacts or irregular framerate.

**Why it happens:** Known IVS Web Broadcast SDK issue with Safari on Intel chipsets.

**How to avoid:** Detect Safari + Intel Mac in broadcaster UI, show warning message recommending Chrome. Use `navigator.userAgent` to check.

**Warning signs:** Viewer complaints about green flashes or stuttering, but only when broadcaster uses Safari on Intel Mac (not M1/M2).

### Pitfall 6: Forgetting to Stop Broadcast on Component Unmount

**What goes wrong:** User navigates away from broadcast page, but stream continues running. Camera stays on, bandwidth consumed, session stuck in LIVE state.

**Why it happens:** IVS client continues streaming until explicitly stopped; React component unmount doesn't automatically stop broadcast.

**How to avoid:** Always call `client.stopBroadcast()` in `useEffect` cleanup function.

**Warning signs:** Camera light stays on after leaving page; session API shows status=LIVE hours after broadcast; AWS costs spike from continuous streaming.

## Code Examples

Verified patterns from official sources:

### Complete Broadcast Component

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/broadcast-web-getting-started.html
// web/src/features/broadcast/BroadcastPage.tsx

import React, { useEffect, useState, useRef } from 'react';
import IVSBroadcastClient, { BASIC_FULL_HD_LANDSCAPE } from 'amazon-ivs-web-broadcast';

interface BroadcastConfig {
  ingestEndpoint: string;
  streamKey: string;
}

export function BroadcastPage({ sessionId }: { sessionId: string }) {
  const [client, setClient] = useState<IVSBroadcastClient | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  // Initialize client
  useEffect(() => {
    const initClient = async () => {
      try {
        // Fetch ingest config from backend
        const response = await fetch(`/api/sessions/${sessionId}/broadcast-config`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const config: BroadcastConfig = await response.json();

        // Create client
        const broadcastClient = IVSBroadcastClient.create({
          streamConfig: BASIC_FULL_HD_LANDSCAPE,
          ingestEndpoint: config.ingestEndpoint,
        });

        setClient(broadcastClient);

        // Attach preview
        if (previewRef.current) {
          broadcastClient.attachPreview(previewRef.current);
        }
      } catch (err: any) {
        setError(err.message);
      }
    };

    initClient();

    // Cleanup on unmount
    return () => {
      if (client) {
        client.stopBroadcast();
      }
    };
  }, [sessionId]);

  const handleStartBroadcast = async () => {
    if (!client) return;

    try {
      // Request permissions and get devices
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });

      // Add video
      client.addVideoInputDevice(stream, 'camera1', { index: 0 });

      // Add audio
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const micStream = new MediaStream([audioTrack]);
        client.addAudioInputDevice(micStream, 'mic1');
      }

      // Fetch stream key
      const response = await fetch(`/api/sessions/${sessionId}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const { streamKey } = await response.json();

      // Start broadcast
      await client.startBroadcast(streamKey);
      setIsLive(true);
    } catch (err: any) {
      setError(`Failed to start broadcast: ${err.message}`);
    }
  };

  const handleStopBroadcast = async () => {
    if (client) {
      await client.stopBroadcast();
      setIsLive(false);

      // Notify backend
      await fetch(`/api/sessions/${sessionId}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
    }
  };

  return (
    <div>
      <video ref={previewRef} autoPlay muted playsInline style={{ width: '100%' }} />
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div>
        {!isLive ? (
          <button onClick={handleStartBroadcast}>Go Live</button>
        ) : (
          <button onClick={handleStopBroadcast}>Stop Broadcast</button>
        )}
      </div>
    </div>
  );
}
```

### Complete Player Component

```typescript
// Source: AWS samples and IVS Player docs
// web/src/features/viewer/VideoPlayer.tsx

import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    IVSPlayer: any;
  }
}

interface VideoPlayerProps {
  playbackUrl: string;
  onViewerCountUpdate?: (count: number) => void;
}

export function VideoPlayer({ playbackUrl, onViewerCountUpdate }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [quality, setQuality] = useState<string>('auto');

  useEffect(() => {
    if (!videoRef.current || !window.IVSPlayer) return;

    // Initialize player
    const player = window.IVSPlayer.create();
    player.attachHTMLVideoElement(videoRef.current);
    playerRef.current = player;

    // Event listeners
    player.addEventListener(window.IVSPlayer.PlayerState.PLAYING, () => {
      setIsPlaying(true);
    });

    player.addEventListener(window.IVSPlayer.PlayerState.IDLE, () => {
      setIsPlaying(false);
    });

    player.addEventListener(window.IVSPlayer.PlayerState.ENDED, () => {
      setIsPlaying(false);
    });

    player.addEventListener(window.IVSPlayer.PlayerEventType.ERROR, (error: any) => {
      console.error('Player error:', error);
    });

    // Quality change listener
    player.addEventListener(window.IVSPlayer.PlayerEventType.QUALITY_CHANGED, (quality: any) => {
      setQuality(quality.name);
    });

    // Load and play
    player.load(playbackUrl);
    player.play();

    // Cleanup
    return () => {
      player.pause();
      player.delete();
    };
  }, [playbackUrl]);

  const toggleQuality = () => {
    if (!playerRef.current) return;

    if (quality === 'auto') {
      // Get available qualities
      const qualities = playerRef.current.getQualities();
      if (qualities.length > 0) {
        playerRef.current.setQuality(qualities[0]); // Set highest quality
      }
    } else {
      playerRef.current.setAutoQualityMode(true); // Back to auto
    }
  };

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline style={{ width: '100%' }} />
      <div>
        <span>Status: {isPlaying ? 'Live' : 'Offline'}</span>
        <button onClick={toggleQuality}>
          Quality: {quality} (click to toggle)
        </button>
      </div>
    </div>
  );
}
```

### EventBridge Rule (CDK)

```typescript
// Source: https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html
// infra/lib/broadcast-stack.ts

import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class BroadcastStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lambda for handling recording end
    const cleanupLambda = new lambda.Function(this, 'RecordingEndedHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'recording-ended.handler',
      code: lambda.Code.fromAsset('../backend/dist'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // EventBridge rule: Stream Start
    const streamStartRule = new events.Rule(this, 'StreamStartRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Stream State Change'],
        detail: {
          event_name: ['Stream Start'],
        },
      },
    });
    streamStartRule.addTarget(new targets.LambdaFunction(streamStartLambda));

    // EventBridge rule: Recording End
    const recordingEndRule = new events.Rule(this, 'RecordingEndRule', {
      eventPattern: {
        source: ['aws.ivs'],
        detailType: ['IVS Recording State Change'],
        detail: {
          recording_status: ['Recording End'],
        },
      },
    });
    recordingEndRule.addTarget(new targets.LambdaFunction(cleanupLambda));
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| RTMP-only ingest | RTMPS (TLS-encrypted RTMP) + WHIP | Sept 2024 | RTMPS required for browser security (HTTPS pages); WHIP for future WebRTC ingest |
| Manual HLS manifest polling | IVS Player SDK with built-in ABR | 2020 (IVS launch) | Automatic quality adaptation; no custom manifest parsing needed |
| Custom EventBridge event structure | Standardized "IVS Recording State Change" events | 2021 | Consistent event schema across all IVS features; easier integration |
| Recording toggle via API | Recording enabled only at channel creation | 2020 (IVS launch) | Must plan recording config upfront; cannot enable mid-session |
| Stream takeover disabled by default | Stream takeover with priority levels | Feb 2024 | Enables seamless encoder switching without viewer interruption |

**Deprecated/outdated:**
- **RTMP without TLS:** Modern browsers block insecure media streams; use RTMPS (port 4443)
- **Third-party HLS players for low-latency:** hls.js and video.js add 20-30s latency; IVS Player required for <5s
- **Polling GetStream for state:** Use EventBridge "Stream Start"/"Stream End" events instead; polling adds cost and latency
- **Recording to custom S3 bucket structure:** IVS Auto-Record handles folder structure, thumbnails, metadata; don't try to customize S3 layout

## Open Questions

1. **Viewer count update frequency**
   - What we know: GetStream API updates `viewerCount` within 15 seconds; CloudWatch ConcurrentViews metric available
   - What's unclear: Whether CloudWatch metric is faster than GetStream API; cost tradeoffs
   - Recommendation: Use GetStream with 15-second cache for v1; evaluate CloudWatch Metrics API if real-time accuracy critical in v2

2. **Stream key rotation for security**
   - What we know: Stream keys are static credentials; CreateChannel returns key once
   - What's unclear: Best practice for key rotation frequency; IVS doesn't support key rotation API
   - Recommendation: Accept static keys for v1; channels are single-use per session, destroyed after broadcast ends

3. **Multi-camera broadcasting**
   - What we know: IVS Web Broadcast SDK supports multiple video sources via `addVideoInputDevice`; iOS WebKit limitation on multiple video devices
   - What's unclear: Whether multi-camera works on all platforms; how to handle camera switching UX
   - Recommendation: Single camera only for Phase 3; defer multi-camera to future phase after iOS testing

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.2.0 (backend), Vitest + React Testing Library (frontend - to be added) |
| Config file | backend/jest.config.js (exists), web/vitest.config.ts (Wave 0) |
| Quick run command | `npm test -- --testPathPattern=broadcast` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BCAST-01 | User can go live with single action (startBroadcast) | integration | `npm test -- backend/src/handlers/__tests__/start-broadcast.test.ts` | ❌ Wave 0 |
| BCAST-02 | User sees self-view preview before/during broadcast | unit | `npm test -- web/src/features/broadcast/__tests__/useBroadcast.test.ts` | ❌ Wave 0 |
| BCAST-03 | Viewers can watch live broadcast with IVS Player | integration | `npm test -- web/src/features/viewer/__tests__/usePlayer.test.ts` | ❌ Wave 0 |
| BCAST-04 | Live viewer count is visible to broadcaster/viewers | integration | `npm test -- backend/src/handlers/__tests__/get-viewer-count.test.ts` | ❌ Wave 0 |
| BCAST-05 | Stream quality auto-adapts to network conditions | manual-only | N/A (IVS SDK internal behavior; verify in staging with network throttling) | N/A |
| BCAST-06 | Live indicator shows currently broadcasting sessions | integration | `npm test -- backend/src/handlers/__tests__/get-sessions.test.ts` | ❌ Wave 0 |
| POOL-06 | Resources released back to pool when sessions end | integration | `npm test -- backend/src/handlers/__tests__/recording-ended.test.ts` | ❌ Wave 0 |
| SESS-03 | Sessions clean up gracefully (stop recording, release resources) | integration | `npm test -- backend/src/handlers/__tests__/recording-ended.test.ts` | ❌ Wave 0 |
| DEV-06 | Stream MP4/MOV into broadcast via FFmpeg | manual-only | Run `scripts/test-broadcast.sh <session-id> <video.mp4>` and verify stream appears live | N/A |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=<feature>` (run affected tests only)
- **Per wave merge:** `npm test` (full backend suite; frontend tests when added)
- **Phase gate:** Full suite green + manual verification of BCAST-05 and DEV-06 before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `backend/src/handlers/__tests__/start-broadcast.test.ts` — covers BCAST-01 (returns ingest config)
- [ ] `backend/src/handlers/__tests__/stop-broadcast.test.ts` — covers session transition to ENDING
- [ ] `backend/src/handlers/__tests__/get-viewer-count.test.ts` — covers BCAST-04 (GetStream API wrapper with cache)
- [ ] `backend/src/handlers/__tests__/recording-ended.test.ts` — covers POOL-06, SESS-03 (EventBridge handler)
- [ ] `backend/src/services/__tests__/broadcast-service.test.ts` — covers GetStream caching logic
- [ ] `web/vitest.config.ts` — Vitest config for frontend testing
- [ ] `web/src/features/broadcast/__tests__/useBroadcast.test.ts` — covers BCAST-02 (mock IVS SDK)
- [ ] `web/src/features/viewer/__tests__/usePlayer.test.ts` — covers BCAST-03 (mock IVS Player)
- [ ] `scripts/test-broadcast.sh` — FFmpeg streaming script for DEV-06

## Sources

### Primary (HIGH confidence)

- [AWS IVS Low-Latency Streaming Docs](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/) - Official AWS documentation
- [AWS IVS Auto-Record to S3](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/record-to-s3.html) - Recording configuration and lifecycle
- [AWS IVS EventBridge Integration](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/eventbridge.html) - Event types and structure
- [IVS Web Broadcast SDK Getting Started](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/broadcast-web-getting-started.html) - Browser broadcast implementation
- [IVS Web Broadcast SDK Known Issues](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/broadcast-web-known-issues.html) - Platform limitations and workarounds
- [IVS Player SDK Web Guide](https://docs.aws.amazon.com/ivs/latest/LowLatencyUserGuide/player-web.html) - Viewer playback implementation
- [GetStream API Reference](https://docs.aws.amazon.com/ivs/latest/APIReference/API_GetStream.html) - Viewer count and stream state

### Secondary (MEDIUM confidence)

- [Amazon IVS Real-Time Streaming RTMP Ingest Announcement](https://aws.amazon.com/about-aws/whats-new/2024/09/amazon-ivs-real-time-streaming-rtmp-ingest/) - RTMPS support details
- [Auto Recording Amazon IVS Live Streams to S3 - DEV Community](https://dev.to/aws/auto-recording-amazon-ivs-live-streams-to-s3-m64) - Recording patterns
- [How to: Amazon IVS with React mini-player demo](https://aws.amazon.com/blogs/media/how-to-amazon-ivs-with-react-mini-player-demo/) - React integration patterns
- [Broadcast from a browser with IVS Web Broadcast SDK](https://aws.amazon.com/blogs/media/broadcast-from-a-browser-with-the-amazon-ivs-web-broadcast-sdk/) - SDK overview
- [Live Stream Viewer Analytics with Amazon IVS](https://dev.to/aws/live-stream-viewer-analytics-with-amazon-ivs-41ih) - Viewer count tracking

### Tertiary (LOW confidence)

- [WebRTC getUserMedia MDN Docs](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) - Browser API reference
- [FFmpeg RTMP Guide](https://aws.amazon.com/blogs/media/connecting-ffmpeg-using-rtmp-to-aws-media-services-in-the-cloud/) - RTMPS streaming examples

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official AWS SDKs with stable APIs; IVS Web Broadcast SDK v1.32.0 and Player SDK v1.49.0 are production-ready
- Architecture: HIGH - EventBridge-driven cleanup pattern verified in official docs; React hooks follow established best practices
- Pitfalls: HIGH - Known issues documented in official IVS docs; stream key storage, port 4443, Safari Intel issues are well-known

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - IVS is stable, but SDK versions update monthly)
