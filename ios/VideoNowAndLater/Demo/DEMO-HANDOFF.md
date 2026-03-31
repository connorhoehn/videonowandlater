# iOS Demo Mode — Handoff

## What was built
A self-contained demo mode for the iOS app that shows all UI components without requiring a backend, CDK deployment, or Cognito auth.

## Entry point
- **Login screen** → "Try Demo" button (yellow, with sparkles icon)
- Sets `env.isDemoMode = true` → routes to `DemoFeedView` instead of `FeedView`

## Files created

### `Demo/` folder
| File | Purpose |
|------|---------|
| `DemoData.swift` | Mock sessions (6), speaker segments (8), chat messages (10), hangout participants (4 + 2 extras for join/leave), user stats. Uses bundled `demo_video.mp4` or Apple HLS fallback |
| `DemoFeedView.swift` | Instagram-style feed: live stories bar + session card grid with per-session video thumbnails (AVAssetImageGenerator at different timestamps). Routes live HANGOUT → DemoHangoutView, live BROADCAST → DemoBroadcastView, ended → DemoReplayView |
| `DemoReplayView.swift` | Full-screen replay with AVPlayer (not IVS SDK), AI summary overlay, transcript sheet with click-to-seek, chat overlay, floating heart reactions |
| `DemoReplayViewModel.swift` | AVPlayer wrapper with position tracking for active segment highlighting |
| `DemoChatView.swift` | Standalone chat overlay — messages appear as video plays (timestamped to playback position), no IVS SDK dependency |
| `DemoHangoutView.swift` | Dynamic participant grid (1-6 tiles) with mute/camera/flip/chat/react controls, speaking indicators, join/leave animations with notification banners. Reuses production ControlButton, FloatingHeartsView, NotificationBannerView |
| `DemoBroadcastView.swift` | Live camera preview (AVCaptureSession, front camera), LIVE pill with pulse animation, duration timer, viewer count (incrementing), stream quality HUD (fluctuating Q/N values), chat overlay, mute/camera controls, end broadcast confirmation |
| `DemoProfileView.swift` | Mock profile with stats (12 broadcasts, 8 hangouts, 3 uploads) |
| `demo_video.mp4` | Bundled sample video (18MB, from ar_drawing_1.mp4) |

## Architecture decisions
- **AVPlayer instead of IVS SDK** for demo playback — bundled MP4s don't need IVS
- **AVCaptureSession** for demo broadcast camera preview — no IVS Broadcast SDK dependency
- **No protocol/mock injection** — demo views are separate from production views to keep things simple and avoid coupling
- **fullScreenCover** for replay/hangout/broadcast — matches the immersive reference design
- **Transcript sheet** slides up from bottom with spring animation, segments highlight in blue as video plays
- **Type-based routing** from feed: HANGOUT sessions open hangout grid, BROADCAST opens camera preview, ended sessions open replay
- **Per-session thumbnails** generated at different timestamps (1s, 2s, 4s, 6s, 8s, 10s) from the same bundled video for visual variety

## What's working
- Feed with 2 live + 4 recorded sessions, each with a unique thumbnail
- Type-based routing: live hangout → hangout view, live broadcast → broadcast view, ended → replay
- **Replay**: full-screen video, AI summary overlay, transcript with click-to-seek, active segment highlighting, chat overlay, floating hearts
- **Hangout**: dynamic participant grid (adapts 1-6 tiles), avatar fallbacks, speaking indicators (green border), mute/video badges, chat overlay, floating hearts, join/leave animations every ~8s with notification banners, leave confirmation
- **Broadcast**: live front camera preview, animated LIVE pill with pulse, running duration timer, mock viewer count (fluctuates every 5s), stream quality HUD (Q/N values fluctuate every 8s), chat overlay, mute/camera toggle, end broadcast confirmation
- **Chat**: 10 mock messages that appear progressively (timestamped to playback position)
- **Reactions**: floating heart animations (reuses production FloatingHeartsView + HeartFactory)
- Pipeline status badges (processing, available)
- Profile view with mock stats
- DEMO badge in top-right of feed

## Completed enhancements
1. **Visual variety** — Feed thumbnails now get per-session color tints (overlay blend) so cards look distinct even with a single bundled video
2. **Camera flip button** — Wired in broadcast demo: toggles front/back camera via AVCaptureSession reconfiguration (DemoCameraPreview accepts `@Binding useFrontCamera`)
3. **Quick emoji reactions bar** — Added to hangout: React button toggles a 6-emoji bar (👋🔥❤️😂👏🎉) that slides up above controls with spring animation. Tapping an emoji triggers a floating heart + auto-dismisses the bar
4. **Stream quality degradation** — Broadcast demo simulates a ~8s quality drop every ~30s (Q/N values drop to 25-55 range), then recovers. StreamQualityHUD dot goes red during degradation

## Additional enhancements (round 2)
5. **Floating emoji reactions** — Extended `FloatingHeart` with optional `emoji: String?` field. When set, shows the actual emoji text (32pt) instead of the heart icon. Factory method `HeartFactory.create(in:emoji:)` passes it through. Backward compatible — existing heart-only callers unaffected.
6. **Emoji bar in replay** — DemoReplayView's React button now toggles the same 6-emoji bar as hangout. Tapping an emoji floats the actual emoji character upward.
7. **Poor connection banner** — DemoBroadcastView shows a red "Poor connection — Viewers may experience buffering" banner during the ~8s degradation window. Slides in/out with animation.

8. **Replay scrubber** — DemoReplayView now has a draggable progress bar with time labels (current / total). DemoReplayViewModel loads video duration via `AVAsset.load(.duration)` and exposes `seekToFraction(_:)` for scrubbing.

9. **Double-tap seek** — DemoReplayView has left/right half-screen double-tap zones for −10s/+10s seeking. Shows a bold indicator ("−10s" / "+10s") that fades after 0.6s. Uses `seekRelative(_:)` on the view model.

10. **Video looping** — Replay auto-restarts when the video ends (AVPlayerItemDidPlayToEndTime observer seeks to .zero and replays). Cleaned up in `cleanup()`.

## To continue
1. Add more bundled sample videos for even more variety (currently using color tints on one video)
2. Add screen share simulation in broadcast demo (toggle between camera and a mock screen)
3. Add landscape orientation support for replay view

## Build & run
```bash
cd ios && xcodegen generate && open VideoNowAndLater.xcodeproj
```
Select VideoNowAndLater scheme → your iPhone → Run. Tap "Try Demo" on login screen.

**Note**: Broadcast demo requires camera permission — the camera preview will show on a real device but not in the simulator.
