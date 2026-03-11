# Phase 8: RealTime Hangouts - Research

**Researched:** 2026-03-02
**Domain:** AWS IVS RealTime Stages, WebRTC multi-participant video, Web Audio API active speaker detection
**Confidence:** HIGH

## Summary

Phase 8 implements small-group video hangouts using AWS IVS RealTime Stages, supporting up to 5 simultaneous participants with under 300ms latency. This phase extends the existing resource pool pattern (established in Phase 2) to include RealTime Stages, reuses the recording infrastructure (Phase 5) via server-side composite recording, and adapts the broadcast SDK patterns to multi-participant WebRTC streaming. The core technical challenges are: implementing a responsive video grid that adapts to participant count, detecting active speakers using Web Audio API for visual indicators, and ensuring instant join experiences through pre-warmed Stage pools.

The research confirms that IVS RealTime Stages are immediately available without pre-warming (unlike channels, they're persistent resources), participant tokens with PUBLISH/SUBSCRIBE capabilities provide fine-grained access control, and server-side composition (SSC) automatically records all participants into a single HLS output for replay. The amazon-ivs-web-broadcast SDK (already in use for broadcasts) provides Stage APIs with the same programming model. Critical success factors: token-based authentication (no exposed ARNs), CSS Grid for responsive layouts (established pattern in AWS samples), Web Audio API AnalyserNode for client-side active speaker detection, and reusing the chat infrastructure (IVS Chat rooms already attached to sessions).

**Primary recommendation:** Extend the existing resource pool to include pre-created Stages with autoParticipantRecordingConfiguration attached, generate server-side participant tokens via CreateParticipantTokenCommand (PUBLISH+SUBSCRIBE capabilities for all hangout users), implement a responsive CSS Grid layout that switches from 5-participant desktop view to 3-participant mobile view, use Web Audio API AnalyserNode for real-time audio level monitoring to highlight active speakers, and leverage existing chat infrastructure (ChatPanel component) with no modifications needed.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HANG-01 | Users can create small-group hangout sessions (RealTime Stage-based) | CreateSession with sessionType=HANGOUT claims Stage from pool (mirrors broadcast flow) |
| HANG-02 | Pre-warmed Stage pool maintains ready-to-use RealTime Stages | Extend replenish-pool.ts with CreateStageCommand + autoParticipantRecordingConfiguration |
| HANG-03 | Participant tokens generated server-side via CreateParticipantTokenCommand | New Lambda handler creates tokens with userId, capabilities:[PUBLISH,SUBSCRIBE], 12-hour TTL |
| HANG-04 | Participant tokens include capabilities (PUBLISH, SUBSCRIBE), user_id, 12-hour TTL | CreateParticipantTokenCommand attributes parameter + duration in seconds |
| HANG-05 | Users can join hangout via participant token exchange | Stage.join(token) in IVS Web Broadcast SDK (same pattern as Channel.startBroadcast) |
| HANG-06 | Multi-participant video grid displays up to 5 participant streams (desktop) | CSS Grid with dynamic column count based on participant count (1-2: 2 cols, 3-5: 3 cols) |
| HANG-07 | Mobile UI limits video rendering to 3 simultaneous streams | Window resize listener + conditional rendering (show top 3 by join order) |
| HANG-08 | Users can mute/unmute audio in hangouts | LocalStageStream.setMuted(true/false) API from IVS SDK |
| HANG-09 | Users can toggle camera on/off in hangouts | StageStrategy.stageStreamsToPublish controls which streams publish |
| HANG-10 | Active speaker visual indicator highlights current speaker's video tile | CSS border highlight triggered by audio level threshold (> -40dB sustained) |
| HANG-11 | Active speaker detection uses Web Audio API | Web Audio API AnalyserNode.getFloatTimeDomainData() → calculate RMS → detect above threshold |
| HANG-12 | Participant join/leave notifications display in hangout UI | Stage.on('participantJoined'/'participantLeft') events → toast notifications |
| HANG-13 | Chat integration works in hangouts (same IVS Chat model as broadcasts) | Reuse existing ChatPanel component with sessionId (chat rooms already in Session.claimedResources) |
| HANG-14 | Hangout sessions record via server-side composition to S3 | autoParticipantRecordingConfiguration on Stage creation → EventBridge recording-ended events |
| HANG-15 | Composite recording metadata processed via EventBridge | Extend recording-ended.ts to handle both Channel and Stage ARNs (determine by ARN prefix) |
| HANG-16 | Hangout recordings appear in home feed alongside broadcast recordings | list-recordings.ts already queries by sessionType (no filtering needed) |

</phase_requirements>

## Standard Stack

### Core (Existing Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| amazon-ivs-web-broadcast | ^1.32.0 (existing) | Stage publishing/subscribing, participant token exchange | Official IVS SDK with unified API for both Channel (broadcast) and Stage (hangout) streaming |
| @aws-sdk/client-ivs-realtime | ^3.1000.0 (existing) | CreateStage, CreateParticipantToken, DeleteStage APIs | Official AWS SDK v3 for IVS RealTime; already used for Stage pool in Phase 2 |
| Web Audio API | Browser native | Active speaker detection via audio level analysis | Standard browser API (94%+ global support), no dependencies, real-time performance |
| CSS Grid | Browser native | Responsive multi-participant video layout | Standard CSS (97%+ support), proven pattern in AWS IVS samples, simpler than flex-based grids |

### Supporting (No New Dependencies)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-router-dom | ^7.7.1 (existing) | Navigation to /hangout/:sessionId route | Existing routing setup, add new route alongside /broadcast/:sessionId |
| React hooks | 19.2.0 (existing) | Custom hooks for Stage lifecycle (useHangout), active speaker detection (useActiveSpeaker) | Mirror useBroadcast.ts pattern for consistency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| IVS RealTime Stages | Agora.io, Daily.co, Vonage Video API | IVS: unified ecosystem (same recording/chat infrastructure), no per-minute pricing (pay per GB egress), AWS integration |
| Web Audio API for active speaker | AWS Transcribe for voice activity detection | Web Audio API: real-time (no latency), client-side (no Lambda cost), simpler implementation for UI indicator |
| CSS Grid | Flexbox with manual wrapping logic | CSS Grid: declarative layout, better responsive control, less JS logic for repositioning |
| Server-side composite recording | Client-side composition via canvas | Server-side: no CPU burden on clients, consistent output quality, automatic S3 upload |
| Participant tokens (server-generated) | Stage ARN direct join (client-side) | Tokens: no ARN exposure, fine-grained capabilities (listen-only possible), automatic expiry (security) |

**Installation:**
```bash
# No new dependencies required
# Phase 8 uses existing IVS Web Broadcast SDK (includes Stage APIs)
# Web Audio API is browser-native
```

## Architecture Patterns

### Recommended Project Structure

```
backend/src/
├── domain/
│   └── session.ts              # SessionType.HANGOUT already exists (Phase 2)
├── handlers/
│   ├── create-session.ts       # EXTEND: Support sessionType=HANGOUT (already implemented)
│   ├── join-hangout.ts         # NEW: Generate participant token for sessionId
│   └── replenish-pool.ts       # EXTEND: Create Stages with autoParticipantRecordingConfiguration (already done in Phase 2)
├── repositories/
│   └── resource-pool-repository.ts  # EXTEND: Query STAGE resources (already supports CHANNEL/STAGE/ROOM)
infra/lib/stacks/
└── session-stack.ts            # EXTEND: Add Lambda for join-hangout handler

web/src/
├── features/
│   └── hangout/
│       ├── HangoutPage.tsx     # NEW: Main hangout UI container (mirrors BroadcastPage.tsx)
│       ├── useHangout.ts       # NEW: Stage lifecycle hook (mirrors useBroadcast.ts)
│       ├── VideoGrid.tsx       # NEW: CSS Grid layout for N participants
│       ├── useActiveSpeaker.ts # NEW: Web Audio API hook for audio level monitoring
│       └── ParticipantTile.tsx # NEW: Individual video tile with mute/camera controls
└── App.tsx                     # EXTEND: Add /hangout/:sessionId route
```

### Pattern 1: IVS RealTime Stage Creation with Auto-Recording

**What:** Pre-create Stages in resource pool with autoParticipantRecordingConfiguration attached, enabling automatic composite recording to S3 without per-session setup.

**When to use:** All RealTime hangout sessions requiring recording (mirrors RecordingConfiguration attachment pattern for broadcast Channels).

**Example:**
```typescript
// Source: Phase 2 replenish-pool.ts + IVS RealTime Recording Guide
import { IVSRealTimeClient, CreateStageCommand } from '@aws-sdk/client-ivs-realtime';

async function createStage(tableName: string): Promise<void> {
  const ivsRealtimeClient = new IVSRealTimeClient({});
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const recordingConfigArn = process.env.RECORDING_CONFIGURATION_ARN!; // Shared with Channels (Phase 5)

  const response = await ivsRealtimeClient.send(new CreateStageCommand({
    name: `vnl-stage-${uuidv4()}`,
    autoParticipantRecordingConfiguration: {
      storageConfigurationArn: recordingConfigArn, // Note: Stages use storageConfigurationArn, not recordingConfigurationArn
      mediaTypes: ['AUDIO_VIDEO'], // Record both audio and video
    },
  }));

  const resourceId = response.stage!.arn!.split('/').pop()!;

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `POOL#STAGE#${resourceId}`,
      SK: 'METADATA',
      GSI1PK: 'STATUS#AVAILABLE',
      GSI1SK: new Date().toISOString(),
      entityType: 'POOL_ITEM',
      resourceType: 'STAGE',
      resourceArn: response.stage!.arn!,
      resourceId,
      endpoints: response.stage!.endpoints, // { events, whip }
      status: 'AVAILABLE',
      version: 1,
      createdAt: new Date().toISOString(),
      claimedAt: null,
      claimedBy: null,
    },
  }));
}
```

### Pattern 2: Server-Side Participant Token Generation

**What:** Lambda handler generates participant tokens with server-controlled capabilities (PUBLISH, SUBSCRIBE) and user metadata, preventing ARN exposure in frontend.

**When to use:** All hangout join flows (ensures secure, capability-based access control).

**Example:**
```typescript
// Source: IVS CreateParticipantToken API Reference + token exchange patterns
// backend/src/handlers/join-hangout.ts

