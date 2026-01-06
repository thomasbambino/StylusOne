import Foundation

struct FavoriteChannel: Codable, Identifiable {
    let id: Int
    let userId: Int
    let channelId: String
    let channelName: String
    let channelLogo: String?
    let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case channelId = "channel_id"
        case channelName = "channel_name"
        case channelLogo = "channel_logo"
        case createdAt = "created_at"
    }
}

struct AddFavoriteRequest: Codable {
    let channelId: String
    let channelName: String
    let channelLogo: String?
}
