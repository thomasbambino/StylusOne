import Foundation

struct Subscription: Codable {
    let id: Int
    let planId: Int
    let status: String
    let billingPeriod: String
    let currentPeriodStart: Date?
    let currentPeriodEnd: Date?
    let cancelAtPeriodEnd: Bool
    let planName: String?
    let planDescription: String?

    var isActive: Bool {
        status == "active" || status == "trialing"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case planId = "plan_id"
        case status
        case billingPeriod = "billing_period"
        case currentPeriodStart = "current_period_start"
        case currentPeriodEnd = "current_period_end"
        case cancelAtPeriodEnd = "cancel_at_period_end"
        case planName = "plan_name"
        case planDescription = "plan_description"
    }
}

struct StreamTokenResponse: Codable {
    let token: String
    let sessionToken: String?
    let expiresIn: Int
}

struct StreamHeartbeatRequest: Codable {
    let sessionToken: String
    let streamId: String
}

struct StreamReleaseRequest: Codable {
    let sessionToken: String
}
