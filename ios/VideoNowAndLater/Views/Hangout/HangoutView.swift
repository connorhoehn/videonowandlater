// Views/Hangout/HangoutView.swift
// Enhanced with patterns from multi-host + feed demos:
// - Camera swap button
// - Participant management sheet (from multi-host demo)
// - Chat toggle with message entrance animations
// - Floating hearts reactions
// - Gradient overlays
// - Notification banner for join/leave events

import SwiftUI

struct HangoutView: View {
    @EnvironmentObject var env: AppEnvironment
    let session: Session
    @StateObject private var vm: HangoutViewModel
    @StateObject private var chatVm: ChatViewModel
    @State private var isControlsExpanded = false
    @State private var showChat = true
    @State private var showLeaveConfirm = false
    @State private var showParticipants = false
    @State private var hearts: [FloatingHeart] = []
    @Environment(\.dismiss) private var dismiss

    init(session: Session, authToken: String = "", username: String = "") {
        self.session = session
        _vm = StateObject(wrappedValue: HangoutViewModel(authToken: authToken, username: username))
        _chatVm = StateObject(wrappedValue: ChatViewModel(
            sessionId: session.id,
            authToken: authToken,
            username: username
        ))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                Color.appBackground.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Header bar
                    headerBar
                        .padding(.horizontal, 16)

                    ZStack(alignment: .bottom) {
                        // Participant video grid
                        ParticipantsGridView(viewModel: vm)
                            .padding(.horizontal, 4)
                            .padding(.bottom, 80)
                            .onTapGesture {
                                UIApplication.shared.sendAction(
                                    #selector(UIResponder.resignFirstResponder),
                                    to: nil, from: nil, for: nil
                                )
                                withAnimation { isControlsExpanded = false }
                            }

                        // Chat overlay — pinned above controls, not overlapping grid
                        if showChat {
                            VStack {
                                Spacer()
                                SimpleChatView(messages: chatVm.messages)
                                    .frame(maxHeight: 120)
                                    .padding(.horizontal, 8)
                                    .allowsHitTesting(false)
                            }
                            .padding(.bottom, 70)
                            .transition(.opacity)
                        }

                        // Floating hearts
                        FloatingHeartsView(hearts: $hearts)

                        // Controls drawer
                        controlsDrawer
                    }
                }

                // Notification banners (join/leave events)
                VStack {
                    NotificationBannerView(notifications: $vm.bannerNotifications)
                    Spacer()
                }

                // Participant management sheet (from multi-host demo)
                if showParticipants {
                    participantSheet
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .confirmationDialog("Leave Hangout?", isPresented: $showLeaveConfirm) {
            Button("Leave", role: .destructive) {
                vm.leave()
                chatVm.disconnect()
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll leave the session. Others can continue.")
        }
        .onChange(of: vm.stageConnectionState) { state in
            if state == .disconnected && !vm.sessionRunning { dismiss() }
        }
        .task {
            guard let token = env.idToken else { return }
            async let joinTask: () = { try? await vm.join(sessionId: session.id) }()
            async let chatTask: () = chatVm.connect()
            _ = await (joinTask, chatTask)
        }
        .onDisappear {
            vm.leave()
            chatVm.disconnect()
        }
    }

    // MARK: - Header Bar

    private var headerBar: some View {
        HStack(spacing: 12) {
            Button {
                showLeaveConfirm = true
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(Color.white.opacity(0.1))
                    .clipShape(Circle())
                    .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
            }

            Text(session.title ?? "Hangout")
                .foregroundColor(.white)
                .font(.system(size: 16, weight: .semibold))
                .lineLimit(1)

            Spacer()

            // Participant count (tappable for management)
            Button {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    showParticipants.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "person.2")
                        .font(.system(size: 12))
                    Text("\(vm.participantCount)")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.appBackgroundButton)
                .cornerRadius(16)
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: - Controls Drawer

    private var controlsDrawer: some View {
        HStack(spacing: 0) {
            HStack(spacing: 12) {
                ControlButton(
                    icon: vm.localUserAudioMuted ? "mic.slash" : "mic",
                    label: vm.localUserAudioMuted ? "Unmute" : "Mute",
                    backgroundColor: vm.localUserAudioMuted ? .red : Color.appBackgroundButton
                ) { vm.toggleMute() }

                ControlButton(
                    icon: vm.localUserVideoMuted ? "video.slash" : "video",
                    label: "Camera",
                    backgroundColor: vm.localUserVideoMuted ? .red : Color.appBackgroundButton
                ) { vm.toggleCamera() }

                ControlButton(
                    icon: "camera.rotate",
                    label: "Flip"
                ) { vm.swapCamera() }

                ControlButton(
                    icon: showChat ? "bubble.left.fill" : "bubble.left",
                    label: "Chat"
                ) { withAnimation { showChat.toggle() } }

                ControlButton(
                    icon: "heart.fill",
                    label: "React",
                    backgroundColor: Color(red: 1.0, green: 0, blue: 0.72).opacity(0.7)
                ) {
                    if let size = UIScreen.main.bounds as CGRect? {
                        hearts.append(HeartFactory.create(in: size.size))
                    }
                }
            }

            Spacer(minLength: 8)

            // Leave button
            Button {
                showLeaveConfirm = true
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 14))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.red)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            Color.appBackground.opacity(0.95)
                .shadow(.drop(color: .black.opacity(0.3), radius: 12, y: -4))
        )
    }

    // MARK: - Participant Management Sheet (from multi-host demo)

    private var participantSheet: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture {
                    withAnimation { showParticipants = false }
                }

            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Participants (\(vm.participantCount))")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                    Spacer()
                    Button {
                        withAnimation { showParticipants = false }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14))
                            .foregroundColor(.appTextGray1)
                            .frame(width: 28, height: 28)
                            .background(Color.appBackgroundButton)
                            .clipShape(Circle())
                    }
                }
                .padding()

                Divider().background(Color.appBackgroundButton)

                // Participant list
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(vm.participantsData.enumerated()), id: \.offset) { _, participant in
                            participantRow(participant)
                            Divider().background(Color.appBackgroundButton.opacity(0.5))
                        }
                    }
                }
                .frame(maxHeight: 300)
            }
            .background(Color.appBackgroundList)
            .cornerRadius(20, corners: [.topLeft, .topRight])
            .ignoresSafeArea(edges: .bottom)
        }
    }

    private func participantRow(_ participant: ParticipantData) -> some View {
        HStack(spacing: 12) {
            // Avatar
            Circle()
                .fill(Color.appBackgroundButton)
                .frame(width: 36, height: 36)
                .overlay(
                    Text(String(participant.username.prefix(1)).uppercased())
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                )

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(participant.username)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                    if participant.isLocal {
                        Text("(You)")
                            .font(.system(size: 12))
                            .foregroundColor(.appTextGray1)
                    }
                }
            }

            Spacer()

            // Mute indicators
            if participant.isAudioMuted {
                Image(systemName: "mic.slash.fill")
                    .font(.system(size: 12))
                    .foregroundColor(.red)
            }
            if participant.isVideoMuted {
                Image(systemName: "video.slash.fill")
                    .font(.system(size: 12))
                    .foregroundColor(.appTextGray1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
