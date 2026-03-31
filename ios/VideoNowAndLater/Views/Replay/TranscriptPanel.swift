// Views/Replay/TranscriptPanel.swift
// Enhanced with:
// - Active segment highlighting (pulse glow matching web app)
// - Smoother scroll-to-active behavior
// - Speaker avatar colors
// - Improved visual hierarchy

import SwiftUI

struct TranscriptPanel: View {
    let segments: [SpeakerSegment]
    let onSeek: (SpeakerSegment) -> Void
    var activeSegmentId: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(segments) { segment in
                        Button {
                            onSeek(segment)
                        } label: {
                            segmentRow(segment)
                        }
                        .id(segment.id)

                        if segment.id != segments.last?.id {
                            Divider()
                                .background(Color.appTextGray1.opacity(0.2))
                                .padding(.leading, 52)
                        }
                    }
                }
            }
            .frame(maxHeight: 280)
            .onChange(of: activeSegmentId) { newId in
                if let id = newId {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
            }
        }
    }

    private func segmentRow(_ segment: SpeakerSegment) -> some View {
        let isActive = segment.id == activeSegmentId

        return HStack(alignment: .top, spacing: 10) {
            // Timestamp
            Text(formatTime(segment.startMs))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundColor(isActive ? .blue : .blue.opacity(0.7))
                .frame(width: 40, alignment: .leading)

            // Speaker color dot
            Circle()
                .fill(speakerColor(for: segment.speaker))
                .frame(width: 6, height: 6)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                Text(segment.speaker)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.appTextGray1)
                Text(segment.text)
                    .font(.system(size: 13))
                    .foregroundColor(isActive ? .white : .white.opacity(0.85))
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(
            isActive
                ? Color.blue.opacity(0.1)
                : Color.clear
        )
        .cornerRadius(8)
    }

    /// Deterministic color for each speaker name
    private func speakerColor(for speaker: String) -> Color {
        let colors: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .mint, .cyan]
        let hash = abs(speaker.hashValue)
        return colors[hash % colors.count]
    }

    private func formatTime(_ ms: Int) -> String {
        let totalSeconds = ms / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
