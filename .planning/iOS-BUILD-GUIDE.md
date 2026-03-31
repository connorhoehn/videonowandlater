# VideoNowAndLater — iOS App Build Guide
_Created: 2026-03-29 | Source: aws-samples/amazon-ivs-chat-for-ios-demo + amazon-ivs-multi-host-for-ios-demo_

---

## Swift Package Manager Setup

The demo repos use CocoaPods. All three IVS SDKs have SPM distributions:

```
// Package.swift dependencies
.package(url: "https://github.com/aws/amazon-ivs-player-ios-sdk-dist", from: "1.40.0"),
.package(url: "https://github.com/aws/amazon-ivs-broadcast-sdk-ios-dist", from: "1.36.0"),
.package(url: "https://github.com/aws/amazon-ivs-chat-messaging-ios-sdk-dist", from: "1.0.1"),
```

In Xcode: File → Add Package Dependencies → paste each URL above.

**Products to add per target:**
- `AmazonIVSPlayer` — replay & live viewing
- `AmazonIVSBroadcast` (includes `/Stages` for HANGOUT multi-host) — broadcast & hangout
- `AmazonIVSChatMessaging` — chat

> **Note:** Verify the exact SPM repo URLs in the [Amazon IVS iOS docs](https://docs.aws.amazon.com/ivs/) before adding — they follow the `*-dist` pattern but confirm the exact names.

---

## Project Structure

```
VideoNowAndLater/
├── App/
│   ├── VideoNowAndLaterApp.swift
│   └── AppEnvironment.swift          ← auth token, user, API client
├── Config/
│   └── Constants.swift               ← API_URL, AWS region
├── Models/
│   ├── Session.swift                 ← maps to your backend SessionRecord
│   ├── ChatMessage.swift
│   ├── ParticipantData.swift         ← from multi-host demo, unchanged
│   └── SpeakerSegment.swift          ← for transcript click-to-seek
├── ViewModels/
│   ├── SessionFeedViewModel.swift    ← list-sessions + polling
│   ├── BroadcastViewModel.swift      ← IVSBroadcastSession for BROADCAST mode
│   ├── HangoutViewModel.swift        ← IVSStage for HANGOUT mode (= StageViewModel)
│   ├── ReplayViewModel.swift         ← IVSPlayer + transcript + AI summary
│   └── ChatViewModel.swift           ← AmazonIVSChatMessaging
├── Networking/
│   └── APIClient.swift               ← all backend calls with Bearer auth
├── Views/
│   ├── Feed/
│   │   ├── FeedView.swift
│   │   └── SessionCard.swift
│   ├── Broadcast/
│   │   ├── BroadcastView.swift
│   │   └── StreamQualityHUD.swift
│   ├── Hangout/
│   │   ├── HangoutView.swift          ← = StageView
│   │   ├── ParticipantsGridView.swift ← from demo, adapted
│   │   └── ControlButtonsDrawer.swift ← from demo, adapted
│   ├── Replay/
│   │   ├── ReplayView.swift
│   │   ├── TranscriptPanel.swift
│   │   └── SummaryPanel.swift
│   ├── Chat/
│   │   ├── ChatView.swift
│   │   ├── SimpleChatView.swift       ← from demo, adapted
│   │   └── MessageActionsView.swift
│   └── Components/
│       ├── ConfirmDialog.swift
│       ├── PipelineStatusBadge.swift
│       └── RemoteImageView.swift
```

---

## Session Plan

### Session 1 — Bootstrap + Auth + API Client
### Session 2 — Session Feed (Home)
### Session 3 — Replay Player + Transcript
### Session 4 — Live Chat
### Session 5 — BROADCAST Mode
### Session 6 — HANGOUT Mode (Multi-host Stage)
### Session 7 — Polish + Orientation

---

## Session 1: Bootstrap + Auth + API Client

### Constants.swift

```swift
// Config/Constants.swift
import Foundation

enum Constants {
    // Replace with your API Gateway URL
    static let apiUrl = "https://YOUR_API_GATEWAY_ID.execute-api.us-east-1.amazonaws.com/prod"
    static let awsRegion = "us-east-1"

    // Cognito
    static let userPoolId = "us-east-1_XXXXXXXX"
    static let clientId = "XXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

### AppEnvironment.swift

Holds the authenticated user across the app. All views read from this.

```swift
// App/AppEnvironment.swift
import Foundation
import SwiftUI

class AppEnvironment: ObservableObject {
    @Published var idToken: String?
    @Published var username: String?
    @Published var isAuthenticated = false

    // Called after Cognito sign-in returns an idToken
    func setSession(idToken: String, username: String) {
        self.idToken = idToken
        self.username = username
        self.isAuthenticated = true
    }

    func signOut() {
        self.idToken = nil
        self.username = nil
        self.isAuthenticated = false
    }
}
```

### APIClient.swift

Adapted from `Server.swift` in the multi-host demo. Adds `Authorization: Bearer` header (the demo uses no auth — your backend requires it).

```swift
// Networking/APIClient.swift
import Foundation

class APIClient: ObservableObject {
    private let baseUrl = Constants.apiUrl

    // MARK: - Sessions

    func listSessions(authToken: String) async throws -> [Session] {
        let data = try await send("GET", path: "/sessions", body: nil, authToken: authToken)
        return try JSONDecoder().decode([Session].self, from: data)
    }

    func getSession(id: String, authToken: String) async throws -> Session {
        let data = try await send("GET", path: "/sessions/\(id)", body: nil, authToken: authToken)
        return try JSONDecoder().decode(Session.self, from: data)
    }

    // MARK: - Broadcast (BROADCAST mode)

    func createSession(title: String, authToken: String) async throws -> CreateSessionResponse {
        let body = ["title": title]
        let data = try await send("POST", path: "/sessions", body: body, authToken: authToken)
        return try JSONDecoder().decode(CreateSessionResponse.self, from: data)
    }

    // MARK: - Hangout (HANGOUT mode / IVS Stage)

    func joinHangout(sessionId: String, authToken: String) async throws -> JoinHangoutResponse {
        let data = try await send("POST", path: "/sessions/\(sessionId)/join", body: nil, authToken: authToken)
        return try JSONDecoder().decode(JoinHangoutResponse.self, from: data)
    }

    // MARK: - Chat

    func createChatToken(sessionId: String, authToken: String) async throws -> ChatTokenResponse {
        let data = try await send("POST", path: "/sessions/\(sessionId)/chat-token", body: nil, authToken: authToken)
        return try JSONDecoder().decode(ChatTokenResponse.self, from: data)
    }

    // MARK: - Comments (for video/replay pages)

    func addComment(sessionId: String, content: String, timestampMs: Int, authToken: String) async throws -> Comment {
        let body: [String: Any] = ["content": content, "timestampMs": timestampMs]
        let data = try await send("POST", path: "/sessions/\(sessionId)/comments", body: body, authToken: authToken)
        return try JSONDecoder().decode(Comment.self, from: data)
    }

    // MARK: - Core

    private func send(_ method: String, path: String, body: [String: Any]?, authToken: String) async throws -> Data {
        guard let url = URL(string: "\(baseUrl)\(path)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode)
        }

        return data
    }
}

enum APIError: Error {
    case invalidURL
    case httpError(Int)
    case decodingError(Error)
}
```

### Session.swift (model)

Maps to your backend `SessionRecord`. Extend as you expose more fields.

```swift
// Models/Session.swift
import Foundation

struct Session: Identifiable, Codable {
    let id: String
    let title: String?
    let status: String            // "ACTIVE", "ENDED", "PROCESSING"
    let type: String              // "BROADCAST", "HANGOUT", "UPLOAD"
    let createdAt: String
    let recordingHlsUrl: String?
    let thumbnailUrl: String?
    let durationSeconds: Int?
    let transcriptStatus: String? // "processing", "available", "failed"
    let aiSummaryStatus: String?  // "processing", "available", "failed"
    let aiSummary: String?
    let participantCount: Int?

    // Computed
    var isLive: Bool { status == "ACTIVE" }
    var isProcessing: Bool {
        transcriptStatus == "processing" || aiSummaryStatus == "processing"
    }
    var isTerminal: Bool {
        (transcriptStatus == "available" || transcriptStatus == "failed" || transcriptStatus == nil) &&
        (aiSummaryStatus == "available" || aiSummaryStatus == "failed" || aiSummaryStatus == nil)
    }
    var formattedDuration: String {
        guard let s = durationSeconds else { return "" }
        let min = s / 60
        let sec = s % 60
        return "\(min) min \(sec) sec"
    }
}

// Response shapes from your API
struct CreateSessionResponse: Codable {
    let sessionId: String
    let streamKey: String
    let ingestEndpoint: String
    let playbackUrl: String
}

struct JoinHangoutResponse: Codable {
    let token: String      // IVS Stage participant token
    let stageArn: String
}

struct ChatTokenResponse: Codable {
    let token: String
    let sessionId: String
}

struct Comment: Codable, Identifiable {
    let id: String
    let content: String
    let timestampMs: Int
    let authorId: String
    let authorName: String
    let createdAt: String
}

struct SpeakerSegment: Codable, Identifiable {
    let id: String
    let speaker: String
    let text: String
    let startMs: Int
    let endMs: Int
}
```

---

## Session 2: Session Feed (Home)

### SessionFeedViewModel.swift

Polls non-terminal sessions using exponential backoff (15s → 30s → 60s), matching the web implementation.

```swift
// ViewModels/SessionFeedViewModel.swift
import Foundation
import Combine

@MainActor
class SessionFeedViewModel: ObservableObject {
    @Published var sessions: [Session] = []
    @Published var isLoading = false
    @Published var error: String?

    private let api: APIClient
    private var pollTask: Task<Void, Never>?
    private var pollInterval: TimeInterval = 15

    init(api: APIClient) {
        self.api = api
    }

    func load(authToken: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            sessions = try await api.listSessions(authToken: authToken)
            startPollingIfNeeded(authToken: authToken)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startPollingIfNeeded(authToken: String) {
        let hasNonTerminal = sessions.contains { !$0.isTerminal && !$0.isLive }
        guard hasNonTerminal else { return }

        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }

                do {
                    let updated = try await api.listSessions(authToken: authToken)
                    sessions = updated

                    let stillNonTerminal = updated.contains { !$0.isTerminal && !$0.isLive }
                    if stillNonTerminal {
                        // Exponential backoff: 15 → 30 → 60
                        pollInterval = min(pollInterval * 2, 60)
                    } else {
                        pollTask?.cancel()
                    }
                } catch { break }
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        pollInterval = 15
    }
}
```

### FeedView.swift

```swift
// Views/Feed/FeedView.swift
import SwiftUI

struct FeedView: View {
    @EnvironmentObject var env: AppEnvironment
    @StateObject private var vm = SessionFeedViewModel(api: APIClient())

    var body: some View {
        NavigationStack {
            ZStack {
                Color("Background").ignoresSafeArea()
                if vm.isLoading && vm.sessions.isEmpty {
                    ProgressView()
                } else {
                    List(vm.sessions) { session in
                        NavigationLink(destination: destinationView(for: session)) {
                            SessionCard(session: session)
                        }
                        .listRowBackground(Color("BackgroundList"))
                        .listRowSeparator(.hidden)
                    }
                    .listStyle(.plain)
                    .refreshable {
                        guard let token = env.idToken else { return }
                        await vm.load(authToken: token)
                    }
                }
            }
            .navigationTitle("Sessions")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(destination: BroadcastSetupView()) {
                        Image(systemName: "video.badge.plus")
                            .foregroundColor(.white)
                    }
                }
            }
        }
        .task {
            guard let token = env.idToken else { return }
            await vm.load(authToken: token)
        }
        .onDisappear { vm.stopPolling() }
    }

    @ViewBuilder
    private func destinationView(for session: Session) -> some View {
        if session.isLive {
            if session.type == "HANGOUT" {
                HangoutView(session: session)
            } else {
                // viewer mode — IVSPlayer playback
                Text("Live viewer coming soon")
            }
        } else {
            ReplayView(session: session)
        }
    }
}
```

### SessionCard.swift

```swift
// Views/Feed/SessionCard.swift
import SwiftUI

