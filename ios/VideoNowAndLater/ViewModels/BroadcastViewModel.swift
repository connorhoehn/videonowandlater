// ViewModels/BroadcastViewModel.swift
import Foundation
import AmazonIVSBroadcast
import UIKit

@MainActor
class BroadcastViewModel: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var isMuted = false
    @Published var isCameraOff = false
    @Published var error: String?
    @Published var streamHealth: String = ""

    private var session: IVSBroadcastSession?
    private let deviceDiscovery = IVSDeviceDiscovery()
    private var camera: IVSCamera?
    private var microphone: IVSMicrophone?

    var ingestEndpoint: String = ""
    var streamKey: String = ""

    func setup() {
        let config = IVSPresets.configurations().standardPortrait()
        do {
            session = try IVSBroadcastSession(
                configuration: config,
                descriptors: nil,
                delegate: self
            )
            attachDevices()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func startBroadcast(ingestEndpoint: String, streamKey: String) {
        self.ingestEndpoint = ingestEndpoint
        self.streamKey = streamKey
        guard let rtmpsUrl = URL(string: "rtmps://\(ingestEndpoint)") else {
            self.error = "Invalid ingest endpoint"
            return
        }
        do {
            try session?.start(with: rtmpsUrl, streamKey: streamKey)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stopBroadcast() {
        session?.stop()
        isConnected = false
    }

    func toggleMute() {
        deviceDiscovery.listLocalDevices()
            .compactMap { $0 as? IVSMicrophone }
            .first
            .map { mic in
                isMuted.toggle()
                mic.setGain(isMuted ? 0 : 1)
            }
    }

    func toggleCamera() {
        isCameraOff.toggle()
        deviceDiscovery.listLocalDevices()
            .compactMap { $0 as? IVSCamera }
            .first
            .map { _ in
                session?.listAttachedDevices()
                    .filter { $0.descriptor().type == .camera }
                    .forEach { device in
                        if isCameraOff {
                            session?.detach(device)
                        } else {
                            session?.attach(device, toSlotWithName: "default")
                        }
                    }
            }
    }

    /// Swap between front and back camera (from multi-host demo)
    func swapCamera() {
        guard let cam = camera else { return }
        let newPosition: IVSDevicePosition = cam.descriptor().position == .front ? .back : .front
        if let source = cam.listAvailableInputSources().first(where: { $0.position == newPosition }) {
            cam.setPreferredInputSource(source) { [weak self] _ in
                self?.camera = cam
            }
        }
    }

    func previewView() -> IVSImagePreviewView? {
        return try? session?.previewView(with: .fill)
    }

    private func attachDevices() {
        let devices = deviceDiscovery.listLocalDevices()
        if let cam = devices.compactMap({ $0 as? IVSCamera }).first {
            camera = cam
            session?.attach(cam, toSlotWithName: "default")
        }
        if let mic = devices.compactMap({ $0 as? IVSMicrophone }).first {
            microphone = mic
            session?.attach(mic, toSlotWithName: "default")
        }
    }
}

// MARK: - IVSBroadcastSession.Delegate

extension BroadcastViewModel: IVSBroadcastSession.Delegate {
    nonisolated func broadcastSession(
        _ session: IVSBroadcastSession,
        didChange state: IVSBroadcastSession.State
    ) {
        Task { @MainActor in
            switch state {
            case .connecting:
                self.streamHealth = "Connecting..."
            case .connected:
                self.isConnected = true
                self.streamHealth = "Connected"
            case .disconnected:
                self.isConnected = false
                self.streamHealth = "Disconnected"
            case .error:
                self.isConnected = false
                self.streamHealth = "Error"
            case .invalid:
                self.isConnected = false
                self.streamHealth = "Invalid"
            @unknown default:
                break
            }
        }
    }

    nonisolated func broadcastSession(
        _ session: IVSBroadcastSession,
        didEmitError error: Error
    ) {
        Task { @MainActor in
            self.error = error.localizedDescription
        }
    }

    nonisolated func broadcastSession(
        _ session: IVSBroadcastSession,
        transmissionStatisticsChanged statistics: IVSTransmissionStatistics
    ) {
        Task { @MainActor in
            let quality = statistics.broadcastQuality
            let networkHealth = statistics.networkHealth
            self.streamHealth = "Q:\(quality) N:\(networkHealth)"
        }
    }
}
