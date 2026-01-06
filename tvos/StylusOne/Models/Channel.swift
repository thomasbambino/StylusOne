import Foundation

struct Channel: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let number: String?
    let logo: String?
    let categoryId: String?
    let categoryName: String?
    let streamId: String?
    let epgChannelId: String?

    // Computed property to get the effective stream ID
    var effectiveStreamId: String {
        streamId ?? id
    }

    // For Hashable conformance
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Channel, rhs: Channel) -> Bool {
        lhs.id == rhs.id
    }

    enum CodingKeys: String, CodingKey {
        case id = "stream_id"
        case name
        case number = "num"
        case logo = "stream_icon"
        case categoryId = "category_id"
        case categoryName = "category_name"
        case epgChannelId = "epg_channel_id"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Handle id as either String or Int
        if let intId = try? container.decode(Int.self, forKey: .id) {
            self.id = String(intId)
        } else {
            self.id = try container.decode(String.self, forKey: .id)
        }

        self.name = try container.decode(String.self, forKey: .name)

        // Handle number as either String or Int
        if let intNum = try? container.decode(Int.self, forKey: .number) {
            self.number = String(intNum)
        } else {
            self.number = try? container.decode(String.self, forKey: .number)
        }

        self.logo = try? container.decode(String.self, forKey: .logo)
        self.categoryId = try? container.decode(String.self, forKey: .categoryId)
        self.categoryName = try? container.decode(String.self, forKey: .categoryName)

        // streamId is the same as id, so set it directly
        self.streamId = self.id

        self.epgChannelId = try? container.decode(String.self, forKey: .epgChannelId)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(number, forKey: .number)
        try container.encodeIfPresent(logo, forKey: .logo)
        try container.encodeIfPresent(categoryId, forKey: .categoryId)
        try container.encodeIfPresent(categoryName, forKey: .categoryName)
        try container.encodeIfPresent(epgChannelId, forKey: .epgChannelId)
    }
}

struct ChannelsResponse: Codable {
    let configured: Bool
    let channels: [Channel]
}
