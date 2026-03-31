// Views/Components/NotificationBanner.swift
// Ported from multi-host demo notification system.
// Shows success/error/warning banners that auto-dismiss.

import SwiftUI

enum NotificationType {
    case success, error, warning

    var color: Color {
        switch self {
        case .success: return .appGreen
        case .error: return .appRed
        case .warning: return .yellow
        }
    }

    var icon: String {
        switch self {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        }
    }
}

struct AppNotification: Identifiable {
    let id = UUID()
    let message: String
    let type: NotificationType
    let createdAt = Date()
}

struct NotificationBannerView: View {
    @Binding var notifications: [AppNotification]

    var body: some View {
        VStack(spacing: 4) {
            ForEach(notifications) { notification in
                notificationRow(notification)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture {
                        withAnimation {
                            notifications.removeAll { $0.id == notification.id }
                        }
                    }
                    .onAppear {
                        // Auto-dismiss after 5 seconds for success, 8 for others
                        let delay: Double = notification.type == .success ? 5 : 8
                        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                            withAnimation {
                                notifications.removeAll { $0.id == notification.id }
                            }
                        }
                    }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: notifications.count)
    }

    private func notificationRow(_ notification: AppNotification) -> some View {
        HStack(spacing: 8) {
            Image(systemName: notification.type.icon)
                .foregroundColor(notification.type.color)
                .font(.system(size: 14))

            Text(notification.message)
                .font(.system(size: 13))
                .foregroundColor(.white)
                .lineLimit(2)

            Spacer()

            Image(systemName: "xmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.appTextGray1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.appBackgroundList)
        .cornerRadius(14)
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(notification.type.color.opacity(0.2), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
    }
}
