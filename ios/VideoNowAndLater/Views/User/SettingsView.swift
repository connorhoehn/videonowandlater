// Views/User/SettingsView.swift
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var env: AppEnvironment
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("autoPlayVideos") private var autoPlayVideos = true
    @AppStorage("preferredQuality") private var preferredQuality = "Auto"

    private let qualityOptions = ["Auto", "1080p", "720p", "480p"]

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            List {
                // Account
                Section {
                    HStack(spacing: 12) {
                        avatarView
                        VStack(alignment: .leading, spacing: 2) {
                            Text(env.username ?? "User")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(.white)
                            Text("Signed in")
                                .font(.caption)
                                .foregroundColor(.appTextGray1)
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                    .listRowBackground(Color.appBackgroundList)
                } header: {
                    Text("Account")
                }

                // Preferences
                Section {
                    Toggle(isOn: $notificationsEnabled) {
                        settingLabel(icon: "bell", title: "Notifications")
                    }
                    .tint(.blue)
                    .listRowBackground(Color.appBackgroundList)

                    Toggle(isOn: $autoPlayVideos) {
                        settingLabel(icon: "play.circle", title: "Auto-play Videos")
                    }
                    .tint(.blue)
                    .listRowBackground(Color.appBackgroundList)

                    Picker(selection: $preferredQuality) {
                        ForEach(qualityOptions, id: \.self) { quality in
                            Text(quality).tag(quality)
                        }
                    } label: {
                        settingLabel(icon: "sparkles.tv", title: "Video Quality")
                    }
                    .listRowBackground(Color.appBackgroundList)
                } header: {
                    Text("Preferences")
                }

                // About
                Section {
                    aboutRow(icon: "info.circle", title: "Version", detail: "\(Constants.appVersion) (\(Constants.buildNumber))")
                    aboutRow(icon: "doc.text", title: "Licenses", detail: nil)
                    aboutRow(icon: "ant", title: "Debug Info", detail: Constants.awsRegion)
                } header: {
                    Text("About")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    // MARK: - Helpers

    private var avatarView: some View {
        let name = env.username ?? "U"
        let initial = String(name.prefix(1)).uppercased()
        let colors: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo]
        let color = colors[abs(name.hashValue) % colors.count]

        return ZStack {
            Circle()
                .fill(color)
                .frame(width: 40, height: 40)
            Text(initial)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.white)
        }
    }

    private func settingLabel(icon: String, title: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 14))
                .foregroundColor(.appTextGray1)
                .frame(width: 20)
            Text(title)
                .font(.system(size: 15))
                .foregroundColor(.white)
        }
    }

    private func aboutRow(icon: String, title: String, detail: String?) -> some View {
        HStack {
            settingLabel(icon: icon, title: title)
            Spacer()
            if let detail {
                Text(detail)
                    .font(.system(size: 14))
                    .foregroundColor(.appTextGray1)
            }
        }
        .listRowBackground(Color.appBackgroundList)
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(AppEnvironment())
    }
}
