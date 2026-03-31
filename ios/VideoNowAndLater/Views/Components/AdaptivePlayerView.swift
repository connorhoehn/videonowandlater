import SwiftUI

/// Orientation-adaptive layout that switches between landscape (full-screen player with floating
/// controls) and portrait (player on top, scrollable content below).
///
/// Usage:
/// ```
/// AdaptivePlayerView {
///     IVSPlayerView(player: player)
/// } content: {
///     SessionDetailPanel(session: session)
/// }
/// ```
struct AdaptivePlayerView<Player: View, Content: View>: View {
    @StateObject private var orientationObserver = OrientationObserver()

    let player: () -> Player
    let content: () -> Content

    init(
        @ViewBuilder player: @escaping () -> Player,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.player = player
        self.content = content
    }

    var body: some View {
        Group {
            if orientationObserver.isLandscape {
                landscapeLayout
            } else {
                portraitLayout
            }
        }
        .background(Color.appBackground)
        .animation(.easeInOut(duration: 0.25), value: orientationObserver.isLandscape)
    }

    // MARK: - Landscape

    /// Full-screen player with floating controls overlaid via ZStack.
    private var landscapeLayout: some View {
        ZStack {
            player()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()

            // Floating controls at bottom, semi-transparent backdrop
            VStack {
                Spacer()
                content()
                    .padding(.horizontal, 24)
                    .padding(.bottom, 12)
                    .background(
                        LinearGradient(
                            colors: [.clear, Color.black.opacity(0.7)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Portrait

    /// Player pinned to top at 16:9, content scrollable below.
    private var portraitLayout: some View {
        VStack(spacing: 0) {
            player()
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipped()
                .background(Color.black)

            ScrollView {
                content()
                    .padding()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

#if DEBUG
struct AdaptivePlayerView_Previews: PreviewProvider {
    static var previews: some View {
        AdaptivePlayerView {
            Color.black
                .overlay(Text("Player").foregroundColor(.white))
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Session Title")
                    .font(.headline)
                    .foregroundColor(.white)
                Text("Some description text goes here.")
                    .font(.subheadline)
                    .foregroundColor(Color.appTextGray1)
            }
        }
        .preferredColorScheme(.dark)
    }
}
#endif
