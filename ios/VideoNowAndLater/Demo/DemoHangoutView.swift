// Demo/DemoHangoutView.swift
// Mock hangout with participant grid, controls, chat, and reactions — no IVS SDK needed

import SwiftUI

struct DemoHangoutView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var participants = DemoData.hangoutParticipants
    @State private var showChat = true
    @State private var showLeaveConfirm = false
    @State private var hearts: [FloatingHeart] = []
    @State private var isMuted = false
    @State private var isCameraOff = false
    @State private var notifications: [AppNotification] = []
    @State private var showEmojiBar = false

    private let quickReactions = ["👋", "🔥", "❤️", "😂", "👏", "🎉"]

    // Visual constants
    private let tileSpacing: CGFloat = 8
    private let tileCornerRadius: CGFloat = 20
    private let avatarSize: CGFloat = 72
    private let avatarInitialFont: CGFloat = 30
    private let controlsVerticalPadding: CGFloat = 14
    private let controlsCornerRadius: CGFloat = 20
    private let headerVerticalPadding: CGFloat = 12
    private let closeButtonSize: CGFloat = 36
    private let nameBadgeFont: CGFloat = 12
    private let nameBadgePadding: CGFloat = 10
    private let speakingBorderWidth: CGFloat = 4
    private let muteBadgeIconSize: CGFloat = 12
    private let muteBadgePadding: CGFloat = 7
    private let drawerHeight: CGFloat = 90

    // Extra participants who can join/leave
    private static let extraParticipants = [
        DemoData.DemoParticipant(id: "p-5", username: "Jordan", isLocal: false, isAudioMuted: false, isVideoMuted: false),
        DemoData.DemoParticipant(id: "p-6", username: "Taylor", isLocal: false, isAudioMuted: true, isVideoMuted: false),
    ]

    private let joinLeaveTimer = Timer.publish(every: 8, on: .main, in: .common).autoconnect()

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                Color.appBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    headerBar
                        .padding(.horizontal, 16)

                    ZStack(alignment: .bottom) {
                        // Participant grid
                        participantGrid(screenSize: geo.size)
                            .padding(.horizontal, 8)
                            .padding(.bottom, drawerHeight)

                        // Chat overlay
                        if showChat {
                            DemoChatView(currentPositionMs: Int(Date().timeIntervalSince1970 * 1000) % 70000)
                                .frame(maxHeight: geo.size.height * 0.22)
                                .padding(.bottom, drawerHeight + 4)
                                .padding(.horizontal, 12)
                                .allowsHitTesting(false)
                                .transition(.opacity)
                        }

                        // Floating hearts
                        FloatingHeartsView(hearts: $hearts)

                        // Quick emoji reactions bar
                        if showEmojiBar {
                            quickEmojiBar
                                .padding(.bottom, drawerHeight + 8)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }

                        // Controls drawer
                        controlsDrawer
                    }
                }
                // Join/leave notification banners
                VStack {
                    NotificationBannerView(notifications: $notifications)
                        .padding(.top, 4)
                    Spacer()
                }
            }
        }
        .onReceive(joinLeaveTimer) { _ in
            simulateJoinLeave()
        }
        .confirmationDialog("Leave Hangout?", isPresented: $showLeaveConfirm) {
            Button("Leave", role: .destructive) { dismiss() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll leave the session. Others can continue.")
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        HStack(spacing: 12) {
            Button { showLeaveConfirm = true } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: closeButtonSize, height: closeButtonSize)
                    .background(Color.appBackgroundButton)
                    .clipShape(Circle())
            }

            Text(session.title ?? "Hangout")
                .foregroundColor(.white)
                .font(.system(size: 17, weight: .semibold))
                .lineLimit(1)

            Spacer()

            // Participant count
            HStack(spacing: 5) {
                Image(systemName: "person.2")
                    .font(.system(size: 13))
                Text("\(participants.count)")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Color.appBackgroundButton)
            .cornerRadius(18)
        }
        .padding(.vertical, headerVerticalPadding)
    }

    // MARK: - Participant Grid

    @ViewBuilder
    private func participantGrid(screenSize: CGSize) -> some View {
        let count = participants.count
        switch count {
        case 0:
            EmptyView()
        case 1:
            participantTile(participants[0])
                .cornerRadius(tileCornerRadius)
        case 2:
            VStack(spacing: tileSpacing) {
                participantTile(participants[0]).cornerRadius(tileCornerRadius)
                participantTile(participants[1]).cornerRadius(tileCornerRadius)
            }
        case 3:
            VStack(spacing: tileSpacing) {
                participantTile(participants[0]).cornerRadius(tileCornerRadius)
                HStack(spacing: tileSpacing) {
                    participantTile(participants[1]).cornerRadius(tileCornerRadius)
                    participantTile(participants[2]).cornerRadius(tileCornerRadius)
                }
            }
        case 4:
            VStack(spacing: tileSpacing) {
                HStack(spacing: tileSpacing) {
                    participantTile(participants[0]).cornerRadius(tileCornerRadius)
                    participantTile(participants[1]).cornerRadius(tileCornerRadius)
                }
                HStack(spacing: tileSpacing) {
                    participantTile(participants[2]).cornerRadius(tileCornerRadius)
                    participantTile(participants[3]).cornerRadius(tileCornerRadius)
                }
            }
        default:
            // 5-6: top row of 3, bottom row of remaining
            VStack(spacing: tileSpacing) {
                HStack(spacing: tileSpacing) {
                    ForEach(participants.prefix(3)) { p in
                        participantTile(p).cornerRadius(tileCornerRadius)
                    }
                }
                HStack(spacing: tileSpacing) {
                    ForEach(participants.dropFirst(3)) { p in
                        participantTile(p).cornerRadius(tileCornerRadius)
                    }
                }
            }
        }
    }

    private func participantTile(_ participant: DemoData.DemoParticipant) -> some View {
        ZStack {
            Color.black

            if participant.isVideoMuted || (participant.isLocal && isCameraOff) {
                // Avatar fallback
                VStack(spacing: 12) {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [avatarColor(for: participant.username), avatarColor(for: participant.username).opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: avatarSize, height: avatarSize)
                        .overlay(
                            Text(String(participant.username.prefix(1)).uppercased())
                                .font(.system(size: avatarInitialFont, weight: .bold))
                                .foregroundColor(.white)
                        )
                        .shadow(color: avatarColor(for: participant.username).opacity(0.4), radius: 8, y: 2)
                    Text(participant.username)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(.white.opacity(0.85))
                }
            } else {
                // Gradient placeholder simulating a video feed
                LinearGradient(
                    colors: [avatarColor(for: participant.username).opacity(0.3), Color.black.opacity(0.8)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .overlay(
                    VStack(spacing: 10) {
                        Image(systemName: participant.isLocal ? "person.fill" : "person.fill")
                            .font(.system(size: 44))
                            .foregroundColor(.white.opacity(0.2))
                        Text(participant.username)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white.opacity(0.5))
                    }
                )
            }

            // Bottom overlay: mute indicators + name badge
            VStack {
                Spacer()
                HStack(spacing: 6) {
                    if participant.isAudioMuted || (participant.isLocal && isMuted) {
                        Image(systemName: "mic.slash.fill")
                            .font(.system(size: muteBadgeIconSize))
                            .foregroundColor(.white)
                            .padding(muteBadgePadding)
                            .background(Color.red.opacity(0.85))
                            .clipShape(Circle())
                    }
                    if participant.isVideoMuted || (participant.isLocal && isCameraOff) {
                        Image(systemName: "video.slash.fill")
                            .font(.system(size: muteBadgeIconSize))
                            .foregroundColor(.white)
                            .padding(muteBadgePadding)
                            .background(Color.appBackgroundButton.opacity(0.85))
                            .clipShape(Circle())
                    }
                    Spacer()
                    Text(participant.isLocal ? "\(participant.username) (You)" : participant.username)
                        .font(.system(size: nameBadgeFont, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, nameBadgePadding)
                        .padding(.vertical, 5)
                        .background(.ultraThinMaterial)
                        .cornerRadius(10)
                }
                .padding(10)
            }
        }
        // Speaking indicator
        .overlay(
            RoundedRectangle(cornerRadius: tileCornerRadius)
                .strokeBorder(
                    !participant.isAudioMuted && !participant.isLocal
                        ? Color.green.opacity(0.9)
                        : Color.clear,
                    lineWidth: speakingBorderWidth
                )
        )
    }

    // MARK: - Controls Drawer

    private var controlsDrawer: some View {
        HStack(spacing: 16) {
            ControlButton(
                icon: isMuted ? "mic.slash" : "mic",
                label: isMuted ? "Unmute" : "Mute",
                backgroundColor: isMuted ? .red : Color.appBackgroundButton
            ) { isMuted.toggle() }

            ControlButton(
                icon: isCameraOff ? "video.slash" : "video",
                label: "Camera",
                backgroundColor: isCameraOff ? .red : Color.appBackgroundButton
            ) { isCameraOff.toggle() }

            ControlButton(
                icon: "camera.rotate",
                label: "Flip"
            ) { /* flip is visual-only in hangout demo */ }

            ControlButton(
                icon: showChat ? "bubble.left.fill" : "bubble.left",
                label: "Chat"
            ) { withAnimation { showChat.toggle() } }

            ControlButton(
                icon: showEmojiBar ? "face.smiling.fill" : "face.smiling",
                label: "React",
                backgroundColor: showEmojiBar ? Color(red: 1.0, green: 0, blue: 0.72).opacity(0.7) : Color.appBackgroundButton
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    showEmojiBar.toggle()
                }
            }

            Spacer()

            Button { showLeaveConfirm = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 13))
                    Text("Leave")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Color.red)
                .cornerRadius(22)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, controlsVerticalPadding)
        .padding(.bottom, UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.windows.first?.safeAreaInsets.bottom ?? 0)
        .background(
            Color.appBackground.opacity(0.97)
                .clipShape(RoundedCorner(radius: controlsCornerRadius, corners: [.topLeft, .topRight]))
                .shadow(color: .black.opacity(0.3), radius: 12, y: -4)
        )
    }

    // MARK: - Quick Emoji Bar

    private var quickEmojiBar: some View {
        HStack(spacing: 12) {
            ForEach(quickReactions, id: \.self) { emoji in
                Button {
                    let size = UIScreen.main.bounds.size
                    hearts.append(HeartFactory.create(in: size, emoji: emoji))
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                        showEmojiBar = false
                    }
                } label: {
                    Text(emoji)
                        .font(.system(size: 30))
                        .frame(width: 52, height: 52)
                        .background(Color.white.opacity(0.12))
                        .cornerRadius(26)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial.opacity(0.92))
        .cornerRadius(30)
        .padding(.horizontal, 14)
    }

    // MARK: - Join/Leave Simulation

    private func simulateJoinLeave() {
        let extras = Self.extraParticipants
        // Check if any extra participant is currently in the grid
        let extraInGrid = participants.filter { p in extras.contains(where: { $0.id == p.id }) }

        if extraInGrid.isEmpty {
            // Add a random extra participant
            if let joiner = extras.randomElement() {
                withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                    participants.append(joiner)
                    notifications.append(AppNotification(
                        message: "\(joiner.username) joined",
                        type: .success
                    ))
                }
                // Auto-dismiss notification
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    withAnimation { notifications.removeAll() }
                }
            }
        } else if let leaver = extraInGrid.randomElement() {
            // Remove a random extra participant
            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                participants.removeAll { $0.id == leaver.id }
                notifications.append(AppNotification(
                    message: "\(leaver.username) left",
                    type: .warning
                ))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                withAnimation { notifications.removeAll() }
            }
        }
    }

    // MARK: - Helpers

    private func avatarColor(for name: String) -> Color {
        let colors: [Color] = [
            .blue, .purple, .pink, .orange, .teal, .indigo, .mint, .cyan
        ]
        let hash = abs(name.hashValue)
        return colors[hash % colors.count]
    }
}