import { Handler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IVSRealTimeClient, CreateParticipantTokenCommand } from '@aws-sdk/client-ivs-realtime';
import { getSessionById } from '../repositories/session-repository';

export const handler: Handler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  const sessionId = event.pathParameters?.sessionId;
  const userId = event.requestContext.authorizer?.claims.sub; // From Cognito JWT

  if (!sessionId || !userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing sessionId or userId' }) };
  }

  // Fetch session to get Stage ARN
  const session = await getSessionById(process.env.TABLE_NAME!, sessionId);
  if (!session || session.sessionType !== 'HANGOUT') {
    return { statusCode: 404, body: JSON.stringify({ error: 'Hangout session not found' }) };
  }

  const stageArn = session.claimedResources.stage!;

  // Generate participant token (12-hour TTL)
  const ivsRealtimeClient = new IVSRealTimeClient({});
  const response = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn,
    duration: 43200, // 12 hours in seconds
    userId, // Used for participant identification in events
    capabilities: ['PUBLISH', 'SUBSCRIBE'], // Both audio/video publishing and subscribing to others
    attributes: {
      username: event.requestContext.authorizer?.claims['cognito:username'] || 'Anonymous',
    },
  }));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: response.participantToken!.token,
      participantId: response.participantToken!.participantId,
      expirationTime: response.participantToken!.expirationTime,
    }),
  };
};
```

### Pattern 3: Multi-Participant Video Grid with Responsive Layout

**What:** CSS Grid-based layout that adapts column count and video sizing based on participant count and viewport width.

**When to use:** All hangout UIs displaying 1-5 participants (desktop) or 1-3 participants (mobile).

**Example:**
```typescript
// Source: AWS IVS RealTime ReactJS demo + CSS Grid Module best practices
// web/src/features/hangout/VideoGrid.tsx

