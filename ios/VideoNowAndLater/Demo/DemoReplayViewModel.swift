// Demo/DemoReplayViewModel.swift
// AVPlayer-based replay for demo mode — no IVS SDK needed

import Foundation
import AVKit
import Combine

@MainActor
class DemoReplayViewModel: ObservableObject {
    @Published var player: AVPlayer?
    @Published var isPlaying = false
    @Published var currentPositionMs: Int = 0
    @Published var durationMs: Int = 0
    @Published var segments: [SpeakerSegment] = []

    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    var activeSegmentId: String? {
        segments.last(where: { $0.startMs <= currentPositionMs && currentPositionMs < $0.endMs })?.id
    }

    func loadSession(_ session: Session) {
        segments = DemoData.speakerSegments

        // Try bundled video first, then URL from session
        let url: URL?
        if let bundled = DemoData.bundledVideoUrl {
            url = bundled
        } else if let urlStr = session.recordingHlsUrl ?? session.playbackUrl {
            url = URL(string: urlStr)
        } else {
            url = nil
        }

        guard let videoUrl = url else { return }

        let avPlayer = AVPlayer(url: videoUrl)
        self.player = avPlayer

        // Get video duration
        Task {
            if let duration = try? await AVAsset(url: videoUrl).load(.duration) {
                self.durationMs = Int(duration.seconds * 1000)
            }
        }

        // Track position for active segment highlighting
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = avPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let ms = Int(time.seconds * 1000)
                if ms != self.currentPositionMs {
                    self.currentPositionMs = ms
                }
            }
        }

        // Loop when video ends
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: avPlayer.currentItem,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.player?.seek(to: .zero)
                self?.player?.play()
            }
        }

        avPlayer.play()
        isPlaying = true
    }

    func togglePlayPause() {
        guard let player else { return }
        if isPlaying {
            player.pause()
        } else {
            player.play()
        }
        isPlaying.toggle()
    }

    func seekRelative(_ deltaMs: Int) {
        let targetMs = max(0, min(durationMs, currentPositionMs + deltaMs))
        let time = CMTime(seconds: Double(targetMs) / 1000.0, preferredTimescale: 600)
        player?.seek(to: time)
    }

    func seekToFraction(_ fraction: Double) {
        guard durationMs > 0 else { return }
        let targetMs = Double(durationMs) * fraction
        let time = CMTime(seconds: targetMs / 1000.0, preferredTimescale: 600)
        player?.seek(to: time)
    }

    func seek(to segment: SpeakerSegment) {
        let time = CMTime(seconds: Double(segment.startMs) / 1000.0, preferredTimescale: 600)
        player?.seek(to: time)
        if !isPlaying {
            player?.play()
            isPlaying = true
        }
    }

    func cleanup() {
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
        if let observer = endObserver {
            NotificationCenter.default.removeObserver(observer)
            endObserver = nil
        }
        player?.pause()
    }
}
