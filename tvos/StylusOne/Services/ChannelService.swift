import Foundation

actor ChannelService {
    static let shared = ChannelService()

    private let apiClient = APIClient.shared

    private init() {}

    // MARK: - Channels

    func getChannels(category: String? = nil) async throws -> [Channel] {
        var endpoint = APIEndpoints.channels
        if let category = category {
            endpoint += "?category=\(category)"
        }
        let response: ChannelsResponse = try await apiClient.get(endpoint)
        return response.channels
    }

    // MARK: - Categories

    func getCategories() async throws -> [Category] {
        let response: CategoriesResponse = try await apiClient.get(APIEndpoints.categories)
        return response.categories
    }

    // MARK: - Streaming

    func generateStreamToken(streamId: String) async throws -> StreamTokenResponse {
        struct TokenRequest: Codable {
            let streamId: String
        }
        return try await apiClient.post(APIEndpoints.generateToken, body: TokenRequest(streamId: streamId))
    }

    func sendHeartbeat(sessionToken: String, streamId: String) async throws {
        let request = StreamHeartbeatRequest(sessionToken: sessionToken, streamId: streamId)
        try await apiClient.post(APIEndpoints.streamHeartbeat, body: request)
    }

    func releaseStream(sessionToken: String) async throws {
        let request = StreamReleaseRequest(sessionToken: sessionToken)
        try await apiClient.post(APIEndpoints.streamRelease, body: request)
    }

    // MARK: - Helpers

    func getStreamURL(streamId: String, token: String) -> URL? {
        let urlString = APIEndpoints.streamURL(streamId, token: token)
        return URL(string: urlString)
    }
}
