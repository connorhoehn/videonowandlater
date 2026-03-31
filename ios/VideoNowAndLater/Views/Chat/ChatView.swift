// Views/Chat/ChatView.swift
// Enhanced with patterns from multi-host demo:
// - Keyboard dismissal on tap
// - Quick reaction bar above input
// - Improved connection status styling
// - Smooth keyboard handling

import SwiftUI
import AmazonIVSChatMessaging

struct ChatView: View {
    @ObservedObject var viewModel: ChatViewModel
    @State private var messageText = ""
    @State private var selectedMessage: ChatMessage?
    @State private var showMessageActions = false
    @FocusState private var isInputFocused: Bool

    var isModerator: Bool = false

    // Quick reactions (from feed/multi-host demos)
    private let quickReactions = ["👋", "🔥", "❤️", "😂", "👏", "🎉"]

    var body: some View {
        VStack(spacing: 0) {
            // Connection status banner
            if !viewModel.isConnected {
                connectionBanner
            }

            // Error banner
            if let error = viewModel.error {
                errorBanner(error)
            }

            // Messages
            SimpleChatView(
                messages: viewModel.messages,
                onLongPress: isModerator ? { message in
                    selectedMessage = message
                    showMessageActions = true
                } : nil
            )
            .onTapGesture {
                isInputFocused = false
            }

            // Quick reaction bar
            quickReactionBar

            // Input bar
            inputBar
        }
        .background(Color.black.opacity(0.4))
        .sheet(isPresented: $showMessageActions) {
            if let message = selectedMessage {
                MessageActionsView(
                    message: message,
                    onDelete: {
                        viewModel.deleteMessage(id: message.id)
                        showMessageActions = false
                        selectedMessage = nil
                    },
                    onKick: {
                        showMessageActions = false
                        selectedMessage = nil
                    },
                    onCancel: {
                        showMessageActions = false
                        selectedMessage = nil
                    }
                )
                .presentationDetents([.height(200)])
                .presentationDragIndicator(.visible)
            }
        }
        .task {
            await viewModel.connect()
        }
        .onDisappear {
            viewModel.disconnect()
        }
    }

    // MARK: - Connection Banner

    private var connectionBanner: some View {
        HStack(spacing: 6) {
            ProgressView()
                .tint(.white)
                .scaleEffect(0.7)
            Text("Connecting to chat...")
                .font(.system(size: 12))
                .foregroundColor(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial.opacity(0.3))
    }

    // MARK: - Error Banner

    private func errorBanner(_ error: String) -> some View {
        Text(error)
            .font(.system(size: 12))
            .foregroundColor(.red)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.red.opacity(0.15))
    }

    // MARK: - Quick Reaction Bar

    private var quickReactionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(quickReactions, id: \.self) { emoji in
                    Button {
                        viewModel.send(emoji)
                    } label: {
                        Text(emoji)
                            .font(.system(size: 20))
                            .frame(width: 36, height: 36)
                            .background(Color.white.opacity(0.08))
                            .cornerRadius(18)
                    }
                    .disabled(!viewModel.isConnected)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Send a message...", text: $messageText)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .foregroundColor(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.1))
                .cornerRadius(20)
                .focused($isInputFocused)
                .onSubmit { sendMessage() }

            Button(action: sendMessage) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? .white.opacity(0.3)
                        : .blue)
            }
            .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !viewModel.isConnected)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.6))
    }

    private func sendMessage() {
        let text = messageText
        messageText = ""
        viewModel.send(text)
    }
}
