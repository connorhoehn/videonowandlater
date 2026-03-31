import SwiftUI

/// Reusable empty state with SF Symbol icon, title, and subtitle. Centered in available space.
///
/// Usage:
/// ```
/// EmptyStateView(
///     icon: "video.slash",
///     title: "No Sessions",
///     subtitle: "Start a broadcast or join a hangout to get started."
/// )
/// ```
struct EmptyStateView: View {
    let icon: String
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 48))
                .foregroundColor(Color.appTextGray1)

            Text(title)
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundColor(.white)
                .multilineTextAlignment(.center)

            if let subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(Color.appTextGray1)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.appBackground)
    }
}

#if DEBUG
struct EmptyStateView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            EmptyStateView(
                icon: "video.slash",
                title: "No Sessions",
                subtitle: "Start a broadcast or join a hangout to get started."
            )

            EmptyStateView(
                icon: "text.bubble",
                title: "No Transcript",
                subtitle: "A transcript will appear once processing is complete."
            )

            EmptyStateView(
                icon: "person.2.slash",
                title: "No Participants"
            )
        }
        .preferredColorScheme(.dark)
    }
}
#endif
