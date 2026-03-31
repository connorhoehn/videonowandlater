// App/AppEnvironment.swift
import Foundation
import SwiftUI
import Security

class AppEnvironment: ObservableObject {
    @Published var idToken: String?
    @Published var username: String?
    @Published var isAuthenticated = false
    @Published var isDemoMode = false
    @AppStorage("hasCompletedOnboarding") var hasCompletedOnboarding = false

    private static let serviceName = "com.videonowandlater.ios"
    private var refreshTimer: Timer?

    init() {
        restoreSession()
    }

    deinit {
        refreshTimer?.invalidate()
    }

    // MARK: - Session Management

    /// Called after Cognito sign-in returns tokens
    func setSession(idToken: String, refreshToken: String? = nil, username: String) {
        self.idToken = idToken
        self.username = username
        self.isAuthenticated = true
        KeychainHelper.save(key: "idToken", value: idToken, service: Self.serviceName)
        KeychainHelper.save(key: "username", value: username, service: Self.serviceName)
        if let refreshToken {
            KeychainHelper.save(key: "refreshToken", value: refreshToken, service: Self.serviceName)
        }
        scheduleTokenRefresh(for: idToken)
    }

    func signOut() {
        refreshTimer?.invalidate()
        refreshTimer = nil
        self.idToken = nil
        self.username = nil
        self.isAuthenticated = false
        KeychainHelper.delete(key: "idToken", service: Self.serviceName)
        KeychainHelper.delete(key: "username", service: Self.serviceName)
        KeychainHelper.delete(key: "refreshToken", service: Self.serviceName)
    }

    /// Attempt to restore a previous session from Keychain
    private func restoreSession() {
        guard let token = KeychainHelper.load(key: "idToken", service: Self.serviceName),
              let user = KeychainHelper.load(key: "username", service: Self.serviceName) else {
            return
        }

        // Check if the token is expired
        if isTokenExpired(token) {
            // Try to refresh
            if KeychainHelper.load(key: "refreshToken", service: Self.serviceName) != nil {
                self.username = user
                refreshTokenNow()
            } else {
                // No refresh token, clear stale session
                signOut()
            }
            return
        }

        self.idToken = token
        self.username = user
        self.isAuthenticated = true
        scheduleTokenRefresh(for: token)
    }

    func completeOnboarding() {
        hasCompletedOnboarding = true
    }

    // MARK: - Token Refresh

    /// Schedule a refresh 5 minutes before the token expires
    private func scheduleTokenRefresh(for jwt: String) {
        refreshTimer?.invalidate()

        guard let exp = expirationDate(from: jwt) else { return }
        let refreshAt = exp.addingTimeInterval(-300) // 5 minutes before expiry
        let delay = max(refreshAt.timeIntervalSinceNow, 10) // at least 10s

        refreshTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            self?.refreshTokenNow()
        }
    }

    /// Exchange refresh_token for new id_token via Cognito token endpoint
    private func refreshTokenNow() {
        guard let refreshToken = KeychainHelper.load(key: "refreshToken", service: Self.serviceName) else {
            DispatchQueue.main.async { self.signOut() }
            return
        }

        let domain = Constants.cognitoDomain
        let clientId = Constants.clientId

        guard let tokenURL = URL(string: "\(domain)/oauth2/token") else { return }

        var request = URLRequest(url: tokenURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = "grant_type=refresh_token&client_id=\(clientId)&refresh_token=\(refreshToken)"
        request.httpBody = body.data(using: .utf8)

        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            DispatchQueue.main.async {
                guard let self else { return }

                guard error == nil,
                      let data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let newIdToken = json["id_token"] as? String else {
                    // Refresh failed — sign out
                    self.signOut()
                    return
                }

                self.idToken = newIdToken
                self.isAuthenticated = true
                KeychainHelper.save(key: "idToken", value: newIdToken, service: Self.serviceName)

                // Cognito may return a new refresh token
                if let newRefresh = json["refresh_token"] as? String {
                    KeychainHelper.save(key: "refreshToken", value: newRefresh, service: Self.serviceName)
                }

                self.scheduleTokenRefresh(for: newIdToken)
            }
        }.resume()
    }

    // MARK: - JWT Helpers

    private func isTokenExpired(_ jwt: String) -> Bool {
        guard let exp = expirationDate(from: jwt) else { return true }
        return exp < Date()
    }

    private func expirationDate(from jwt: String) -> Date? {
        let segments = jwt.split(separator: ".")
        guard segments.count >= 2 else { return nil }

        var base64 = String(segments[1])
        while base64.count % 4 != 0 { base64.append("=") }

        guard let data = Data(base64Encoded: base64),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = payload["exp"] as? TimeInterval else {
            return nil
        }

        return Date(timeIntervalSince1970: exp)
    }
}

// MARK: - Keychain Helper

private enum KeychainHelper {
    static func save(key: String, value: String, service: String) {
        guard let data = value.data(using: .utf8) else { return }
        delete(key: key, service: service)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String, service: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String, service: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
