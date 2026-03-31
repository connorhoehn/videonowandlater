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
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        room?.sendMessage(
            with: SendMessageRequest(content: trimmed, attributes: ["message_type": "MESSAGE"]),
            onSuccess: { _ in },
            onFailure: { [weak self] error in
                DispatchQueue.main.async { self?.error = error.localizedDescription }
            }
        )
    }

    func deleteMessage(id: String) {
        room?.deleteMessage(
            with: DeleteMessageRequest(id: id, reason: "Moderated"),
            onSuccess: { _ in },
            onFailure: { _ in }
        )
    }
}

// MARK: - ChatRoomDelegate

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

    func room(_ room: ChatRoom, didReceive event: ChatEvent) {
        // Handle custom events (e.g., reactions) in the future
    }

    func room(_ room: ChatRoom, didDisconnect user: DisconnectedUser) {
        DispatchQueue.main.async {
            self.messages.removeAll { $0.sender.userId == user.userId }
        }
    }
}
