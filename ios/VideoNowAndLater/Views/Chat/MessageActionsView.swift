// Views/Chat/MessageActionsView.swift
import SwiftUI
import AmazonIVSChatMessaging

struct MessageActionsView: View {
    let message: ChatMessage
    var onDelete: () -> Void
    var onKick: () -> Void
    var onCancel: () -> Void

    private var displayName: String {
        message.sender.attributes?["username"] ?? message.sender.userId
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 4) {
                Text("Message from \(displayName)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)

                Text(message.content)
                    .font(.system(size: 13))
                    .foregroundColor(.white.opacity(0.6))
                    .lineLimit(2)
            }
            .padding(.top, 16)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)

            Divider()
                .background(Color.white.opacity(0.1))

            // Actions
            Button(role: .destructive, action: onDelete) {
                HStack {
                    Image(systemName: "trash")
                    Text("Delete Message")
                }
                .font(.system(size: 16))
                .foregroundColor(.red)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            Divider()
                .background(Color.white.opacity(0.1))

            Button(role: .destructive, action: onKick) {
                HStack {
                    Image(systemName: "person.crop.circle.badge.xmark")
                    Text("Kick User")
                }
                .font(.system(size: 16))
                .foregroundColor(.red)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }

            Divider()
                .background(Color.white.opacity(0.1))

            Button(action: onCancel) {
                Text("Cancel")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white.opacity(0.7))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
        }
        .background(Color(red: 0.12, green: 0.12, blue: 0.12))
        .cornerRadius(16)
        .padding(.horizontal, 8)
    }
}
