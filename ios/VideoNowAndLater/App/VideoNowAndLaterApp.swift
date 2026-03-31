// App/VideoNowAndLaterApp.swift
import SwiftUI

@main
struct VideoNowAndLaterApp: App {
    @StateObject var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            Group {
                if env.isDemoMode {
                    DemoFeedView()
                        .transition(.opacity)
                } else if !env.hasCompletedOnboarding {
                    OnboardingView()
                        .transition(.opacity)
                } else if env.isAuthenticated {
                    FeedView()
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .trailing)),
                            removal: .opacity
                        ))
                } else {
                    LoginView()
                        .transition(.opacity)
                }
            }
            .environmentObject(env)
            .animation(.easeInOut(duration: 0.35), value: env.isAuthenticated)
            .animation(.easeInOut(duration: 0.35), value: env.hasCompletedOnboarding)
            .animation(.easeInOut(duration: 0.35), value: env.isDemoMode)
        }
    }
}
