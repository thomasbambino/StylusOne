import SwiftUI

struct HomeView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = HomeViewModel()
    @State private var selectedChannel: Channel?
    @State private var showPlayer = false
    @State private var showGuide = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if viewModel.isLoading {
                    LoadingView(message: "Loading channels...")
                } else if let error = viewModel.errorMessage {
                    ErrorView(message: error) {
                        Task { await viewModel.loadData() }
                    }
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(alignment: .leading, spacing: 50) {
                            // Header
                            HStack {
                                Text(AppConstants.appName)
                                    .font(.largeTitle)
                                    .fontWeight(.bold)
                                    .foregroundColor(.white)

                                Spacer()

                                // Guide button
                                Button {
                                    showGuide = true
                                } label: {
                                    HStack {
                                        Image(systemName: "list.bullet.rectangle")
                                        Text("Guide")
                                    }
                                }

                                // Logout button
                                Button {
                                    Task { await appState.logout() }
                                } label: {
                                    HStack {
                                        Image(systemName: "rectangle.portrait.and.arrow.right")
                                        Text("Sign Out")
                                    }
                                }
                            }
                            .padding(.horizontal, 80)
                            .padding(.top, 40)

                            // Favorites row (if any)
                            if !viewModel.favorites.isEmpty {
                                CategoryRow(
                                    title: "Favorites",
                                    channels: viewModel.favoriteChannels,
                                    onChannelSelect: { channel in
                                        selectedChannel = channel
                                        showPlayer = true
                                    }
                                )
                            }

                            // Category rows
                            ForEach(viewModel.categories) { category in
                                if let channels = viewModel.channelsByCategory[category.id], !channels.isEmpty {
                                    CategoryRow(
                                        title: category.name,
                                        channels: channels,
                                        onChannelSelect: { channel in
                                            selectedChannel = channel
                                            showPlayer = true
                                        }
                                    )
                                }
                            }
                        }
                        .padding(.bottom, 80)
                    }
                }
            }
            .fullScreenCover(isPresented: $showPlayer) {
                if let channel = selectedChannel {
                    PlayerView(
                        channel: channel,
                        allChannels: viewModel.allChannels,
                        onDismiss: { showPlayer = false }
                    )
                }
            }
            .fullScreenCover(isPresented: $showGuide) {
                GuideView(
                    channels: viewModel.allChannels,
                    onChannelSelect: { channel in
                        showGuide = false
                        selectedChannel = channel
                        showPlayer = true
                    },
                    onDismiss: { showGuide = false }
                )
            }
        }
        .task {
            await viewModel.loadData()
        }
    }
}

@MainActor
class HomeViewModel: ObservableObject {
    @Published var categories: [Category] = []
    @Published var channelsByCategory: [String: [Channel]] = [:]
    @Published var favorites: [FavoriteChannel] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let channelService = ChannelService.shared
    private let favoritesService = FavoritesService.shared

    var allChannels: [Channel] {
        channelsByCategory.values.flatMap { $0 }
    }

    var favoriteChannels: [Channel] {
        let favoriteIds = Set(favorites.map { $0.channelId })
        return allChannels.filter { favoriteIds.contains($0.id) }
    }

    func loadData() async {
        isLoading = true
        errorMessage = nil

        do {
            // Load categories and favorites in parallel
            async let categoriesTask = channelService.getCategories()
            async let favoritesTask = favoritesService.getFavorites()

            categories = try await categoriesTask
            favorites = try await favoritesTask

            // Load channels for each category
            for category in categories {
                let channels = try await channelService.getChannels(category: category.id)
                channelsByCategory[category.id] = channels
            }

            isLoading = false
        } catch {
            isLoading = false
            errorMessage = error.localizedDescription
        }
    }

    func refreshFavorites() async {
        do {
            favorites = try await favoritesService.getFavorites(forceRefresh: true)
        } catch {
            print("Failed to refresh favorites: \(error)")
        }
    }
}

#Preview {
    HomeView()
        .environmentObject(AppState())
}
