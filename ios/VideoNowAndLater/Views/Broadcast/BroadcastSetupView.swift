// Views/Broadcast/BroadcastSetupView.swift
import SwiftUI

struct BroadcastSetupView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var title: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var navigateToBroadcast = false
    @State private var sessionResponse: CreateSessionResponse?

    private let apiClient = APIClient()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                Image(systemName: "video.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.white.opacity(0.6))

                Text("Start a Broadcast")
                    .font(.title2.weight(.bold))
                    .foregroundColor(.white)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Session Title")
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white.opacity(0.7))

                    TextField("What are you streaming?", text: $title)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .background(Color.white.opacity(0.1))
                        .cornerRadius(10)
                        .foregroundColor(.white)
                        .accentColor(.white)
                }
                .padding(.horizontal, 24)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundColor(.red)
                        .padding(.horizontal, 24)
                }

                Button {
                    startSession()
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView()
                                .tint(.black)
                        }
                        Text("Start Broadcast")
                            .font(.headline)
                    }
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        title.trimmingCharacters(in: .whitespaces).isEmpty || isLoading
                            ? Color.white.opacity(0.3)
                            : Color.white
                    )
                    .cornerRadius(12)
                }
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                .padding(.horizontal, 24)

                Spacer()
                Spacer()
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .fullScreenCover(isPresented: $navigateToBroadcast) {
            if let resp = sessionResponse, let token = env.idToken {
                BroadcastView(
                    sessionId: resp.sessionId,
                    ingestEndpoint: resp.ingestEndpoint,
                    streamKey: resp.streamKey,
                    authToken: token
                )
                .environmentObject(env)
            }
        }
    }

    private func startSession() {
        guard let authToken = env.idToken else {
            errorMessage = "Not authenticated"
            return
        }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                let response = try await apiClient.createSession(
                    title: title.trimmingCharacters(in: .whitespaces),
                    authToken: authToken
                )
                sessionResponse = response
                navigateToBroadcast = true
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
