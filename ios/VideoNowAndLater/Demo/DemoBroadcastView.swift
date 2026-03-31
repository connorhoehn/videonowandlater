// Demo/DemoBroadcastView.swift
// Mock broadcast with camera preview, LIVE pill, duration timer, chat, and controls — no IVS SDK needed

import SwiftUI
import AVFoundation

struct DemoBroadcastView: View {
    let session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var showConfirmStop = false
    @State private var livePulse = false
    @State private var elapsedSeconds = 0
    @State private var showChat = true
    @State private var isMuted = false
    @State private var isCameraOff = false
    @State private var isUsingFrontCamera = true
    @State private var viewerCount = 3
    @State private var streamQuality = "Q:92 N:95"
    @State private var isDegraded = false

    private let durationTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let viewerTimer = Timer.publish(every: 5, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Camera preview
            if !isCameraOff {
                DemoCameraPreview(useFrontCamera: $isUsingFrontCamera)
                    .ignoresSafeArea()
            } else {
                // Camera off fallback
                VStack(spacing: 12) {
                    Image(systemName: "video.slash.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.white.opacity(0.3))
                    Text("Camera Off")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white.opacity(0.5))
                }
            }

            // Gradient overlays
            TopGradientOverlay(height: 120, opacity: 0.5)
            BottomGradientOverlay(height: 240, opacity: 0.5)

            // Stream quality HUD
            StreamQualityHUD(streamHealth: streamQuality)

            // Poor connection warning during degradation
            if isDegraded {
                VStack {
                    Spacer()
                        .frame(height: 70)

                    VStack(spacing: 4) {
                        HStack(spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .font(.system(size: 15))
                                .foregroundColor(.yellow)
                            Text("Poor connection")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        Text("Viewers may experience buffering")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.8))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(Color.red.opacity(0.7))
                    .cornerRadius(12)
                    .padding(.horizontal, 20)
                    .transition(.move(edge: .top).combined(with: .opacity))

                    Spacer()
                }
                .animation(.easeInOut(duration: 0.4), value: isDegraded)
            }

            // Overlay controls
            VStack(spacing: 0) {
                headerBar
                    .padding(.horizontal, 16)
                    .padding(.top, 10)

                Spacer()

                // Chat overlay
                if showChat {
                    DemoChatView(currentPositionMs: elapsedSeconds * 1000)
                        .frame(maxHeight: 200)
                        .allowsHitTesting(false)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                        .transition(.opacity)
                }

                // Control buttons
                controlsBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
            }
        }
        .statusBarHidden()
        .confirmationDialog("End Broadcast", isPresented: $showConfirmStop) {
            Button("Stop", role: .destructive) { dismiss() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will end your live session for all viewers.")
        }
        .onReceive(durationTimer) { _ in
            elapsedSeconds += 1
            // Stream quality degradation scenario:
            // Every ~30s, simulate a quality drop lasting ~8s, then recovery
            let cyclePos = elapsedSeconds % 30
            if cyclePos >= 22 && cyclePos < 30 {
                // Degraded period — low quality with jitter
                if !isDegraded {
                    isDegraded = true
                }
                let q = Int.random(in: 25...55)
                let n = Int.random(in: 30...60)
                streamQuality = "Q:\(q) N:\(n)"
            } else if isDegraded && cyclePos == 0 {
                // Recovery
                isDegraded = false
                streamQuality = "Q:90 N:93"
            } else if elapsedSeconds % 5 == 0 {
                // Normal fluctuations
                let q = Int.random(in: 82...98)
                let n = Int.random(in: 85...99)
                streamQuality = "Q:\(q) N:\(n)"
            }
        }
        .onReceive(viewerTimer) { _ in
            // Simulate viewers joining/leaving
            let delta = Int.random(in: -1...2)
            viewerCount = max(1, viewerCount + delta)
        }
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            Button { showConfirmStop = true } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }

            livePill
            durationPill
            viewerCountPill

            Spacer()

            // Camera flip
            Button { isUsingFrontCamera.toggle() } label: {
                Image(systemName: "camera.rotate")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }

