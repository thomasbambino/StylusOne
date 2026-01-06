import Foundation

actor EPGService {
    static let shared = EPGService()

    private let apiClient = APIClient.shared

    // Cache for EPG data
    private var shortEPGCache: [String: (data: EPGShortResponse, timestamp: Date)] = [:]
    private var fullEPGCache: [String: (data: [EPGProgram], timestamp: Date)] = [:]

    private let cacheTimeout: TimeInterval = 60 // 1 minute cache

    private init() {}

    // MARK: - Short EPG (Current + Next)

    func getShortEPG(streamId: String, forceRefresh: Bool = false) async throws -> EPGShortResponse {
        // Check cache
        if !forceRefresh,
           let cached = shortEPGCache[streamId],
           Date().timeIntervalSince(cached.timestamp) < cacheTimeout {
            return cached.data
        }

        // Fetch fresh data
        let response: EPGShortResponse = try await apiClient.get(APIEndpoints.epgShort(streamId))

        // Update cache
        shortEPGCache[streamId] = (data: response, timestamp: Date())

        return response
    }

    // MARK: - Full EPG

    func getFullEPG(streamId: String, limit: Int = 50, forceRefresh: Bool = false) async throws -> [EPGProgram] {
        // Check cache
        if !forceRefresh,
           let cached = fullEPGCache[streamId],
           Date().timeIntervalSince(cached.timestamp) < cacheTimeout {
            return cached.data
        }

        // Fetch fresh data
        let response: EPGFullResponse = try await apiClient.get(APIEndpoints.epgFull(streamId, limit: limit))

        // Update cache
        fullEPGCache[streamId] = (data: response.epg, timestamp: Date())

        return response.epg
    }

    // MARK: - Cache Management

    func clearCache() {
        shortEPGCache.removeAll()
        fullEPGCache.removeAll()
    }

    func clearCache(for streamId: String) {
        shortEPGCache.removeValue(forKey: streamId)
        fullEPGCache.removeValue(forKey: streamId)
    }
}
