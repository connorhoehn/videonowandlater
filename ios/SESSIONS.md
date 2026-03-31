# VideoNowAndLater iOS App — Session Handoff
_Created: 2026-03-29_

---

## What's Built

| # | File | Location | Status |
|---|------|----------|--------|
| 1 | `VideoNowAndLaterApp.swift` | App/ | Done |
| 2 | `AppEnvironment.swift` | App/ | Done |
| 3 | `ColorAssets.swift` | App/ | Done |
| 4 | `Constants.swift` | Config/ | Done (placeholders) |
| 5 | `Session.swift` | Models/ | Done |
| 6 | `ParticipantData.swift` | Models/ | Done |
| 7 | `APIClient.swift` | Networking/ | Done (7 endpoints) |
| 8 | `SessionFeedViewModel.swift` | ViewModels/ | Done |
| 9 | `ReplayViewModel.swift` | ViewModels/ | Done |
| 10 | `PlayerModel.swift` | ViewModels/ | Done |
| 11 | `ChatViewModel.swift` | ViewModels/ | Done |
| 12 | `BroadcastViewModel.swift` | ViewModels/ | Done |
| 13 | `HangoutViewModel.swift` | ViewModels/ | Done |
| 14 | `FeedView.swift` | Views/Feed/ | Done |
| 15 | `SessionCard.swift` | Views/Feed/ | Done |
| 16 | `LoginView.swift` | Views/Feed/ | Done (placeholder auth) |
| 17 | `ReplayView.swift` | Views/Replay/ | Done |
| 18 | `TranscriptPanel.swift` | Views/Replay/ | Done |
| 19 | `SummaryPanel.swift` | Views/Replay/ | Done |
| 20 | `ChatView.swift` | Views/Chat/ | Done |
| 21 | `SimpleChatView.swift` | Views/Chat/ | Done |
| 22 | `MessageBubble.swift` | Views/Chat/ | Done |
| 23 | `MessageActionsView.swift` | Views/Chat/ | Done |
| 24 | `BroadcastSetupView.swift` | Views/Broadcast/ | Done |
| 25 | `BroadcastView.swift` | Views/Broadcast/ | Done |
| 26 | `BroadcastPreviewView.swift` | Views/Broadcast/ | Done |
| 27 | `StreamQualityHUD.swift` | Views/Broadcast/ | Done |
| 28 | `HangoutView.swift` | Views/Hangout/ | Done |
| 29 | `ParticipantsGridView.swift` | Views/Hangout/ | Done |
| 30 | `ControlButtonsDrawer.swift` | Views/Components/ | Done |
| 31 | `ConfirmDialog.swift` | Views/Components/ | Done |
| 32 | `IVSPlayerView.swift` | Views/Components/ | Done (`PlayerContainerView`) |
| 33 | `PipelineStatusBadge.swift` | Views/Components/ | Done |
| 34 | `OrientationObserver.swift` | Views/Components/ | Done |
| 35 | `AdaptivePlayerView.swift` | Views/Components/ | Done |
| 36 | `RemoteImageView.swift` | Views/Components/ | Done |
| 37 | `LoadingView.swift` | Views/Components/ | Done |
| 38 | `EmptyStateView.swift` | Views/Components/ | Done |
| 39 | `Package.swift` | ios/ | Done (SPM deps) |
| 40 | `README.md` | ios/ | Done |

**All 38 Swift files complete + Package.swift + README.md.**

---

## Architecture

```
VideoNowAndLaterApp (@main)
├── LoginView (placeholder — replace with ASWebAuthenticationSession)
└── FeedView (NavigationStack)
    ├── SessionCard (thumbnail, title, badges)
    ├── → ReplayView (ended sessions)
    │   ├── PlayerContainerView (IVSPlayer UIViewRepresentable)
    │   ├── SummaryPanel (3 states: loading/available/failed)
    │   └── TranscriptPanel (click-to-seek speaker segments)
    ├── → BroadcastSetupView → BroadcastView (BROADCAST mode)
    │   ├── BroadcastPreviewView (camera UIViewRepresentable)
    │   ├── SimpleChatView overlay
    │   ├── StreamQualityHUD
    │   └── ControlButtonsDrawer (mic/camera/stop)
    └── → HangoutView (HANGOUT mode)
        ├── ParticipantsGridView (1-4+ participant layout)
        ├── SimpleChatView overlay
        └── ControlButtonsDrawer (mic/camera/leave)
```

---

## Shared State

