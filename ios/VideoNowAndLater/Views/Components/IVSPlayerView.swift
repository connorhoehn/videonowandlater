// Views/Components/IVSPlayerView.swift
// Enhanced with patterns from ecommerce + feed + screenshare demos:
// - Buffering spinner overlay
// - Play/pause tap gesture with animated overlay
// - Seek bar with position tracking
// - Controls auto-show/hide with gradient overlays
// - Adaptive video gravity (portrait vs landscape content)
// - Double-tap to seek ±10s
// - LIVE badge for live streams
// - Error state display

import SwiftUI
import AmazonIVSPlayer

/// SwiftUI bridge for the UIKit IVSPlayerView.
struct PlayerContainerView: UIViewRepresentable {
    let player: IVSPlayer
    var isPortraitContent: Bool = false

    func makeUIView(context: Context) -> AmazonIVSPlayer.IVSPlayerView {
        let view = AmazonIVSPlayer.IVSPlayerView()
        view.player = player
        view.videoGravity = isPortraitContent ? .resizeAspectFill : .resizeAspect
        view.backgroundColor = .black
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ uiView: AmazonIVSPlayer.IVSPlayerView, context: Context) {
        uiView.player = player
        uiView.videoGravity = isPortraitContent ? .resizeAspectFill : .resizeAspect
    }
}

// MARK: - Rich Player View with Controls Overlay

/// Full-featured player view with controls, buffering indicator, seek bar, and gradient overlays.
/// Inspired by ecommerce + feed demos.
struct RichPlayerView: View {
    @ObservedObject var playerModel: PlayerModel
    var showSeekBar: Bool = true

    @State private var playPauseScale: CGFloat = 0
    @State private var seekForwardFlash = false
    @State private var seekBackwardFlash = false

    var body: some View {
        ZStack {
            // Video layer
            PlayerContainerView(
                player: playerModel.player,
                isPortraitContent: playerModel.isPortraitContent
            )

            // Tap target + controls
            controlsOverlay

            // Buffering spinner (from ecommerce demo)
            if playerModel.isBuffering {
                bufferingIndicator
            }

            // Error display
            if let error = playerModel.error {
                errorOverlay(error)
            }

            // Double-tap seek indicators
            doubleTapIndicators
        }
        .background(Color.black)
        .clipped()
    }

    // MARK: - Controls Overlay

    private var controlsOverlay: some View {
        ZStack {
            // Tap to show/hide controls
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { playerModel.tapPlayer() }
                .simultaneousGesture(
                    TapGesture(count: 2)
                        .onEnded { /* handled by left/right double-tap zones */ }
                )

            // Double-tap zones for ±10s seek
            HStack(spacing: 0) {
                // Left half: seek back 10s
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) {
                        playerModel.seekRelative(-10)
                        withAnimation(.easeOut(duration: 0.15)) { seekBackwardFlash = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            withAnimation { seekBackwardFlash = false }
                        }
                    }

                // Right half: seek forward 10s
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) {
                        playerModel.seekRelative(10)
                        withAnimation(.easeOut(duration: 0.15)) { seekForwardFlash = true }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            withAnimation { seekForwardFlash = false }
                        }
                    }
            }

            if playerModel.showControls {
                // Top gradient (from feed demo)
                VStack {
                    LinearGradient(
                        colors: [Color.black.opacity(0.6), .clear],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(height: 60)
                    Spacer()
                }

                // Bottom gradient + controls
                VStack {
                    Spacer()

                    // Bottom gradient (from feed demo)
                    LinearGradient(
                        colors: [.clear, Color.black.opacity(0.6)],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(height: 100)
                    .overlay(alignment: .bottom) {
                        bottomControls
                    }
                }

                // Center play/pause button
                centerPlayPause

                // LIVE badge (top-left, from ecommerce demo)
                if playerModel.isLive {
                    VStack {
                        HStack {
                            liveBadge
                                .padding(.leading, 12)
                                .padding(.top, 12)
                            Spacer()
                        }
                        Spacer()
                    }
                }
            }
        }
    }

    // MARK: - Center Play/Pause

    private var centerPlayPause: some View {
        Button {
            playerModel.togglePlayPause()
            // Animate the play/pause icon
            playPauseScale = 1.3
            withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                playPauseScale = 1.0
            }
        } label: {
            Image(systemName: playerModel.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: 40))
                .foregroundColor(.white)
                .scaleEffect(playPauseScale == 0 ? 1.0 : playPauseScale)
                .frame(width: 70, height: 70)
                .background(Color.black.opacity(0.4))
                .clipShape(Circle())
        }
        .transition(.opacity)
    }

    // MARK: - Bottom Controls

    private var bottomControls: some View {
        VStack(spacing: 4) {
            if showSeekBar && !playerModel.isLive {
                seekBar
            }
            HStack {
                // Position / Duration
                if !playerModel.isLive {
                    Text("\(formatTime(playerModel.position)) / \(formatTime(playerModel.duration))")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundColor(.white.opacity(0.9))
                }
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    // MARK: - Seek Bar

    private var seekBar: some View {
        GeometryReader { geo in
            let progress = playerModel.duration > 0
                ? min(playerModel.position / playerModel.duration, 1.0)
                : 0.0

            ZStack(alignment: .leading) {
                // Track
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(height: 3)

                // Fill
                Capsule()
                    .fill(Color.white)
                    .frame(width: geo.size.width * progress, height: 3)
            }
            .frame(height: 20)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let fraction = max(0, min(value.location.x / geo.size.width, 1.0))
                        playerModel.seek(to: fraction * playerModel.duration)
                    }
            )
        }
        .frame(height: 20)
        .padding(.horizontal, 12)
    }

    // MARK: - Buffering Indicator (from ecommerce demo)

    private var bufferingIndicator: some View {
        ZStack {
            Color.black.opacity(0.3)
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                .scaleEffect(1.5)
        }
        .allowsHitTesting(false)
    }

    // MARK: - Error Overlay

    private func errorOverlay(_ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundColor(.appRed)
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }

    // MARK: - LIVE Badge (from ecommerce demo)

    private var liveBadge: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
            Text("LIVE")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.red.opacity(0.8))
        .cornerRadius(12)
    }

    // MARK: - Double-Tap Seek Indicators

    private var doubleTapIndicators: some View {
        HStack {
            if seekBackwardFlash {
                seekIndicator(icon: "gobackward.10", alignment: .leading)
            }
            Spacer()
            if seekForwardFlash {
                seekIndicator(icon: "goforward.10", alignment: .trailing)
            }
        }
        .allowsHitTesting(false)
    }

    private func seekIndicator(icon: String, alignment _: Alignment) -> some View {
        Image(systemName: icon)
            .font(.system(size: 36, weight: .semibold))
            .foregroundColor(.white)
            .padding(20)
            .background(Color.black.opacity(0.4))
            .clipShape(Circle())
            .transition(.scale.combined(with: .opacity))
    }

    // MARK: - Helpers

    private func formatTime(_ seconds: TimeInterval) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let totalSeconds = Int(seconds)
        let m = totalSeconds / 60
        let s = totalSeconds % 60
        return String(format: "%d:%02d", m, s)
    }
}