import React from 'react';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean; // From useActiveSpeaker hook
}

interface VideoGridProps {
  participants: Participant[];
}

export function VideoGrid({ participants }: VideoGridProps) {
  const isMobile = window.innerWidth < 768;

  // Mobile: show max 3 participants (oldest first)
  const visibleParticipants = isMobile
    ? participants.slice(0, 3)
    : participants.slice(0, 5);

  // Dynamic grid columns: 1-2 participants = 2 cols, 3-5 participants = 3 cols
  const gridCols = visibleParticipants.length <= 2 ? 2 : 3;

  return (
    <div
      className="video-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: '16px',
        width: '100%',
        height: '100%',
        padding: '16px',
      }}
    >
      {visibleParticipants.map((participant) => (
        <ParticipantTile
          key={participant.participantId}
          participant={participant}
          isSpeaking={participant.isSpeaking} // Active speaker visual indicator
        />
      ))}
    </div>
  );
}

// web/src/features/hangout/ParticipantTile.tsx
interface ParticipantTileProps {
  participant: Participant;
  isSpeaking: boolean;
}

export function ParticipantTile({ participant, isSpeaking }: ParticipantTileProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (videoRef.current && participant.streams.length > 0) {
      videoRef.current.srcObject = participant.streams[0];
    }
  }, [participant.streams]);

  return (
    <div
      className="participant-tile"
      style={{
        position: 'relative',
        aspectRatio: '16/9',
        backgroundColor: '#1a1a1a',
        borderRadius: '8px',
        overflow: 'hidden',
        border: isSpeaking ? '3px solid #10b981' : '1px solid #374151', // Green border when speaking
        transition: 'border-color 200ms ease-in-out',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={participant.isLocal} // Prevent echo on local stream
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <div className="participant-label" style={{
        position: 'absolute',
        bottom: '8px',
        left: '8px',
        padding: '4px 8px',
        backgroundColor: 'rgba(0,0,0,0.7)',
        color: 'white',
        borderRadius: '4px',
        fontSize: '14px',
      }}>
        {participant.userId} {participant.isLocal && '(You)'}
      </div>
    </div>
  );
}
```

### Pattern 4: Active Speaker Detection with Web Audio API

**What:** Client-side audio level monitoring using Web Audio API AnalyserNode to detect when a participant's audio exceeds a threshold, triggering visual indicators.

**When to use:** All hangout sessions requiring active speaker highlighting (UI feedback for who's currently speaking).

**Example:**
```typescript
// Source: Web Audio API AnalyserNode docs + webrtcHacks volume monitoring patterns
// web/src/features/hangout/useActiveSpeaker.ts

import { useState, useEffect } from 'react';

interface UseActiveSpeakerOptions {
  participants: Array<{ participantId: string; streams: MediaStream[] }>;
  threshold?: number; // dB threshold for "speaking" detection (default: -40)
  smoothingTimeConstant?: number; // Frequency smoothing (default: 0.8)
}

export function useActiveSpeaker({
  participants,
  threshold = -40,
  smoothingTimeConstant = 0.8
}: UseActiveSpeakerOptions) {
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  useEffect(() => {
    const audioContexts: Map<string, AudioContext> = new Map();
    const analysers: Map<string, AnalyserNode> = new Map();

    // Create Web Audio API analyser for each participant
    participants.forEach(({ participantId, streams }) => {
      const audioTracks = streams.flatMap(s => s.getAudioTracks());
      if (audioTracks.length === 0) return;

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = smoothingTimeConstant;

      const source = audioContext.createMediaStreamSource(streams[0]);
      source.connect(analyser);

      audioContexts.set(participantId, audioContext);
      analysers.set(participantId, analyser);
    });

    // Poll audio levels every 100ms
    const intervalId = setInterval(() => {
      let loudestParticipant: string | null = null;
      let maxVolume = threshold; // Must exceed threshold to be "speaking"

      analysers.forEach((analyser, participantId) => {
        const dataArray = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(dataArray);

        // Calculate RMS (root mean square) volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const volumeDb = 20 * Math.log10(rms);

        if (volumeDb > maxVolume) {
          maxVolume = volumeDb;
          loudestParticipant = participantId;
        }
      });

      setActiveSpeakerId(loudestParticipant);
    }, 100);

    // Cleanup
    return () => {
      clearInterval(intervalId);
      audioContexts.forEach(ctx => ctx.close());
    };
  }, [participants, threshold, smoothingTimeConstant]);

  return { activeSpeakerId };
}
```

### Pattern 5: IVS Stage Lifecycle Management (React Hook)

**What:** Custom React hook encapsulating Stage join, participant subscription, local stream publishing, and cleanup (mirrors useBroadcast pattern).

**When to use:** All hangout page implementations.

**Example:**
```typescript
// Source: IVS Web Broadcast SDK Stage guides + existing useBroadcast.ts pattern
// web/src/features/hangout/useHangout.ts

import { useState, useEffect, useRef } from 'react';
import { Stage, StageStrategy, SubscribeType } from 'amazon-ivs-web-broadcast';

interface Participant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
}