struct SessionCard: View {
    let session: Session

    var body: some View {
        HStack(spacing: 12) {
            // Thumbnail
            if let thumbUrl = session.thumbnailUrl, let url = URL(string: thumbUrl) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Rectangle().fill(Color("BackgroundButton"))
                }
                .frame(width: 80, height: 55)
                .cornerRadius(8)
                .clipped()
            } else {
                Rectangle()
                    .fill(Color("BackgroundButton"))
                    .frame(width: 80, height: 55)
                    .cornerRadius(8)
                    .overlay(Image(systemName: "video").foregroundColor(.gray))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(session.title ?? "Untitled")
                    .foregroundColor(.white)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)

                HStack(spacing: 8) {
                    if session.isLive {
                        liveBadge
                    } else if let duration = session.formattedDuration as String?, !duration.isEmpty {
                        Text(duration)
                            .font(.system(size: 12))
                            .foregroundColor(Color("TextGray1"))
                    }
                    PipelineStatusBadge(session: session)
                }
            }
            Spacer()
        }
        .padding(.vertical, 8)
    }

    private var liveBadge: some View {
        Text("LIVE")
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.red)
            .cornerRadius(4)
    }
}

struct PipelineStatusBadge: View {
    let session: Session

    var body: some View {
        if let label = statusLabel {
            Text(label.text)
                .font(.system(size: 11))
                .foregroundColor(label.color)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(label.color.opacity(0.15))
                .cornerRadius(4)
        }
    }

