// Networking/APIClient.swift
import Foundation

class APIClient: ObservableObject {
    private let baseUrl = Constants.apiUrl

    // MARK: - Sessions

    func listSessions(authToken: String) async throws -> [Session] {
        let data = try await send("GET", path: "/sessions", body: nil, authToken: authToken)
        return try JSONDecoder().decode([Session].self, from: data)
    }

    func getSession(id: String, authToken: String) async throws -> Session {
        let data = try await send("GET", path: "/sessions/\(id)", body: nil, authToken: authToken)
        return try JSONDecoder().decode(Session.self, from: data)
    }

    // MARK: - Broadcast (BROADCAST mode)

    func createSession(title: String, authToken: String) async throws -> CreateSessionResponse {
        let body: [String: Any] = ["title": title]
        let data = try await send("POST", path: "/sessions", body: body, authToken: authToken)
        return try JSONDecoder().decode(CreateSessionResponse.self, from: data)
    }

    // MARK: - Hangout (HANGOUT mode / IVS Stage)

    func joinHangout(sessionId: String, authToken: String) async throws -> JoinHangoutResponse {
        let data = try await send("POST", path: "/sessions/\(sessionId)/join", body: nil, authToken: authToken)
        return try JSONDecoder().decode(JoinHangoutResponse.self, from: data)
    }

    // MARK: - Chat

    func createChatToken(sessionId: String, authToken: String) async throws -> ChatTokenResponse {
        let data = try await send("POST", path: "/sessions/\(sessionId)/chat-token", body: nil, authToken: authToken)
        return try JSONDecoder().decode(ChatTokenResponse.self, from: data)
    }

    // MARK: - Comments (for video/replay pages)

    func addComment(sessionId: String, content: String, timestampMs: Int, authToken: String) async throws -> Comment {
        let body: [String: Any] = ["content": content, "timestampMs": timestampMs]
        let data = try await send("POST", path: "/sessions/\(sessionId)/comments", body: body, authToken: authToken)
        return try JSONDecoder().decode(Comment.self, from: data)
    }

    // MARK: - Speaker Segments (transcript click-to-seek)

    func getSpeakerSegments(sessionId: String, authToken: String) async throws -> [SpeakerSegment] {
        let data = try await send("GET", path: "/sessions/\(sessionId)/speaker-segments", body: nil, authToken: authToken)
        return try JSONDecoder().decode([SpeakerSegment].self, from: data)
    }

    // MARK: - User Stats

    func getUserStats(authToken: String) async throws -> UserStats {
        let data = try await send("GET", path: "/me", authToken: authToken)
        return try JSONDecoder().decode(UserStats.self, from: data)
    }

    // MARK: - Core

    internal func send(_ method: String, path: String, body: [String: Any]? = nil, authToken: String) async throws -> Data {
        guard let url = URL(string: "\(baseUrl)\(path)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw APIError.httpError(statusCode)
        }

        return data
    }
}

enum APIError: Error, LocalizedError {
    case invalidURL
    case httpError(Int)
    case decodingError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .httpError(let code):
            return "HTTP error \(code)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        }
    }
}
