// Demo/DemoFeedView.swift
// Instagram/TikTok-style feed with live stories bar + session card grid

import SwiftUI
import AVFoundation

// MARK: - Bubbly Press Button Style

struct BubblyButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - DemoFeedView

struct DemoFeedView: View {
    let sessions = DemoData.sessions
    @State private var selectedSession: Session?
    @State private var selectedHangout: Session?
    @State private var selectedBroadcast: Session?
    @State private var thumbnails: [String: UIImage] = [:]

    private var liveSessions: [Session] { sessions.filter { $0.isLive } }
    private var replaySessions: [Session] { sessions.filter { !$0.isLive } }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.appBackground.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        // Stories-style live sessions bar
                        if !liveSessions.isEmpty {
                            liveStoriesBar
                        }

                        // Session grid
                        sessionGrid
                    }
                    .padding(.bottom, 24)
                }
            }
            .navigationTitle("VideoNowAndLater")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink(destination: DemoProfileView()) {
                        Image(systemName: "person.circle")
                            .foregroundColor(.white)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    demoBadge
                }
            }
            .fullScreenCover(item: $selectedSession) { session in
                DemoReplayView(session: session)
            }
            .fullScreenCover(item: $selectedHangout) { session in
                DemoHangoutView(session: session)
            }
            .fullScreenCover(item: $selectedBroadcast) { session in
                DemoBroadcastView(session: session)
            }
            .task {
                thumbnails = await generateThumbnails()
            }
        }
        .preferredColorScheme(.dark)
    }

    /// Generate thumbnails from bundled video at different timestamps + color tints for visual variety
    private func generateThumbnails() async -> [String: UIImage] {
        guard let videoUrl = DemoData.bundledVideoUrl else { return [:] }
        let asset = AVAsset(url: videoUrl)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 400, height: 300)

        // Different timestamps + tint colors per session for visual variety
        let configs: [(id: String, seconds: Double, tint: UIColor?)] = [
            ("demo-live-1", 1.0, UIColor(red: 0.9, green: 0.2, blue: 0.4, alpha: 0.15)),
            ("demo-live-2", 4.0, UIColor(red: 0.2, green: 0.4, blue: 0.9, alpha: 0.15)),
            ("demo-replay-1", 2.0, nil),
            ("demo-replay-2", 6.0, UIColor(red: 0.5, green: 0.2, blue: 0.8, alpha: 0.12)),
            ("demo-processing-1", 8.0, UIColor(red: 0.9, green: 0.6, blue: 0.1, alpha: 0.15)),
            ("demo-upload-1", 10.0, UIColor(red: 0.1, green: 0.7, blue: 0.5, alpha: 0.12)),
        ]

        var result: [String: UIImage] = [:]
        for config in configs {
            let time = CMTime(seconds: config.seconds, preferredTimescale: 600)
            if let (cgImage, _) = try? await generator.image(at: time) {
                var image = UIImage(cgImage: cgImage)
                // Apply color tint for visual variety
                if let tint = config.tint {
                    image = applyTint(to: image, color: tint)
                }
                result[config.id] = image
            }
        }
        return result
    }

    /// Apply a color tint overlay to an image for visual differentiation
    private func applyTint(to image: UIImage, color: UIColor) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: image.size)
        return renderer.image { ctx in
            image.draw(at: .zero)
            ctx.cgContext.setFillColor(color.cgColor)
            ctx.cgContext.setBlendMode(.overlay)
            ctx.cgContext.fill(CGRect(origin: .zero, size: image.size))
        }
    }

    // MARK: - Live Stories Bar

    private var liveStoriesBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("LIVE NOW")
                .font(.system(size: 13, weight: .bold))
                .tracking(1.2)
                .foregroundColor(.appTextGray1)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(liveSessions) { session in
                        Button {
                            selectSession(session)
                        } label: {
                            liveStoryCircle(session: session)
                        }
                        .buttonStyle(BubblyButtonStyle())
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 10)
    }

    private func liveStoryCircle(session: Session) -> some View {
        VStack(spacing: 8) {
            ZStack {
                // Gradient ring
                Circle()
                    .stroke(
                        LinearGradient(
                            colors: [.red, .orange, .pink],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 3.5
                    )
                    .frame(width: 84, height: 84)

                // Avatar/icon or thumbnail
                if let thumb = thumbnails[session.id] {
                    Image(uiImage: thumb)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 76, height: 76)
                        .clipShape(Circle())
                } else {
                    Circle()
                        .fill(Color.appBackgroundButton)
                        .frame(width: 76, height: 76)
                        .overlay(
                            Image(systemName: session.type == "HANGOUT" ? "person.2.fill" : "video.fill")
                                .foregroundColor(.white)
                                .font(.system(size: 24))
                        )
                }

                // LIVE badge — bigger and bolder
                VStack {
                    Spacer()
                    Text("LIVE")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            Capsule()
                                .fill(Color.red)
                                .shadow(color: .red.opacity(0.6), radius: 4, y: 1)
                        )
                }
                .frame(height: 84)
            }

            Text(session.title ?? "Live")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.white)
                .lineLimit(1)
                .frame(width: 84)
        }
    }

    // MARK: - Session Grid

    private var sessionGrid: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("RECENT")
                .font(.system(size: 13, weight: .bold))
                .tracking(1.2)
                .foregroundColor(.appTextGray1)
                .padding(.horizontal, 16)

            GeometryReader { geo in
                let cardWidth = (geo.size.width - 16 * 2 - 12) / 2
                let largeHeight = cardWidth * 1.3
                let smallHeight = cardWidth * 0.95

                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12)
                ], spacing: 12) {
                    ForEach(Array(replaySessions.enumerated()), id: \.element.id) { index, session in
                        Button {
                            selectSession(session)
                        } label: {
                            sessionCard(
                                session: session,
                                isLarge: index == 0,
                                height: index == 0 ? largeHeight : smallHeight
                            )
                        }
                        .buttonStyle(BubblyButtonStyle())
                    }
                }
                .padding(.horizontal, 16)
            }
            .frame(height: calculateGridHeight())
        }
    }

    /// Estimate grid height so the GeometryReader doesn't collapse
    private func calculateGridHeight() -> CGFloat {
        let screenWidth = UIScreen.main.bounds.width
        let cardWidth = (screenWidth - 16 * 2 - 12) / 2
        let largeHeight = cardWidth * 1.3
        let smallHeight = cardWidth * 0.95
        let count = replaySessions.count
        if count == 0 { return 0 }
        // First row has the large card height, subsequent rows use small height
        let rows = (count + 1) / 2 // ceil division
        if rows <= 1 { return largeHeight + 12 }
        return largeHeight + CGFloat(rows - 1) * (smallHeight + 12) + 12
    }

    private func sessionCard(session: Session, isLarge: Bool, height: CGFloat) -> some View {
        ZStack(alignment: .bottomLeading) {
            // Thumbnail from bundled video or fallback gradient
            if let thumb = thumbnails[session.id] {
                Image(uiImage: thumb)
                    .resizable()
                    .scaledToFill()
                    .frame(height: height)
                    .clipped()
                    .overlay(
                        // Tinted overlay per type
                        LinearGradient(
                            colors: cardGradient(for: session.type).map { $0.opacity(0.35) },
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            } else {
                RoundedRectangle(cornerRadius: 20)
                    .fill(
                        LinearGradient(
                            colors: cardGradient(for: session.type),
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: height)
                    .overlay(
                        Image(systemName: iconForType(session.type))
                            .font(.system(size: 40))
                            .foregroundColor(.white.opacity(0.12))
                    )
            }

            // Info overlay
            VStack(alignment: .leading, spacing: 5) {
                // Type + status badges
                HStack(spacing: 5) {
                    Text(session.type)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white.opacity(0.95))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Color.white.opacity(0.2))
                        .clipShape(Capsule())

                    PipelineStatusBadge(session: session)
                }

                Text(session.title ?? "Untitled")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                if let dur = session.durationSeconds {
                    Text(formatDuration(dur))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [.clear, .black.opacity(0.75)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(
                    UnevenRoundedRectangle(
                        topLeadingRadius: 0,
                        bottomLeadingRadius: 20,
                        bottomTrailingRadius: 20,
                        topTrailingRadius: 0
                    )
                )
            )
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.35), radius: 8, x: 0, y: 4)
    }

    // MARK: - Routing

    private func selectSession(_ session: Session) {
        if session.isLive && session.type == "HANGOUT" {
            selectedHangout = session
        } else if session.isLive && session.type == "BROADCAST" {
            selectedBroadcast = session
        } else {
            selectedSession = session
        }
    }

    // MARK: - Helpers

    private func cardGradient(for type: String) -> [Color] {
        switch type {
        case "BROADCAST": return [Color.blue.opacity(0.6), Color.purple.opacity(0.8)]
        case "HANGOUT": return [Color.purple.opacity(0.6), Color.pink.opacity(0.8)]
        case "UPLOAD": return [Color.orange.opacity(0.6), Color.red.opacity(0.8)]
        default: return [Color.gray.opacity(0.6), Color.gray.opacity(0.8)]
        }
    }

    private func iconForType(_ type: String) -> String {
        switch type {
        case "BROADCAST": return "antenna.radiowaves.left.and.right"
        case "HANGOUT": return "person.2.wave.2"
        case "UPLOAD": return "arrow.up.circle"
        default: return "video"
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%d:%02d", m, s)
    }

    private var demoBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
                .font(.system(size: 9, weight: .bold))
            Text("DEMO")
                .font(.system(size: 11, weight: .heavy))
        }
        .foregroundColor(.black)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(Color.yellow)
                .shadow(color: .yellow.opacity(0.4), radius: 4, y: 1)
        )
    }
}
