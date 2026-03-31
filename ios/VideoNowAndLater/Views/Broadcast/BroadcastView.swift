// Views/Broadcast/BroadcastView.swift
// Enhanced with patterns from ecommerce + multi-host demos:
// - Rich stream quality HUD with color-coded health indicators
// - Camera flip button
// - Gradient overlays for text readability
// - Chat overlay wired to SimpleChatView
// - Viewer count display
// - Animated LIVE pill with glow effect
// - Duration timer

import SwiftUI
import AmazonIVSBroadcast

struct BroadcastView: View {
    @EnvironmentObject var env: AppEnvironment
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = BroadcastViewModel()
    @StateObject private var chatVm: ChatViewModel
    @State private var showConfirmStop = false
    @State private var livePulse = false
    @State private var elapsedSeconds = 0
    @State private var showChat = true

    let sessionId: String
    let ingestEndpoint: String
    let streamKey: String
    let authToken: String

    init(sessionId: String, ingestEndpoint: String, streamKey: String, authToken: String) {
        self.sessionId = sessionId
        self.ingestEndpoint = ingestEndpoint
        self.streamKey = streamKey
        self.authToken = authToken
        _chatVm = StateObject(wrappedValue: ChatViewModel(
            sessionId: sessionId,
            authToken: authToken,
            username: ""
        ))
    }

    private let durationTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Full-screen camera preview
            BroadcastPreviewView(broadcastVm: vm)
                .ignoresSafeArea()

            // Gradient overlays (from feed + ecommerce demos)
            TopGradientOverlay(height: 100, opacity: 0.5)
            BottomGradientOverlay(height: 200, opacity: 0.5)

            // Overlay controls
            VStack(spacing: 0) {
                // Header bar
                headerBar
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                Spacer()

                // Chat overlay (wired up from placeholder)
                if showChat {
                    SimpleChatView(messages: chatVm.messages)
                        .frame(maxHeight: 180)
                        .allowsHitTesting(false)
                        .padding(.horizontal, 12)
                        .transition(.opacity)
                }

                // Control buttons bar
                controlsBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
            }

            // Stream quality HUD (enhanced)
            StreamQualityHUD(streamHealth: vm.streamHealth)
        }
        .statusBarHidden()
        .confirmationDialog("End Broadcast", isPresented: $showConfirmStop) {
            Button("Stop", role: .destructive) {
                vm.stopBroadcast()
                chatVm.disconnect()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will end your live session for all viewers.")
        }
        .onAppear {
            vm.setup()
            vm.startBroadcast(ingestEndpoint: ingestEndpoint, streamKey: streamKey)
        }
        .task {
            await chatVm.connect()
        }
        .onReceive(durationTimer) { _ in
            if vm.isConnected { elapsedSeconds += 1 }
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            // Close button
            Button {
                showConfirmStop = true
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }

            if vm.isConnected {
                livePill
                durationPill
            }

            Spacer()

            // Camera flip (from multi-host demo)
            Button {
                vm.swapCamera()
            } label: {
                Image(systemName: "camera.rotate")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }

            // Toggle chat visibility
            Button {
                withAnimation { showChat.toggle() }
            } label: {
                Image(systemName: showChat ? "bubble.left.fill" : "bubble.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }
        }
    }

    private var livePill: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(Color.red)
                .frame(width: 7, height: 7)
                .scaleEffect(livePulse ? 1.4 : 1.0)
                .opacity(livePulse ? 0.6 : 1.0)
                .animation(
                    .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                    value: livePulse
                )
            Text("LIVE")
                .font(.system(size: 12, weight: .bold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.red.opacity(0.75))
        .cornerRadius(14)
        .shadow(color: Color.red.opacity(0.4), radius: 6)
        .onAppear { livePulse = true }
    }

    private var durationPill: some View {
        Text(formatElapsed(elapsedSeconds))
            .font(.system(size: 12, weight: .medium, design: .monospaced))
            .foregroundColor(.white.opacity(0.9))
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Color.black.opacity(0.5))
            .cornerRadius(14)
    }

    // MARK: - Controls Bar

    private var controlsBar: some View {
        HStack(spacing: 20) {
            controlButton(
                icon: vm.isMuted ? "mic.slash.fill" : "mic.fill",
                label: vm.isMuted ? "Unmute" : "Mute",
                isActive: vm.isMuted,
                activeColor: .red
            ) {
                vm.toggleMute()
            }

            controlButton(
                icon: vm.isCameraOff ? "video.slash.fill" : "video.fill",
                label: vm.isCameraOff ? "Camera On" : "Camera Off",
                isActive: vm.isCameraOff,
                activeColor: .red
            ) {
                vm.toggleCamera()
            }

            Spacer()

            Button {
                showConfirmStop = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 12))
                    Text("End")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.red)
                .cornerRadius(20)
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.5))
        .cornerRadius(16)
    }

    private func controlButton(
        icon: String, label: String, isActive: Bool,
        activeColor: Color = .red, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .frame(width: 44, height: 44)
                    .background(isActive ? activeColor.opacity(0.8) : Color.white.opacity(0.1))
                    .clipShape(Circle())
                Text(label)
                    .font(.system(size: 10))
            }
            .foregroundColor(.white)
        }
    }

    // MARK: - Helpers

    private func formatElapsed(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        let h = m / 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m % 60, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}
