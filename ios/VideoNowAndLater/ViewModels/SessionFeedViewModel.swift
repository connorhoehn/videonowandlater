// ViewModels/SessionFeedViewModel.swift
import Foundation
import Combine

@MainActor
class SessionFeedViewModel: ObservableObject {
    @Published var sessions: [Session] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var searchText: String = ""

    private let api: APIClient
    private var pollTask: Task<Void, Never>?
    private var pollInterval: TimeInterval = 15

    init(api: APIClient) {
        self.api = api
    }

    // MARK: - Computed Properties

    var liveSessions: [Session] {
        let filtered = filteredSessions
        return filtered.filter { $0.isLive }
            .sorted { ($0.createdAt) > ($1.createdAt) }
    }

    var recentSessions: [Session] {
        let filtered = filteredSessions
        return filtered.filter { !$0.isLive }
            .sorted { ($0.createdAt) > ($1.createdAt) }
    }

    var hasLiveSessions: Bool { !liveSessions.isEmpty }

    private var filteredSessions: [Session] {
        guard !searchText.isEmpty else { return sessions }
        let query = searchText.lowercased()
        return sessions.filter { session in
            (session.title?.lowercased().contains(query) ?? false) ||
            session.type.lowercased().contains(query)
        }
    }

    // MARK: - Loading

    func load(authToken: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let loaded = try await api.listSessions(authToken: authToken)
            sessions = loaded
            startPollingIfNeeded(authToken: authToken)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Polling

    private func startPollingIfNeeded(authToken: String) {
        let hasLive = sessions.contains { $0.isLive }
        let hasNonTerminal = sessions.contains { !$0.isTerminal && !$0.isLive }
        guard hasLive || hasNonTerminal else { return }

        pollTask?.cancel()
        pollInterval = hasLive ? 15 : 15  // Reset interval on new load
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
                guard !Task.isCancelled else { break }

                do {
                    let updated = try await api.listSessions(authToken: authToken)
                    sessions = updated

                    let stillLive = updated.contains { $0.isLive }
                    let stillNonTerminal = updated.contains { !$0.isTerminal && !$0.isLive }

                    if stillLive {
                        // Keep fast polling for live sessions
                        pollInterval = 15
                    } else if stillNonTerminal {
                        // Exponential backoff for processing sessions: 15 -> 30 -> 60
                        pollInterval = min(pollInterval * 2, 60)
                    } else {
                        // All sessions terminal, stop polling
                        break
                    }
                } catch { break }
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
        pollInterval = 15
    }
}
