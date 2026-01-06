import SwiftUI
import Combine

@MainActor
class AppState: ObservableObject {
    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var currentUser: User?
    @Published var errorMessage: String?

    private let authService = AuthService.shared
    private let keychainService = KeychainService.shared

    func checkAuthStatus() async {
        isLoading = true
        defer { isLoading = false }

        // Check if we have a stored session
        guard let sessionCookie = keychainService.getSessionCookie() else {
            isAuthenticated = false
            return
        }

        // Validate session with server
        do {
            let user = try await authService.getCurrentUser()
            self.currentUser = user
            self.isAuthenticated = true
        } catch {
            // Session invalid, clear it
            keychainService.clearSession()
            isAuthenticated = false
        }
    }

    func login(with authToken: String) async throws {
        let user = try await authService.loginWithTVCode(authToken: authToken)
        self.currentUser = user
        self.isAuthenticated = true
    }

    func logout() async {
        do {
            try await authService.logout()
        } catch {
            print("Logout error: \(error)")
        }
        keychainService.clearSession()
        currentUser = nil
        isAuthenticated = false
    }
}
