// Views/Chat/SimpleChatView.swift
// Enhanced with patterns from multi-host demo:
// - Inverted scroll (newest at bottom, auto-anchored)
// - Message entrance animation (slide up + fade in)
// - Chat gradient at top for fade effect
// - Smoother auto-scroll behavior

import SwiftUI
import AmazonIVSChatMessaging

struct SimpleChatView: View {
    let messages: [ChatMessage]
    var onLongPress: ((ChatMessage) -> Void)?

    var body: some View {
        ZStack(alignment: .top) {
            // Chat gradient overlay at top (from multi-host demo)
            LinearGradient(
                gradient: Gradient(colors: [Color.black.opacity(0.4), .clear]),
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 30)
            .allowsHitTesting(false)
            .zIndex(1)

            // Inverted scroll (from multi-host demo)
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(messages, id: \.id) { message in
                            AnimatedMessageRow(message: message, onLongPress: onLongPress)
                                .id(message.id)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                .onChange(of: messages.count) { _ in
                    if let last = messages.last {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Animated Message Row (from multi-host demo: slide up + fade in)

private struct AnimatedMessageRow: View {
    let message: ChatMessage
    let onLongPress: ((ChatMessage) -> Void)?

    @State private var offsetY: CGFloat = 30
    @State private var opacity: Double = 0

    var body: some View {
        MessageBubble(message: message)
            .offset(y: offsetY)
            .opacity(opacity)
            .onAppear {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    offsetY = 0
                    opacity = 1
                }
            }
            .onLongPressGesture {
                onLongPress?(message)
            }
    }
}
