// Views/ContentView.swift
// Tab/navigation root view.
// Provides the main navigation structure with feed as the primary tab.
// Additional tabs can be added as features are built out.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var selectedTab: Tab = .feed

    enum Tab: Hashable {
        case feed
        case profile
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            // Feed tab — session list with navigation to replay/live
            NavigationStack {
                FeedView()
            }
            .tabItem {
                Label("Sessions", systemImage: "play.rectangle.on.rectangle")
            }
            .tag(Tab.feed)

            // Profile tab — user profile and settings
            NavigationStack {
                UserProfileView()
            }
            .tabItem {
                Label("Profile", systemImage: "person.circle")
            }
            .tag(Tab.profile)
        }
        .tint(.white)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
        .environmentObject(AppEnvironment())
}
