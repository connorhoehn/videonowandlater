// Views/Feed/FeedView.swift
// Enhanced with:
// - "Live Now" horizontal scroll section + "Recent" vertical grid
// - Pull to refresh with .refreshable
// - Empty state with icon + message
// - Search/filter bar placeholder
// - Shimmer loading skeleton for card layout

import SwiftUI

struct FeedView: View {
    @EnvironmentObject var env: AppEnvironment
    @StateObject private var vm = SessionFeedViewModel(api: APIClient())

    var body: some View {
        NavigationStack {
            ZStack {
                Color.appBackground.ignoresSafeArea()

                if vm.isLoading && vm.sessions.isEmpty {
                    loadingSkeleton
                } else if let error = vm.error, vm.sessions.isEmpty {
                    errorState(error)
                } else if vm.sessions.isEmpty {
                    emptyState
                } else {
                    feedContent
                }
            }
            .navigationTitle("Sessions")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(destination: UserProfileView()) {
                        Image(systemName: "person.circle")
                            .foregroundColor(.white)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(destination: BroadcastSetupView()) {
                        Image(systemName: "video.badge.plus")
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            guard let token = env.idToken else { return }
            await vm.load(authToken: token)
        }
        .onDisappear { vm.stopPolling() }
    }

    // MARK: - Feed Content

    private var feedContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                // Search bar
                searchBar

                // Live Now section (horizontal scroll)
                if vm.hasLiveSessions {
                    liveNowSection
                }

                // Recent section (vertical cards)
                recentSection
            }
            .padding(.bottom, 20)
        }
        .refreshable {
            guard let token = env.idToken else { return }
            await vm.load(authToken: token)
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.appTextGray1)
                .font(.system(size: 15))

            TextField("Search sessions...", text: $vm.searchText)
                .foregroundColor(.white)
                .font(.system(size: 15))
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.appBackgroundButton)
        .cornerRadius(12)
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    // MARK: - Live Now Section

    private var liveNowSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle()
                    .fill(Color.red)
                    .frame(width: 8, height: 8)
                Text("Live Now")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(vm.liveSessions) { session in
                        NavigationLink(destination: destinationView(for: session)) {
                            SessionCard(session: session)
                                .frame(width: 300)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    // MARK: - Recent Section

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if vm.hasLiveSessions {
                Text("Recent")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 16)
            }

            LazyVStack(spacing: 16) {
                ForEach(vm.recentSessions) { session in
                    NavigationLink(destination: destinationView(for: session)) {
                        SessionCard(session: session)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 16)
                }
            }
        }
    }

    // MARK: - Navigation Destinations

    @ViewBuilder
    private func destinationView(for session: Session) -> some View {
        if session.isLive {
            if session.type == "HANGOUT" {
                HangoutView(
                    session: session,
                    authToken: env.idToken ?? "",
                    username: env.username ?? "User"
                )
            } else {
                LiveViewerView(session: session)
            }
        } else {
            ReplayView(session: session)
        }
    }

    // MARK: - Loading Skeleton

    private var loadingSkeleton: some View {
        ScrollView {
            VStack(spacing: 16) {
                ForEach(0..<3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 0) {
                        // Thumbnail skeleton
                        ShimmerRect(width: .infinity, height: .infinity, cornerRadius: 0)
                            .frame(maxWidth: .infinity)
                            .aspectRatio(16.0 / 9.0, contentMode: .fill)

                        // Info skeleton
                        VStack(alignment: .leading, spacing: 8) {
                            ShimmerRect(width: 200, height: 16, cornerRadius: 4)
                            HStack(spacing: 8) {
                                ShimmerRect(width: 24, height: 24, cornerRadius: 12)
                                ShimmerRect(width: 100, height: 12, cornerRadius: 4)
                                Spacer()
                                ShimmerRect(width: 70, height: 20, cornerRadius: 10)
                            }
                            ShimmerRect(width: 120, height: 12, cornerRadius: 4)
                        }
                        .padding(12)
                    }
                    .background(Color.appBackgroundList)
                    .cornerRadius(16)
                    .padding(.horizontal, 16)
                }
            }
            .padding(.top, 16)
        }
    }

    // MARK: - Error State

    private func errorState(_ error: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundColor(.appTextGray1)
            Text("Something went wrong")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
            Text(error)
                .foregroundColor(.appTextGray1)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Retry") {
                Task {
                    guard let token = env.idToken else { return }
                    await vm.load(authToken: token)
                }
            }
            .foregroundColor(.white)
            .padding(.horizontal, 24)
            .padding(.vertical, 10)
            .background(Color.appBackgroundButton)
            .cornerRadius(10)
        }
        .padding()
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "video.slash")
                .font(.system(size: 48))
                .foregroundColor(.appTextGray1)
            Text("No sessions yet")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(.white)
            Text("Start a broadcast or join a hangout\nto see sessions here.")
                .font(.subheadline)
                .foregroundColor(.appTextGray1)
                .multilineTextAlignment(.center)

            NavigationLink(destination: BroadcastSetupView()) {
                HStack(spacing: 6) {
                    Image(systemName: "video.badge.plus")
                    Text("Start Broadcasting")
                }
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 10)
                .background(Color.blue)
                .cornerRadius(10)
            }
        }
        .padding()
    }
}

