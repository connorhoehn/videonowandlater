// Views/Replay/ReplayView.swift
// Enhanced with:
// - RichPlayerView with buffering, seek bar, controls auto-hide
// - Zoomable fullscreen mode (from screenshare demo)
// - Improved layout with AdaptivePlayerView for landscape support
// - Segmented picker: Chapters | Transcript | Summary

import SwiftUI
import AmazonIVSPlayer

struct ReplayView: View {
    @EnvironmentObject var env: AppEnvironment
    @StateObject private var vm: ReplayViewModel
    @StateObject private var playerModel = PlayerModel()
    @State private var selectedTab: ReplayTab = .chapters
    @State private var isFullscreen = false

    enum ReplayTab: String, CaseIterable {
        case chapters = "Chapters"
        case transcript = "Transcript"
        case summary = "Summary"
    }

    init(session: Session) {
        _vm = StateObject(wrappedValue: ReplayViewModel(session: session))
    }

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            if isFullscreen {
                fullscreenPlayer
            } else {
                AdaptivePlayerView {
                    playerArea
                } content: {
                    contentBelow
                }
            }
        }
        .navigationTitle(vm.session.title ?? "Replay")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarHidden(isFullscreen)
        .statusBarHidden(isFullscreen)
        .task {
            guard let token = env.idToken, let url = vm.session.recordingHlsUrl else { return }
            vm.player = playerModel.player
            playerModel.load(url: url)
            await vm.setup(authToken: token)
            vm.startPositionTracking()
            // Default tab: chapters if available, otherwise transcript
            if let chapters = vm.session.chapters, !chapters.isEmpty {
                selectedTab = .chapters
            } else if !vm.segments.isEmpty {
                selectedTab = .transcript
            } else {
                selectedTab = .summary
            }
            if !vm.session.isTerminal {
                await vm.pollUntilReady(authToken: token)
            }
        }
        .onDisappear {
            vm.stopPositionTracking()
        }
    }

    // MARK: - Player Area

    private var playerArea: some View {
        ZStack {
            RichPlayerView(playerModel: playerModel)
                .aspectRatio(16/9, contentMode: .fit)

            // Fullscreen toggle button (top-right)
            VStack {
                HStack {
                    Spacer()
                    if playerModel.showControls {
                        Button {
                            withAnimation(.easeInOut(duration: 0.25)) {
                                isFullscreen.toggle()
                            }
                        } label: {
                            Image(systemName: isFullscreen ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 32, height: 32)
                                .background(Color.black.opacity(0.5))
                                .clipShape(Circle())
                        }
                        .padding(12)
                        .transition(.opacity)
                    }
                }
                Spacer()
            }
        }
    }

    // MARK: - Content Below Player

    private var contentBelow: some View {
        VStack(spacing: 0) {
            // Segmented picker
            Picker("", selection: $selectedTab) {
                ForEach(ReplayTab.allCases, id: \.self) { tab in
                    Text(tab.rawValue).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            // Tab content
            switch selectedTab {
            case .chapters:
                chaptersTab
            case .transcript:
                transcriptTab
            case .summary:
                summaryTab
            }

            Spacer()
        }
    }

    // MARK: - Chapters Tab

    @ViewBuilder
    private var chaptersTab: some View {
        if let chapters = vm.session.chapters, !chapters.isEmpty {
            ChapterListView(
                chapters: chapters,
                currentTimeMs: vm.currentPositionMs,
                thumbnailBaseUrl: vm.session.thumbnailBaseUrl,
                onSeek: { ms in vm.seekToMs(ms) }
            )
        } else {
            emptyState(icon: "list.bullet.rectangle", message: "No chapters available for this session.")
        }
    }

    // MARK: - Transcript Tab

    @ViewBuilder
    private var transcriptTab: some View {
        if !vm.segments.isEmpty {
            TranscriptPanel(
                segments: vm.segments,
                onSeek: { segment in vm.seek(to: segment) },
                activeSegmentId: vm.activeSegmentId
            )
        } else if vm.session.transcriptStatus == "processing" {
            VStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.appIndigo.opacity(0.1))
                        .frame(width: 52, height: 52)
                    ProgressView()
                        .tint(.appIndigo)
                        .scaleEffect(0.9)
                }
                Text("Generating transcript...")
                    .font(.system(size: 13))
                    .foregroundColor(Color.appTextGray1)
            }
            .padding(.top, 24)
        } else {
            emptyState(icon: "text.alignleft", message: "No transcript available for this session.")
        }
    }

    // MARK: - Summary Tab

    private var summaryTab: some View {
        SummaryPanel(session: vm.session)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
    }

    // MARK: - Empty State Helper

    private func emptyState(icon: String, message: String) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.appTextGray1.opacity(0.08))
                    .frame(width: 52, height: 52)
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundColor(Color.appTextGray1.opacity(0.5))
            }
            Text(message)
                .font(.system(size: 13))
                .foregroundColor(Color.appTextGray1.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(.top, 32)
        .padding(.horizontal, 32)
    }

    // MARK: - Fullscreen (with ZoomableContainer from screenshare demo)

    private var fullscreenPlayer: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            ZoomableContainer {
                PlayerContainerView(
                    player: playerModel.player,
                    isPortraitContent: playerModel.isPortraitContent
                )
            }
            .ignoresSafeArea()

            // Floating controls in fullscreen
            VStack {
                HStack {
                    Spacer()
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isFullscreen = false
                        }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.black.opacity(0.5))
                            .clipShape(Circle())
                    }
                    .padding()
                }
                Spacer()
            }
        }
    }
}
