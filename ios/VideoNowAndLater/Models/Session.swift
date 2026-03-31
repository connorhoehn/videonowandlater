// Models/Session.swift
import Foundation

struct Session: Identifiable, Codable {
    // Core fields (match backend SessionRecord)
    let sessionId: String
    let userId: String?
    let mode: String              // "BROADCAST" or "HANGOUT"
    let status: String            // "live", "ending", "ended"
    let createdAt: String

    // Thumbnail / poster
    var thumbnailUrl: String?
    var posterFrameUrl: String?
    var thumbnailBaseUrl: String?
    var thumbnailCount: Int?

    // Recording / playback
    var recordingHlsUrl: String?
    var playbackUrl: String?
    var recordingDurationMs: Int?

    // Transcript
    var transcript: String?
    var transcriptStatus: String? // "processing", "available", "failed"

    // AI Summary
    var aiSummary: String?
    var aiSummaryStatus: String?  // "processing", "available", "failed"

    // Highlight reel
    var highlightReelUrl: String?
    var highlightReelVerticalUrl: String?
    var highlightReelStatus: String?

    // Chapters
    var chapters: [Chapter]?

    // Reactions
    var reactionSummary: [String: Int]?

    // Legacy / convenience fields used by existing views
    var title: String?
    var participantCount: Int?

    // Identifiable conformance
    var id: String { sessionId }

    // MARK: - Backward Compatibility

    /// Maps `mode` to `type` for views that reference `.type`
    var type: String { mode }

    /// Duration in seconds (derived from recordingDurationMs for backward compat)
    var durationSeconds: Int? {
        guard let ms = recordingDurationMs else { return nil }
        return ms / 1000
    }

    // MARK: - Computed Properties

    var isLive: Bool { status == "live" || status == "ACTIVE" }
    var isProcessing: Bool {
        transcriptStatus == "processing" || aiSummaryStatus == "processing"
    }
    var isTerminal: Bool {
        (transcriptStatus == "available" || transcriptStatus == "failed" || transcriptStatus == nil) &&
        (aiSummaryStatus == "available" || aiSummaryStatus == "failed" || aiSummaryStatus == nil)
    }
    var formattedDuration: String {
        guard let s = durationSeconds else { return "" }
        let min = s / 60
        let sec = s % 60
        return "\(min) min \(sec) sec"
    }

    // MARK: - CodingKeys

    enum CodingKeys: String, CodingKey {
        case sessionId, userId, mode, status, createdAt
        case thumbnailUrl, posterFrameUrl, thumbnailBaseUrl, thumbnailCount
        case recordingHlsUrl, playbackUrl, recordingDurationMs
        case transcript, transcriptStatus
        case aiSummary, aiSummaryStatus
        case highlightReelUrl, highlightReelVerticalUrl, highlightReelStatus
        case chapters, reactionSummary
        case title, participantCount
    }

    // MARK: - Custom Decoding (handle both old and new API shapes)

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // sessionId: try "sessionId" first, fall back to "id" for backward compat
        if let sid = try container.decodeIfPresent(String.self, forKey: .sessionId) {
            sessionId = sid
        } else {
            // Fall back: use a dynamic key for "id"
            let altContainer = try decoder.container(keyedBy: DynamicCodingKey.self)
            sessionId = try altContainer.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "id")!) ?? UUID().uuidString
        }

        userId = try container.decodeIfPresent(String.self, forKey: .userId)

        // mode: try "mode" first, fall back to "type"
        if let m = try container.decodeIfPresent(String.self, forKey: .mode) {
            mode = m
        } else {
            let altContainer = try decoder.container(keyedBy: DynamicCodingKey.self)
            mode = try altContainer.decodeIfPresent(String.self, forKey: DynamicCodingKey(stringValue: "type")!) ?? "BROADCAST"
        }

        status = try container.decode(String.self, forKey: .status)
        createdAt = try container.decode(String.self, forKey: .createdAt)

        thumbnailUrl = try container.decodeIfPresent(String.self, forKey: .thumbnailUrl)
        posterFrameUrl = try container.decodeIfPresent(String.self, forKey: .posterFrameUrl)
        thumbnailBaseUrl = try container.decodeIfPresent(String.self, forKey: .thumbnailBaseUrl)
        thumbnailCount = try container.decodeIfPresent(Int.self, forKey: .thumbnailCount)

        recordingHlsUrl = try container.decodeIfPresent(String.self, forKey: .recordingHlsUrl)
        playbackUrl = try container.decodeIfPresent(String.self, forKey: .playbackUrl)
        recordingDurationMs = try container.decodeIfPresent(Int.self, forKey: .recordingDurationMs)

        transcript = try container.decodeIfPresent(String.self, forKey: .transcript)
        transcriptStatus = try container.decodeIfPresent(String.self, forKey: .transcriptStatus)

        aiSummary = try container.decodeIfPresent(String.self, forKey: .aiSummary)
        aiSummaryStatus = try container.decodeIfPresent(String.self, forKey: .aiSummaryStatus)

        highlightReelUrl = try container.decodeIfPresent(String.self, forKey: .highlightReelUrl)
        highlightReelVerticalUrl = try container.decodeIfPresent(String.self, forKey: .highlightReelVerticalUrl)
        highlightReelStatus = try container.decodeIfPresent(String.self, forKey: .highlightReelStatus)

        chapters = try container.decodeIfPresent([Chapter].self, forKey: .chapters)
        reactionSummary = try container.decodeIfPresent([String: Int].self, forKey: .reactionSummary)

        title = try container.decodeIfPresent(String.self, forKey: .title)
        participantCount = try container.decodeIfPresent(Int.self, forKey: .participantCount)
    }

    // MARK: - Memberwise Init (for previews and tests)

    init(
        sessionId: String,
        userId: String? = nil,
        mode: String = "BROADCAST",
        status: String = "ended",
        createdAt: String = "",
        thumbnailUrl: String? = nil,
        posterFrameUrl: String? = nil,
        thumbnailBaseUrl: String? = nil,
        thumbnailCount: Int? = nil,
        recordingHlsUrl: String? = nil,
        playbackUrl: String? = nil,
        recordingDurationMs: Int? = nil,
        transcript: String? = nil,
        transcriptStatus: String? = nil,
        aiSummary: String? = nil,
        aiSummaryStatus: String? = nil,
        highlightReelUrl: String? = nil,
        highlightReelVerticalUrl: String? = nil,
        highlightReelStatus: String? = nil,
        chapters: [Chapter]? = nil,
        reactionSummary: [String: Int]? = nil,
        title: String? = nil,
        participantCount: Int? = nil
    ) {
        self.sessionId = sessionId
        self.userId = userId
        self.mode = mode
        self.status = status
        self.createdAt = createdAt
        self.thumbnailUrl = thumbnailUrl
        self.posterFrameUrl = posterFrameUrl
        self.thumbnailBaseUrl = thumbnailBaseUrl
        self.thumbnailCount = thumbnailCount
        self.recordingHlsUrl = recordingHlsUrl
        self.playbackUrl = playbackUrl
        self.recordingDurationMs = recordingDurationMs
        self.transcript = transcript
        self.transcriptStatus = transcriptStatus
        self.aiSummary = aiSummary
        self.aiSummaryStatus = aiSummaryStatus
        self.highlightReelUrl = highlightReelUrl
        self.highlightReelVerticalUrl = highlightReelVerticalUrl
        self.highlightReelStatus = highlightReelStatus
        self.chapters = chapters
        self.reactionSummary = reactionSummary
        self.title = title
        self.participantCount = participantCount
    }
}

