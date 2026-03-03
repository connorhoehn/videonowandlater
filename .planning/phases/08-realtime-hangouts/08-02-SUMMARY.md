---
phase: 08-realtime-hangouts
plan: 02
subsystem: frontend-hangout-ui
tags: [ui, realtime, video-grid, active-speaker, chat-integration]
dependencies:
  requires: [08-01-participant-tokens, amazon-ivs-web-broadcast-sdk]
  provides: [hangout-ui, video-grid-component, active-speaker-detection]
  affects: [web-app-routing]
tech-stack:
  added: [Web Audio API, AnalyserNode, RMS volume calculation, CSS Grid responsive layout]
  patterns: [Stage lifecycle hook, client-side speaker detection, responsive video grid]
key-files:
  created:
    - web/src/features/hangout/useHangout.ts (Stage lifecycle management hook)
    - web/src/features/hangout/useActiveSpeaker.ts (Web Audio API speaker detection)
    - web/src/features/hangout/VideoGrid.tsx (Responsive CSS Grid layout)
    - web/src/features/hangout/ParticipantTile.tsx (Individual video tile component)
    - web/src/features/hangout/HangoutPage.tsx (Main hangout container)
  modified:
    - web/src/App.tsx (Added /hangout/:sessionId route)
decisions:
  - Client-side active speaker detection using Web Audio API (sufficient for visual indicator without ML)
  - Limit grid to 5 participants desktop / 3 mobile (prevents layout complexity)
  - Responsive CSS Grid with dynamic column count (2 for 1-2 participants, 3 for 3+)
  - Green border visual indicator for active speaker (200ms transition for smooth effect)
  - Reuse ChatPanel component from Phase 4 (no hangout-specific chat UI needed)
metrics:
  duration: 120
  tasks: 6
  completed: 2026-03-03T14:06:50Z
---

# Phase 8 Plan 2: Multi-Participant Hangout UI Summary

Multi-participant hangout UI with responsive video grid, Web Audio API active speaker detection, mute/camera controls, and integrated chat.

## Overview

Created complete RealTime hangout UI that enables users to join IVS Stage sessions with up to 5 simultaneous participants (desktop) or 3 (mobile), see who's speaking via green border visual indicators, control their audio/video streams, and chat alongside video. The implementation mirrors BroadcastPage.tsx patterns for consistency and reuses the existing ChatPanel component.

## Implementation Details

### Task 1: useHangout Stage Lifecycle Hook
**Commit:** 1d3ec2f

Created React hook following useBroadcast.ts pattern for Stage lifecycle management:
- Fetches participant token from POST /sessions/{sessionId}/join endpoint
- Creates Stage instance with StageStrategy (publish/subscribe AUDIO_VIDEO for all participants)
- Handles getUserMedia to access camera (720p ideal) and microphone
- Manages Stage event listeners for PARTICIPANT_JOINED, PARTICIPANT_LEFT, STREAMS_CHANGED
- Provides toggleMute() and toggleCamera() functions via MediaStream track.enabled
- Cleans up Stage instance and media tracks on unmount

**Key pattern:** Mirror useBroadcast.ts but adapt for Stage APIs instead of Channel APIs.

### Task 2: useActiveSpeaker Web Audio API Detection
**Commit:** d4b0395

Implemented client-side active speaker detection without ML:
- Creates AudioContext and AnalyserNode for each participant's audio stream
- Polls audio levels every 100ms using getFloatTimeDomainData()
- Calculates RMS volume: sqrt(sum(dataArray[i]^2) / length)
- Converts to dB: 20 * log10(rms)
- Returns participantId of loudest participant above -40dB threshold
- Cleans up AudioContexts on unmount or participant changes

**Why this approach:** Simple, performant, sufficient for visual indicator (green border on loudest participant). No ML model needed for basic active speaker highlighting.

### Task 3: VideoGrid and ParticipantTile Components
**Commit:** 97d54f2

Created responsive video layout components:

**VideoGrid.tsx:**
- Detects mobile viewport (< 768px) and limits to 3 participants (5 on desktop)
- Calculates dynamic grid columns: 2 for 1-2 participants, 3 for 3+
- Uses CSS Grid with `display: grid`, `gridTemplateColumns: repeat(N, 1fr)`, 16px gap
- Maps visible participants to ParticipantTile components

**ParticipantTile.tsx:**
- Renders video element with participant's MediaStream attached
- Shows green border when isSpeaking=true: `3px solid #10b981` vs `1px solid #374151`
- Includes 200ms transition for smooth border color change
- Displays participant userId label with "(You)" for local participant
- Mutes local video to prevent echo

**Design choice:** Inline styles for dynamic values (gridTemplateColumns, border color), Tailwind for static layout.

### Task 4: HangoutPage Container Component
**Commit:** 618732b

Created main hangout page mirroring BroadcastPage.tsx structure:
- Extracts sessionId from route params
- Calls useHangout() for Stage lifecycle and participant state
- Calls useActiveSpeaker() to get activeSpeakerId
- Merges activeSpeakerId into participants array using useMemo
- Renders responsive layout: 2/3 video section + 1/3 chat section on desktop, stacked on mobile
- Includes mute/camera control buttons below video grid
- Integrates ChatPanel component with sessionId prop (reuses existing Phase 4 component)
- Shows loading state "Joining hangout..." while !isJoined
- Displays error message if useHangout returns error

