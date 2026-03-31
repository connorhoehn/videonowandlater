// Demo/DemoChatView.swift
// Chat overlay for demo replay — simulates messages appearing as video plays, no IVS SDK needed

import SwiftUI

struct DemoChatView: View {
    let currentPositionMs: Int
    private let allMessages = DemoData.chatMessages

    private var visibleMessages: [DemoData.DemoChatMessage] {
        allMessages.filter { $0.timestampMs <= currentPositionMs }
    }

    var body: some View {
        ZStack(alignment: .top) {
            // Fade gradient at top
            LinearGradient(
                colors: [Color.black.opacity(0.4), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 30)
            .allowsHitTesting(false)
            .zIndex(1)

            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(visibleMessages) { message in
                            DemoChatBubble(message: message)
                                .id(message.id)
                                .transition(.asymmetric(
                                    insertion: .move(edge: .bottom).combined(with: .opacity),
                                    removal: .opacity
                                ))
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .onChange(of: visibleMessages.count) { _ in
                    if let last = visibleMessages.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: visibleMessages.count)
    }
}

// MARK: - Chat Bubble (standalone, no IVS SDK dependency)

private struct DemoChatBubble: View {
    let message: DemoData.DemoChatMessage

    private var avatarColor: Color {
        let colors: [Color] = [
            .blue, .purple, .pink, .orange, .teal, .indigo, .mint, .cyan
        ]
        let hash = abs(message.senderName.hashValue)
        return colors[hash % colors.count]
    }

    private var isEmojiOnly: Bool {
        let trimmed = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        return trimmed.allSatisfy { char in
            guard let firstScalar = char.unicodeScalars.first else { return false }
            return firstScalar.properties.isEmoji && (
                firstScalar.value > 0x238C ||
                char.unicodeScalars.contains { $0.properties.isEmojiPresentation }
            )
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            // Avatar
            Circle()
                .fill(avatarColor.opacity(0.4))
                .frame(width: 28, height: 28)
                .overlay(
                    Text(String(message.senderName.prefix(1)).uppercased())
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                )

            if isEmojiOnly {
                VStack(alignment: .leading, spacing: 2) {
                    Text(message.senderName)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                    Text(message.content)
                        .font(.system(size: 36))
                }
                .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    (Text(message.senderName)
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
}