    private var statusLabel: (text: String, color: Color)? {
        if session.transcriptStatus == "processing" { return ("Transcribing...", .orange) }
        if session.aiSummaryStatus == "processing"  { return ("Summarizing...", .blue) }
        if session.transcriptStatus == "available" && session.aiSummaryStatus == "available" {
            return ("Summary ready", .green)
        }
        if session.transcriptStatus == "failed" || session.aiSummaryStatus == "failed" {
            return ("Processing failed", .red)
        }
        return nil
    }
}
```

---

## Session 3: Replay Player + Transcript

### ReplayViewModel.swift

```swift
// ViewModels/ReplayViewModel.swift
import Foundation
import AmazonIVSPlayer

@MainActor
class ReplayViewModel: NSObject, ObservableObject {
    @Published var session: Session
    @Published var segments: [SpeakerSegment] = []
    @Published var currentPositionMs: Int = 0
    @Published var isLoading = false

    private let api: APIClient
    var player: IVSPlayer?

    init(session: Session, api: APIClient = APIClient()) {
        self.session = session
        self.api = api
    }

    func setup(authToken: String) async {
        // Refresh session for latest transcript/summary state
        do {
            session = try await api.getSession(id: session.id, authToken: authToken)
        } catch { }

        // Load speaker segments if available
        if session.transcriptStatus == "available" {
            await loadSegments(authToken: authToken)
        }
    }

    private func loadSegments(authToken: String) async {
        do {
            let data = try await api.send("GET", path: "/sessions/\(session.id)/speaker-segments", authToken: authToken)
            segments = try JSONDecoder().decode([SpeakerSegment].self, from: data)
        } catch { }
    }

    func seek(to segment: SpeakerSegment) {
        let seconds = Double(segment.startMs) / 1000.0
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 1000))
    }

    func pollUntilReady(authToken: String) async {
        // Poll until transcript and summary both have terminal status
        while !session.isTerminal {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            do {
                session = try await api.getSession(id: session.id, authToken: authToken)
                if session.transcriptStatus == "available" && segments.isEmpty {
                    await loadSegments(authToken: authToken)
                }
            } catch { break }
        }
    }
}
```

### PlayerModel.swift (adapted from chat demo)

```swift
// ViewModels/PlayerModel.swift
import AmazonIVSPlayer
import AVFoundation

class PlayerModel: NSObject, ObservableObject, IVSPlayer.Delegate {
    @Published var state: IVSPlayer.State = .idle
    @Published var isReady = false
    let player = IVSPlayer()

    override init() {
        super.init()
        player.delegate = self
    }

    func load(url: String) {
        guard let u = URL(string: url) else { return }
        player.load(u)
    }

    // MARK: - IVSPlayer.Delegate
    func player(_ player: IVSPlayer, didChangeState state: IVSPlayer.State) {
        DispatchQueue.main.async { self.state = state }
        if state == .ready {
            player.play()
            DispatchQueue.main.async { self.isReady = true }
        }
    }

    func player(_ player: IVSPlayer, didFailWithError error: Error) {
        print("❌ IVSPlayer error: \(error)")
    }
}
```

### ReplayView.swift

```swift
// Views/Replay/ReplayView.swift
import SwiftUI
import AmazonIVSPlayer

struct ReplayView: View {
    @EnvironmentObject var env: AppEnvironment
    @StateObject private var vm: ReplayViewModel
    @StateObject private var playerModel = PlayerModel()
    @State private var showTranscript = true

    init(session: Session) {
        _vm = StateObject(wrappedValue: ReplayViewModel(session: session))
    }

