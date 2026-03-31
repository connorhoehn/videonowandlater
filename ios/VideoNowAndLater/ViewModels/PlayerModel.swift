// ViewModels/PlayerModel.swift
// Enhanced with patterns from AWS IVS ecommerce + feed demos:
// - Buffering/error state tracking
// - Seek position & duration tracking
// - Adaptive video gravity (portrait vs landscape content)
// - Timed metadata decoding
// - Background/foreground lifecycle handling
// - Play/pause toggle
// - AVAudioSession configuration

import AmazonIVSPlayer
import AVFoundation
import Combine
import SwiftUI
import UIKit

@MainActor
class PlayerModel: NSObject, ObservableObject {
    // MARK: - Player State
    @Published var state: IVSPlayer.State = .idle
    @Published var isReady = false
    @Published var isBuffering = false
    @Published var isPlaying = false
    @Published var error: String?

    // MARK: - Playback Position
    @Published var position: TimeInterval = 0       // seconds
    @Published var duration: TimeInterval = 0       // seconds (0 for live)
    @Published var isLive = false

    // MARK: - Video Info
    @Published var videoSize: CGSize = .zero
    @Published var isPortraitContent = false

    // MARK: - Timed Metadata
    @Published var latestMetadata: [String: String]?

    // MARK: - Controls
    @Published var showControls = true
    private var controlsHideTimer: Timer?
    private var positionTimer: Timer?

    let player = IVSPlayer()
    private let jsonDecoder = JSONDecoder()

    override init() {
        super.init()
        player.delegate = self
        configureAudioSession()
        setupLifecycleObservers()
    }

    deinit {
        controlsHideTimer?.invalidate()
        positionTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Audio Session (from ecommerce demo)

    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("AVAudioSession error: \(error)")
        }
    }

    // MARK: - Lifecycle (from ecommerce + feed demos)

    private func setupLifecycleObservers() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil
        )
    }

    @objc private func didEnterBackground() {
        if player.state == .playing || player.state == .buffering {
            player.pause()
        }
    }

    @objc private func willEnterForeground() {
        if isReady {
            player.play()
        }
    }

    // MARK: - Load & Playback

    func load(url: String) {
        guard let u = URL(string: url) else { return }
        error = nil
        player.load(u)
    }

    func togglePlayPause() {
        if player.state == .playing {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
        resetControlsTimer()
    }

    func seek(to seconds: TimeInterval) {
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 1000))
        position = seconds
        resetControlsTimer()
    }

    func seekRelative(_ delta: TimeInterval) {
        let target = max(0, min(position + delta, duration))
        seek(to: target)
    }

    // MARK: - Controls Auto-Hide (from ecommerce demo)

    func tapPlayer() {
        withAnimation(.easeInOut(duration: 0.3)) {
            showControls.toggle()
        }
        if showControls {
            resetControlsTimer()
        }
    }

    private func resetControlsTimer() {
        controlsHideTimer?.invalidate()
        controlsHideTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.isPlaying else { return }
                withAnimation(.easeInOut(duration: 0.3)) {
                    self.showControls = false
                }
            }
        }
    }

    // MARK: - Position Tracking

    private func startPositionTracking() {
        positionTimer?.invalidate()
        positionTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let pos = self.player.position
                self.position = pos.seconds.isNaN ? 0 : pos.seconds
                let dur = self.player.duration
                self.duration = dur.seconds.isNaN ? 0 : dur.seconds
                self.isLive = self.duration == 0 || self.duration.isInfinite
            }
        }
    }

    private func stopPositionTracking() {
        positionTimer?.invalidate()
        positionTimer = nil
    }
}

// MARK: - IVSPlayer.Delegate

extension PlayerModel: IVSPlayer.Delegate {
    nonisolated func player(_ player: IVSPlayer, didChangeState state: IVSPlayer.State) {
        Task { @MainActor in
            self.state = state
            self.isBuffering = state == .buffering
            self.isPlaying = state == .playing

            switch state {
            case .ready:
                player.play()
                self.isReady = true
                self.startPositionTracking()
                self.resetControlsTimer()
            case .playing:
                self.startPositionTracking()
            case .idle, .ended:
                self.stopPositionTracking()
                self.showControls = true
            default:
                break
            }
        }
    }

    nonisolated func player(_ player: IVSPlayer, didFailWithError error: Error) {
        Task { @MainActor in
            self.error = error.localizedDescription
            self.isBuffering = false
        }
    }

    // Adaptive video gravity (from feed demo)
    nonisolated func player(_ player: IVSPlayer, didChangeVideoSize videoSize: CGSize) {
        Task { @MainActor in
            self.videoSize = videoSize
            self.isPortraitContent = videoSize.height > videoSize.width
        }
    }

    // Timed metadata decoding (from ecommerce demo)
    nonisolated func player(_ player: IVSPlayer, didOutputCue cue: IVSCue) {
        guard let textCue = cue as? IVSTextMetadataCue,
              let jsonData = textCue.text.data(using: .utf8) else { return }
        Task { @MainActor in
            do {
                let decoded = try self.jsonDecoder.decode([String: String].self, from: jsonData)
                self.latestMetadata = decoded
            } catch {
                print("Metadata decode error: \(error)")
            }
        }
    }
}
