// Views/User/UserProfileView.swift
import SwiftUI

struct UserProfileView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var showSignOutConfirm = false
    @State private var stats: UserStats?
    private let api = APIClient()

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    // Avatar + username
                    VStack(spacing: 12) {
                        avatarView
                        Text(env.username ?? "User")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.white)
                    }
                    .padding(.top, 32)

                    // Stats row
                    HStack(spacing: 0) {
                        statItem(value: stats.map { "\($0.broadcastCount ?? 0)" } ?? "—", label: "Broadcasts")
                        Divider()
                            .frame(height: 32)
                            .background(Color.appBackgroundButton)
                        statItem(value: stats.map { "\($0.hangoutCount ?? 0)" } ?? "—", label: "Hangouts")
                        Divider()
                            .frame(height: 32)
                            .background(Color.appBackgroundButton)
                        statItem(value: stats.map { "\($0.uploadCount ?? 0)" } ?? "—", label: "Uploads")
                    }
                    .padding(.vertical, 16)
                    .background(Color.appBackgroundList)
                    .cornerRadius(12)
                    .padding(.horizontal, 16)

                    // Menu items
                    VStack(spacing: 0) {
                        menuRow(icon: "gearshape", title: "Settings", destination: SettingsView())
                        Divider().background(Color.appBackgroundButton)
                        menuRow(icon: "questionmark.circle", title: "Help & Support")
                        Divider().background(Color.appBackgroundButton)
                        menuRow(icon: "doc.text", title: "Terms of Service")
                        Divider().background(Color.appBackgroundButton)
                        menuRow(icon: "hand.raised", title: "Privacy Policy")
                    }
                    .background(Color.appBackgroundList)
                    .cornerRadius(12)
                    .padding(.horizontal, 16)

                    // Sign out
                    Button {
                        showSignOutConfirm = true
                    } label: {
                        HStack {
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                            Text("Sign Out")
                        }
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.appRed)
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Color.appBackgroundList)
                        .cornerRadius(12)
                    }
                    .padding(.horizontal, 16)

                    // Version
                    Text("v\(Constants.appVersion) (\(Constants.buildNumber))")
                        .font(.caption)
                        .foregroundColor(.appTextGray1)
                        .padding(.top, 8)

                    Spacer(minLength: 40)
                }
            }
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            guard let token = env.idToken else { return }
            stats = try? await api.getUserStats(authToken: token)
        }
        .confirmationDialog("Sign Out", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                env.signOut()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }

    // MARK: - Avatar

    private var avatarView: some View {
        let name = env.username ?? "U"
        let initial = String(name.prefix(1)).uppercased()
        let color = avatarColor(for: name)

        return ZStack {
            Circle()
                .fill(color)
                .frame(width: 80, height: 80)
            Text(initial)
                .font(.system(size: 32, weight: .bold))
                .foregroundColor(.white)
        }
    }

    private func avatarColor(for name: String) -> Color {
        let colors: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo]
        let hash = abs(name.hashValue)
        return colors[hash % colors.count]
    }

    // MARK: - Stat Item

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundColor(.white)
            Text(label)
                .font(.caption)
                .foregroundColor(.appTextGray1)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Menu Row (navigable)

    private func menuRow<Destination: View>(icon: String, title: String, destination: Destination) -> some View {
        NavigationLink(destination: destination) {
            menuRowContent(icon: icon, title: title)
        }
    }

    // Menu row (non-navigable placeholder)
    private func menuRow(icon: String, title: String) -> some View {
        menuRowContent(icon: icon, title: title)
    }

    private func menuRowContent(icon: String, title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundColor(.appTextGray1)
                .frame(width: 24)
            Text(title)
                .font(.system(size: 16))
                .foregroundColor(.white)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.appTextGray1)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

#Preview {
    NavigationStack {
        UserProfileView()
            .environmentObject(AppEnvironment())
    }
}
