// Views/Replay/ChapterListView.swift
// Horizontal scrollable chapter navigation with auto-scroll to active chapter

import SwiftUI

struct ChapterListView: View {
    let chapters: [Chapter]
    let currentTimeMs: Int
    let thumbnailBaseUrl: String?
    let onSeek: (Int) -> Void

    /// The chapter whose time range contains currentTimeMs
    private var activeChapterId: String? {
        chapters.first(where: { currentTimeMs >= $0.startTimeMs && currentTimeMs < $0.endTimeMs })?.id
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(chapters) { chapter in
                        chapterCard(chapter)
                            .id(chapter.id)
                            .onTapGesture {
                                onSeek(chapter.startTimeMs)
                            }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .onChange(of: activeChapterId) { newId in
                if let id = newId {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
            }
        }
    }

    // MARK: - Chapter Card

    private func chapterCard(_ chapter: Chapter) -> some View {
        let isActive = chapter.id == activeChapterId

        return VStack(alignment: .leading, spacing: 6) {
            // Thumbnail area
            ZStack {
                if let baseUrl = thumbnailBaseUrl,
                   let idx = chapter.thumbnailIndex {
                    AsyncImage(url: URL(string: "\(baseUrl)/thumb\(idx).jpg")) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(16/9, contentMode: .fill)
                        default:
                            thumbnailPlaceholder
                        }
                    }
                } else {
                    thumbnailPlaceholder
                }

                // Time badge
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text(chapter.formattedStartTime)
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.black.opacity(0.7))
                            .cornerRadius(4)
                            .padding(4)
                    }
                }
            }
            .frame(width: 140, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // Title
            Text(chapter.title)
                .font(.system(size: 12, weight: isActive ? .bold : .medium))
                .foregroundColor(isActive ? .white : .white.opacity(0.7))
                .lineLimit(2)
                .frame(width: 140, alignment: .leading)
        }
        .scaleEffect(isActive ? 1.05 : 1.0)
        .shadow(color: isActive ? Color.blue.opacity(0.4) : Color.clear, radius: 6, x: 0, y: 2)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isActive ? Color.blue : Color.clear, lineWidth: 2)
                .frame(width: 140, height: 80),
            alignment: .top
        )
        .animation(.easeInOut(duration: 0.2), value: isActive)
    }

    private var thumbnailPlaceholder: some View {
        LinearGradient(
            colors: [Color.blue.opacity(0.3), Color.purple.opacity(0.3)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(
            Image(systemName: "play.rectangle")
                .font(.system(size: 20))
                .foregroundColor(.white.opacity(0.5))
        )
    }
}
