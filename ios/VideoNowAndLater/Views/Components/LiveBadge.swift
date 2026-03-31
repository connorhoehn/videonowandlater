// Views/Components/LiveBadge.swift
// Reusable pulsing LIVE indicator badge.
// Extracted from SessionCard for reuse across feed, player, and viewer screens.

import SwiftUI

struct LiveBadge: View {
    var fontSize: CGFloat = 10
    var dotSize: CGFloat = 5
    var compact: Bool = false

    @State private var isPulsing = false

    var body: some View {
        HStack(spacing: compact ? 2 : 3) {
            Circle()
                .fill(Color.red)
                .frame(width: dotSize, height: dotSize)
                .scaleEffect(isPulsing ? 1.3 : 1.0)
                .animation(
                    .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                    value: isPulsing
                )

            Text("LIVE")
                .font(.system(size: fontSize, weight: .bold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, compact ? 4 : 6)
        .padding(.vertical, compact ? 1 : 2)
        .background(Color.red.opacity(0.8))
        .cornerRadius(compact ? 3 : 4)
        .onAppear { isPulsing = true }
    }
}

// MARK: - Large variant for player overlay

extension LiveBadge {
    /// Larger badge suitable for player overlays
    static var playerOverlay: LiveBadge {
        LiveBadge(fontSize: 11, dotSize: 7)
    }
}

#Preview {
    VStack(spacing: 16) {
        LiveBadge()
        LiveBadge(compact: true)
        LiveBadge.playerOverlay
    }
    .padding()
    .background(Color.black)
}