    var body: some View {
        ZStack {
            Color("Background").ignoresSafeArea()
            VStack(spacing: 0) {
                // Player
                IVSPlayerView(player: playerModel.player)
                    .aspectRatio(16/9, contentMode: .fit)
                    .background(Color.black)

                // Summary panel
                SummaryPanel(session: vm.session)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                // Transcript toggle + panel
                if !vm.segments.isEmpty {
                    HStack {
                        Text("Transcript")
                            .foregroundColor(.white)
                            .font(.system(size: 14, weight: .semibold))
                        Spacer()
                        Button(showTranscript ? "Hide" : "Show") {
                            withAnimation { showTranscript.toggle() }
                        }
                        .foregroundColor(.blue)
                        .font(.system(size: 14))
                    }
                    .padding(.horizontal, 16)

                    if showTranscript {
                        TranscriptPanel(segments: vm.segments) { segment in
                            vm.seek(to: segment)
                        }
                    }
                }
                Spacer()
            }
        }
        .navigationTitle(vm.session.title ?? "Replay")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let token = env.idToken, let url = vm.session.recordingHlsUrl else { return }
            playerModel.load(url: url)
            await vm.setup(authToken: token)
            if !vm.session.isTerminal {
                await vm.pollUntilReady(authToken: token)
            }
        }
    }
}
```

### TranscriptPanel.swift

```swift
// Views/Replay/TranscriptPanel.swift
import SwiftUI

struct TranscriptPanel: View {
    let segments: [SpeakerSegment]
    let onSeek: (SpeakerSegment) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(segments) { segment in
                    Button {
                        onSeek(segment)
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Text(formatTime(segment.startMs))
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundColor(.blue)
                                .frame(width: 40, alignment: .leading)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(segment.speaker)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(Color("TextGray1"))
                                Text(segment.text)
                                    .font(.system(size: 13))
                                    .foregroundColor(.white)
                                    .multilineTextAlignment(.leading)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                    }
                    Divider().background(Color("TextGray1").opacity(0.3))
                }
            }
        }
        .frame(maxHeight: 280)
    }

    private func formatTime(_ ms: Int) -> String {
        let totalSeconds = ms / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
```

### SummaryPanel.swift

Three distinct visual states matching the web implementation (Phase 40).

```swift
// Views/Replay/SummaryPanel.swift
import SwiftUI

struct SummaryPanel: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("AI Summary")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color("TextGray1"))

            content
        }
        .padding(12)
        .background(Color("BackgroundButton"))
        .cornerRadius(12)
    }

    @ViewBuilder
    private var content: some View {
        switch session.aiSummaryStatus {
        case "processing":
            HStack(spacing: 8) {
                ProgressView().scaleEffect(0.7)
                Text("Generating summary…")
                    .font(.system(size: 13))
                    .foregroundColor(Color("TextGray1"))
            }
        case "available":
            if let summary = session.aiSummary {
                Text(summary)
                    .font(.system(size: 14))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case "failed":
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundColor(.orange)
                Text("Summary generation failed")
                    .font(.system(size: 13))
                    .foregroundColor(.orange)
            }
        default:
            EmptyView()
        }
    }
}
```

---

## Session 4: Live Chat

### ChatViewModel.swift

Adapted from `ViewModel.swift` in the chat demo. Key change: fetches the IVS chat token from your `create-chat-token` backend endpoint instead of using a hardcoded `chatRoomId`.

```swift
// ViewModels/ChatViewModel.swift
import Foundation
import AmazonIVSChatMessaging

@MainActor
class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isConnected = false
    @Published var error: String?

    private var room: ChatRoom?
    private let sessionId: String
    private let api: APIClient
    private let authToken: String
    private let username: String

    init(sessionId: String, authToken: String, username: String, api: APIClient = APIClient()) {
        self.sessionId = sessionId
        self.authToken = authToken
        self.username = username
        self.api = api
    }

    func connect() async {
        do {
            let tokenResponse = try await api.createChatToken(sessionId: sessionId, authToken: authToken)

            room = ChatRoom(awsRegion: Constants.awsRegion) {
                return ChatToken(token: tokenResponse.token)
            }
            room?.delegate = self
            try await room?.connect()
        } catch {
            self.error = "Chat connection failed: \(error.localizedDescription)"
        }
    }

    func disconnect() {
        room?.disconnect()
        room = nil
        isConnected = false
    }

    func send(_ text: String) {
        room?.sendMessage(
            with: SendMessageRequest(content: text, attributes: ["message_type": "MESSAGE"]),
            onSuccess: { _ in },
            onFailure: { [weak self] error in
                DispatchQueue.main.async { self?.error = error.localizedDescription }
            }
        )
    }

    // Moderator only
    func deleteMessage(id: String) {
        room?.deleteMessage(with: DeleteMessageRequest(id: id, reason: "Moderated"),
                           onSuccess: { _ in },
                           onFailure: { _ in })
    }
}

extension ChatViewModel: ChatRoomDelegate {
    func roomDidConnect(_ room: ChatRoom) {
        DispatchQueue.main.async { self.isConnected = true }
    }

    func roomDidDisconnect(_ room: ChatRoom) {
        DispatchQueue.main.async { self.isConnected = false }
    }

    func room(_ room: ChatRoom, didReceive message: ChatMessage) {
        DispatchQueue.main.async {
            self.messages.append(message)
        }
    }

    func room(_ room: ChatRoom, didDelete message: DeletedMessage) {
        DispatchQueue.main.async {
            self.messages.removeAll { $0.id == message.messageID }
        }
    }

    func room(_ room: ChatRoom, didReceive event: ChatEvent) {}
    func room(_ room: ChatRoom, didDisconnect user: DisconnectedUser) {
        DispatchQueue.main.async {
            self.messages.removeAll { $0.sender.userId == user.userId }
        }
    }
}
```

### SimpleChatView.swift (adapted from chat demo)

The demo's `SimpleChatView` is almost exactly right. Only change: use `ChatMessage` (IVS type) directly instead of the demo's local `Message` wrapper.

```swift
// Views/Chat/SimpleChatView.swift
import SwiftUI
import AmazonIVSChatMessaging

