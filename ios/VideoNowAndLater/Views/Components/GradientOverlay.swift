// Views/Components/GradientOverlay.swift
// Reusable gradient overlays from feed + ecommerce demos.
// Top gradient protects status bar / top controls.
// Bottom gradient protects text overlays and engagement buttons.

import SwiftUI

struct TopGradientOverlay: View {
    var height: CGFloat = 80
    var opacity: Double = 0.6

    var body: some View {
        VStack {
            LinearGradient(
                colors: [Color.black.opacity(opacity), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: height)
            Spacer()
        }
        .allowsHitTesting(false)
    }
}

struct BottomGradientOverlay: View {
    var height: CGFloat = 120
    var opacity: Double = 0.6

    var body: some View {
        VStack {
            Spacer()
            LinearGradient(
                colors: [.clear, Color.black.opacity(opacity)],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: height)
        }
        .allowsHitTesting(false)
    }
}

/// Stream info pill with circular avatar and LIVE badge (from ecommerce demo)
struct StreamInfoPill: View {
    let title: String
    var avatarUrl: String?
    var isLive: Bool = true

    var body: some View {
        HStack(spacing: 8) {
            // Circular avatar
            if let urlString = avatarUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(Color.white.opacity(0.2))
                }
                .frame(width: 32, height: 32)
                .clipShape(Circle())
            }

            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)

            if isLive {
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 6, height: 6)
                    Text("LIVE")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(Color.red.opacity(0.8))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.black.opacity(0.5))
        .cornerRadius(25)
    }
}
