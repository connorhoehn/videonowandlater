// Views/Components/ZoomableContainer.swift
// Ported from amazon-ivs-screenshare-ios-demo ZoomableFullscreenPreviewView.
// Supports pinch-to-zoom, drag pan, and double-tap to toggle zoom.

import SwiftUI

struct ZoomableContainer<Content: View>: View {
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    private let minScale: CGFloat = 1.0
    private let maxScale: CGFloat = 4.0

    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .scaleEffect(scale)
            .offset(offset)
            .gesture(combinedGestures)
            .onTapGesture(count: 2) { handleDoubleTap() }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .contentShape(Rectangle())
    }

    private var combinedGestures: some Gesture {
        SimultaneousGesture(magnificationGesture, dragGesture)
    }

    private var magnificationGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                let newScale = lastScale * value
                scale = min(max(newScale, minScale), maxScale)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= minScale {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        offset = .zero
                        lastOffset = .zero
                    }
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                guard scale > 1 else { return }
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private func handleDoubleTap() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
            if scale > 1 {
                scale = 1.0
                lastScale = 1.0
                offset = .zero
                lastOffset = .zero
            } else {
                scale = maxScale
                lastScale = maxScale
            }
        }
    }
}
