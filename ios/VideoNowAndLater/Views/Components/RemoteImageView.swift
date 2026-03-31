import SwiftUI

/// Async image loader with placeholder, error state, and configurable content mode / corner radius.
///
/// Usage:
/// ```
/// RemoteImageView(url: session.thumbnailURL, contentMode: .fill, cornerRadius: 8)
///     .frame(width: 120, height: 68)
/// ```
struct RemoteImageView: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    var cornerRadius: CGFloat = 8

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            case .failure:
                placeholder
            case .empty:
                placeholder
                    .overlay(
                        ProgressView()
                            .tint(Color.appTextGray1)
                    )
            @unknown default:
                placeholder
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    private var placeholder: some View {
        Rectangle()
            .fill(Color.appBackgroundButton)
            .overlay(
                Image(systemName: "photo")
                    .font(.title2)
                    .foregroundColor(Color.appTextGray1)
            )
    }
}

#if DEBUG
struct RemoteImageView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 16) {
            // Valid URL (will show placeholder then image)
            RemoteImageView(url: nil, contentMode: .fill, cornerRadius: 12)
                .frame(width: 200, height: 112)

            // Nil URL (shows placeholder)
            RemoteImageView(url: nil, contentMode: .fit, cornerRadius: 4)
                .frame(width: 200, height: 112)
        }
        .padding()
        .background(Color.appBackground)
        .preferredColorScheme(.dark)
    }
}
#endif
