// Views/Components/ControlButtonsDrawer.swift
import SwiftUI
import UIKit

struct ControlButtonsDrawer: View {
    @Binding var isMuted: Bool
    @Binding var isCameraOff: Bool
    @Binding var isExpanded: Bool
    var onMute: () -> Void
    var onCamera: () -> Void
    var onStop: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Drag handle
            Capsule()
                .fill(Color.white.opacity(0.4))
                .frame(width: 40, height: 4)
                .padding(.top, 8)
                .gesture(
                    DragGesture(minimumDistance: 20)
                        .onEnded { value in
                            withAnimation {
                                isExpanded = value.translation.height < -60
                            }
                        }
                )

            if isExpanded {
                HStack(spacing: 20) {
                    ControlButton(
                        icon: isMuted ? "mic.slash" : "mic",
                        label: isMuted ? "Unmute" : "Mute",
                        backgroundColor: isMuted ? Color.red : Color.appBackgroundButton
                    ) { onMute() }

                    ControlButton(
                        icon: isCameraOff ? "video.slash" : "video",
                        label: isCameraOff ? "Camera off" : "Camera",
                        backgroundColor: isCameraOff ? Color.red : Color.appBackgroundButton
                    ) { onCamera() }

                    ControlButton(
                        icon: "stop.circle",
                        label: "End",
                        backgroundColor: Color.red
                    ) { onStop() }
                }
                .padding(.vertical, 16)
                .padding(.horizontal, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(
            Color.appBackground
                .opacity(0.95)
                .cornerRadius(24, corners: [.topLeft, .topRight])
        )
    }
}

struct ControlButton: View {
    let icon: String
    let label: String
    var backgroundColor: Color = Color.appBackgroundButton
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 52, height: 52)
                    .background(backgroundColor)
                    .clipShape(Circle())
                Text(label)
                    .font(.system(size: 11))
                    .foregroundColor(Color.appTextGray1)
            }
        }
    }
}

// MARK: - Partial corner radius helper

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}
