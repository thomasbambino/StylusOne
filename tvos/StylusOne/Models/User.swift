import Foundation

struct User: Codable, Identifiable {
    let id: Int
    let username: String
    let email: String?
    let role: String
    let approved: Bool
    let enabled: Bool

    var isAdmin: Bool {
        role == "admin" || role == "superadmin"
    }
}

struct TVCodeResponse: Codable {
    let code: String
    let expiresAt: Date
    let expiresInSeconds: Int
}

struct TVCodeStatus: Codable {
    let verified: Bool
    let authToken: String?
    let expiresAt: Date?
}

struct TVCodeLoginRequest: Codable {
    let authToken: String
}
