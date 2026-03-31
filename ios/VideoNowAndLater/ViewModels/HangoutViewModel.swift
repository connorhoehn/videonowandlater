// ViewModels/HangoutViewModel.swift
import Foundation
import AmazonIVSBroadcast
import UIKit

class HangoutViewModel: NSObject, ObservableObject {
    @Published var sessionRunning = false
    @Published var stageConnectionState: IVSStageConnectionState = .disconnected
    @Published var participantsData: [ParticipantData] = []
    @Published var localUserAudioMuted = false
    @Published var localUserVideoMuted = false
    @Published var bannerNotifications: [AppNotification] = []
    @Published var isBroadcasting = false

    var participantCount: Int { participantsData.count }

    private var stage: IVSStage?
    var localStreams: [IVSLocalStageStream] = []
    let deviceDiscovery = IVSDeviceDiscovery()
    let deviceSlotName = UUID().uuidString

    private let api: APIClient
    private let authToken: String
    private let username: String

    init(authToken: String, username: String, api: APIClient = APIClient()) {
        self.authToken = authToken
        self.username = username
        self.api = api
        super.init()
        setupLocalUser()
        setupBackgroundObservers()
    }

    // MARK: - Join via backend

    func join(sessionId: String) async throws {
        let response = try await api.joinHangout(sessionId: sessionId, authToken: authToken)
        await MainActor.run { joinStage(token: response.token) }
    }

    private func joinStage(token: String) {
        do {
            let s = try IVSStage(token: token, strategy: self)
            s.addRenderer(self)
            s.errorDelegate = self
            try s.join()
            stage = s
            sessionRunning = true
        } catch {
            bannerNotifications.append(AppNotification(message: "Failed to join: \(error.localizedDescription)", type: .error))
        }
    }

    func leave() {
        stage?.leave()
        stage = nil
        sessionRunning = false
        while participantsData.count > 1 {
            participantsData.removeLast()
        }
    }

    // MARK: - Local user setup

    private func setupLocalUser() {
        let devices = deviceDiscovery.listLocalDevices()

        if let mic = devices.compactMap({ $0 as? IVSMicrophone }).first {
            mic.isEchoCancellationEnabled = true
            localStreams.append(IVSLocalStageStream(device: mic))
        }

        if let cam = devices.compactMap({ $0 as? IVSCamera }).first {
            localStreams.append(IVSLocalStageStream(device: cam))
        }

        let local = ParticipantData(isLocal: true, info: nil, participantId: nil)
        local.username = username
        participantsData.append(local)
        participantsData[0].streams = localStreams
    }

    func toggleMute() {
        localStreams.filter { $0.device is IVSAudioDevice }.forEach {
            $0.setMuted(!$0.isMuted)
            localUserAudioMuted = $0.isMuted
        }
    }

    func toggleCamera() {
        localStreams.filter { $0.device is IVSImageDevice }.forEach {
            $0.setMuted(!$0.isMuted)
            localUserVideoMuted = $0.isMuted
        }
    }

    /// Swap between front and back camera (from multi-host demo)
    func swapCamera() {
        guard let cam = deviceDiscovery.listLocalDevices().compactMap({ $0 as? IVSCamera }).first else { return }
        let newPosition: IVSDevicePosition = cam.descriptor().position == .front ? .back : .front
        if let source = cam.listAvailableInputSources().first(where: { $0.position == newPosition }) {
            cam.setPreferredInputSource(source) { _ in }
        }
    }

    func mutatingParticipant(_ participantId: String?, modifier: (inout ParticipantData) -> Void) {
        guard let idx = participantsData.firstIndex(where: { $0.participantId == participantId }) else { return }
        var p = participantsData[idx]
        modifier(&p)
        participantsData[idx] = p
    }

    // MARK: - Background observers

    private func setupBackgroundObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func didEnterBackground() {
        // Drop video, keep audio when backgrounded
        participantsData.compactMap { $0.participantId }.forEach { id in
            mutatingParticipant(id) { $0.requiresAudioOnly = true }
        }
        stage?.refreshStrategy()
    }

    @objc private func willEnterForeground() {
        participantsData.compactMap { $0.participantId }.forEach { id in
            mutatingParticipant(id) { $0.requiresAudioOnly = false }
        }
        stage?.refreshStrategy()
    }
}

// MARK: - IVSStageStrategy

extension HangoutViewModel: IVSStageStrategy {
    func stage(_ stage: IVSStage, shouldSubscribeToParticipant participant: IVSParticipantInfo) -> IVSStageSubscribeType {
        guard let data = participantsData.first(where: { $0.participantId == participant.participantId }) else {
            return .audioVideo
        }
        if data.isAudioOnly { return .audioOnly }
        return data.wantsSubscribed ? .audioVideo : .none
    }

    func stage(_ stage: IVSStage, shouldPublishParticipant participant: IVSParticipantInfo) -> Bool {
        return true
    }

    func stage(_ stage: IVSStage, streamsToPublishForParticipant participant: IVSParticipantInfo) -> [IVSLocalStageStream] {
        return localStreams
    }
}

// MARK: - IVSStageRenderer

extension HangoutViewModel: IVSStageRenderer {
    func stage(_ stage: IVSStage, participantDidJoin participant: IVSParticipantInfo) {
        guard !participant.isLocal else { return }
        DispatchQueue.main.async {
            let data = ParticipantData(isLocal: false, info: participant, participantId: participant.participantId)
            self.participantsData.append(data)
            let name = data.username
            self.bannerNotifications.append(AppNotification(message: "\(name) joined", type: .success))
        }
    }

    func stage(_ stage: IVSStage, participantDidLeave participant: IVSParticipantInfo) {
        DispatchQueue.main.async {
            let name = self.participantsData.first(where: { $0.participantId == participant.participantId })?.username ?? "Participant"
            self.participantsData.removeAll { $0.participantId == participant.participantId }
            self.bannerNotifications.append(AppNotification(message: "\(name) left", type: .warning))
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange publishState: IVSParticipantPublishState) {
        mutatingParticipant(participant.participantId) { $0.publishState = publishState }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didChange subscribeState: IVSParticipantSubscribeState) {
        mutatingParticipant(participant.participantId) { $0.subscribeState = subscribeState }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didAdd streams: [IVSStageStream]) {
        mutatingParticipant(participant.participantId) { data in
            data.streams += streams.filter { stream in
                !data.streams.contains(where: { $0.device === stream.device })
            }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didRemove streams: [IVSStageStream]) {
        mutatingParticipant(participant.participantId) { data in
            data.streams.removeAll { stream in
                streams.contains(where: { $0.device === stream.device })
            }
        }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didMuteMicrophone isMuted: Bool) {
        mutatingParticipant(participant.participantId) { $0.isAudioMuted = isMuted }
    }

    func stage(_ stage: IVSStage, participant: IVSParticipantInfo, didMuteCamera isMuted: Bool) {
        mutatingParticipant(participant.participantId) { $0.isVideoMuted = isMuted }
    }

    func stage(_ stage: IVSStage, connectionStateDidChange state: IVSStageConnectionState) {
        DispatchQueue.main.async { self.stageConnectionState = state }
    }
}

// MARK: - IVSErrorDelegate

extension HangoutViewModel: IVSErrorDelegate {
    func source(_ source: IVSErrorSource, didEmitError error: Error) {
        DispatchQueue.main.async { self.bannerNotifications.append(AppNotification(message: error.localizedDescription, type: .error)) }
    }
}
