import SwiftUI
import AVKit

struct PlayerView: View {
    let channel: Channel
    let allChannels: [Channel]
    let onDismiss: () -> Void

    @StateObject private var viewModel: PlayerViewModel

    init(channel: Channel, allChannels: [Channel], onDismiss: @escaping () -> Void) {
        self.channel = channel
        self.allChannels = allChannels
        self.onDismiss = onDismiss
        _viewModel = StateObject(wrappedValue: PlayerViewModel(channel: channel, allChannels: allChannels))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            // Video player
            if let player = viewModel.player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            }

            // Loading overlay
            if viewModel.isLoading {
                VStack(spacing: 20) {
                    ProgressView()
                        .scaleEffect(2)
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))

                    Text("Loading stream...")
                        .font(.title2)
                        .foregroundColor(.white)
                }
            }

            // Error overlay
            if let error = viewModel.errorMessage {
                VStack(spacing: 20) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 60))
                        .foregroundColor(.red)

                    Text(error)
                        .font(.title2)
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)

                    Button("Retry") {
                        Task { await viewModel.playChannel(viewModel.currentChannel) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }

            // Channel info overlay (shown when paused or on interaction)
            if viewModel.showOverlay {
                PlayerOverlayView(
                    channel: viewModel.currentChannel,
                    currentProgram: viewModel.currentProgram,
                    nextProgram: viewModel.nextProgram,
                    isFavorite: viewModel.isFavorite,
                    onToggleFavorite: {
                        Task { await viewModel.toggleFavorite() }
                    }
                )
                .transition(.opacity)
            }
        }
        .onAppear {
            Task { await viewModel.playChannel(channel) }
        }
        .onDisappear {
            viewModel.stop()
        }
        .onExitCommand {
            viewModel.stop()
            onDismiss()
        }
        .onMoveCommand { direction in
            switch direction {
            case .up:
                Task { await viewModel.previousChannel() }
            case .down:
                Task { await viewModel.nextChannel() }
            default:
                break
            }
        }
        .onPlayPauseCommand {
            viewModel.togglePlayPause()
        }
        .gesture(
            TapGesture()
                .onEnded { _ in
                    viewModel.toggleOverlay()
                }
        )
    }
}

@MainActor
class PlayerViewModel: ObservableObject {
    @Published var player: AVPlayer?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var showOverlay = false
    @Published var currentProgram: EPGProgram?
    @Published var nextProgram: EPGNextProgram?
    @Published var isFavorite = false
    @Published var currentChannel: Channel

    private let allChannels: [Channel]
    private var currentIndex: Int
    private var sessionToken: String?
    private var heartbeatTask: Task<Void, Never>?
    private var overlayHideTask: Task<Void, Never>?

    private let channelService = ChannelService.shared
    private let epgService = EPGService.shared
    private let favoritesService = FavoritesService.shared

    init(channel: Channel, allChannels: [Channel]) {
        self.currentChannel = channel
        self.allChannels = allChannels
        self.currentIndex = allChannels.firstIndex(where: { $0.id == channel.id }) ?? 0
    }

    func playChannel(_ channel: Channel) async {
        isLoading = true
        errorMessage = nil
        currentChannel = channel

        // Stop current stream
        stop()

        do {
            // Generate stream token
            let tokenResponse = try await channelService.generateStreamToken(streamId: channel.effectiveStreamId)
            sessionToken = tokenResponse.sessionToken

            // Get stream URL
            guard let url = channelService.getStreamURL(streamId: channel.effectiveStreamId, token: tokenResponse.token) else {
                throw APIError.invalidURL
            }

            // Create player
            let playerItem = AVPlayerItem(url: url)
            let player = AVPlayer(playerItem: playerItem)
            player.play()

            self.player = player
            isLoading = false

            // Start heartbeat
            startHeartbeat()

            // Load EPG and favorite status
            await loadEPGData()
            await checkFavoriteStatus()

            // Show overlay briefly
            showOverlayTemporarily()

        } catch {
            isLoading = false
            errorMessage = error.localizedDescription
        }
    }

    func stop() {
        player?.pause()
        player = nil
        heartbeatTask?.cancel()
        heartbeatTask = nil
        overlayHideTask?.cancel()
        overlayHideTask = nil

        // Release stream
        if let token = sessionToken {
            Task {
                try? await channelService.releaseStream(sessionToken: token)
            }
            sessionToken = nil
        }
    }

    func togglePlayPause() {
        guard let player = player else { return }

        if player.timeControlStatus == .playing {
            player.pause()
            showOverlay = true
        } else {
            player.play()
            showOverlayTemporarily()
        }
    }

    func toggleOverlay() {
        showOverlay.toggle()

        if showOverlay {
            showOverlayTemporarily()
        }
    }

    func nextChannel() async {
        let newIndex = (currentIndex + 1) % allChannels.count
        currentIndex = newIndex
        await playChannel(allChannels[newIndex])
    }

    func previousChannel() async {
        let newIndex = currentIndex > 0 ? currentIndex - 1 : allChannels.count - 1
        currentIndex = newIndex
        await playChannel(allChannels[newIndex])
    }

    func toggleFavorite() async {
        do {
            isFavorite = try await favoritesService.toggleFavorite(channel: currentChannel)
        } catch {
            print("Failed to toggle favorite: \(error)")
        }
    }

    // MARK: - Private Methods

    private func startHeartbeat() {
        heartbeatTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(APIConfig.heartbeatInterval * 1_000_000_000))

                if let token = sessionToken {
                    try? await channelService.sendHeartbeat(
                        sessionToken: token,
                        streamId: currentChannel.effectiveStreamId
                    )
                }
            }
        }
    }

    private func loadEPGData() async {
        do {
            let epg = try await epgService.getShortEPG(streamId: currentChannel.effectiveStreamId)
            currentProgram = epg.now
            nextProgram = epg.next
        } catch {
            print("Failed to load EPG: \(error)")
        }
    }

    private func checkFavoriteStatus() async {
        do {
            isFavorite = try await favoritesService.isFavorite(channelId: currentChannel.id)
        } catch {
            print("Failed to check favorite status: \(error)")
        }
    }

    private func showOverlayTemporarily() {
        showOverlay = true

        overlayHideTask?.cancel()
        overlayHideTask = Task {
            try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
            if !Task.isCancelled {
                showOverlay = false
            }
        }
    }
}
