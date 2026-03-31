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
                } else if !env.hasCompletedOnboarding {
                    OnboardingView()
                } else if env.isAuthenticated {
                    FeedView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(env)
            .animation(.easeInOut(duration: 0.3), value: env.isAuthenticated)
            .animation(.easeInOut(duration: 0.3), value: env.hasCompletedOnboarding)
        }
    }
}