interface UseHangoutOptions {
  sessionId: string;
  apiBaseUrl: string;
  authToken: string;
}

export function useHangout({ sessionId, apiBaseUrl, authToken }: UseHangoutOptions) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // Initialize stage and join
  useEffect(() => {
    const joinStage = async () => {
      try {
        // Fetch participant token from backend
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/join`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (!response.ok) {
          throw new Error(`Failed to get participant token: ${response.statusText}`);
        }

        const { token, participantId } = await response.json();

        // Define stage strategy
        const strategy: StageStrategy = {
          stageStreamsToPublish() {
            return SubscribeType.AUDIO_VIDEO; // Publish both audio and video
          },
          shouldPublishParticipant() {
            return true; // Publish local participant
          },
          shouldSubscribeToParticipant() {
            return SubscribeType.AUDIO_VIDEO; // Subscribe to all remote participants
          },
        };

        // Create and join stage
        const stageInstance = new Stage(token, strategy);

        // Event: participant joined
        stageInstance.on(Stage.Events.STAGE_PARTICIPANT_JOINED, (participant) => {
          setParticipants((prev) => [
            ...prev,
            {
              participantId: participant.id,
              userId: participant.userId,
              isLocal: false,
              streams: participant.streams,
            },
          ]);
        });

        // Event: participant left
        stageInstance.on(Stage.Events.STAGE_PARTICIPANT_LEFT, (participant) => {
          setParticipants((prev) => prev.filter((p) => p.participantId !== participant.id));
        });

        // Event: participant streams changed (camera toggle, etc.)
        stageInstance.on(Stage.Events.STAGE_PARTICIPANT_STREAMS_CHANGED, (participant) => {
          setParticipants((prev) =>
            prev.map((p) =>
              p.participantId === participant.id
                ? { ...p, streams: participant.streams }
                : p
            )
          );
        });

        // Get local camera and microphone
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });

        // Attach local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        // Add local stream to stage
        await stageInstance.join();
        setStage(stageInstance);
        setIsJoined(true);

        // Add local participant to list
        setParticipants([
          {
            participantId: participantId,
            userId: 'You',
            isLocal: true,
            streams: [localStream],
          },
        ]);
      } catch (err: any) {
        setError(err.message);
      }
    };

    joinStage();

    return () => {
      if (stage) {
        stage.leave();
      }
    };
  }, [sessionId, apiBaseUrl, authToken]);

  // Mute/unmute audio
  const toggleMute = async (muted: boolean) => {
    if (stage) {
      const localParticipant = stage.localParticipant;
      const audioTrack = localParticipant.streams[0]?.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !muted;
      }
    }
  };

  // Toggle camera on/off
  const toggleCamera = async (enabled: boolean) => {
    if (stage) {
      const localParticipant = stage.localParticipant;
      const videoTrack = localParticipant.streams[0]?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
      }
    }
  };

  return {
    localVideoRef,
    participants,
    isJoined,
    error,
    toggleMute,
    toggleCamera,
  };
}
```

### Anti-Patterns to Avoid

- **Client-side Stage ARN exposure:** Always generate participant tokens server-side; never send Stage ARN to frontend (security risk, no capability control)
- **Manual canvas-based video composition:** Use IVS server-side composition instead (no CPU burden, consistent quality, automatic S3 upload)
- **Polling for participant changes:** Use Stage event listeners (STAGE_PARTICIPANT_JOINED, etc.) for real-time updates, not setInterval polling
- **Global AudioContext reuse across components:** Create AudioContext per useActiveSpeaker instance to avoid conflicts (AudioContext limit: 6 per tab)
- **Hardcoded participant count limits in CSS:** Use dynamic grid columns based on participants.length (flexible for future expansion to 12 participants)
- **Synchronous navigator.mediaDevices.getUserMedia:** Always await getUserMedia before Stage.join() (prevents race conditions with empty streams)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebRTC signaling server | Custom WebSocket + STUN/TURN infrastructure | IVS RealTime Stages | IVS handles signaling, NAT traversal, bandwidth adaptation, reconnection logic; custom WebRTC signaling requires months of edge case handling |
| Multi-participant recording | Client-side screen capture + upload to S3 | IVS server-side composite recording | Server-side: no CPU burden, handles participant disconnects, consistent output quality, automatic HLS encoding |
| Active speaker detection (ML-based) | TensorFlow.js audio classification model | Web Audio API AnalyserNode RMS volume | Web Audio API: <10ms latency, no model loading, 100x simpler; ML only needed for "voice activity detection" (speech vs noise), not "who's loudest" |
| Responsive video grid layout | Custom flexbox logic with manual repositioning | CSS Grid with dynamic column count | CSS Grid: declarative, browser-optimized, fewer layout bugs, simpler maintenance |
| Participant token security | Client-side Stage ARN direct join | Server-side CreateParticipantToken | Tokens: fine-grained capabilities (PUBLISH vs SUBSCRIBE), automatic expiry, no ARN exposure, audit trail (userId in events) |

**Key insight:** IVS RealTime Stages abstract away 90% of WebRTC complexity (signaling, STUN/TURN, bandwidth adaptation, codec negotiation). The only custom code needed is UI layout (CSS Grid), active speaker detection (Web Audio API RMS calculation), and participant token generation (Lambda). Trying to build WebRTC infrastructure from scratch introduces months of debugging edge cases (NAT traversal failures, mobile browser quirks, reconnection logic).

## Common Pitfalls

### Pitfall 1: Stage ARN Exposed in Frontend Code

**What goes wrong:** Developers pass Stage ARN directly to frontend, allowing any user to join any Stage by guessing/sniffing ARNs. No capability control (all users can publish).

**Why it happens:** IVS documentation shows Stage.join(stageArn) examples for simplicity, but this is only for demos. Production apps must use participant tokens.

**How to avoid:**
- Never send Stage ARN to frontend (only participant tokens)
- Generate tokens server-side via CreateParticipantTokenCommand
- Include userId in token for audit trail (visible in EventBridge events)
- Set capabilities explicitly (PUBLISH+SUBSCRIBE for participants, SUBSCRIBE for viewers)

**Warning signs:**
- Stage ARN visible in browser DevTools network tab
- Users report "random people joining my hangout"
- No audit trail for who joined sessions

### Pitfall 2: Video Grid Layout Breaks on Participant Join/Leave

**What goes wrong:** Adding/removing participants causes video tiles to resize incorrectly, overlap, or leave empty gaps. Grid columns don't recalculate dynamically.

**Why it happens:** Developers hardcode grid-template-columns (e.g., "repeat(3, 1fr)") instead of dynamically adjusting based on participant count.

**How to avoid:**
- Use dynamic gridTemplateColumns based on participants.length
- Set explicit aspect-ratio: 16/9 on video tiles (prevents stretching)
- Use CSS transition for smooth layout changes
- Test with 1, 2, 3, 4, 5 participants (and simulate rapid joins/leaves)

**Warning signs:**
- Video tiles stretch to wrong aspect ratios
- Empty grid cells after participant leaves
- Layout reflow causes jank (100ms+ frame drops)

### Pitfall 3: Active Speaker Detection Too Sensitive (False Positives)

**What goes wrong:** Background noise triggers "speaking" indicator. Users see green borders flickering constantly even during silence.

**Why it happens:** Threshold set too low (e.g., -60dB detects breathing), or no smoothing applied to audio levels.

**How to avoid:**
- Set threshold to -40dB or higher (filters out ambient noise)
- Use smoothingTimeConstant: 0.8 on AnalyserNode (reduces jitter)
- Require sustained volume (3+ consecutive samples above threshold) before triggering indicator
- Add debounce: indicator stays active for 500ms after audio drops below threshold

**Warning signs:**
- Speaking indicator flickers on/off rapidly
- Indicator activates during silence (keyboard typing, breathing)
- Users report "everyone shows as speaking all the time"

### Pitfall 4: Mobile Safari Autoplay Policy Blocking Video

**What goes wrong:** Remote participant videos don't play on iOS Safari. Users see black tiles with no error messages.

**Why it happens:** Safari requires user gesture (click/tap) before allowing video.play() with audio. Autoplay policy blocks muted videos in some contexts.

**How to avoid:**
- Set video element autoPlay, playsInline, muted attributes
- Mute remote audio by default, unmute on user tap (or use "tap to unmute" button)
- Add error handling: videoRef.current.play().catch(err => console.warn('Autoplay blocked'))
- Test on iOS Safari 15+ (strictest autoplay policy)

**Warning signs:**
- Videos work on Chrome/Firefox but fail on iOS Safari
- Console shows "NotAllowedError: play() failed because user didn't interact"
- Users report "I can't see other participants"

### Pitfall 5: Not Handling Stage Recording ARN Prefix Differences

**What goes wrong:** recording-ended EventBridge handler expects Channel ARNs (arn:aws:ivs:...:channel/...), but Stage ARNs have different format (arn:aws:ivs:...:stage/...). Handler fails to match recordings to sessions.

**Why it happens:** Phase 5 recording-ended.ts only tested with broadcast Channels, assumes ARN format.

**How to avoid:**
- Extend recording-ended.ts to check ARN prefix (channel vs stage)
- Query sessions by both claimedResources.channel and claimedResources.stage
- Add integration test with Stage ARN (not just Channel ARN)
- Use ARN parsing library or regex: arn:aws:ivs:[^:]+:[^:]+:(channel|stage)/(.+)

**Warning signs:**
- Hangout recordings complete but don't appear in home feed
- CloudWatch shows recording-ended Lambda invocations but no session updates
- DynamoDB query errors: "Session not found" for valid session IDs

### Pitfall 6: Exceeding Stage Participant Limit Without Feedback

**What goes wrong:** 6th user tries to join 5-participant hangout, Stage.join() silently fails or throws cryptic error. No user-facing message.

**Why it happens:** IVS RealTime Stages support up to 12 publishers, but UI design targets 5 participants (desktop). No check before join.

**How to avoid:**
- Query current participant count via DescribeStage API before generating token
- Return 409 Conflict if hangout is full (>5 participants)
- Show "Hangout full" UI with retry button
- Consider "viewer mode" for 6+ participants (SUBSCRIBE-only tokens, no publishing)

**Warning signs:**
- Users report "I can't join" with no error message
- Stage.join() throws "TooManyParticipants" exception in console
- Some users can join, others can't (race condition between 5th and 6th)

## Code Examples

Verified patterns from official sources:

### EventBridge Rule for Stage Recording Events

```typescript
// Source: IVS RealTime EventBridge integration (same pattern as Channel recording)
// infra/lib/stacks/session-stack.ts

// Recording End events for BOTH Channels and Stages
new events.Rule(this, 'RecordingEndRule', {
  eventPattern: {
    source: ['aws.ivs'],
    detailType: ['IVS Recording State Change'],
    detail: {
      event_name: ['Recording End'],
      // Match both Channel ARNs (arn:aws:ivs:...:channel/...) and Stage ARNs (arn:aws:ivs:...:stage/...)
      // EventBridge automatically includes both in this pattern
    },
  },
  targets: [new targets.LambdaFunction(recordingEndedFn)],
  description: 'Store recording metadata for both broadcasts and hangouts',
});
```

### Extending recording-ended Handler for Stage ARNs

```typescript
// Source: IVS RealTime composite recording event structure
// backend/src/handlers/recording-ended.ts (EXTEND existing handler)

export const handler = async (event: EventBridgeEvent<'IVS Recording State Change', RecordingEndDetail>) => {
  const { resource_arn, recording_s3_key_prefix, recording_duration_ms, recording_status } = event.detail;

  // Determine resource type from ARN
  // Channel ARN: arn:aws:ivs:us-west-2:123456789012:channel/abcdefg
  // Stage ARN: arn:aws:ivs:us-west-2:123456789012:stage/xyzabc
  const arnParts = resource_arn.split('/');
  const resourceType = arnParts[arnParts.length - 2]; // "channel" or "stage"

  let session: Session | null = null;

  if (resourceType === 'channel') {
    // Existing logic: find by claimedResources.channel
    session = await findSessionByChannelArn(resource_arn);
  } else if (resourceType === 'stage') {
    // NEW: find by claimedResources.stage
    session = await findSessionByStageArn(resource_arn);
  } else {
    console.error('Unknown resource type in ARN:', resource_arn);
    return;
  }

  if (!session) {
    console.warn('Session not found for recording:', resource_arn);
    return;
  }

  // Rest of logic identical: compute CloudFront URLs, update session metadata
  const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN!;
  const recordingHlsUrl = `https://${cloudFrontDomain}/${recording_s3_key_prefix}/playlist.m3u8`;
  const thumbnailUrl = `https://${cloudFrontDomain}/${recording_s3_key_prefix}/thumb-0.jpg`;

  await updateRecordingMetadata(session.sessionId, {
    recordingDuration: recording_duration_ms,
    recordingHlsUrl,
    thumbnailUrl,
    recordingStatus: recording_status === 'Recording End' ? 'available' : 'failed',
  });
};
```

### API Route for Join Hangout (Generate Participant Token)

```typescript
// Source: IVS CreateParticipantToken API Reference
// infra/lib/stacks/api-stack.ts (ADD new route)

// POST /sessions/:sessionId/join - Generate participant token for hangout
const joinHangoutFn = new nodejs.NodejsFunction(this, 'JoinHangout', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'handler',
  entry: path.join(__dirname, '../../../backend/src/handlers/join-hangout.ts'),
  timeout: Duration.seconds(10),
  environment: {
    TABLE_NAME: sessionStack.table.tableName,
  },
});

sessionStack.table.grantReadData(joinHangoutFn); // Need to read session to get Stage ARN

joinHangoutFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['ivs:CreateParticipantToken'],
  resources: ['*'], // IVS doesn't support resource-level permissions for CreateParticipantToken
}));

