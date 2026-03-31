// Views/Components/PipelineStatusBadge.swift
import SwiftUI

struct PipelineStatusBadge: View {
    let session: Session

    var body: some View {
        if let label = statusLabel {
            HStack(spacing: 4) {
                // Animated ping dot for in-progress states
                if label.isInProgress {
                    ZStack {
                        Circle()
                            .fill(label.color)
                            .frame(width: 6, height: 6)

                        Circle()
                            .fill(label.color.opacity(0.5))
                            .frame(width: 6, height: 6)
                            .scaleEffect(pingScale)
                            .opacity(pingOpacity)
                            .animation(
                                .easeOut(duration: 1.5)
                                    .repeatForever(autoreverses: false),
                                value: pingScale
                            )
                    }
                    .onAppear {
                        pingScale = 2.5
                        pingOpacity = 0.0
                    }
                }

                Text(label.text)
                    .font(.system(size: 11))
                    .foregroundColor(label.color)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(label.color.opacity(0.15))
            .cornerRadius(4)
        }
    }

    @State private var pingScale: CGFloat = 1.0
    @State private var pingOpacity: Double = 1.0

    private var statusLabel: StatusInfo? {
        if session.transcriptStatus == "processing" {
            return StatusInfo(text: "Transcribing...", color: .orange, isInProgress: true)
        }
        if session.aiSummaryStatus == "processing" {
            return StatusInfo(text: "Summarizing...", color: .blue, isInProgress: true)
        }
        if session.transcriptStatus == "available" && session.aiSummaryStatus == "available" {
            return StatusInfo(text: "Summary ready", color: .green, isInProgress: false)
        }
        if session.transcriptStatus == "failed" || session.aiSummaryStatus == "failed" {
            return StatusInfo(text: "Processing failed", color: .red, isInProgress: false)
        }
        return nil
    }
}

private struct StatusInfo {
    let text: String
    let color: Color
    let isInProgress: Bool
}

#Preview {
    VStack(spacing: 12) {
        PipelineStatusBadge(session: Session(
            sessionId: "1",
            mode: "BROADCAST",
            status: "ended",
            createdAt: "",
            recordingDurationMs: 120_000,
            transcriptStatus: "processing",
            title: "Test"
        ))
        PipelineStatusBadge(session: Session(
            sessionId: "2",
            mode: "BROADCAST",
            status: "ended",
            createdAt: "",
            recordingDurationMs: 120_000,
            transcriptStatus: "available",
            aiSummary: "Summary",
            aiSummaryStatus: "available",
            title: "Test"
        ))
    }
    .padding()
    .background(Color(hex: 0x1a1a1a))
}

// MARK: - Color hex initializer (used across the app)

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: alpha
        )
    }
}