- **`AppEnvironment`** — injected as `@EnvironmentObject` throughout. Holds `idToken`, `username`, `isAuthenticated`.
- **`APIClient`** — stateless, created per-ViewModel. All calls require `authToken` parameter (`Authorization: Bearer`).
- **`Constants`** — `apiUrl`, `awsRegion`, `userPoolId`, `clientId` (all placeholders — fill before first run).

---

## SPM Dependencies (in Package.swift)

| Package | Version | Used For |
|---------|---------|----------|
| `amazon-ivs-player-ios-sdk-dist` | >= 1.40.0 | Replay playback (`IVSPlayer`) |
| `amazon-ivs-broadcast-sdk-ios-dist` | >= 1.36.0 | Broadcast (`IVSBroadcastSession`) + Hangout (`IVSStage`) |
| `amazon-ivs-chat-messaging-ios-sdk-dist` | >= 1.0.1 | Chat (`ChatRoom`, `ChatMessage`) |

---

## Backend Endpoints Used

| iOS Method | HTTP | Path | Backend Handler |
|-----------|------|------|-----------------|
| `listSessions` | GET | `/sessions` | `list-sessions` |
| `getSession` | GET | `/sessions/:id` | `get-session` |
| `createSession` | POST | `/sessions` | `create-session` |
| `joinHangout` | POST | `/sessions/:id/join` | `join-hangout` |
| `createChatToken` | POST | `/sessions/:id/chat-token` | `create-chat-token` |
| `addComment` | POST | `/sessions/:id/comments` | `add-comment` |
| `getSpeakerSegments` | GET | `/sessions/:id/speaker-segments` | **New — needs backend endpoint** |

---

## What Still Needs Work

### Before First Build (Xcode Setup)
1. Create an Xcode project (File → New → App, SwiftUI, iOS 16+)
2. Drag the `VideoNowAndLater/` folder into the project navigator
3. Add SPM packages (File → Add Package Dependencies → paste URLs from Package.swift)
4. Set your Team and Bundle Identifier in Signing & Capabilities
5. Fill in `Constants.swift` with your real API Gateway URL and Cognito IDs

### Auth (Session 1 — Replace Placeholder)
- Replace `LoginView`'s placeholder button with `ASWebAuthenticationSession`
- Flow: Cognito Hosted UI → redirect URI → parse `id_token` from URL fragment
- Set `env.setSession(idToken: realToken, username: parsedUsername)`

### Backend Gaps
| Gap | Priority | Work |
|-----|----------|------|
| Speaker segments endpoint | High | `GET /sessions/:id/speaker-segments` Lambda or extend `get-session` |
| `list-sessions` pagination | Medium | Cursor-based pagination for mobile scroll |
| Device token registration | Low | `POST /device-token` for push notifications |
| Push notification Lambda | Low | SNS → APNs triggered by pipeline events |

### iOS-Specific Polish (Future)
- Offline transcript caching (`FileManager` + cache key by sessionId)
- Push notifications (APNs registration + backend integration)
- Timed metadata chapters (IVSPlayer delegate `didReceiveTimedMetadata`)
- Deep links (open specific session from notification)

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SwiftUI (not UIKit/RN) | Direct access to IVS Broadcast SDK, matches AWS demo patterns |
| SPM (not CocoaPods) | Simpler dependency management, all 3 IVS SDKs have SPM distributions |
| `PlayerContainerView` name | Avoids naming conflict with UIKit's `IVSPlayerView` |
| `Color(hex:)` extension | Used across all views for consistent dark theme without Asset Catalog setup |
| `@MainActor` on ViewModels | Required for `@Published` properties updated from async contexts |
| `APIClient.send()` is `internal` | Allows ViewModels to call custom endpoints without adding wrapper methods |
| Polling with exponential backoff | Matches web app pattern (15s → 30s → 60s) for non-terminal sessions |

---

## Web Frontend Polish (Also Done This Session)

In parallel with the iOS build, the web app received UI polish across all features:

- **Session Feed** — Shimmer loading skeletons, pipeline status badges with animated ping dots, LIVE pulse, thumbnail fallbacks
- **Replay Player** — Fade-in state transitions, active segment pulse glow, click-to-seek with visual feedback, smooth tab transitions
- **Chat** — Message entrance animations, emoji-only detection, backdrop-blur panels, pure CSS floating reactions (replaced framer-motion)
- **Broadcast** — SVG icons replacing emoji, glass morphism controls, LIVE pill with glow, slide-up animations
- **Hangout** — Emerald ring speaking indicator, Tailwind grid layouts, tile-enter animations, backdrop-blur name badges
- **Shared** — Unified `index.css` with 12 custom animations, polished `ConfirmDialog` with backdrop blur

All 160 web tests pass. TypeScript compiles clean.
