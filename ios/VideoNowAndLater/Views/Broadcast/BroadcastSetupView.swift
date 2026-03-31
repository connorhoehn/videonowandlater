// Views/Broadcast/BroadcastSetupView.swift
import SwiftUI

struct BroadcastSetupView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var title: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var navigateToBroadcast = false
    @State private var sessionResponse: CreateSessionResponse?
    @State private var isTitleFocused = false

    private let apiClient = APIClient()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()

                // Icon in badge
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Color.white.opacity(0.06))
                        .frame(width: 64, height: 64)
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )

                    Image(systemName: "video.fill")
                        .font(.system(size: 28))
                        .foregroundColor(.white.opacity(0.7))
                }

                Text("Start a Broadcast")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.white)

                VStack(alignment: .leading, spacing: 10) {
                    Text("SESSION TITLE")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.appTextGray1)
                        .tracking(1)

                    TextField("What are you streaming?", text: $title, onEditingChanged: { editing in
                        withAnimation(.easeInOut(duration: 0.15)) {
                            isTitleFocused = editing
                        }
                    })
                        .textFieldStyle(.plain)
                        .padding(14)
                        .background(isTitleFocused ? Color.appInputFocused : Color.appInputBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(isTitleFocused ? Color.appIndigo.opacity(0.4) : Color.white.opacity(0.06), lineWidth: 1)
                        )
                        .foregroundColor(.white)
                        .accentColor(.appIndigo)
                        .animation(.easeInOut(duration: 0.15), value: isTitleFocused)
                }
                .padding(.horizontal, 24)

                if let errorMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 12))
                            .foregroundColor(.appRed)
                        Text(errorMessage)
                            .font(.system(size: 13))
                            .foregroundColor(.appRed)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.appRed.opacity(0.1))
                    .cornerRadius(12)
                    .padding(.horizontal, 24)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .move(edge: .top)),
                        removal: .opacity
                    ))
                }

                Button {
                    startSession()
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView()
                                .tint(.black)
                                .scaleEffect(0.85)
                        }
                        Text(isLoading ? "Starting" : "Start Broadcast")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    .foregroundColor(.black)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(
                        title.trimmingCharacters(in: .whitespaces).isEmpty || isLoading
                            ? Color.white.opacity(0.3)
                            : Color.white
                    )
                    .cornerRadius(14)
                    .shadow(color: .white.opacity(title.trimmingCharacters(in: .whitespaces).isEmpty ? 0 : 0.15), radius: 12, y: 4)
                }
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)
                .scaleEffect(isLoading ? 0.98 : 1.0)
                .animation(.easeInOut(duration: 0.15), value: isLoading)
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
