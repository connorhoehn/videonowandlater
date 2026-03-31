// Views/Broadcast/StreamQualityHUD.swift
// Enhanced with color-coded health indicators from ecommerce demo patterns.
// Shows broadcast quality and network health with color transitions.

import SwiftUI

struct StreamQualityHUD: View {
    let streamHealth: String

    var body: some View {
        if !streamHealth.isEmpty {
            VStack {
                HStack {
                    Spacer()
                    healthBadge
                        .padding(.trailing, 16)
                        .padding(.top, 48)
                }
                Spacer()
            }
            .allowsHitTesting(false)
        }
    }

    private var healthBadge: some View {
        HStack(spacing: 6) {
            // Connection quality indicator dot
            Circle()
                .fill(healthColor)
                .frame(width: 6, height: 6)

            Text(streamHealth)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(.white.opacity(0.85))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.55))
        .cornerRadius(10)
    }

    /// Color based on stream health values (Q: quality, N: network health)
    /// Values are 0-1 from IVS SDK, displayed as 0-100.
    private var healthColor: Color {
        // Parse quality number from "Q:85 N:90" format
        let components = streamHealth.components(separatedBy: " ")
        let quality = components.first.flatMap { part in
            let val = part.replacingOccurrences(of: "Q:", with: "")
            return Double(val)
        } ?? 0

        if quality >= 80 { return .appGreen }
        if quality >= 50 { return .yellow }
        return .appRed
    }
}
