# iOS App UI Enhancements
_Enhanced: 2026-03-29_

All enhancements sourced from 4 official AWS IVS demo repos:
- [amazon-ivs-ecommerce-ios-demo](https://github.com/aws-samples/amazon-ivs-ecommerce-ios-demo)
- [amazon-ivs-feed-ios-demo](https://github.com/aws-samples/amazon-ivs-feed-ios-demo)
- [amazon-ivs-multi-host-for-ios-demo](https://github.com/aws-samples/amazon-ivs-multi-host-for-ios-demo)
- [sample-amazon-ivs-real-time-screenshare-for-ios-demo](https://github.com/aws-samples/sample-amazon-ivs-real-time-screenshare-for-ios-demo)

---

## Summary of Changes

| Area | Files Changed | Files Created | Source Demo |
|------|--------------|--------------|-------------|
| Video Player | 2 | 0 | Ecommerce + Feed |
| Feed/Navigation | 2 | 0 | Feed |
| Broadcast | 3 | 0 | Ecommerce + Multi-host |
| Hangout | 3 | 0 | Multi-host |
| Chat | 3 | 0 | Multi-host |
| Replay | 2 | 0 | Screenshare |
| New Components | 0 | 4 | All demos |
| Models | 1 | 0 | — |

**Total: 16 files modified, 4 files created**

---

## New Components Created

### 1. FloatingHeartsView.swift
**Source:** Feed demo's `HeartView.swift` (UIKit → SwiftUI port)

TikTok-style floating hearts:
- Random color palette (5 vibrant colors: pink, red, purple, yellow, cyan)
- Spring bloom animation (0.4s response, 0.6 damping)
- Cubic bezier curve path upward with randomized control points
- Fade + shrink over 3 seconds
- `HeartFactory.create(in: size)` generates hearts at the bottom-right

Used in: `LiveViewerView`, `HangoutView`

### 2. ZoomableContainer.swift
**Source:** Screenshare demo's `ZoomableFullscreenPreviewView.swift`

Pinch-to-zoom + drag + double-tap container:
- `MagnificationGesture` + `DragGesture` combined via `SimultaneousGesture`
- Double-tap toggles between 1x and 4x zoom with spring animation
- Drag only enabled when zoomed in (scale > 1)
- Resets to origin on zoom-out

Used in: `ReplayView` fullscreen mode

### 3. GradientOverlay.swift
**Source:** Feed + Ecommerce demos' `CAGradientLayer` patterns

Three reusable components:
- `TopGradientOverlay` — black-to-clear, protects status bar
- `BottomGradientOverlay` — clear-to-black, protects bottom content
- `StreamInfoPill` — circular avatar + title + LIVE badge in a capsule

Used in: `BroadcastView`, `LiveViewerView`

### 4. NotificationBanner.swift
**Source:** Multi-host demo's notification system

In-app notification banners:
- Success (green) / Error (red) / Warning (yellow) types
- Auto-dismiss: 5s for success, 8s for errors
- Tap to dismiss
- Stacked with spring animations
- Color-coded icon + border

---

## Enhanced Files — Detail

### PlayerModel.swift (ViewModels/)
**Before:** 33 lines, bare-bones — load, play on ready, error print
**After:** ~175 lines with:
- `AVAudioSession.setCategory(.playback)` — audio with ringer off *(ecommerce demo)*
- Background/foreground lifecycle — pause on background, resume on foreground *(ecommerce + feed)*
- Position + duration tracking with 0.5s timer
- `isLive` detection (duration == 0 or infinite)
- Play/pause toggle with `togglePlayPause()`
- Seek to position + relative seek (±Ns)
- Controls auto-hide timer (4s, resets on interaction)
- Buffering state tracking (`isBuffering`)
- Error state with message
- Adaptive video gravity detection (`isPortraitContent`) *(feed demo)*
- Timed metadata JSON decoding (`IVSTextMetadataCue`) *(ecommerce demo)*

### IVSPlayerView.swift (Views/Components/)
**Before:** 21 lines, basic `UIViewRepresentable`
**After:** ~270 lines with `PlayerContainerView` + `RichPlayerView`:
- Adaptive video gravity (aspect fill for portrait, aspect for landscape) *(feed demo)*
- Full controls overlay with auto-show/hide *(ecommerce demo)*
- Top + bottom gradient overlays for text readability *(feed demo)*
- Center play/pause button with spring scale animation
- Seek bar with drag-to-seek gesture
- Position/duration display (monospaced)
- Double-tap left/right to seek ±10s with flash indicators
- LIVE badge (top-left) for live streams *(ecommerce demo)*
- Buffering spinner overlay *(ecommerce demo)*
- Error state display
- Fullscreen toggle button

### FeedView.swift (Views/Feed/)
**Before:** Placeholder "Coming Soon" destinations
**After:**
- Real navigation: `ReplayView` for ended, `HangoutView` for live hangouts, `LiveViewerView` for live broadcasts
- Shimmer loading skeleton with animated gradient *(new)*
- `BroadcastSetupView` wired to toolbar button
- Uses `Color.appBackground`/`Color.appBackgroundList` named colors
- New `LiveViewerView` component:
  - Full-screen player with `RichPlayerView`
  - `StreamInfoPill` overlay (top-left)
  - Chat overlay at bottom
  - Engagement buttons (heart, share) on right side *(feed demo)*
  - `FloatingHeartsView` integration
  - Chat input bar

### SessionCard.swift (Views/Feed/)
**Before:** Basic thumbnail + title + LIVE badge
**After:**
- Type badge (BROADCAST blue / HANGOUT purple / UPLOAD orange)
- Animated LIVE pulse dot
- Participant count for hangouts
- Duration overlay on thumbnail (compact format)
- Improved placeholder icons per session type
- Chevron indicator
- Better visual hierarchy

### BroadcastView.swift (Views/Broadcast/)
**Before:** Basic camera preview + simple controls
**After:**
- `TopGradientOverlay` + `BottomGradientOverlay` *(feed demo)*
- Chat overlay wired to real `SimpleChatView` (was placeholder)
- Camera flip button (`swapCamera()`) *(multi-host demo)*
- Chat toggle button
- Duration timer pill (HH:MM:SS)
- Animated LIVE pill with red glow shadow
- `confirmationDialog` instead of alert for stop action
- Color-coded mute buttons (red when active)

### BroadcastViewModel.swift (ViewModels/)
- Added `swapCamera()` — toggles front/back camera *(multi-host demo)*

### StreamQualityHUD.swift (Views/Broadcast/)
**Before:** Plain monospaced text
**After:**
- Color-coded health dot (green ≥80, yellow ≥50, red <50)
- Capsule pill style with rounded corners

### HangoutView.swift (Views/Hangout/)
**Before:** Basic grid + simple controls drawer
**After:**
- Camera flip button *(multi-host demo)*
- Participant management sheet (tap count badge to open) *(multi-host demo)*
  - Scrollable participant list with avatars
  - Mute state indicators per participant
  - "(You)" label for local user
  - Tap-outside to dismiss
- Chat toggle button
- Heart reaction button with `FloatingHeartsView`
- Leave button styled as phone-down pill
- Better header with count badge
- Removed dependency on generic `ControlButtonsDrawer` — inline custom controls

### HangoutViewModel.swift (ViewModels/)
- Added `swapCamera()` — toggles front/back camera *(multi-host demo)*

### ParticipantsGridView.swift (Views/Hangout/)
**Before:** Basic grid with fallback icon
**After:**
- Avatar circle fallback with deterministic colors from username hash *(multi-host demo)*
- Name badge with `.ultraThinMaterial` backdrop blur *(multi-host demo)*
- Audio mute indicator (red mic.slash pill) *(multi-host demo)*
- Video mute indicator
- Speaking indicator: green border on tile when not muted *(inspired by multi-host demo)*
- Spring layout animation when participant count changes
- "(You)" suffix on local participant name
- Connecting state with spinner
- Reduced corner radius (40→24) for modern feel

### ChatView.swift (Views/Chat/)
**Before:** Basic input + messages
**After:**
- Quick reaction bar (6 emoji: 👋🔥❤️😂👏🎉) above input
- Tap messages area to dismiss keyboard *(multi-host demo)*
- `.ultraThinMaterial` on connection banner
- Cleaner structure with extracted sub-views

### SimpleChatView.swift (Views/Chat/)
**Before:** Basic ScrollView with message list
**After:**
- Message entrance animation (slide up 30px + fade in with spring) *(multi-host demo)*
- Chat gradient at top for smooth fade effect
- Smoother auto-scroll behavior

### MessageBubble.swift (Views/Chat/)
**Before:** Solid black background bubbles
**After:**
- `.ultraThinMaterial` background (glass morphism) *(multi-host demo)*
- Subtle border (0.5px white 6% opacity)
- Deterministic avatar colors from username hash
- Improved default avatar

### TranscriptPanel.swift (Views/Replay/)
**Before:** Basic list with timestamps
**After:**
- Active segment highlighting with blue background
- Speaker color dots (deterministic from name)
- Auto-scroll to active segment
- Better visual hierarchy with dividers
- `activeSegmentId` prop for tracking current position

### Session.swift (Models/)
- Added `playbackUrl: String?` field for live playback URLs

---

## Patterns Reference (from demos)

| Pattern | Demo Source | Where Used |
|---------|-----------|------------|
| Timed metadata JSON decoding | Ecommerce | PlayerModel |
| Buffering spinner | Ecommerce + Feed | RichPlayerView |
| Controls auto-hide (4s timer) | Ecommerce | PlayerModel |
| Bottom gradient overlay | Ecommerce + Feed | GradientOverlay, BroadcastView |
| Stream info pill (avatar + LIVE) | Ecommerce | GradientOverlay, LiveViewerView |
| AVAudioSession .playback | Ecommerce + Feed | PlayerModel |
| Background/foreground lifecycle | Ecommerce + Feed | PlayerModel |
| Adaptive video gravity | Feed | PlayerModel, PlayerContainerView |
| Floating heart bezier animation | Feed | FloatingHeartsView |
| TikTok-style engagement buttons | Feed | LiveViewerView |
| Message slide-up animation | Multi-host | SimpleChatView |
| Inverted scroll for chat | Multi-host | SimpleChatView |
| Participant management sheet | Multi-host | HangoutView |
| Camera swap (front/back) | Multi-host | BroadcastVM, HangoutVM |
| Notification banner system | Multi-host | NotificationBanner |
| Participant avatar + name badges | Multi-host | ParticipantsGridView |
| Pinch-zoom + double-tap | Screenshare | ZoomableContainer, ReplayView |
| IVS preview UIViewRepresentable | Screenshare | PlayerContainerView |

---

## Still TODO

1. **Wire `activeSegmentId` in ReplayView** — track player position and match to transcript segments
2. **Add `NotificationBannerView` to HangoutView** — show join/leave events from VM
3. **Implement real auth** — replace `LoginView` placeholder with `ASWebAuthenticationSession`
4. **Add `speaker-segments` backend endpoint** — required for transcript click-to-seek
5. **Test on device** — all IVS SDK features require physical iPhone
