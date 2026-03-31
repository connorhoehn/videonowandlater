// Views/User/OnboardingView.swift
import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            icon: "video.circle.fill",
            iconColors: [.blue, .purple],
            title: "Welcome to\nVideoNowAndLater",
            subtitle: "Live streaming, video hangouts, and instant replay — all in one app."
        ),
        OnboardingPage(
            icon: "person.3.fill",
            iconColors: [.purple, .pink],
            title: "Go Live or\nHang Out",
            subtitle: "Broadcast to an audience or jump into a multi-participant video hangout with friends."
        ),
        OnboardingPage(
            icon: "play.rectangle.fill",
            iconColors: [.orange, .red],
            title: "Watch It Back\nAnytime",
            subtitle: "Every session is recorded with AI transcripts and summaries so you never miss a moment."
        ),
    ]

    var body: some View {
        ZStack {
            Color(hex: 0x1a1a1a).ignoresSafeArea()

            VStack(spacing: 0) {
                // Page content
                TabView(selection: $currentPage) {
                    ForEach(pages.indices, id: \.self) { index in
                        pageView(pages[index])
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(.easeInOut(duration: 0.3), value: currentPage)

                // Dots + button
                VStack(spacing: 24) {
                    // Page dots
                    HStack(spacing: 8) {
                        ForEach(pages.indices, id: \.self) { index in
                            Circle()
                                .fill(index == currentPage ? Color.white : Color.white.opacity(0.3))
                                .frame(width: 8, height: 8)
                                .scaleEffect(index == currentPage ? 1.2 : 1.0)
                                .animation(.spring(response: 0.3), value: currentPage)
                        }
                    }

                    // Action button
                    Button {
                        if currentPage < pages.count - 1 {
                            withAnimation { currentPage += 1 }
                        } else {
                            env.completeOnboarding()
                        }
                    } label: {
                        Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 52)
                            .background(
                                LinearGradient(
                                    colors: pages[currentPage].iconColors,
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .cornerRadius(14)
                            .shadow(color: pages[currentPage].iconColors.first?.opacity(0.3) ?? .clear, radius: 12, y: 4)
                    }
                    .buttonStyle(PressScaleButtonStyle())

                    // Skip button
                    if currentPage < pages.count - 1 {
                        Button {
                            env.completeOnboarding()
                        } label: {
                            Text("Skip")
                                .font(.system(size: 15))
                                .foregroundColor(.appTextGray1)
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Page View

    private func pageView(_ page: OnboardingPage) -> some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: page.icon)
                .resizable()
                .scaledToFit()
                .frame(width: 100, height: 100)
                .foregroundStyle(
                    LinearGradient(
                        colors: page.iconColors,
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Text(page.title)
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)

            Text(page.subtitle)
                .font(.system(size: 16))
                .foregroundColor(Color(hex: 0x8e8e93))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Spacer()
            Spacer()
        }
    }
}

// MARK: - Model

private struct OnboardingPage {
    let icon: String
    let iconColors: [Color]
    let title: String
    let subtitle: String
}

/// Button style that scales down on press for tactile feedback
struct PressScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeInOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview {
    OnboardingView()
        .environmentObject(AppEnvironment())
}
