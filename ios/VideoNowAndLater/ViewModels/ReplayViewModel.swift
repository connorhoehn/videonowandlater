// ViewModels/ReplayViewModel.swift
import Foundation
import AmazonIVSPlayer
import CoreMedia

@MainActor
class ReplayViewModel: NSObject, ObservableObject {
    @Published var session: Session
    @Published var segments: [SpeakerSegment] = []
    @Published var currentPositionMs: Int = 0
    @Published var isLoading = false

    private let api: APIClient
    var player: IVSPlayer?
    private var positionTimer: Timer?

    /// The currently active transcript segment based on player position
    var activeSegmentId: String? {
        segments.last(where: { $0.startMs <= currentPositionMs && currentPositionMs < $0.endMs })?.id
    }

    init(session: Session, api: APIClient = APIClient()) {
        self.session = session
        self.api = api
    }

    func setup(authToken: String) async {
        // Refresh session for latest transcript/summary state
        do {
            session = try await api.getSession(id: session.id, authToken: authToken)
        } catch { }

        // Load speaker segments if available
        if session.transcriptStatus == "available" {
            await loadSegments(authToken: authToken)
        }
    }

    private func loadSegments(authToken: String) async {
        do {
            let data = try await api.send("GET", path: "/sessions/\(session.id)/speaker-segments", authToken: authToken)
            segments = try JSONDecoder().decode([SpeakerSegment].self, from: data)
        } catch { }
    }

    func seek(to segment: SpeakerSegment) {
        seekToMs(segment.startMs)
    }

    /// Seek to an arbitrary position in milliseconds (used by chapters and transcript)
    func seekToMs(_ ms: Int) {
        let seconds = Double(ms) / 1000.0
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 1000))
        currentPositionMs = ms
    }

    /// Start tracking player position to update activeSegmentId
    func startPositionTracking() {
        positionTimer?.invalidate()
        positionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, let player = self.player else { return }
                let pos = player.position
                let ms = pos.seconds.isNaN ? 0 : Int(pos.seconds * 1000)
                if ms != self.currentPositionMs {
                    self.currentPositionMs = ms
                }
            }
        }
    }

    func stopPositionTracking() {
        positionTimer?.invalidate()
        positionTimer = nil
    }

    func pollUntilReady(authToken: String) async {
        // Poll until transcript and summary both have terminal status
        while !session.isTerminal {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            do {
                session = try await api.getSession(id: session.id, authToken: authToken)
                if session.transcriptStatus == "available" && segments.isEmpty {
                    await loadSegments(authToken: authToken)
                }
            } catch { break }
        }
    }
}