struct SimpleChatView: View {
    let messages: [ChatMessage]
    var onLongPress: ((ChatMessage) -> Void)?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(messages, id: \.id) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                            .onLongPressGesture {
                                onLongPress?(message)
                            }
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: messages.count)
                .padding(.horizontal, 12)
            }
            .onChange(of: messages.count) { _ in
                if let last = messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Avatar
            if let avatarUrl = message.sender.attributes?["avatar"],
               let url = URL(string: avatarUrl) {
                AsyncImage(url: url) { img in img.resizable().scaledToFill() }
                    placeholder: { Circle().fill(Color("BackgroundButton")) }
                    .frame(width: 28, height: 28)
                    .clipShape(Circle())
            }

            VStack(alignment: .leading, spacing: 2) {
                // Username + content on same line (matches demo style)
                (Text(message.sender.attributes?["username"] ?? message.sender.userId)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(.white)
                 + Text(" \(message.content)")
                    .font(.system(size: 13))
                    .foregroundColor(.white))
                .padding(.vertical, 6)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Color("Background").opacity(0.7))
        .cornerRadius(20)
        .padding(.vertical, 2)
    }
}
```

---

## Session 5: BROADCAST Mode

### BroadcastViewModel.swift

```swift
// ViewModels/BroadcastViewModel.swift
import Foundation
import AmazonIVSBroadcast
import UIKit

