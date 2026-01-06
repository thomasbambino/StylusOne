import SwiftUI

struct GuideView: View {
    let channels: [Channel]
    let onChannelSelect: (Channel) -> Void
    let onDismiss: () -> Void

    @StateObject private var viewModel = GuideViewModel()
    @State private var selectedChannel: Channel?
    @State private var scrollOffset: CGFloat = 0

    private let channelColumnWidth: CGFloat = 250
    private let timeSlotWidth: CGFloat = 200
    private let rowHeight: CGFloat = 100
    private let headerHeight: CGFloat = 60

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("TV Guide")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(.white)

                    Spacer()

                    Button("Close") {
                        onDismiss()
                    }
                }
                .padding(.horizontal, 40)
                .padding(.vertical, 20)

                // Time header
                HStack(spacing: 0) {
                    // Channel column header
                    Text("Channel")
                        .font(.headline)
                        .foregroundColor(.gray)
                        .frame(width: channelColumnWidth, height: headerHeight)
                        .background(Color.black)

                    // Time slots header
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 0) {
                            ForEach(viewModel.timeSlots, id: \.self) { time in
                                Text(formatTime(time))
                                    .font(.headline)
                                    .foregroundColor(.gray)
                                    .frame(width: timeSlotWidth, height: headerHeight)
                            }
                        }
                    }
                    .disabled(true) // Sync with main scroll
                }
                .background(Color.black)

                // Current time indicator
                CurrentTimeIndicator(
                    channelColumnWidth: channelColumnWidth,
                    timeSlotWidth: timeSlotWidth,
                    startTime: viewModel.timeSlots.first ?? Date()
                )

                // Main grid
                ScrollView([.horizontal, .vertical], showsIndicators: false) {
                    HStack(spacing: 0) {
                        // Channel column
                        VStack(spacing: 0) {
                            ForEach(channels) { channel in
                                ChannelRowHeader(channel: channel)
                                    .frame(width: channelColumnWidth, height: rowHeight)
                            }
                        }

                        // Programs grid
                        LazyVStack(spacing: 0) {
                            ForEach(channels) { channel in
                                ProgramRow(
                                    channel: channel,
                                    programs: viewModel.programsByChannel[channel.id] ?? [],
                                    timeSlots: viewModel.timeSlots,
                                    timeSlotWidth: timeSlotWidth,
                                    rowHeight: rowHeight,
                                    onProgramSelect: { _ in
                                        onChannelSelect(channel)
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Loading overlay
            if viewModel.isLoading {
                Color.black.opacity(0.7)
                    .ignoresSafeArea()

                ProgressView()
                    .scaleEffect(2)
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
            }
        }
        .onExitCommand {
            onDismiss()
        }
        .task {
            await viewModel.loadEPGData(for: channels)
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}

struct ChannelRowHeader: View {
    let channel: Channel

    var body: some View {
        HStack(spacing: 15) {
            // Logo
            if let logoURL = channel.logo, let url = URL(string: logoURL) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 50, height: 40)
                    default:
                        Image(systemName: "tv")
                            .font(.system(size: 25))
                            .foregroundColor(.gray)
                            .frame(width: 50, height: 40)
                    }
                }
            } else {
                Image(systemName: "tv")
                    .font(.system(size: 25))
                    .foregroundColor(.gray)
                    .frame(width: 50, height: 40)
            }

            VStack(alignment: .leading, spacing: 4) {
                if let number = channel.number {
                    Text(number)
                        .font(.caption)
                        .foregroundColor(.gray)
                }

                Text(channel.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.white)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 15)
        .background(Color.black)
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.1))
                .frame(height: 1),
            alignment: .bottom
        )
    }
}

struct ProgramRow: View {
    let channel: Channel
    let programs: [EPGProgram]
    let timeSlots: [Date]
    let timeSlotWidth: CGFloat
    let rowHeight: CGFloat
    let onProgramSelect: (EPGProgram) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(programs) { program in
                ProgramCell(
                    program: program,
                    width: calculateWidth(for: program),
                    height: rowHeight,
                    onSelect: { onProgramSelect(program) }
                )
            }

            // Fill remaining space if needed
            Spacer(minLength: 0)
        }
        .frame(height: rowHeight)
        .overlay(
            Rectangle()
                .fill(Color.white.opacity(0.1))
                .frame(height: 1),
            alignment: .bottom
        )
    }

    private func calculateWidth(for program: EPGProgram) -> CGFloat {
        let duration = program.duration
        let minutesPerSlot: TimeInterval = 30 * 60 // 30 minutes
        let slots = duration / minutesPerSlot
        return CGFloat(slots) * timeSlotWidth
    }
}

struct CurrentTimeIndicator: View {
    let channelColumnWidth: CGFloat
    let timeSlotWidth: CGFloat
    let startTime: Date

    var body: some View {
        GeometryReader { geometry in
            let now = Date()
            let elapsedMinutes = now.timeIntervalSince(startTime) / 60
            let offset = channelColumnWidth + (CGFloat(elapsedMinutes) / 30) * timeSlotWidth

            if offset > channelColumnWidth && offset < geometry.size.width {
                Rectangle()
                    .fill(Color.red)
                    .frame(width: 2)
                    .offset(x: offset)
            }
        }
        .frame(height: 2)
    }
}

@MainActor
class GuideViewModel: ObservableObject {
    @Published var programsByChannel: [String: [EPGProgram]] = [:]
    @Published var timeSlots: [Date] = []
    @Published var isLoading = false

    private let epgService = EPGService.shared

    func loadEPGData(for channels: [Channel]) async {
        isLoading = true

        // Generate time slots (current time rounded down to 30 min, plus 4 hours)
        generateTimeSlots()

        // Load EPG for each channel
        await withTaskGroup(of: (String, [EPGProgram]).self) { group in
            for channel in channels.prefix(50) { // Limit to first 50 channels
                group.addTask {
                    do {
                        let programs = try await self.epgService.getFullEPG(streamId: channel.effectiveStreamId, limit: 20)
                        return (channel.id, programs)
                    } catch {
                        print("Failed to load EPG for \(channel.name): \(error)")
                        return (channel.id, [])
                    }
                }
            }

            for await (channelId, programs) in group {
                programsByChannel[channelId] = programs
            }
        }

        isLoading = false
    }

    private func generateTimeSlots() {
        let calendar = Calendar.current
        let now = Date()

        // Round down to nearest 30 minutes
        let minute = calendar.component(.minute, from: now)
        let roundedMinute = (minute / 30) * 30
        var components = calendar.dateComponents([.year, .month, .day, .hour], from: now)
        components.minute = roundedMinute

        guard let startTime = calendar.date(from: components) else { return }

        // Generate slots for 4 hours
        timeSlots = (0..<8).compactMap { index in
            calendar.date(byAdding: .minute, value: index * 30, to: startTime)
        }
    }
}
