import SwiftUI

/// Full-screen loading indicator with optional label text. Uses the app's dark background.
///
/// Usage:
/// ```
/// if isLoading {
///     LoadingView(label: "Loading session...")
/// }
/// ```
struct LoadingView: View {
    var label: String? = nil

    var body: some View {
        ZStack {
            Color.appBackground
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .progressViewStyle(.circular)
                    .scaleEffect(1.2)
                    .tint(.white)

                if let label {
                    Text(label)
                        .font(.subheadline)
                        .foregroundColor(Color.appTextGray1)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
