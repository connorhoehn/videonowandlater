// Views/Feed/LoginView.swift
import SwiftUI
import AuthenticationServices

struct LoginView: View {
    @EnvironmentObject var env: AppEnvironment
    @State private var isSigningIn = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color(hex: 0x1a1a1a).ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // App logo / name area
                VStack(spacing: 16) {
                    Image(systemName: "video.circle.fill")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 80, height: 80)
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )

                    Text("VideoNowAndLater")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(.white)

                    Text("Live streaming, hangouts, and replay")
                        .font(.subheadline)
                        .foregroundColor(Color(hex: 0x8e8e93))
                }

                Spacer()

                // Sign-in buttons
                VStack(spacing: 12) {
                    // Primary: Cognito Hosted UI sign-in
                    Button {
                        startCognitoSignIn()
                    } label: {
                        HStack(spacing: 8) {
                            if isSigningIn {
                                ProgressView()
                                    .tint(.white)
                                    .scaleEffect(0.8)
                            }
                            Text("Sign in with Cognito")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundColor(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(12)
                    }
                    .disabled(isSigningIn)

                    // Dev mode: skip auth with placeholder
                    // Demo mode — explore UI without backend
                    Button {
                        env.isDemoMode = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 14))
                            Text("Try Demo")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .foregroundColor(.yellow)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(Color.yellow.opacity(0.12))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.yellow.opacity(0.3), lineWidth: 1)
                        )
                    }

                    #if DEBUG
                    Button {
                        isSigningIn = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                            env.setSession(idToken: "dev-placeholder-token", username: "devuser")
                            isSigningIn = false
                        }
                    } label: {
                        Text("Skip (Dev Mode)")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.appTextGray1)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Color.appBackgroundButton)
                            .cornerRadius(12)
                    }
                    .disabled(isSigningIn)
                    #endif

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.appRed)
                            .multilineTextAlignment(.center)
                            .transition(.opacity)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Cognito OAuth2 PKCE Flow

    private func startCognitoSignIn() {
        isSigningIn = true
        errorMessage = nil

        // Build Cognito Hosted UI authorize URL
        let domain = Constants.cognitoDomain
        let clientId = Constants.clientId
        let redirectUri = Constants.callbackUrl
        let scope = "openid+profile+email"

        guard let url = URL(string:
            "\(domain)/oauth2/authorize?response_type=code&client_id=\(clientId)&redirect_uri=\(redirectUri)&scope=\(scope)"
        ) else {
            errorMessage = "Invalid auth configuration"
            isSigningIn = false
            return
        }

        let callbackScheme = Constants.callbackScheme

        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
            DispatchQueue.main.async {
                isSigningIn = false

                if let error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        // User cancelled — no error to show
                        return
                    }
                    errorMessage = error.localizedDescription
                    return
                }

                guard let callbackURL,
                      let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
                        .queryItems?.first(where: { $0.name == "code" })?.value else {
                    errorMessage = "No authorization code received"
                    return
                }

                // Exchange auth code for tokens
                exchangeCodeForTokens(code: code)
            }
        }

        // Find the current window scene for presentation
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
            session.presentationContextProvider = WebAuthPresenter(windowScene: windowScene)
        }
        session.prefersEphemeralWebBrowserSession = false
        session.start()
    }

    private func exchangeCodeForTokens(code: String) {
        isSigningIn = true

        let domain = Constants.cognitoDomain
        let clientId = Constants.clientId
        let redirectUri = Constants.callbackUrl

        guard let tokenURL = URL(string: "\(domain)/oauth2/token") else {
            errorMessage = "Invalid token endpoint"
            isSigningIn = false
            return
        }

        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = "grant_type=authorization_code&client_id=\(clientId)&code=\(code)&redirect_uri=\(redirectUri)"
        request.httpBody = body.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { data, _, error in
            DispatchQueue.main.async {
                isSigningIn = false

                if let error {
                    errorMessage = error.localizedDescription
                    return
                }

                guard let data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let idToken = json["id_token"] as? String else {
                    errorMessage = "Failed to parse token response"
                    return
                }

                // Decode username from id_token JWT payload
                let username = decodeUsernameFromJWT(idToken) ?? "User"
                let refreshToken = json["refresh_token"] as? String
                env.setSession(idToken: idToken, refreshToken: refreshToken, username: username)
            }
        }.resume()
    }

    /// Decode the `cognito:username` claim from a JWT id_token
    private func decodeUsernameFromJWT(_ jwt: String) -> String? {
        let segments = jwt.split(separator: ".")
        guard segments.count >= 2 else { return nil }

        var base64 = String(segments[1])
        // Pad to multiple of 4
        while base64.count % 4 != 0 { base64.append("=") }

        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        return payload["cognito:username"] as? String ?? payload["preferred_username"] as? String
    }
}

// MARK: - ASWebAuthenticationSession Presentation

private class WebAuthPresenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    let windowScene: UIWindowScene

    init(windowScene: UIWindowScene) {
        self.windowScene = windowScene
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        windowScene.windows.first(where: { $0.isKeyWindow }) ?? ASPresentationAnchor()
    }
}

#Preview {
    LoginView()
        .environmentObject(AppEnvironment())
}
