// Demo/DemoProfileView.swift
// Mock profile view for demo mode

import SwiftUI

struct DemoProfileView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Color.appBackground.ignoresSafeArea()

            VStack(spacing: 24) {
                // Avatar
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 90, height: 90)
                    .overlay(
                        Text("D")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundColor(.white)
                    )

                Text("Demo User")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.white)

                // Stats
                HStack(spacing: 32) {
                    statItem(value: "12", label: "Broadcasts")
                    statItem(value: "8", label: "Hangouts")
                    statItem(value: "3", label: "Uploads")
                }

                Spacer()

                // Demo notice
                VStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 24))
                        .foregroundColor(.yellow)
                    Text("Demo Mode")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                    Text("Connect your backend to see real data")
                        .font(.system(size: 13))
                        .foregroundColor(.appTextGray1)
                }

                Spacer()
            }
            .padding(.top, 40)
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func statItem(value: String, label: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(.white)
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(.appTextGray1)
        }
    }
}
