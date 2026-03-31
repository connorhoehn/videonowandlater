// Models/ParticipantData.swift
// Adapted from amazon-ivs-multi-host-for-ios-demo ParticipantData model
import Foundation
import SwiftUI
import AmazonIVSBroadcast

class ParticipantData: ObservableObject, Identifiable {
    let id: UUID
    let isLocal: Bool

    @Published var participantId: String?
    @Published var username: String
    @Published var isAudioMuted: Bool = false
    @Published var isVideoMuted: Bool = false
    @Published var publishState: IVSParticipantPublishState = .notPublished
    @Published var subscribeState: IVSParticipantSubscribeState = .notSubscribed
    @Published var streams: [IVSStageStream] = []
    @Published var wantsSubscribed: Bool = true
    @Published var isAudioOnly: Bool = false
    @Published var requiresAudioOnly: Bool = false

    init(isLocal: Bool, info: IVSParticipantInfo?, participantId: String?) {
        self.id = UUID()
        self.isLocal = isLocal
        self.participantId = participantId ?? info?.participantId
        self.username = info?.attributes["username"] as? String ?? (isLocal ? "You" : "Participant")
    }

    /// Returns a SwiftUI view wrapping the first video stream's preview, or nil if no video stream.
    var previewView: AnyView? {
        guard let videoStream = streams.first(where: { $0.device is IVSImageDevice }),
              let imageDevice = videoStream.device as? IVSImageDevice else {
            return nil
        }

        guard let preview = try? imageDevice.previewView(with: .fit) else { return nil }
        return AnyView(
            UIViewRepresentableWrapper(uiView: preview)
                .id(id)
        )
    }
}

/// Wraps a UIView for use in SwiftUI via UIViewRepresentable.
private struct UIViewRepresentableWrapper: UIViewRepresentable {
    let uiView: UIView

    func makeUIView(context: Context) -> UIView {
        return uiView
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        // No updates needed — the IVS SDK manages the preview internally.
    }
}