// MARK: - Shimmer Loading Rectangle

struct ShimmerRect: View {
    let width: CGFloat
    let height: CGFloat
    var cornerRadius: CGFloat = 4
    @State private var shimmerPhase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(Color.appBackgroundButton)
            .frame(width: width == .infinity ? nil : width, height: height == .infinity ? nil : height)
            .frame(maxWidth: width == .infinity ? .infinity : nil, maxHeight: height == .infinity ? .infinity : nil)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(
                        LinearGradient(
                            colors: [.clear, Color.white.opacity(0.08), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .offset(x: shimmerPhase * 100)
            )
            .clipped()
            .onAppear {
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    shimmerPhase = 2
                }
            }
    }
}

// MARK: - Live Viewer View

struct LiveViewerView: View {
    @EnvironmentObject var env: AppEnvironment
    let session: Session
    @StateObject private var playerModel = PlayerModel()
    @State private var chatVm: ChatViewModel?
    @State private var hearts: [FloatingHeart] = []

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottom) {
                Color.black.ignoresSafeArea()

                // Full-screen player
                RichPlayerView(playerModel: playerModel, showSeekBar: false)
                    .ignoresSafeArea()

                // Stream info pill
                VStack {
                    HStack {
                        StreamInfoPill(
                            title: session.title ?? "Live",
                            isLive: true
                        )
                        .padding(.leading, 12)
                        .padding(.top, 50)
                        Spacer()
                    }
                    Spacer()
                }

                // Bottom: chat overlay + engagement buttons
                VStack(spacing: 0) {
                    Spacer()

                    HStack(alignment: .bottom) {
                        SimpleChatView(messages: chatVm?.messages ?? [])
                            .frame(maxHeight: 200)

                        VStack(spacing: 16) {
                            Button {
                                hearts.append(HeartFactory.create(in: geo.size))
                            } label: {
                                Image(systemName: "heart.fill")
                                    .font(.system(size: 24))
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(Color.white.opacity(0.15))
                                    .clipShape(Circle())
                            }

                            Button {
                                // Share action
                            } label: {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 22))
                                    .foregroundColor(.white)
                                    .frame(width: 44, height: 44)
                                    .background(Color.white.opacity(0.15))
                                    .clipShape(Circle())
                            }
                        }
                        .padding(.trailing, 8)
                        .padding(.bottom, 20)
                    }
                    .padding(.horizontal, 12)

                    chatInputBar
                }

                FloatingHeartsView(hearts: $hearts)
                BottomGradientOverlay(height: 200, opacity: 0.5)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let url = session.playbackUrl ?? session.recordingHlsUrl else { return }
            playerModel.load(url: url)
            if let token = env.idToken, let username = env.username {
                let vm = ChatViewModel(sessionId: session.id, authToken: token, username: username)
                chatVm = vm
                await vm.connect()
            }
        }
        .onDisappear {
            chatVm?.disconnect()
        }
    }

    @State private var messageText = ""

    private var chatInputBar: some View {
        HStack(spacing: 8) {
            TextField("Say something...", text: $messageText)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.1))
                .cornerRadius(20)
                .onSubmit {
                    let text = messageText
                    messageText = ""
                    chatVm?.send(text)
                }

            Button {
                let text = messageText
                messageText = ""
                chatVm?.send(text)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? .white.opacity(0.3) : .blue)
            }
            .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.6))
    }
}

#Preview {
    FeedView()
        .environmentObject(AppEnvironment())
}
