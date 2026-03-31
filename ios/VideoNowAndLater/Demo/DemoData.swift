// Demo/DemoData.swift
// Mock data for demo mode -- see all UI components without a backend
// Sessions have varied data: some with thumbnailUrl, some with posterFrameUrl,
// some live, some with chapters, reactions, highlight reels.

import Foundation

enum DemoData {

    // MARK: - Bundled video
    static var bundledVideoUrl: URL? {
        Bundle.main.url(forResource: "demo_video", withExtension: "mp4")
    }

    // Public HLS fallback
    static let hlsFallbackUrl = "https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8"

    static var videoUrlString: String {
        bundledVideoUrl?.absoluteString ?? hlsFallbackUrl
    }

    // Sample image URLs for thumbnails/posters (public Unsplash)
    private static let sampleThumbnails = [
        "https://images.unsplash.com/photo-1611532736597-de2d4265fba3?w=640&h=360&fit=crop",
        "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=640&h=360&fit=crop",
        "https://images.unsplash.com/photo-1531297484001-80022131f5a1?w=640&h=360&fit=crop",
    ]

    private static let samplePosters = [
        "https://images.unsplash.com/photo-1492619375914-88005aa9e8fb?w=640&h=360&fit=crop",
        "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=640&h=360&fit=crop",
    ]

    // MARK: - Sessions

    static let sessions: [Session] = [
        // Live hangout - no thumbnail (gradient placeholder)
        Session(
            sessionId: "demo-live-1",
            userId: "connor",
            mode: "HANGOUT",
            status: "live",
            createdAt: isoDate(minutesAgo: 12),
            playbackUrl: videoUrlString,
            reactionSummary: ["\u{1F525}": 24, "\u{2764}\u{FE0F}": 18, "\u{1F44F}": 7],
            title: "Sunday Morning Hangout",
            participantCount: 4
        ),
        // Live broadcast - with posterFrameUrl
        Session(
            sessionId: "demo-live-2",
            userId: "sarah",
            mode: "BROADCAST",
            status: "live",
            createdAt: isoDate(minutesAgo: 45),
            posterFrameUrl: samplePosters[0],
            playbackUrl: videoUrlString,
            title: "Live from the Studio",
            participantCount: 1
        ),
        // Ended broadcast - with thumbnailUrl + highlight reel ready
        Session(
            sessionId: "demo-replay-1",
            userId: "connor",
            mode: "BROADCAST",
            status: "ended",
            createdAt: isoDate(minutesAgo: 180),
            thumbnailUrl: sampleThumbnails[0],
            recordingHlsUrl: videoUrlString,
            playbackUrl: videoUrlString,
            recordingDurationMs: 1_234_000,
            transcriptStatus: "available",
            aiSummary: "This session covered the latest product updates including the new real-time collaboration features, improved video quality settings, and the upcoming mobile app launch. Key decisions: ship v2.0 by end of month, prioritize iOS over Android, and integrate the new AI summary pipeline.",
            aiSummaryStatus: "available",
            highlightReelUrl: "https://example.com/highlights.mp4",
            highlightReelStatus: "available",
            chapters: chapters,
            reactionSummary: ["\u{1F680}": 15, "\u{1F4AF}": 9, "\u{1F44D}": 22, "\u{1F389}": 4],
            title: "Product Demo -- New Features",
            participantCount: 1
        ),
        // Ended hangout - with posterFrameUrl + chapters
        Session(
            sessionId: "demo-replay-2",
            userId: "mike",
            mode: "HANGOUT",
            status: "ended",
            createdAt: isoDate(minutesAgo: 2880),
            posterFrameUrl: samplePosters[1],
            recordingHlsUrl: videoUrlString,
            playbackUrl: videoUrlString,
            recordingDurationMs: 847_000,
            transcriptStatus: "available",
            aiSummary: "Daily standup covering sprint progress. Backend team finished the transcription pipeline. Frontend team demoed the new replay viewer with click-to-seek. Mobile team started iOS app scaffolding. Blocker: CDK deployment failing on the new SQS queue.",
            aiSummaryStatus: "available",
            chapters: chapters,
            reactionSummary: ["\u{1F44D}": 6, "\u{2764}\u{FE0F}": 3],
            title: "Team Standup -- March 28",
            participantCount: 5
        ),
        // Processing session - with thumbnailUrl (no summary yet)
        Session(
            sessionId: "demo-processing-1",
            userId: "alex",
            mode: "BROADCAST",
            status: "ended",
            createdAt: isoDate(minutesAgo: 60),
            thumbnailUrl: sampleThumbnails[1],
            recordingHlsUrl: videoUrlString,
            playbackUrl: videoUrlString,
            recordingDurationMs: 2_100_000,
            transcriptStatus: "processing",
            aiSummaryStatus: "processing",
            title: "Design Review Session",
            participantCount: 1
        ),
        // Old recording - with thumbnailUrl, no reactions
        Session(
            sessionId: "demo-upload-1",
            userId: "connor",
            mode: "BROADCAST",
            status: "ended",
            createdAt: isoDate(minutesAgo: 4320),
            thumbnailUrl: sampleThumbnails[2],
            recordingHlsUrl: videoUrlString,
            playbackUrl: videoUrlString,
            recordingDurationMs: 2_700_000,
            transcriptStatus: "available",
            aiSummary: "A recorded conference talk about building real-time video applications with AWS IVS. Topics covered: low-latency streaming architecture, multi-host stages, chat integration, and AI-powered post-processing pipelines.",
            aiSummaryStatus: "available",
            title: "Conference Talk Recording"
        ),
        // Ended hangout - no thumbnail, no summary (gradient placeholder)
        Session(
            sessionId: "demo-no-thumb",
            userId: "jamie",
            mode: "HANGOUT",
            status: "ended",
            createdAt: isoDate(minutesAgo: 720),
            recordingHlsUrl: videoUrlString,
            playbackUrl: videoUrlString,
            recordingDurationMs: 540_000,
            title: "Quick Sync",
            participantCount: 2
        ),
    ]

