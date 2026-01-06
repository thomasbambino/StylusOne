import Foundation

actor FavoritesService {
    static let shared = FavoritesService()

    private let apiClient = APIClient.shared

    // Cache for favorites
    private var favoritesCache: [FavoriteChannel]?
    private var lastFetch: Date?
    private let cacheTimeout: TimeInterval = 30 // 30 seconds

    private init() {}

    // MARK: - Favorites

    func getFavorites(forceRefresh: Bool = false) async throws -> [FavoriteChannel] {
        // Check cache
        if !forceRefresh,
           let cached = favoritesCache,
           let lastFetch = lastFetch,
           Date().timeIntervalSince(lastFetch) < cacheTimeout {
            return cached
        }

        // Fetch fresh data
        let favorites: [FavoriteChannel] = try await apiClient.get(APIEndpoints.favorites)

        // Update cache
        favoritesCache = favorites
        lastFetch = Date()

        return favorites
    }

    func addFavorite(channel: Channel) async throws -> FavoriteChannel {
        let request = AddFavoriteRequest(
            channelId: channel.id,
            channelName: channel.name,
            channelLogo: channel.logo
        )

        let favorite: FavoriteChannel = try await apiClient.post(APIEndpoints.favorites, body: request)

        // Invalidate cache
        favoritesCache = nil

        return favorite
    }

    func removeFavorite(channelId: String) async throws {
        try await apiClient.delete(APIEndpoints.deleteFavorite(channelId))

        // Invalidate cache
        favoritesCache = nil
    }

    func isFavorite(channelId: String) async throws -> Bool {
        let favorites = try await getFavorites()
        return favorites.contains { $0.channelId == channelId }
    }

    func toggleFavorite(channel: Channel) async throws -> Bool {
        if try await isFavorite(channelId: channel.id) {
            try await removeFavorite(channelId: channel.id)
            return false
        } else {
            _ = try await addFavorite(channel: channel)
            return true
        }
    }

    // MARK: - Cache Management

    func clearCache() {
        favoritesCache = nil
        lastFetch = nil
    }
}
