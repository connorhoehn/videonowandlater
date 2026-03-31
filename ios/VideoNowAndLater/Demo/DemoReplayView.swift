// Demo/DemoReplayView.swift
// Full-screen replay with transcript, AI summary, and click-to-seek — no backend needed

import SwiftUI
import UIKit
import AVKit

struct DemoReplayView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = DemoReplayViewModel()
    @State private var showInfo = true
    @State private var showTranscript = false
    @State private var showChat = false
    @State private var hearts: [FloatingHeart] = []
    @State private var showEmojiBar = false
    @State private var seekIndicator: String? = nil

    private let quickReactions = ["👋", "🔥", "❤️", "😂", "👏", "🎉"]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Video player (full screen)
            if let player = vm.player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showInfo.toggle()
                        }
                    }

                // Double-tap seek zones (left = -10s, right = +10s)
                HStack(spacing: 0) {
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) {
                            vm.seekRelative(-10_000)
                            showSeekIndicator("−10s")
                        }
                    Color.clear
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) {
                            vm.seekRelative(10_000)
                            showSeekIndicator("+10s")
                        }
                }
                .ignoresSafeArea()
            }

            // Seek indicator
            if let indicator = seekIndicator {
                Text(indicator)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(Color.black.opacity(0.5))
                    .cornerRadius(16)
                    .transition(.scale.combined(with: .opacity))
            }

            // Chat overlay (left side, above bottom controls)
            if showChat {
                VStack {
                    Spacer()
                    DemoChatView(currentPositionMs: vm.currentPositionMs)
                        .frame(maxHeight: 200)
                        .padding(.bottom, 180)
                        .padding(.horizontal, 12)
                }
                .transition(.opacity)
            }

            // Floating hearts
            FloatingHeartsView(hearts: $hearts)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            // Quick emoji bar
            if showEmojiBar {
                VStack {
                    Spacer()
                    replayEmojiBar
                        .padding(.bottom, 120)
                }
                .transition(.opacity)
            }

            // Overlay UI
            if showInfo {
                overlayControls
            }

            // Transcript sheet
            if showTranscript {
                transcriptSheet
            }
        }
        .onAppear {
            vm.loadSession(session)
        }
        .onDisappear {
            vm.cleanup()
        }
        .statusBarHidden(true)
    }

    // MARK: - Overlay Controls

    private var overlayControls: some View {
        ZStack {
            // Top gradient
            VStack {
                LinearGradient(
                    colors: [.black.opacity(0.7), .clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 140)
                Spacer()
            }
            .ignoresSafeArea()

            // Bottom gradient
            VStack {
                Spacer()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.85)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 300)
            }
            .ignoresSafeArea()

            VStack {
                // Top bar
                topBar
                    .padding(.top, 8)

                Spacer()

                // Bottom info + controls
                bottomSection
            }
        }
        .transition(.opacity)
    }

    // MARK: - Top Bar

    private var topBar: some View {
        HStack {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
            }

            Spacer()

            Text(session.title ?? "Replay")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)

            Spacer()

            // Type badge
            Text(session.type)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.white.opacity(0.2))
                .cornerRadius(8)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Bottom Section

    private var bottomSection: some View {
        VStack(spacing: 14) {
            // AI Summary (if available)
            if let summary = session.aiSummary {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 14))
                        Text("AI Summary")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundColor(.yellow)

                    Text(summary)
                        .font(.system(size: 14))
                        .foregroundColor(.white.opacity(0.9))
                        .lineLimit(3)
                }
                .padding(14)
                .background(Color.white.opacity(0.1))
                .cornerRadius(14)
                .padding(.horizontal, 16)
            }

            // Pipeline status
            if session.isProcessing {
                HStack {
                    PipelineStatusBadge(session: session)
                    Spacer()
                }
                .padding(.horizontal, 16)
            }

            // Session info row
            HStack(spacing: 16) {
                if let dur = session.durationSeconds {
                    Label(formatDuration(dur), systemImage: "clock")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.7))
                }

                if let count = session.participantCount, count > 0 {
                    Label("\(count)", systemImage: "person.2")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.7))
                }

                Spacer()
            }
            .padding(.horizontal, 16)

            // Progress scrubber
            if vm.durationMs > 0 {
                VStack(spacing: 6) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            // Track
                            Capsule()
                                .fill(Color.white.opacity(0.2))
                                .frame(height: 5)

                            // Progress fill
                            Capsule()
                                .fill(Color.white)
                                .frame(width: geo.size.width * progress, height: 5)

                            // Thumb circle
                            Circle()
                                .fill(Color.white)
                                .frame(width: 14, height: 14)
                                .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
                                .offset(x: max(0, min(geo.size.width - 14, geo.size.width * progress - 7)))
                        }
                        .frame(height: 14)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let fraction = max(0, min(1, value.location.x / geo.size.width))
                                    vm.seekToFraction(fraction)
                                }
                        )
                    }
                    .frame(height: 14)

                    // Time labels
                    HStack {
                        Text(formatMs(vm.currentPositionMs))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.white.opacity(0.6))
                        Spacer()
                        Text(formatMs(vm.durationMs))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
                .padding(.horizontal, 16)
            }

            // Action buttons
            HStack(spacing: 12) {
                // Transcript button
                Button {
                    withAnimation(.spring(response: 0.3)) {
                        showTranscript.toggle()
                    }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: "text.quote")
                            .font(.system(size: 24))
                        Text("Transcript")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(session.transcriptStatus == "available" ? .white : .white.opacity(0.3))
                    .frame(width: 70, height: 52)
                }
                .disabled(session.transcriptStatus != "available")

                // Chat toggle
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showChat.toggle()
                    }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: showChat ? "bubble.left.fill" : "bubble.left")
                            .font(.system(size: 24))
                        Text("Chat")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(.white)
                    .frame(width: 70, height: 52)
                }

                Spacer()

                // Play/Pause
                Button {
                    vm.togglePlayPause()
                } label: {
                    Image(systemName: vm.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.white)
                }

                Spacer()

                // Reactions
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        showEmojiBar.toggle()
                    }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: showEmojiBar ? "face.smiling.fill" : "heart.fill")
                            .font(.system(size: 24))
                        Text("React")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(.pink)
                    .frame(width: 70, height: 52)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
    }

    // MARK: - Transcript Sheet

    private var transcriptSheet: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 0) {
                // Drag handle
                Capsule()
                    .fill(Color.white.opacity(0.3))
                    .frame(width: 40, height: 5)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                // Header
                HStack {
                    Text("Transcript")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Button {
                        withAnimation(.spring(response: 0.3)) {
                            showTranscript = false
                        }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)

                // Segments list
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(vm.segments) { segment in
                                Button {
                                    vm.seek(to: segment)
                                } label: {
                                    transcriptRow(segment)
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 24)
                    }
                }
            }
            .frame(height: 400)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color(white: 0.12))
            )
        }
        .transition(.move(edge: .bottom))
        .ignoresSafeArea(edges: .bottom)
    }

    private func transcriptRow(_ segment: SpeakerSegment) -> some View {
        HStack(alignment: .top, spacing: 12) {
            // Timestamp
            Text(formatMs(segment.startMs))
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundColor(.blue)
                .frame(width: 46, alignment: .leading)

            VStack(alignment: .leading, spacing: 3) {
                Text(segment.speaker)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(speakerColor(segment.speaker))
                Text(segment.text)
                    .font(.system(size: 14))
                    .foregroundColor(.white.opacity(0.85))
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(14)
        .background(
            vm.activeSegmentId == segment.id
                ? Color.blue.opacity(0.15)
                : Color.white.opacity(0.05)
        )
        .cornerRadius(12)
    }

    private func showSeekIndicator(_ text: String) {
        withAnimation(.easeOut(duration: 0.15)) {
            seekIndicator = text
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            withAnimation(.easeIn(duration: 0.2)) {
                seekIndicator = nil
            }
        }
    }

    private var progress: CGFloat {
        guard vm.durationMs > 0 else { return 0 }
        return CGFloat(vm.currentPositionMs) / CGFloat(vm.durationMs)
    }

    // MARK: - Emoji Bar

    private var replayEmojiBar: some View {
        HStack(spacing: 10) {
            ForEach(quickReactions, id: \.self) { emoji in
                Button {
                    let size = UIScreen.main.bounds.size
                    hearts.append(HeartFactory.create(in: size, emoji: emoji))
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        showEmojiBar = false
                    }
                } label: {
                    Text(emoji)
                        .font(.system(size: 28))
                        .frame(width: 48, height: 48)
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(24)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial.opacity(0.9))
        .cornerRadius(28)
    }

    // MARK: - Helpers

    private func formatDuration(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    private func formatMs(_ ms: Int) -> String {
        let totalSec = ms / 1000
        let m = totalSec / 60
        let s = totalSec % 60
        return String(format: "%d:%02d", m, s)
    }

    private func speakerColor(_ name: String) -> Color {
        let colors: [Color] = [.blue, .green, .orange, .purple, .pink, .cyan]
        let hash = abs(name.hashValue)
        return colors[hash % colors.count]
    }
}
