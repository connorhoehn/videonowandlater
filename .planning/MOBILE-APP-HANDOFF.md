# Mobile App — Exploration & Planning Handoff
_Created: 2026-03-29_

## Context

This document captures ideas surfaced during a research session covering:
- The existing transcoding → transcription → AI pipeline (fully functional, 496 tests passing)
- AWS IVS iOS demo repos: chat (`amazon-ivs-chat-for-ios-demo`) and multi-host (`amazon-ivs-multi-host-for-ios-demo`)
- AWS IVS ecommerce blog post (timed metadata / product carousel patterns)

The web app (React + Vite) is at v1.7, 90% complete. The backend is production-ready on AWS.

---

## What the IVS Demo Repos Reveal

### Multi-Host Demo — Key Patterns
- **`IVSStage` + `IVSStageStrategy`**: strategy object makes per-participant subscribe/publish decisions — this is the iOS equivalent of your existing HANGOUT mode backend
- **`IVSBroadcastSession` + mixer slots**: up to N participant video streams are mixed into a single broadcast output — relevant for creator spotlight feature on mobile
- **`BroadcastDelegate`**: implements `IVSBroadcastSession.Delegate`, emits `isBroadcasting` state via `DispatchQueue.main.async` with weak self
- **`StageViewModel`**: central state object tracking `participantsData`, `localUserAudioMuted`, `localUserVideoMuted`, `broadcastSlots` — maps well onto your existing session/participant model
- **`ParticipantsGridView`**: dynamic grid layout for 1–N participants, tap-to-dismiss keyboard, corner radius 40pt
- **`ControlButtonsDrawer`**: collapsible bottom tray for mic/camera/broadcast toggles — expands on tap, collapses when grid is tapped
- **Request-to-join flow**: stage has a separate "request" path before granting publish permission

### Chat Demo — Key Patterns
- **WebSocket endpoint**: `wss://edge.ivschat.<region>.amazonaws.com` — your backend already issues chat tokens
- **Message types**: plain text, emojis, stickers — each renders differently in the list
- **Moderation**: admin can delete specific messages or remove users — maps to your Phase 28 chat moderation backend
- **User identity**: entered on first chat interaction (name prompt) — your app uses Cognito username instead

### Ecommerce Demo — Key Patterns
- **`PutMetadata` API**: sends <1KB JSON payload synced to the stream, received by all viewers simultaneously regardless of latency
- **`isFeatured` flag**: indicates which product is on-screen right now — usable for any "pin current moment" pattern
- **DynamoDB + metadata IDs**: store rich objects in DB, send only IDs in timed metadata — keeps payload under 1KB
- **Portrait + landscape stream configs**: two separate playback URLs, app detects orientation

---

## Tasks to Explore & Plan

### 1. iOS App Bootstrapping
**Explore first:**
- Clone `amazon-ivs-multi-host-for-ios-demo` and run it locally to understand the SDK setup (CocoaPods, `API_URL` config, physical device requirement for camera)
- Map your existing Lambda endpoints (create-session, join-hangout, get-chat-token, list-sessions) to what the iOS app will call
- Decide: SwiftUI (both demos use it) vs React Native. SwiftUI gives direct access to IVS Broadcast SDK; RN requires a native module bridge.

**Plan:**
- New iOS Xcode project with `AmazonIVS` pod + `AWSIVSBroadcast` pod
- `Constants.swift` pointing at your existing API Gateway URL
- Auth: Cognito SDK for iOS (Amplify or direct) to get `idToken` for `Authorization: Bearer` headers
- Skeleton navigation: Home → Session Feed → Broadcast / Hangout / Replay / VideoPage

---

### 2. Session Feed (Home Screen)
**Explore first:**
- Your `list-sessions` API response shape — what fields are available for thumbnail, duration, status, title
- Activity card polling logic (already in web: 15s → 30s → 60s exponential backoff)

**Plan:**
- `UICollectionView` or SwiftUI `LazyVGrid` of session cards
- Each card: thumbnail (from `thumbnailUrl`), duration (`formatHumanDuration`), pipeline status badge (`transcribing` / `summarizing` / `complete` / `failed`)
- Background polling for non-terminal sessions (match web logic)
- Pull-to-refresh

---

### 3. Live Broadcast (BROADCAST mode)
**Explore first:**
- `IVSBroadcastSession` setup from multi-host demo — device discovery, mixer config, preset quality
- Your `create-session` + stream key flow — what the mobile app needs to start a broadcast
- Portrait-only vs landscape: decide early (affects entire app layout)

**Plan:**
- Camera preview using `IVSBroadcastSession` device discovery
- Stream quality HUD (bitrate, FPS, network) — backend already has this in Phase 23; expose via API or IVS SDK metrics callback
- `ControlButtonsDrawer` pattern: mic toggle, camera toggle, stop broadcast button
- `ConfirmDialog` before ending (already built in web Phase 41-02)
- Push notification when recording is ready (post-broadcast)

---

### 4. Hangout (HANGOUT mode / IVS Stage)
**Explore first:**
- `IVSStage` + `IVSStageStrategy` from multi-host demo — understand `shouldPublish`, `shouldSubscribeTo`, `didSubscribeTo` lifecycle
- Your `join-hangout` Lambda — what token/stage ARN it returns
- Request-to-join flow in the demo — matches your existing participant model

