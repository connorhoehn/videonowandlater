// Views/Broadcast/BroadcastPreviewView.swift
import SwiftUI
import AmazonIVSBroadcast

struct BroadcastPreviewView: UIViewRepresentable {
    @ObservedObject var broadcastVm: BroadcastViewModel

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .black

        if let preview = broadcastVm.previewView() {
            preview.frame = container.bounds
            preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(preview)
        }

        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        // If camera was toggled off and back on, re-attach preview
        if !broadcastVm.isCameraOff, uiView.subviews.isEmpty {
            if let preview = broadcastVm.previewView() {
                preview.frame = uiView.bounds
                preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                uiView.addSubview(preview)
            }
        }
    }
}