            // Toggle chat
            Button {
                withAnimation { showChat.toggle() }
            } label: {
                Image(systemName: showChat ? "bubble.left.fill" : "bubble.left")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.black.opacity(0.5))
                    .clipShape(Circle())
            }
        }
    }

    private var livePill: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
                .scaleEffect(livePulse ? 1.4 : 1.0)
                .opacity(livePulse ? 0.6 : 1.0)
                .animation(
                    .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                    value: livePulse
                )
            Text("LIVE")
                .font(.system(size: 13, weight: .bold))
        }
        .foregroundColor(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.red.opacity(0.75))
        .cornerRadius(14)
        .shadow(color: Color.red.opacity(0.4), radius: 6)
        .onAppear { livePulse = true }
    }

    private var durationPill: some View {
        Text(formatElapsed(elapsedSeconds))
            .font(.system(size: 13, weight: .medium, design: .monospaced))
            .foregroundColor(.white.opacity(0.9))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.black.opacity(0.5))
            .cornerRadius(14)
    }

    private var viewerCountPill: some View {
        HStack(spacing: 5) {
            Image(systemName: "eye")
                .font(.system(size: 12))
            Text("\(viewerCount)")
                .font(.system(size: 13, weight: .medium))
        }
        .foregroundColor(.white.opacity(0.9))
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.5))
        .cornerRadius(14)
        .animation(.easeInOut(duration: 0.3), value: viewerCount)
    }

    // MARK: - Controls Bar

    private var controlsBar: some View {
        HStack(spacing: 20) {
            controlButton(
                icon: isMuted ? "mic.slash.fill" : "mic.fill",
                label: isMuted ? "Unmute" : "Mute",
                isActive: isMuted,
                activeColor: .red
            ) { isMuted.toggle() }

            controlButton(
                icon: isCameraOff ? "video.slash.fill" : "video.fill",
                label: isCameraOff ? "Camera On" : "Camera Off",
                isActive: isCameraOff,
                activeColor: .red
            ) { isCameraOff.toggle() }

            Spacer()

            Button { showConfirmStop = true } label: {
                HStack(spacing: 7) {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 14))
                    Text("End")
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Color.red)
                .cornerRadius(22)
            }
        }
        .padding(16)
        .background(Color.black.opacity(0.5))
        .cornerRadius(20)
    }

    private func controlButton(
        icon: String, label: String, isActive: Bool,
        activeColor: Color = .red, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .frame(width: 52, height: 52)
                    .background(isActive ? activeColor.opacity(0.8) : Color.white.opacity(0.1))
                    .clipShape(Circle())
                Text(label)
                    .font(.system(size: 11))
            }
            .foregroundColor(.white)
        }
    }

    // MARK: - Helpers

    private func formatElapsed(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        let h = m / 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m % 60, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - Camera Preview (uses AVCaptureSession directly, no IVS SDK)

struct DemoCameraPreview: UIViewRepresentable {
    @Binding var useFrontCamera: Bool

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.backgroundColor = .black

        let session = AVCaptureSession()
        session.sessionPreset = .high
        context.coordinator.captureSession = session

        let position: AVCaptureDevice.Position = useFrontCamera ? .front : .back
        configureCamera(session: session, position: position)

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = UIScreen.main.bounds
        view.layer.addSublayer(previewLayer)

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }

        context.coordinator.currentPosition = position

        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        if let layer = uiView.layer.sublayers?.first as? AVCaptureVideoPreviewLayer {
            layer.frame = uiView.bounds
        }

        let desired: AVCaptureDevice.Position = useFrontCamera ? .front : .back
        guard desired != context.coordinator.currentPosition,
              let session = context.coordinator.captureSession else { return }

        // Switch camera
        DispatchQueue.global(qos: .userInitiated).async {
            session.beginConfiguration()
            // Remove existing input
            for input in session.inputs {
                session.removeInput(input)
            }
            configureCamera(session: session, position: desired)
            session.commitConfiguration()
            DispatchQueue.main.async {
                context.coordinator.currentPosition = desired
            }
        }
    }

    private func configureCamera(session: AVCaptureSession, position: AVCaptureDevice.Position) {
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else { return }
        session.addInput(input)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator {
        var captureSession: AVCaptureSession?
        var currentPosition: AVCaptureDevice.Position = .front

        deinit {
            captureSession?.stopRunning()
        }
    }
}
