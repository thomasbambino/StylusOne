import Foundation

enum APIConfig {
    static let baseURL = "https://stylus.services"
    static let streamTokenDuration: TimeInterval = 3600 // 1 hour
    static let heartbeatInterval: TimeInterval = 30 // 30 seconds
    static let tvCodePollInterval: TimeInterval = 3 // 3 seconds
}

enum AppConstants {
    static let appName = "Stylus One"
    static let keychainServiceName = "com.stylus.one.tvos"
    static let sessionCookieKey = "sessionCookie"
}

enum APIEndpoints {
    // Authentication
    static let generateTVCode = "/api/tv-codes/generate"
    static func tvCodeStatus(_ code: String) -> String { "/api/tv-codes/status/\(code)" }
    static let tvCodeLogin = "/api/tv-codes/login"
    static let logout = "/api/logout"
    static let currentUser = "/api/user"

    // Channels
    static let channels = "/api/iptv/channels"
    static let categories = "/api/iptv/categories"
    static let iptvStatus = "/api/iptv/status"

    // EPG
    static func epgShort(_ streamId: String) -> String { "/api/iptv/epg/short/\(streamId)" }
    static func epgFull(_ streamId: String, limit: Int = 50) -> String { "/api/iptv/epg/\(streamId)?limit=\(limit)" }

    // Favorites
    static let favorites = "/api/favorite-channels"
    static func deleteFavorite(_ channelId: String) -> String { "/api/favorite-channels/\(channelId)" }

    // Streaming
    static let generateToken = "/api/iptv/generate-token"
    static func streamURL(_ streamId: String, token: String) -> String {
        "\(APIConfig.baseURL)/api/iptv/stream/\(streamId).m3u8?token=\(token)"
    }
    static let streamHeartbeat = "/api/iptv/stream/heartbeat"
    static let streamRelease = "/api/iptv/stream/release"
}
