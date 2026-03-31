// Views/Replay/SummaryPanel.swift
// AI summary display with shimmer animation for processing state

import SwiftUI

struct SummaryPanel: View {
    let session: Session

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                    .foregroundColor(.blue)
                Text("AI Summary")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color.appTextGray1)
            }

            content
        }
        .padding(12)
        .background(Color.appBackgroundButton)
        .cornerRadius(12)
    }

    @ViewBuilder
    private var content: some View {
        switch session.aiSummaryStatus {
        case "processing":
            VStack(alignment: .leading, spacing: 8) {
                ShimmerLine(width: .infinity)
                ShimmerLine(width: 260)
                ShimmerLine(width: 200)
                Text("Generating summary...")
                    .font(.system(size: 12))
                    .foregroundColor(Color.appTextGray1.opacity(0.6))
                    .padding(.top, 2)
            }
        case "available":
            if let summary = session.aiSummary {
                Text(summary)
                    .font(.system(size: 14))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case "failed":
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                    Text("Summary generation failed")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.orange)
                }
                Text("Try replaying this session later or contact support.")
                    .font(.system(size: 12))
                    .foregroundColor(Color.appTextGray1.opacity(0.7))
            }
        default:
            HStack(spacing: 6) {
                Image(systemName: "clock")
                    .font(.system(size: 12))
                    .foregroundColor(Color.appTextGray1.opacity(0.5))
                Text("Summary will be available after transcription completes.")
                    .font(.system(size: 13))
                    .foregroundColor(Color.appTextGray1.opacity(0.7))
            }
        }
    }
}

// MARK: - Shimmer Effect

private struct ShimmerLine: View {
    let width: CGFloat

    @State private var phase: CGFloat = 0

    var body: some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.white.opacity(0.08))
            .frame(maxWidth: width == .infinity ? .infinity : width)
            .frame(height: 14)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.0),
                            Color.white.opacity(0.12),
                            Color.white.opacity(0.0)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geo.size.width * 0.4)
                    .offset(x: phase * geo.size.width)
                }
                .mask(RoundedRectangle(cornerRadius: 4))
            )
            .onAppear {
                withAnimation(
                    .linear(duration: 1.5)
                    .repeatForever(autoreverses: false)
                ) {
                    phase = 1.2
                }
            }
    }
}
