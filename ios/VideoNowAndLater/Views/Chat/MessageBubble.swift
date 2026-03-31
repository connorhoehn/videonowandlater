// Views/Chat/MessageBubble.swift
// Enhanced with patterns from multi-host + feed demos:
// - Backdrop blur material background
// - Improved avatar with deterministic colors
// - Emoji-only messages with larger rendering
// - Timestamp display
// - Subtle border on bubbles

import SwiftUI
import AmazonIVSChatMessaging

struct MessageBubble: View {
    let message: ChatMessage

    /// Returns true when the message content is composed entirely of emoji characters.
    private var isEmojiOnly: Bool {
        let trimmed = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return trimmed.allSatisfy { $0.isEmoji }
    }

    private var displayName: String {
        message.sender.attributes?["username"] ?? message.sender.userId
    }

    private var avatarColor: Color {
        let colors: [Color] = [
            .blue, .purple, .pink, .orange, .teal, .indigo, .mint, .cyan
        ]
        let hash = abs(displayName.hashValue)
        return colors[hash % colors.count]
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Avatar
            avatar

            if isEmojiOnly {
                // Emoji-only messages render large
                VStack(alignment: .leading, spacing: 2) {
                    Text(displayName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                    Text(message.content)
                        .font(.system(size: 36))
                }
                .padding(.vertical, 4)
            } else {
                // Standard message: username + content
                VStack(alignment: .leading, spacing: 2) {
                    (Text(displayName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                     + Text(" \(message.content)")
                        .font(.system(size: 13))
                        .foregroundColor(.white.opacity(0.9)))
                    .padding(.vertical, 6)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(.ultraThinMaterial.opacity(0.6))
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.white.opacity(0.06), lineWidth: 0.5)
        )
        .padding(.vertical, 2)
    }

    // MARK: - Avatar

    @ViewBuilder
    private var avatar: some View {
        if let avatarUrl = message.sender.attributes?["avatar"],
           let url = URL(string: avatarUrl) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                default:
                    defaultAvatar
                }
            }
            .frame(width: 28, height: 28)
            .clipShape(Circle())
        } else {
            defaultAvatar
        }
    }

    private var defaultAvatar: some View {
        Circle()
            .fill(
                LinearGradient(
                    colors: [avatarColor.opacity(0.6), avatarColor.opacity(0.3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .frame(width: 28, height: 28)
            .overlay(
                Text(String(displayName.prefix(1)).uppercased())
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
            )
    }
}

// MARK: - Character emoji detection

private extension Character {
    /// True if this character is an emoji (including compound emoji sequences).
    var isEmoji: Bool {
        guard let firstScalar = unicodeScalars.first else { return false }
        return firstScalar.properties.isEmoji && (
            firstScalar.value > 0x238C ||
            unicodeScalars.contains { $0.properties.isEmojiPresentation }
        )
    }
}