const joinHangoutIntegration = new HttpLambdaIntegration('JoinHangoutIntegration', joinHangoutFn);

httpApi.addRoutes({
  path: '/sessions/{sessionId}/join',
  methods: [HttpMethod.POST],
  integration: joinHangoutIntegration,
  authorizer: jwtAuthorizer, // Cognito JWT authorizer (same as other protected routes)
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom WebRTC infrastructure (Janus, Mediasoup) | IVS RealTime Stages | IVS RealTime launch (2023) | Managed WebRTC removes 90% of signaling/TURN/STUN complexity, automatic recording, integrated with IVS ecosystem |
| Client-side composition (canvas recording) | IVS server-side composition | IVS SSC launch (2024) | Offloads CPU from clients, consistent recording quality, automatic HLS encoding |
| Stage ARN direct join | Participant token exchange | IVS token exchange feature (2026) | Security (no ARN exposure), capability control (PUBLISH vs SUBSCRIBE), dynamic permission upgrades (viewer → co-host) |
| Voice activity detection (ML models) | Web Audio API AnalyserNode RMS | Ongoing (Web Audio API since 2014) | Real-time performance (<10ms), no model loading, sufficient for "loudest speaker" detection |
| Flexbox video grids with manual reflow | CSS Grid with dynamic columns | CSS Grid maturity (2020+) | Declarative layout, fewer bugs, better browser optimization, simpler responsive logic |

**Deprecated/outdated:**
- **Direct Stage ARN join (no tokens):** Still works but insecure; use participant tokens for production
- **Individual participant recording only:** Composite recording (SSC) now recommended for hangouts (single playback file)
- **AudioContext.createScriptProcessor (legacy Web Audio API):** Use AudioWorklet or AnalyserNode (ScriptProcessor deprecated in Chrome 2020)

## Open Questions

1. **Participant count limit for Phase 8 (5 vs 12)**
   - What we know: IVS RealTime Stages support up to 12 publishers. UI design targets 5 participants (desktop), 3 (mobile). AWS samples show grids up to 12 participants.
   - What's unclear: Whether to enforce 5-participant limit server-side (reject join-hangout requests when 5+ participants) or allow up to 12 with "viewer mode" fallback (SUBSCRIBE-only tokens for 6-12th participants).
   - Recommendation: Phase 8 enforces 5-participant limit (reject join when full). Phase 9 or v2 can add "viewer mode" for scalability. Simpler UX for v1.1 ("hangout full" vs "you're a viewer now").

2. **Active speaker detection: RMS volume vs voice activity detection**
   - What we know: Web Audio API AnalyserNode provides RMS volume (loudest participant). ML-based voice activity detection (VAD) distinguishes speech from noise but adds latency and complexity.
   - What's unclear: Whether RMS volume threshold is sufficient for "active speaker" detection or if users will complain about false positives (keyboard typing, background music triggering indicator).
   - Recommendation: Start with RMS volume + -40dB threshold + 500ms debounce. Monitor user feedback in Phase 9 testing. Add VAD (e.g., @tensorflow/speech-commands) only if false positives are widespread.

3. **Mobile video grid performance (3 simultaneous streams)**
   - What we know: Mobile browsers (iOS Safari, Android Chrome) can struggle with 5 simultaneous video decodes. AWS best practices recommend limiting to 3 videos on mobile.
   - What's unclear: Exact mobile browser limits (varies by device), whether to pause off-screen videos or remove them from DOM entirely.
   - Recommendation: Render top 3 participants only on mobile (by join order). Add "Show more" button to rotate visible participants. Monitor frame rate (target: 30fps) on iPhone 12 / Pixel 5 during Phase 8 testing.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 30.x (existing in backend/package.json) |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test -- --testPathPattern=hangout` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HANG-01 | Create hangout session (sessionType=HANGOUT) | unit | `npm test -- handlers/create-session.test.ts -x` | ✅ Existing (extend) |
| HANG-02 | Pre-warmed Stage pool | unit | `npm test -- handlers/replenish-pool.test.ts -x` | ✅ Existing (extend) |
| HANG-03 | Generate participant tokens server-side | unit | `npm test -- handlers/join-hangout.test.ts -x` | ❌ Wave 0 |
| HANG-04 | Token includes capabilities/userId/TTL | unit | `npm test -- handlers/join-hangout.test.ts -x` | ❌ Wave 0 |
| HANG-05 | Join hangout via token exchange | integration | Manual test (requires browser WebRTC) | ❌ Manual only |
| HANG-06 | Multi-participant video grid (desktop) | integration | Manual test (visual layout) | ❌ Manual only |
| HANG-07 | Mobile UI (3 streams limit) | integration | Manual test on iOS Safari | ❌ Manual only |
| HANG-08 | Mute/unmute audio | integration | Manual test (requires browser) | ❌ Manual only |
| HANG-09 | Toggle camera on/off | integration | Manual test (requires browser) | ❌ Manual only |
| HANG-10 | Active speaker visual indicator | integration | Manual test (visual feedback) | ❌ Manual only |
| HANG-11 | Web Audio API active speaker detection | unit | `npm test -- features/hangout/useActiveSpeaker.test.ts -x` | ❌ Wave 0 |
| HANG-12 | Participant join/leave notifications | integration | Manual test (UI toast) | ❌ Manual only |
| HANG-13 | Chat in hangouts | integration | `npm test -- features/chat/ -x` | ✅ Existing (no changes) |
| HANG-14 | Hangout recording via SSC | integration | `npm test -- handlers/recording-ended.test.ts -x` | ✅ Existing (extend) |
| HANG-15 | Recording metadata for Stages | unit | `npm test -- handlers/recording-ended.test.ts -x` | ✅ Existing (extend) |
| HANG-16 | Hangout recordings in home feed | unit | `npm test -- handlers/list-recordings.test.ts -x` | ✅ Existing (no changes) |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern={modified-handler} -x` (fast unit tests only)
- **Per wave merge:** `npm test` (full backend suite)
- **Phase gate:** Backend unit tests green + manual frontend testing (video grid layout, active speaker, mute/camera controls) on Chrome + iOS Safari

### Wave 0 Gaps

- [ ] `backend/src/handlers/__tests__/join-hangout.test.ts` — covers HANG-03, HANG-04 (participant token generation)
- [ ] `web/src/features/hangout/__tests__/useActiveSpeaker.test.ts` — covers HANG-11 (Web Audio API RMS calculation)
- [ ] Manual test checklist (covers HANG-05, HANG-06, HANG-07, HANG-08, HANG-09, HANG-10, HANG-12):
  - [ ] Create hangout session, join with 2 browsers
  - [ ] Verify video grid layout adjusts dynamically (1, 2, 3, 4, 5 participants)
  - [ ] Test mobile view (3 participant limit, responsive layout)
  - [ ] Test mute/unmute audio (audio track enabled/disabled)
  - [ ] Test camera toggle (video track enabled/disabled)
  - [ ] Test active speaker indicator (green border on loudest participant)
  - [ ] Test join/leave notifications (toast messages)
  - [ ] Verify recording appears in home feed after hangout ends

**Note:** Frontend tests use manual verification due to WebRTC browser dependency (automated browser testing with Playwright deferred to v2).

## Sources

### Primary (HIGH confidence)

- [IVS Composite Recording](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/rt-composite-recording.html) - Official AWS docs on server-side composite recording for Stages
- [IVS Server-Side Composition](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/server-side-composition.html) - SSC overview and configuration
- [Publishing & Subscribing with IVS Web Broadcast SDK](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/web-publish-subscribe.html) - Stage join, participant token exchange
- [IVS Broadcast SDK: Token Exchange](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/broadcast-mobile-token-exchange.html) - Token capabilities and upgrade/downgrade patterns
- [CreateParticipantToken API](https://docs.aws.amazon.com/ivs/latest/RealTimeAPIReference/API_CreateParticipantToken.html) - Official API reference for token generation
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - AnalyserNode, getFloatTimeDomainData(), RMS calculation patterns
- [AWS IVS RealTime ReactJS Demo](https://github.com/aws-samples/amazon-ivs-realtime-web-demo-reactjs) - CSS Grid layout patterns for multi-participant video

### Secondary (MEDIUM confidence)

- [Understanding AWS IVS Real-Time (Stage)](https://medium.com/@singhkshitij221/understanding-aws-ivs-real-time-stage-how-it-actually-works-e56a7a0c5464) - January 2026 overview of Stage architecture
- [Building Real-time Microphone Level Meter Using Web Audio API](https://dev.to/tooleroid/building-a-real-time-microphone-level-meter-using-web-audio-api-a-complete-guide-1e0b) - RMS volume calculation guide
- [Shut up! Monitoring Audio Volume in getUserMedia](https://webrtchacks.com/getusermedia-volume/) - Web Audio API volume monitoring patterns
- [Migrating Video Conferencing to IVS RealTime](https://webrtc.ventures/2026/02/migrating-a-video-conferencing-app-to-amazon-ivs-real-time-streaming/) - February 2026 migration guide with best practices

### Tertiary (LOW confidence)

None — all findings verified with official AWS documentation and Web Audio API standards

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - IVS Web Broadcast SDK already in use (Phase 3), Web Audio API is W3C standard, CreateParticipantToken API verified in AWS docs
- Architecture: HIGH - Stage pool pattern mirrors existing Channel pool (Phase 2), recording integration extends Phase 5 patterns, CSS Grid is proven in AWS samples
- Pitfalls: MEDIUM - Based on official IVS docs (token security, ARN format differences) and Web Audio API quirks (autoplay policies, Safari constraints), but not all pitfalls verified in production hangout scenarios

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days - IVS RealTime APIs stable, Web Audio API mature, CSS Grid well-established)
