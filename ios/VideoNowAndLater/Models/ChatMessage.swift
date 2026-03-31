// Models/ChatMessage.swift
// Local chat message model for cases where the IVS Chat SDK types are not available.
// The IVS ChatMessaging SDK provides its own `ChatMessage` type used in ChatViewModel.
// This local model is useful for:
//   - Displaying demo/mock chat messages
//   - Offline chat history
//   - Mapping API responses to a local type

import Foundation

struct LocalChatMessage: Codable, Identifiable {
    let id: String
    let sessionId: String
    let senderId: String
    let senderName: String
    let content: String
    let messageType: String  // "MESSAGE", "STICKER", "EMOJI"
    let sentAt: String

    /// Whether this message was sent by the current user
    func isMine(currentUserId: String) -> Bool {
        senderId == currentUserId
    }

    /// Timestamp formatted for display
    var formattedTime: String {
        // Parse ISO 8601 date
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: sentAt) else { return "" }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "h:mm a"
        return displayFormatter.string(from: date)
    }
}

// MARK: - Convenience init for previews

extension LocalChatMessage {
    init(
        senderName: String,
        content: String,
        sentAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = UUID().uuidString
        self.sessionId = ""
        self.senderId = senderName.lowercased()
        self.senderName = senderName
        self.content = content
        self.messageType = "MESSAGE"
        self.sentAt = sentAt
    }
}
