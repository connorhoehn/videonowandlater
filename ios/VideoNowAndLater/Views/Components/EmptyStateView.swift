import SwiftUI

/// Reusable empty state with SF Symbol icon in a tinted circle, title, and subtitle.
struct EmptyStateView: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    var iconColor: Color = .appIndigo

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(iconColor.opacity(0.1))
                    .frame(width: 72, height: 72)
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundColor(iconColor)
            }

            VStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)

                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 14))
                        .foregroundColor(Color.appTextGray1)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
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
                title: "No Participants",
                iconColor: .appViolet
            )
        }
        .preferredColorScheme(.dark)
    }
}
#endif