// MARK: - Chapter

struct Chapter: Codable, Identifiable {
    let title: String
    let startTimeMs: Int
    let endTimeMs: Int
    var thumbnailIndex: Int?

    var id: String { "\(title)-\(startTimeMs)" }

    var formattedStartTime: String {
        let totalSeconds = startTimeMs / 1000
        let m = totalSeconds / 60
        let s = totalSeconds % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - SpeakerSegment

struct SpeakerSegment: Codable, Identifiable {
    let speaker: String
    let startTime: Double  // ms
    let endTime: Double    // ms
    let text: String

    var id: String { "\(speaker)-\(Int(startTime))" }

    // Backward compat: existing views use startMs/endMs as Int
    var startMs: Int { Int(startTime) }
    var endMs: Int { Int(endTime) }

    private enum CodingKeys: String, CodingKey {
        case speaker, startTime, endTime, text, startMs, endMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        speaker = try container.decode(String.self, forKey: .speaker)
        text = try container.decode(String.self, forKey: .text)

        // Try startTime first, fall back to startMs
        if let st = try container.decodeIfPresent(Double.self, forKey: .startTime) {
            startTime = st
        } else if let sm = try container.decodeIfPresent(Int.self, forKey: .startMs) {
            startTime = Double(sm)
        } else {
            startTime = 0
        }

        if let et = try container.decodeIfPresent(Double.self, forKey: .endTime) {
            endTime = et
        } else if let em = try container.decodeIfPresent(Int.self, forKey: .endMs) {
            endTime = Double(em)
        } else {
            endTime = 0
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(speaker, forKey: .speaker)
        try container.encode(startTime, forKey: .startTime)
        try container.encode(endTime, forKey: .endTime)
        try container.encode(text, forKey: .text)
    }

    init(speaker: String, startTime: Double, endTime: Double, text: String) {
        self.speaker = speaker
        self.startTime = startTime
        self.endTime = endTime
        self.text = text
    }
}

// MARK: - API Response Types

struct CreateSessionResponse: Codable {
    let sessionId: String
    let streamKey: String
    let ingestEndpoint: String
    let playbackUrl: String
}

struct JoinHangoutResponse: Codable {
    let token: String      // IVS Stage participant token
    let stageArn: String
}

struct ChatTokenResponse: Codable {
    let token: String
    let sessionId: String
}

struct Comment: Codable, Identifiable {
    let id: String
    let content: String
    let timestampMs: Int
    let authorId: String
    let authorName: String
    let createdAt: String
}

struct UserStats: Codable {
    let broadcastCount: Int?
    let hangoutCount: Int?
    let uploadCount: Int?

    enum CodingKeys: String, CodingKey {
        case broadcastCount, hangoutCount, uploadCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        broadcastCount = try container.decodeIfPresent(Int.self, forKey: .broadcastCount)
        hangoutCount = try container.decodeIfPresent(Int.self, forKey: .hangoutCount)
        uploadCount = try container.decodeIfPresent(Int.self, forKey: .uploadCount)
    }
}

// MARK: - Dynamic CodingKey (for backward compat decoding)

private struct DynamicCodingKey: CodingKey {
    var stringValue: String
    var intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        self.intValue = nil
    }

    init?(intValue: Int) {
        self.stringValue = "\(intValue)"
        self.intValue = intValue
    }
}