    // MARK: - Speaker Segments (transcript)

    static let speakerSegments: [SpeakerSegment] = [
        SpeakerSegment(speaker: "Connor", startTime: 0, endTime: 8000, text: "Hey everyone, thanks for joining. Let me share my screen and walk through the new features we've been working on."),
        SpeakerSegment(speaker: "Connor", startTime: 8000, endTime: 18000, text: "So first up, we've completely rebuilt the replay viewer. You can now click on any transcript segment to jump to that point in the video."),
        SpeakerSegment(speaker: "Sarah", startTime: 18000, endTime: 25000, text: "Oh that's awesome. Does it work with the AI summary too? Like can you click on a summary point and it takes you there?"),
        SpeakerSegment(speaker: "Connor", startTime: 25000, endTime: 35000, text: "Not yet, but that's on the roadmap. Right now the summary is just a text overview. The click-to-seek only works on individual transcript segments."),
        SpeakerSegment(speaker: "Mike", startTime: 35000, endTime: 40000, text: "What about the mobile app? Is this going to be available on iOS too?"),
        SpeakerSegment(speaker: "Connor", startTime: 40000, endTime: 50000, text: "Yes! We just got the iOS app building this morning. Same feature set -- feed, replay with transcripts, chat, reactions, the whole thing."),
        SpeakerSegment(speaker: "Sarah", startTime: 50000, endTime: 55000, text: "That's great progress. How does the AI pipeline work on the backend?"),
        SpeakerSegment(speaker: "Connor", startTime: 55000, endTime: 70000, text: "It's a multi-stage pipeline. When a broadcast ends, the recording goes through MediaConvert, then AWS Transcribe, and finally Bedrock Claude for the AI summary."),
    ]

    // MARK: - Chat Messages

    struct DemoChatMessage: Identifiable {
        let id: String
        let senderName: String
        let content: String
        let timestampMs: Int
    }

    static let chatMessages: [DemoChatMessage] = [
        DemoChatMessage(id: "chat-1", senderName: "Sarah", content: "Just joined, what did I miss?", timestampMs: 2000),
        DemoChatMessage(id: "chat-2", senderName: "Mike", content: "Hey Sarah! Connor's showing the new replay viewer", timestampMs: 5000),
        DemoChatMessage(id: "chat-3", senderName: "Connor", content: "Welcome! Let me restart the demo real quick", timestampMs: 8000),
        DemoChatMessage(id: "chat-4", senderName: "Sarah", content: "The click-to-seek looks amazing!", timestampMs: 20000),
        DemoChatMessage(id: "chat-5", senderName: "Alex", content: "\u{1F525}\u{1F525}\u{1F525}", timestampMs: 22000),
        DemoChatMessage(id: "chat-6", senderName: "Mike", content: "Can we get this on mobile too?", timestampMs: 36000),
        DemoChatMessage(id: "chat-7", senderName: "Connor", content: "Yes! iOS app is building now", timestampMs: 42000),
        DemoChatMessage(id: "chat-8", senderName: "Sarah", content: "Ship it! \u{1F680}", timestampMs: 48000),
        DemoChatMessage(id: "chat-9", senderName: "Alex", content: "The AI summary pipeline is really cool", timestampMs: 56000),
        DemoChatMessage(id: "chat-10", senderName: "Mike", content: "Great demo, thanks Connor!", timestampMs: 65000),
    ]

    // MARK: - Chapters (demo data for chapter navigation)

    static let chapters: [Chapter] = [
        Chapter(title: "Introduction", startTimeMs: 0, endTimeMs: 8000, thumbnailIndex: 0),
        Chapter(title: "Replay Viewer Demo", startTimeMs: 8000, endTimeMs: 25000, thumbnailIndex: 1),
        Chapter(title: "Q&A", startTimeMs: 25000, endTimeMs: 40000, thumbnailIndex: 2),
        Chapter(title: "Mobile App Discussion", startTimeMs: 40000, endTimeMs: 55000, thumbnailIndex: 3),
        Chapter(title: "AI Pipeline Overview", startTimeMs: 55000, endTimeMs: 70000, thumbnailIndex: 4),
    ]

    // MARK: - Hangout Participants

    struct DemoParticipant: Identifiable {
        let id: String
        let username: String
        let isLocal: Bool
        let isAudioMuted: Bool
        let isVideoMuted: Bool
    }

    static let hangoutParticipants: [DemoParticipant] = [
        DemoParticipant(id: "p-1", username: "You", isLocal: true, isAudioMuted: false, isVideoMuted: false),
        DemoParticipant(id: "p-2", username: "Sarah", isLocal: false, isAudioMuted: false, isVideoMuted: false),
        DemoParticipant(id: "p-3", username: "Mike", isLocal: false, isAudioMuted: true, isVideoMuted: false),
        DemoParticipant(id: "p-4", username: "Alex", isLocal: false, isAudioMuted: false, isVideoMuted: true),
    ]

    // MARK: - User Stats

    static let userStats: UserStats = {
        let json = #"{"broadcastCount":12,"hangoutCount":8,"uploadCount":3}"#
        return try! JSONDecoder().decode(UserStats.self, from: json.data(using: .utf8)!)
    }()

    // MARK: - Helpers

    private static func isoDate(minutesAgo: Int) -> String {
        let date = Date().addingTimeInterval(-Double(minutesAgo) * 60)
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: date)
    }
}
