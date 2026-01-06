import Foundation

actor AuthService {
    static let shared = AuthService()

    private let apiClient = APIClient.shared

    private init() {}

    // MARK: - TV Code Authentication

    func generateTVCode() async throws -> TVCodeResponse {
        return try await apiClient.post(APIEndpoints.generateTVCode, body: EmptyBody())
    }

    func checkTVCodeStatus(code: String) async throws -> TVCodeStatus {
        return try await apiClient.get(APIEndpoints.tvCodeStatus(code))
    }

    func loginWithTVCode(authToken: String) async throws -> User {
        let request = TVCodeLoginRequest(authToken: authToken)
        return try await apiClient.post(APIEndpoints.tvCodeLogin, body: request)
    }

    // MARK: - Session Management

    func getCurrentUser() async throws -> User {
        return try await apiClient.get(APIEndpoints.currentUser)
    }

    func logout() async throws {
        try await apiClient.post(APIEndpoints.logout)
        KeychainService.shared.clearSession()
    }
}

// Empty body for POST requests that don't need data
private struct EmptyBody: Codable {}
