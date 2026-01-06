import Foundation

struct EPGProgram: Codable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let start: TimeInterval // Unix timestamp
    let end: TimeInterval // Unix timestamp

    var startDate: Date {
        Date(timeIntervalSince1970: start)
    }

    var endDate: Date {
        Date(timeIntervalSince1970: end)
    }

    var duration: TimeInterval {
        end - start
    }

    var isCurrentlyAiring: Bool {
        let now = Date().timeIntervalSince1970
        return start <= now && end > now
    }

    var progress: Double {
        guard isCurrentlyAiring else { return 0 }
        let now = Date().timeIntervalSince1970
        return (now - start) / duration
    }

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case description
        case start
        case end
    }

    // Memberwise initializer for previews and testing
    init(id: String, title: String, start: TimeInterval, end: TimeInterval, description: String? = nil) {
        self.id = id
        self.title = title
        self.start = start
        self.end = end
        self.description = description
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Generate an ID if not present
        if let id = try? container.decode(String.self, forKey: .id) {
            self.id = id
        } else {
            self.id = UUID().uuidString
        }

        self.title = try container.decode(String.self, forKey: .title)
        self.description = try? container.decode(String.self, forKey: .description)
        self.start = try container.decode(TimeInterval.self, forKey: .start)
        self.end = try container.decode(TimeInterval.self, forKey: .end)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encodeIfPresent(description, forKey: .description)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
    }
}

struct EPGShortResponse: Codable {
    let configured: Bool
    let now: EPGProgram?
    let next: EPGNextProgram?
}

struct EPGNextProgram: Codable {
    let title: String
    let start: TimeInterval

    var startDate: Date {
        Date(timeIntervalSince1970: start)
    }
}

struct EPGFullResponse: Codable {
    let configured: Bool
    let epg: [EPGProgram]
}