**Layout pattern:** `flex flex-col md:flex-row` for responsive desktop/mobile switching.

### Task 5: Route Integration
**Commit:** c19f895

Added /hangout/:sessionId route to App.tsx:
- Imported HangoutPage component
- Added route inside ProtectedRoute wrapper (requires authentication)
- Placed after /broadcast/:sessionId route for consistency

### Task 6: Human Verification Checkpoint
**Status:** PASSED (user-approved)

User verified multi-participant hangout UI in two browser windows:
- Video grid displays multiple participants correctly
- Active speaker detection works (green border on speaking participant)
- Mute/camera controls functional
- Chat integration working via ChatPanel
- Responsive layout adjusts to viewport width

## Deviations from Plan

None - plan executed exactly as written. All tasks completed without auto-fixes or additional work.

## Key Decisions

1. **Client-side active speaker detection:** Used Web Audio API with RMS volume calculation instead of ML model. Sufficient for visual indicator (green border on loudest participant). Avoids server-side processing and model deployment complexity.

2. **Participant limit (5 desktop / 3 mobile):** Prevents layout complexity and maintains usable tile sizes. Future enhancement could add pagination or scrolling for larger groups.

3. **Dynamic grid columns:** 2 columns for 1-2 participants, 3 columns for 3+. Balances tile size with grid density.

4. **Green border active speaker indicator:** Simple, clear visual cue. 200ms transition prevents jarring border flicker during silence gaps.

5. **Reuse ChatPanel component:** No hangout-specific chat UI needed. Existing ChatPanel works identically for hangouts and broadcasts.

## Technical Notes

### Web Audio API Integration
- AudioContext lifecycle managed per participant (created/closed when participants join/leave)
- AnalyserNode configuration: fftSize=512, smoothingTimeConstant=0.8
- 100ms polling interval balances responsiveness with CPU usage
- RMS-to-dB conversion: `20 * Math.log10(rms)` with -40dB threshold

### CSS Grid Responsive Layout
- Dynamic column calculation prevents awkward single-column layouts for 2 participants
- 16:9 aspect ratio maintained via `aspectRatio: '16/9'` CSS property
- Gap and padding ensure tiles don't touch edges

### Stage Lifecycle Pattern
- Mirrors useBroadcast.ts hook structure for consistency
- Cleanup in useEffect return ensures Stage.leave() called on unmount
- MediaStream tracks stopped to release camera/mic permissions

### Mobile Considerations
- Viewport detection via window.innerWidth < 768
- Resize listener updates mobile state dynamically
- ChatPanel shown as overlay on mobile (button to toggle)
- Video grid stacks vertically via flex-col

## Verification Results

All automated verification passed:
- TypeScript compiles without errors
- All 5 component files exist
- Route /hangout/:sessionId present in App.tsx
- Stage.join() usage confirmed in useHangout.ts
- AnalyserNode usage confirmed in useActiveSpeaker.ts
- ChatPanel integration confirmed in HangoutPage.tsx

Manual verification confirmed:
- Multi-participant video grid displays correctly (2 browser windows tested)
- Active speaker detection highlights speaking participant with green border
- Mute/camera controls work as expected
- Chat messages synchronized between participants
- Responsive layout switches correctly at mobile breakpoint
- Participant leave event updates grid

## Requirements Satisfied

This plan satisfies the following requirements:
- HANG-01: Multi-participant video grid UI
- HANG-05: Active speaker visual indicator
- HANG-06: Mute audio control
- HANG-07: Camera on/off control
- HANG-08: Responsive layout (desktop/mobile)
- HANG-09: Chat integration with existing ChatPanel
- HANG-10: Participant join/leave notifications
- HANG-11: Video grid responsive column layout
- HANG-12: Stage lifecycle management via useHangout hook
- HANG-13: Web Audio API active speaker detection

## What's Next

With hangout UI complete, Phase 8 Plan 3 will implement hangout session creation flow:
- UI components for creating new hangout sessions
- Integration with backend POST /sessions endpoint
- Navigation to /hangout/:sessionId after session creation
- Invite link generation for sharing hangout sessions

## Self-Check: PASSED

**Files exist:**
```
FOUND: web/src/features/hangout/useHangout.ts
FOUND: web/src/features/hangout/useActiveSpeaker.ts
FOUND: web/src/features/hangout/VideoGrid.tsx
FOUND: web/src/features/hangout/ParticipantTile.tsx
FOUND: web/src/features/hangout/HangoutPage.tsx
FOUND: web/src/App.tsx (modified)
```

**Commits exist:**
```
FOUND: 1d3ec2f (Task 1: useHangout hook)
FOUND: d4b0395 (Task 2: useActiveSpeaker hook)
FOUND: 97d54f2 (Task 3: VideoGrid and ParticipantTile)
FOUND: 618732b (Task 4: HangoutPage container)
FOUND: c19f895 (Task 5: /hangout/:sessionId route)
```

All claimed files and commits verified successfully.