**Plan:**
- `StageViewModel` equivalent wrapping your session/participant state
- `ParticipantsGridView` layout (1, 2, 3–4 participants)
- Mic/camera mute per-participant
- Leave confirmation dialog
- Reactions overlay (floating emojis) — Phase 41-02 already built this in web

---

### 5. IVS Chat on Mobile
**Explore first:**
- Your `create-chat-token` Lambda response — what fields the iOS WebSocket needs (`chatWebsocket` URL, `token`)
- The IVS Chat SDK for iOS (`AmazonIVSChat` pod) vs raw WebSocket — SDK wraps connection lifecycle

**Plan:**
- `ChatManager` wrapping the WebSocket connection (see chat demo pattern)
- Message list: `LazyVStack` in a `ScrollView`, auto-scroll to bottom on new message
- Input bar: text field + send button, emoji picker button
- Sticker support (optional — match web capability)
- Admin moderation: long-press a message → delete / ban user (uses your Phase 28 backend)

---

### 6. Replay Player
**Explore first:**
- `IVSPlayer` SDK for iOS — plays `.m3u8` HLS URLs directly
- Your `get-session` API: what fields are available (recordingHlsUrl, transcript, speakerSegments, aiSummary)

**Plan:**
- `AVPlayerViewController` or `IVSPlayer` view playing `recordingHlsUrl`
- Transcript panel below: speaker segments, tap-to-seek (set `player.seek(to:)`)
- AI summary panel: 3 states — spinner, formatted text, error (match web Phase 40 pattern)
- Timestamped comment thread with click-to-seek

---

### 7. Timed Metadata → Chapter Markers
**Explore first:**
- `IVSPlayer` iOS delegate method `player(_:didReceiveTimedMetadata:)` — fires in sync with video
- Your transcript speaker segments — already have timestamps, usable as chapter boundaries

**Plan:**
- During live broadcast: broadcaster sends `PutMetadata` with `{ "chapter": "Q&A starts", "ts": <epoch> }` via a host UI button
- During replay: inject synthetic metadata events from stored speaker segments at their timestamps
- Mobile player shows a chapter list (bottom sheet) + progress bar markers

---

### 8. Push Notifications (APNs)
**Explore first:**
- Your existing EventBridge events — `Transcript Stored` and `aiSummaryStatus: available` already fire
- AWS SNS → APNs integration (or Amazon Pinpoint for richer targeting)

**Plan:**
- New Lambda `send-push-notification` triggered by `Transcript Stored` and `AI Summary Available` events
- SNS topic with APNs platform application
- iOS: register device token on app launch, send to your backend (store on user record in DynamoDB)
- Notification payload: "Your recording from [session title] is ready — transcript and summary available"

---

### 9. Portrait/Landscape Adaptive Layout
**Explore first:**
- Ecommerce demo's two stream config approach (portrait URL vs landscape URL)
- iOS `UIDevice.current.orientation` + `ViewGeometry` in SwiftUI for reactive layout

**Plan:**
- Broadcast page: portrait = tall camera preview with controls below; landscape = full-screen with floating controls
- Replay page: portrait = player + transcript panel stacked; landscape = player full-screen, transcript in side panel
- Use `GeometryReader` + `.onReceive(NotificationCenter.publisher(for: UIDevice.orientationDidChangeNotification))` pattern

---

### 10. Offline Transcript Caching
**Explore first:**
- Your `get-session` API — does it return the full transcript or just a status + S3 URI?
- If S3 URI only: add a Lambda endpoint that returns a signed URL for the speaker segments JSON

**Plan:**
- On first replay open: fetch transcript, write to `FileManager` cache keyed by `sessionId`
- On subsequent opens: load from cache, skip network fetch
- Cache invalidation: compare `transcriptStatus` timestamp; bust cache if session was reprocessed
- Show "Available offline" badge on feed cards with cached transcripts

---

## Recommended Starting Order

1. **Bootstrap + Auth** — get the Xcode project running, Cognito login, API calls working
2. **Session Feed** — confirms end-to-end connectivity before any live video
3. **Replay Player** — lowest risk (no broadcast SDK), validates IVS playback + transcript display
4. **Chat** — add WebSocket chat to replay first, then live sessions
5. **Live Broadcast** — requires physical device, most complex
6. **Hangout** — builds on Broadcast SDK knowledge
7. **Push Notifications** — backend addition, testable without mobile UI changes
8. **Timed Metadata chapters** — polish layer on top of replay
9. **Offline caching** — polish layer
10. **Orientation layout** — final polish pass

---

## Backend Gaps to Address Before Mobile

| Gap | Work Required |
|-----|---------------|
| Device token registration | New `POST /device-token` endpoint + user record field |
| Push notification Lambda | New handler triggered by pipeline events |
| Signed URL for transcript S3 | Either extend `get-session` or add `GET /session/:id/transcript-url` |
| `list-sessions` pagination | Mobile feed needs cursor-based pagination for scroll |
| Session title field | Currently may not be set — needs broadcaster input at session start |

---

## Key Files for Mobile Auth Reference

- `backend/src/handlers/create-session.ts` — uses `cognito:username` as userId
- `backend/src/handlers/create-chat-token.ts` — chat token generation
- `backend/src/handlers/join-hangout.ts` — returns IVS Stage token
- All require `Authorization: Bearer ${idToken}` header
