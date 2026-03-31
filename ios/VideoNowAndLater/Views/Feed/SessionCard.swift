// Views/Feed/SessionCard.swift
// Enhanced card with:
// - Poster frame / thumbnail priority chain with shimmer placeholder
// - 16:9 thumbnail area with overlay badges
// - Username row with avatar initial, mode pill, pipeline status
// - Highlight reel indicator, reaction summary pills
// - Press scale animation

import SwiftUI

struct SessionCard: View {
    let session: Session
    @State private var isPressed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // MARK: - Thumbnail Area (16:9)
            thumbnailArea

            // MARK: - Info Area
            infoArea
        }
        .background(Color.appBackgroundList)
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.3), radius: 8, x: 0, y: 4)
        .scaleEffect(isPressed ? 0.97 : 1.0)
        .animation(.easeInOut(duration: 0.15), value: isPressed)
        .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
            isPressed = pressing
        }, perform: {})
    }

    // MARK: - Thumbnail Area

    private var thumbnailArea: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // Image with priority chain: posterFrameUrl -> thumbnailUrl -> gradient
                thumbnailImage(width: geo.size.width, height: geo.size.height)

                // Gradient overlay at bottom for text readability
                VStack {
                    Spacer()
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: geo.size.height * 0.4)
                }

                // LIVE badge (top-left)
                if session.isLive {
                    LiveBadge()
                        .padding(10)
                }

                // Duration badge (bottom-right) for ended sessions
                if !session.isLive, let seconds = session.durationSeconds, seconds > 0 {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            Text(compactDuration(seconds))
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundColor(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(Color.black.opacity(0.75))
                                .cornerRadius(6)
                                .padding(10)
                        }
                    }
                }
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fill)
        .clipped()
        .cornerRadius(16, corners: [.topLeft, .topRight])
    }

    @ViewBuilder
    private func thumbnailImage(width: CGFloat, height: CGFloat) -> some View {
        let imageUrl = session.posterFrameUrl ?? session.thumbnailUrl
        if let urlString = imageUrl, let url = URL(string: urlString) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .frame(width: width, height: height)
                        .clipped()
                case .failure:
                    gradientPlaceholder
                case .empty:
                    shimmerPlaceholder
                @unknown default:
                    gradientPlaceholder
                }
            }
        } else {
            gradientPlaceholder
        }
    }

    private var gradientPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: gradientColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Image(systemName: session.type == "HANGOUT" ? "person.2.circle" : "video.fill")
                .font(.system(size: 32))
                .foregroundColor(.white.opacity(0.4))
        }
    }

    private var gradientColors: [Color] {
        switch session.type {
        case "HANGOUT": return [Color.purple.opacity(0.6), Color.indigo.opacity(0.4)]
        case "BROADCAST": return [Color.blue.opacity(0.6), Color.cyan.opacity(0.3)]
        default: return [Color.orange.opacity(0.5), Color.red.opacity(0.3)]
        }
    }

    private var shimmerPlaceholder: some View {
        ShimmerRect(width: .infinity, height: .infinity, cornerRadius: 0)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Info Area

    private var infoArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Title
            Text(session.title ?? "Untitled")
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(2)

            // Username row with avatar + mode badge
            HStack(spacing: 8) {
                // Avatar initial circle
                avatarCircle

                // Username
                Text(session.userId ?? "Unknown")
                    .font(.system(size: 13))
                    .foregroundColor(.appTextGray1)
                    .lineLimit(1)

                Spacer()

                // Mode badge pill
                modeBadge
            }

            // Status row: pipeline status + highlight reel
            HStack(spacing: 8) {
                PipelineStatusBadge(session: session)

                if session.highlightReelStatus == "available" {
                    highlightReelBadge
                }

                if let count = session.participantCount, count > 0, session.type == "HANGOUT" {
                    HStack(spacing: 3) {
                        Image(systemName: "person.2.fill")
                            .font(.system(size: 10))
                        Text("\(count)")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(.appTextGray1)
                }

                Spacer()

                // Relative time
                Text(relativeTime)
                    .font(.system(size: 12))
                    .foregroundColor(.appTextGray1)
            }

            // Reaction summary pills
            if let reactions = session.reactionSummary, !reactions.isEmpty {
                reactionPills(reactions)
            }
        }
        .padding(12)
    }

    // MARK: - Avatar

    private var avatarCircle: some View {
        let initial = String((session.userId ?? "U").prefix(1)).uppercased()
        return Circle()
            .fill(avatarColor)
            .frame(width: 24, height: 24)
            .overlay(
                Text(initial)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
            )
    }

    private var avatarColor: Color {
        // Deterministic color from userId hash
        let hash = abs((session.userId ?? "").hashValue)
        let colors: [Color] = [.blue, .purple, .orange, .green, .pink, .teal]
        return colors[hash % colors.count]
    }

    // MARK: - Badges

    private var modeBadge: some View {
        Text(session.type)
            .font(.system(size: 10, weight: .bold))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(typeColor.opacity(0.5))
            .cornerRadius(10)
    }

    private var typeColor: Color {
        switch session.type {
        case "BROADCAST": return .blue
        case "HANGOUT": return .purple
        case "UPLOAD": return .orange
        default: return .gray
        }
    }

    private var highlightReelBadge: some View {
        HStack(spacing: 3) {
            Image(systemName: "sparkles")
                .font(.system(size: 10))
            Text("Highlights")
                .font(.system(size: 11, weight: .medium))
        }
        .foregroundColor(.yellow)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.yellow.opacity(0.15))
        .cornerRadius(6)
    }

    // MARK: - Reaction Pills

    private func reactionPills(_ reactions: [String: Int]) -> some View {
        let sorted = reactions.sorted { $0.value > $1.value }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(sorted.prefix(5), id: \.key) { emoji, count in
                    HStack(spacing: 2) {
                        Text(emoji)
                            .font(.system(size: 14))
                        Text("\(count)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.appTextGray1)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.appBackgroundButton)
                    .cornerRadius(12)
                }
            }
        }
    }

    // MARK: - Helpers

    private func compactDuration(_ seconds: Int) -> String {
        if seconds >= 3600 {
            let h = seconds / 3600
            let m = (seconds % 3600) / 60
            let s = seconds % 60
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    private var relativeTime: String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: session.createdAt) else { return "" }
        let interval = Date().timeIntervalSince(date)

        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        if interval < 604800 { return "\(Int(interval / 86400))d ago" }
        return "\(Int(interval / 604800))w ago"
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            SessionCard(session: Session(
                sessionId: "1",
                userId: "connor",
                mode: "BROADCAST",
                status: "live",
                createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-720)),
                title: "My Live Stream",
                participantCount: 5
            ))
            SessionCard(session: Session(
                sessionId: "2",
                userId: "sarah",
                mode: "HANGOUT",
                status: "ended",
                createdAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-7200)),
                recordingHlsUrl: "https://example.com/hls",
                recordingDurationMs: 342_000,
                transcriptStatus: "available",
                aiSummary: "A summary",
                aiSummaryStatus: "available",
                highlightReelStatus: "available",
                reactionSummary: ["\u{1F525}": 12, "\u{2764}\u{FE0F}": 8, "\u{1F44D}": 5],
                title: "Recorded Hangout",
                participantCount: 3
            ))
        }
        .padding()
    }
    .background(Color.appBackground)
}
