import SwiftUI

/// Full-screen loading indicator with branded spinner and optional label text.
struct LoadingView: View {
    var label: String? = nil
    @State private var isSpinning = false

    var body: some View {
        ZStack {
            Color.appBackground
                .ignoresSafeArea()

            VStack(spacing: 20) {
                // Branded spinner ring
                Circle()
                    .trim(from: 0.15, to: 0.85)
                    .stroke(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round)
                    )
                    .frame(width: 36, height: 36)
                    .rotationEffect(.degrees(isSpinning ? 360 : 0))
                    .animation(.linear(duration: 1).repeatForever(autoreverses: false), value: isSpinning)

                VStack(spacing: 6) {
                    Text("videonow")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white.opacity(0.5))
                        .tracking(-0.3)

                    if let label {
                        Text(label)
                            .font(.system(size: 13))
                            .foregroundColor(Color.appTextGray1)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { isSpinning = true }
    }
}

#if DEBUG
struct LoadingView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            LoadingView()
            LoadingView(label: "Loading session...")
        }
        .preferredColorScheme(.dark)
    }
}
#endif
