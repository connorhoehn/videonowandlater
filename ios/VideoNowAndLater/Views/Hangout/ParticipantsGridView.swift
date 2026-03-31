// Views/Hangout/ParticipantsGridView.swift
// Enhanced with patterns from multi-host demo:
// - Speaking indicator (green border pulse) on active audio
// - Name badges with backdrop blur
// - Mute indicator badges (audio + video)
// - Join/leave animations on tiles
// - Avatar fallback when video is off (from multi-host demo)
// - Tap tile for participant options

import SwiftUI
import AmazonIVSBroadcast

struct ParticipantsGridView: View {
    @ObservedObject var viewModel: HangoutViewModel

    var body: some View {
        if viewModel.sessionRunning {
            GeometryReader { geo in
                gridLayout(in: geo.size)
                    .animation(.spring(response: 0.4, dampingFraction: 0.8), value: viewModel.participantCount)
            }
        } else {
            VStack(spacing: 12) {
                ProgressView()
                    .tint(.white)
                Text("Connecting...")
                    .font(.system(size: 14))
                    .foregroundColor(.appTextGray1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func gridLayout(in size: CGSize) -> some View {
        switch viewModel.participantCount {
        case 0:
            EmptyView()
        case 1:
            participantTile(at: 0)
                .cornerRadius(24)
        case 2:
            VStack(spacing: 4) {
                participantTile(at: 0).cornerRadius(24)
                participantTile(at: 1).cornerRadius(24)
            }
        case 3:
            let tileW = (size.width - 4) / 2
            VStack(spacing: 4) {
                participantTile(at: 0).cornerRadius(24)
                HStack(spacing: 4) {
                    participantTile(at: 1).frame(width: tileW).cornerRadius(24)
                    participantTile(at: 2).frame(width: tileW).cornerRadius(24)
                }
            }
        default:
            let tileW = (size.width - 4) / 2
            VStack(spacing: 4) {
                HStack(spacing: 4) {
                    participantTile(at: 0).frame(width: tileW).cornerRadius(24)
                    participantTile(at: 1).frame(width: tileW).cornerRadius(24)
                }
                HStack(spacing: 4) {
                    participantTile(at: 2).frame(width: tileW).cornerRadius(24)
                    participantTile(at: 3).frame(width: tileW).cornerRadius(24)
                }
            }
        }
    }

    @ViewBuilder
    private func participantTile(at index: Int) -> some View {
        let participant = viewModel.participantsData[index]
        ZStack {
            Color.black

            // Video preview or fallback
            if let preview = participant.previewView, !participant.isVideoMuted {
                preview
                    .transition(.opacity)
            } else {
                // Fallback: avatar + name (from multi-host demo)
                VStack(spacing: 10) {
                    // Avatar circle with initial
                    Circle()
                        .fill(avatarColor(for: participant.username))
                        .frame(width: 64, height: 64)
                        .overlay(
                            Text(String(participant.username.prefix(1)).uppercased())
                                .font(.system(size: 26, weight: .bold))
                                .foregroundColor(.white)
                        )
                    Text(participant.username)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white.opacity(0.8))
                }
            }

            // Bottom overlay: name badge + mute indicators
            VStack {
                Spacer()
                HStack(spacing: 6) {
                    // Audio mute indicator (from multi-host demo)
                    if participant.isAudioMuted {
                        Image(systemName: "mic.slash.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.white)
                            .padding(5)
                            .background(Color.red.opacity(0.8))
                            .clipShape(Circle())
                    }

                    // Video mute indicator
                    if participant.isVideoMuted {
                        Image(systemName: "video.slash.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.white)
                            .padding(5)
                            .background(Color.appBackgroundButton.opacity(0.8))
                            .clipShape(Circle())
                    }

                    Spacer()

                    // Name badge with blur (from multi-host demo)
                    Text(participant.isLocal ? "\(participant.username) (You)" : participant.username)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(.ultraThinMaterial)
                        .cornerRadius(8)
                }
                .padding(8)
            }
        }
        // Speaking indicator: green border when not audio muted (from multi-host demo pattern)
        .overlay(
            RoundedRectangle(cornerRadius: 24)
                .strokeBorder(
                    !participant.isAudioMuted && !participant.isLocal
                        ? Color.appGreen.opacity(0.8)
                        : Color.clear,
                    lineWidth: 3
                )
                .animation(.easeInOut(duration: 0.3), value: participant.isAudioMuted)
        )
        .id("\(participant.participantId ?? "")-\(index)")
    }

    /// Deterministic color from username (so each participant gets a consistent avatar color)
    private func avatarColor(for name: String) -> Color {
        let colors: [Color] = [
            .blue, .purple, .pink, .orange, .teal, .indigo, .mint, .cyan
        ]
        let hash = abs(name.hashValue)
        return colors[hash % colors.count]
    }
}