@MainActor
class BroadcastViewModel: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var isMuted = false
    @Published var isCameraOff = false
    @Published var error: String?
    @Published var streamHealth: String = ""  // from IVS metrics

    private var session: IVSBroadcastSession?
    private let deviceDiscovery = IVSDeviceDiscovery()
    private var camera: IVSCamera?
    private var microphone: IVSMicrophone?

    // From your create-session response
    var ingestEndpoint: String = ""
    var streamKey: String = ""

    func setup() {
        let config = IVSPresets.configurations().standardPortrait()
        do {
            session = try IVSBroadcastSession(configuration: config, descriptors: nil, delegate: self)
            attachDevices()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func startBroadcast(ingestEndpoint: String, streamKey: String) {
        self.ingestEndpoint = ingestEndpoint
        self.streamKey = streamKey
        guard let rtmpsUrl = URL(string: "rtmps://\(ingestEndpoint)") else { return }
        do {
            try session?.start(with: rtmpsUrl, streamKey: streamKey)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stopBroadcast() {
        session?.stop()
        isConnected = false
    }

    func toggleMute() {
        // Mute audio stream
        deviceDiscovery.listLocalDevices()
            .compactMap { $0 as? IVSMicrophone }
            .first
            .map { mic in
                isMuted.toggle()
                // Adjust gain: 0 = muted, 1 = full
                mic.setGain(isMuted ? 0 : 1)
            }
    }

    func toggleCamera() {
        isCameraOff.toggle()
        deviceDiscovery.listLocalDevices()
            .compactMap { $0 as? IVSCamera }
            .first
            .map { cam in
                // Mute the video stream
                session?.listAttachedDevices()
                    .filter { $0.descriptor().type == .camera }
                    .forEach { device in
                        if isCameraOff {
                            session?.detach(device)
                        } else {
                            session?.attach(device, toSlotWithName: "default")
                        }
                    }
            }
    }

    func previewView() -> IVSImagePreviewView? {
        return try? session?.previewView(with: .fill)
    }

    private func attachDevices() {
        let devices = deviceDiscovery.listLocalDevices()
        if let cam = devices.compactMap({ $0 as? IVSCamera }).first {
            camera = cam
            session?.attach(cam, toSlotWithName: "default")
        }
        if let mic = devices.compactMap({ $0 as? IVSMicrophone }).first {
            microphone = mic
            session?.attach(mic, toSlotWithName: "default")
        }
    }
}

extension BroadcastViewModel: IVSBroadcastSession.Delegate {
    func broadcastSession(_ session: IVSBroadcastSession, didChange state: IVSBroadcastSession.State) {
        DispatchQueue.main.async {
            switch state {
            case .connecting, .connected: self.isConnected = true
            case .disconnected, .invalid, .error: self.isConnected = false
            @unknown default: break
            }
        }
    }

    func broadcastSession(_ session: IVSBroadcastSession, didEmit error: Error) {
        DispatchQueue.main.async { self.error = error.localizedDescription }
    }
}
```

### BroadcastView.swift

```swift
// Views/Broadcast/BroadcastView.swift
import SwiftUI
import AmazonIVSBroadcast

struct BroadcastView: View {
    @EnvironmentObject var env: AppEnvironment
    @StateObject private var vm = BroadcastViewModel()
    @StateObject private var chatVm: ChatViewModel
    @State private var showConfirmStop = false
    @State private var sessionId: String
    @State private var isControlsExpanded = false

    init(sessionId: String, ingestEndpoint: String, streamKey: String, authToken: String) {
        self.sessionId = sessionId
        _chatVm = StateObject(wrappedValue: ChatViewModel(
            sessionId: sessionId,
            authToken: authToken,
            username: ""
        ))
    }

    var body: some View {
        ZStack {
            Color("Background").ignoresSafeArea()

            // Camera preview fills screen
            BroadcastPreviewView(broadcastVm: vm)
                .edgesIgnoringSafeArea(.all)

            VStack {
                // Header
                HStack {
                    Button {
                        showConfirmStop = true
                    } label: {
                        Image(systemName: "xmark")
                            .foregroundColor(.white)
                            .padding(10)
                            .background(Color.black.opacity(0.4))
                            .clipShape(Circle())
                    }
                    Spacer()
                    if vm.isConnected {
                        livePill
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

                // Chat overlay (bottom 40% of screen)
                SimpleChatView(messages: chatVm.messages)
                    .frame(maxHeight: 200)
                    .allowsHitTesting(false)  // messages don't block camera tap

                // Controls drawer (from multi-host demo pattern)
                ControlButtonsDrawer(
                    isMuted: $vm.isMuted,
                    isCameraOff: $vm.isCameraOff,
                    isExpanded: $isControlsExpanded,
                    onMute: { vm.toggleMute() },
                    onCamera: { vm.toggleCamera() },
                    onStop: { showConfirmStop = true }
                )
            }
        }
        .alert("Stop Broadcast?", isPresented: $showConfirmStop) {
            Button("Stop", role: .destructive) { vm.stopBroadcast() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will end your live session for all viewers.")
        }
        .onAppear { vm.setup() }
        .task { await chatVm.connect() }
        .onDisappear { chatVm.disconnect() }
    }

    private var livePill: some View {
        HStack(spacing: 4) {
            Circle().fill(Color.red).frame(width: 6, height: 6)
            Text("LIVE").font(.system(size: 11, weight: .bold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.black.opacity(0.5))
        .cornerRadius(12)
    }
}

struct BroadcastPreviewView: UIViewRepresentable {
    let broadcastVm: BroadcastViewModel

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black
        if let preview = broadcastVm.previewView() {
            preview.frame = container.bounds
            preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(preview)
        }
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
```

---

## Session 6: HANGOUT Mode (Multi-host Stage)

`HangoutViewModel` is essentially `StageViewModel` from the demo, wired to your backend.

### HangoutViewModel.swift

The key difference from the demo's `StageViewModel`: join token comes from your `join-hangout` Lambda, not the demo's `joinStage` endpoint.

```swift
// ViewModels/HangoutViewModel.swift
import Foundation
import AmazonIVSBroadcast
import UIKit

class HangoutViewModel: NSObject, ObservableObject {
    @Published var sessionRunning = false
    @Published var stageConnectionState: IVSStageConnectionState = .disconnected
    @Published var participantsData: [ParticipantData] = []
    @Published var localUserAudioMuted = false
    @Published var localUserVideoMuted = false
    @Published var notifications: [String] = []
    @Published var isBroadcasting = false

    var participantCount: Int { participantsData.count }

    private var stage: IVSStage?
    var localStreams: [IVSLocalStageStream] = []
    let deviceDiscovery = IVSDeviceDiscovery()
    let deviceSlotName = UUID().uuidString

    private let api: APIClient
    private let authToken: String
    private let username: String

    init(authToken: String, username: String, api: APIClient = APIClient()) {
        self.authToken = authToken
        self.username = username
        self.api = api
        super.init()
        setupLocalUser()
        setupBackgroundObservers()
    }

    // MARK: - Join via your backend

    func join(sessionId: String) async throws {
        let response = try await api.joinHangout(sessionId: sessionId, authToken: authToken)
        await MainActor.run { joinStage(token: response.token) }
    }

    private func joinStage(token: String) {
        do {
            let s = try IVSStage(token: token, strategy: self)
            s.addRenderer(self)
            s.errorDelegate = self
            try s.join()
            stage = s
            sessionRunning = true
        } catch {
            notifications.append("Failed to join: \(error.localizedDescription)")
        }
    }

    func leave() {
        stage?.leave()
        stage = nil
        sessionRunning = false
        while participantsData.count > 1 {
            participantsData.removeLast()
        }
    }

    // MARK: - Local user setup (identical to demo)

    private func setupLocalUser() {
        let devices = deviceDiscovery.listLocalDevices()

        if let mic = devices.compactMap({ $0 as? IVSMicrophone }).first {
            mic.isEchoCancellationEnabled = true
            localStreams.append(IVSLocalStageStream(device: mic))
        }

        if let cam = devices.compactMap({ $0 as? IVSCamera }).first {
            localStreams.append(IVSLocalStageStream(device: cam))
        }

        let local = ParticipantData(isLocal: true, info: nil, participantId: nil)
        local.username = username
        participantsData.append(local)
        participantsData[0].streams = localStreams
    }

    func toggleMute() {
        localStreams.filter { $0.device is IVSAudioDevice }.forEach {
            $0.setMuted(!$0.isMuted)
            localUserAudioMuted = $0.isMuted
        }
    }

    func toggleCamera() {
        localStreams.filter { $0.device is IVSImageDevice }.forEach {
            $0.setMuted(!$0.isMuted)
            localUserVideoMuted = $0.isMuted
        }
    }

    func mutatingParticipant(_ participantId: String?, modifier: (inout ParticipantData) -> Void) {
        guard let idx = participantsData.firstIndex(where: { $0.participantId == participantId }) else { return }
        var p = participantsData[idx]
        modifier(&p)
        participantsData[idx] = p
    }

    private func setupBackgroundObservers() {
        NotificationCenter.default.addObserver(self,
            selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self,
            selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func didEnterBackground() {
        // Drop video, keep audio when backgrounded
        participantsData.compactMap { $0.participantId }.forEach { id in
            mutatingParticipant(id) { $0.requiresAudioOnly = true }
        }
        stage?.refreshStrategy()
    }

    @objc private func willEnterForeground() {
        participantsData.compactMap { $0.participantId }.forEach { id in
            mutatingParticipant(id) { $0.requiresAudioOnly = false }
        }
        stage?.refreshStrategy()
    }
}

// MARK: - IVSStageStrategy (subscription decisions)
// Direct port from StageViewModel+Extensions.swift in the multi-host demo
extension HangoutViewModel: IVSStageStrategy {
    func stage(_ stage: IVSStage, shouldSubscribeTo participant: IVSParticipantInfo) -> IVSStageSubscribeType {
        guard let data = participantsData.first(where: { $0.participantId == participant.participantId }) else {
            return .audioVideo
        }
        if data.isAudioOnly { return .audioOnly }
        return data.wantsSubscribed ? .audioVideo : .none
    }

    func stage(_ stage: IVSStage, shouldPublishParticipant participant: IVSParticipantInfo) -> Bool {
        return true
    }

    func stage(_ stage: IVSStage, streamsToPublishForParticipant participant: IVSParticipantInfo) -> [IVSLocalStageStream] {
        return localStreams
    }
}

// MARK: - IVSStageRenderer (participant lifecycle)
extension HangoutViewModel: IVSStageRenderer {
    func stage(_ stage: IVSStage, participantDidJoin participant: IVSParticipantInfo) {
        guard !participant.isLocal else { return }
        DispatchQueue.main.async {
            let data = ParticipantData(isLocal: false, info: participant, participantId: participant.participantId)
            self.participantsData.append(data)
        }
    }

    func stage(_ stage: IVSStage, participantDidLeave participant: IVSParticipantInfo) {
        DispatchQueue.main.async {
            self.participantsData.removeAll { $0.participantId == participant.participantId }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange publishState: IVSParticipantPublishState) {
        mutatingParticipant(participant.participantId) { $0.publishState = publishState }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange subscribeState: IVSParticipantSubscribeState) {
        mutatingParticipant(participant.participantId) { $0.subscribeState = subscribeState }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didAdd streams: [IVSStageStream]) {
        mutatingParticipant(participant.participantId) { data in
            data.streams += streams.filter { stream in !data.streams.contains(where: { $0.device === stream.device }) }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didRemove streams: [IVSStageStream]) {
        mutatingParticipant(participant.participantId) { data in
            data.streams.removeAll { stream in streams.contains(where: { $0.device === stream.device }) }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didMuteMicrophone isMuted: Bool) {
        mutatingParticipant(participant.participantId) { $0.isAudioMuted = isMuted }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didMuteCamera isMuted: Bool) {
        mutatingParticipant(participant.participantId) { $0.isVideoMuted = isMuted }
    }

    func stage(_ stage: IVSStage, connectionStateDidChange state: IVSStageConnectionState) {
        DispatchQueue.main.async { self.stageConnectionState = state }
    }
}

extension HangoutViewModel: IVSErrorDelegate {
    func source(_ source: IVSErrorSource, didEmitError error: Error) {
        DispatchQueue.main.async { self.notifications.append(error.localizedDescription) }
    }
}
```

### HangoutView.swift

Directly adapted from `StageView.swift` in the multi-host demo.

```swift
// Views/Hangout/HangoutView.swift
import SwiftUI

struct HangoutView: View {
    @EnvironmentObject var env: AppEnvironment
    let session: Session
    @StateObject private var vm: HangoutViewModel
    @StateObject private var chatVm: ChatViewModel
    @State private var isControlsExpanded = false
    @State private var isChatPresent = false
    @State private var showLeaveConfirm = false
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
        ZStack(alignment: .top) {
            Color("Background").ignoresSafeArea()

            VStack(spacing: 0) {
                // Header (from demo HeaderView)
                HStack {
                    Button {
                        showLeaveConfirm = true
                    } label: {
                        Image(systemName: "xmark")
                            .resizable().frame(width: 12, height: 12)
                            .foregroundColor(.white)
                            .padding()
                    }
                    Spacer()
                    Text(session.title ?? "Hangout")
                        .foregroundColor(.white)
                        .font(.system(size: 16, weight: .semibold))
                    Spacer()
                    // Participant count
                    HStack(spacing: 4) {
                        Image(systemName: "person.2")
                        Text("\(vm.participantCount)")
                    }
                    .foregroundColor(.white)
                    .padding()
                }

                ZStack(alignment: .bottom) {
                    // Participant video grid (direct port from demo)
                    ParticipantsGridView(viewModel: vm)
                        .onTapGesture {
                            UIApplication.shared.sendAction(
                                #selector(UIResponder.resignFirstResponder),
                                to: nil, from: nil, for: nil)
                            withAnimation { isControlsExpanded = false }
                        }
                        .cornerRadius(40)
                        .padding(.bottom, 80)

                    // Chat overlay
                    if isChatPresent {
                        SimpleChatView(messages: chatVm.messages)
                            .frame(maxHeight: 180)
                            .padding(.bottom, 80)
                            .allowsHitTesting(false)
                    }

                    // Controls drawer
                    ControlButtonsDrawer(
                        isMuted: $vm.localUserAudioMuted,
                        isCameraOff: $vm.localUserVideoMuted,
                        isExpanded: $isControlsExpanded,
                        onMute: { vm.toggleMute() },
                        onCamera: { vm.toggleCamera() },
                        onStop: { showLeaveConfirm = true }
                    )
                    .padding(.bottom, !isControlsExpanded ? -145 : 0)
                    .onTapGesture {
                        guard !isControlsExpanded else { return }
                        withAnimation { isControlsExpanded = true }
                    }
                }
            }
        }
        .alert("Leave Hangout?", isPresented: $showLeaveConfirm) {
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
            if state == .disconnected && vm.sessionRunning == false { dismiss() }
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
}
```

### ParticipantsGridView.swift (direct port)

```swift
// Views/Hangout/ParticipantsGridView.swift
// Directly ported from amazon-ivs-multi-host-for-ios-demo
import SwiftUI
import AmazonIVSBroadcast

struct ParticipantsGridView: View {
    @ObservedObject var viewModel: HangoutViewModel

    var body: some View {
        if viewModel.sessionRunning {
            switch viewModel.participantCount {
            case 0:
                EmptyView()
            case 1:
                viewModel.participantsData[0].previewView
            case 2:
                VStack {
                    viewModel.participantsData[0].previewView.cornerRadius(40)
                    viewModel.participantsData[1].previewView.cornerRadius(40)
                }
            case 3:
                VStack {
                    viewModel.participantsData[0].previewView.cornerRadius(40)
                    HStack {
                        viewModel.participantsData[1].previewView.cornerRadius(40)
                        viewModel.participantsData[2].previewView.cornerRadius(40)
                    }
                }
            default:
                VStack {
                    HStack {
                        viewModel.participantsData[0].previewView.cornerRadius(40)
                        viewModel.participantsData[1].previewView.cornerRadius(40)
                    }
                    HStack {
                        viewModel.participantsData[2].previewView.cornerRadius(40)
                        viewModel.participantsData[3].previewView.cornerRadius(40)
                    }
                }
            }
        } else {
            Spacer()
        }
    }
}
```

### ControlButtonsDrawer.swift (adapted from demo)

Simplified to work for both Broadcast and Hangout. Demo original has host-specific buttons (copy URL, start stream) — replaced with a single stop/leave button.

```swift
// Views/Components/ControlButtonsDrawer.swift
import SwiftUI

struct ControlButtonsDrawer: View {
    @Binding var isMuted: Bool
    @Binding var isCameraOff: Bool
    @Binding var isExpanded: Bool
    var onMute: () -> Void
    var onCamera: () -> Void
    var onStop: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(Color.white.opacity(0.4))
                .frame(width: 40, height: 4)
                .padding(.top, 8)
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onEnded { value in
                            withAnimation {
                                isExpanded = value.translation.height < -60
                            }
                        }
                )

            if isExpanded {
                HStack(spacing: 20) {
                    ControlButton(
                        icon: isMuted ? "mic.slash" : "mic",
                        label: isMuted ? "Unmute" : "Mute",
                        backgroundColor: isMuted ? Color.red : Color("BackgroundButton")
                    ) { onMute() }

                    ControlButton(
                        icon: isCameraOff ? "video.slash" : "video",
                        label: isCameraOff ? "Camera off" : "Camera",
                        backgroundColor: isCameraOff ? Color.red : Color("BackgroundButton")
                    ) { onCamera() }

                    ControlButton(
                        icon: "stop.circle",
                        label: "End",
                        backgroundColor: Color.red
                    ) { onStop() }
                }
                .padding(.vertical, 16)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(
            Color("Background")
                .opacity(0.95)
                .cornerRadius(24, corners: [.topLeft, .topRight])
        )
    }
}

struct ControlButton: View {
    let icon: String
    let label: String
    var backgroundColor: Color = Color("BackgroundButton")
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 52, height: 52)
                    .background(backgroundColor)
                    .clipShape(Circle())
                Text(label)
                    .font(.system(size: 11))
                    .foregroundColor(Color("TextGray1"))
            }
        }
    }
}

// Helper for partial corner radius
extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner
    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(roundedRect: rect,
                                byRoundingCorners: corners,
                                cornerRadii: CGSize(width: radius, height: radius))
        return Path(path.cgPath)
    }
}
```

---

## Session 7: Polish + Orientation

### Orientation-aware player layout

```swift
// Pattern for orientation-responsive views
struct AdaptivePlayerView: View {
    @Environment(\.horizontalSizeClass) var hSize
    @StateObject private var orientationObserver = OrientationObserver()

    var body: some View {
        Group {
            if orientationObserver.isLandscape {
                // Full-screen player, controls floating
                ZStack {
                    playerFill
                    floatingControls
                }
                .ignoresSafeArea()
            } else {
                // Portrait: player top, content below
                VStack(spacing: 0) {
                    playerAspect
                    contentPanel
                }
            }
        }
    }
}

class OrientationObserver: ObservableObject {
    @Published var isLandscape = false

    init() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(orientationChanged),
            name: UIDevice.orientationDidChangeNotification,
            object: nil
        )
    }

    @objc private func orientationChanged() {
        let o = UIDevice.current.orientation
        DispatchQueue.main.async {
            self.isLandscape = o == .landscapeLeft || o == .landscapeRight
        }
    }
}
```

### IVSPlayerView (UIViewRepresentable bridge)

```swift
// Views/Components/IVSPlayerView.swift
import SwiftUI
import AmazonIVSPlayer

struct IVSPlayerView: UIViewRepresentable {
    let player: IVSPlayer

    func makeUIView(context: Context) -> IVSPlayerView {
        let view = IVSPlayerView()
        view.player = player
        view.videoGravity = .resizeAspect
        return view
    }

    func updateUIView(_ uiView: IVSPlayerView, context: Context) {
        uiView.player = player
    }
}
```

---

## Color Assets (from demo — add to Assets.xcassets)

Create these color set names to match the demo's dark theme:

| Name | Light | Dark |
|------|-------|------|
| `Background` | #1a1a1a | #1a1a1a |
| `BackgroundList` | #222222 | #222222 |
| `BackgroundButton` | #333333 | #333333 |
| `TextGray1` | #8e8e93 | #8e8e93 |
| `appGreen` | #30d158 | #30d158 |
| `appRed` | #ff453a | #ff453a |

---

## Backend Endpoints Required (verify with your API Gateway)

| iOS call | Method | Path | Handler |
|----------|--------|------|---------|
| List sessions | GET | `/sessions` | `list-sessions` |
| Get session | GET | `/sessions/:id` | `get-session` |
| Create broadcast | POST | `/sessions` | `create-session` |
| Join hangout | POST | `/sessions/:id/join` | `join-hangout` |
| Get chat token | POST | `/sessions/:id/chat-token` | `create-chat-token` |
| Get speaker segments | GET | `/sessions/:id/speaker-segments` | new or extend `get-session` |

> **Speaker segments endpoint**: your current pipeline stores `speaker-segments.json` to S3. Either extend `get-session` to fetch and return it, or add a lightweight `GET /sessions/:id/speaker-segments` Lambda.

---

## Key Decisions vs Demo Defaults

| Demo default | VNL adaptation |
|--------------|----------------|
| Hardcoded `chatRoomId` in Constants | Fetched per-session from `create-chat-token` |
| No auth header on API calls | `Authorization: Bearer \(idToken)` on every call |
| `userId` = random UUID | `userId` = `cognito:username` from idToken |
| `StageViewModel` owns server + stage | Split: `APIClient` handles network, `HangoutViewModel` handles stage |
| CocoaPods | Swift Package Manager |
| Single chat room globally | One `ChatRoom` per session, connected/disconnected with the view |
