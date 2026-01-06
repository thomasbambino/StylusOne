import SwiftUI

struct PlayerOverlayView: View {
    let channel: Channel
    let currentProgram: EPGProgram?
    let nextProgram: EPGNextProgram?
    let isFavorite: Bool
    let onToggleFavorite: () -> Void

    var body: some View {
        VStack {
            Spacer()

            // Bottom info bar
            HStack(alignment: .bottom, spacing: 30) {
                // Channel info
                VStack(alignment: .leading, spacing: 15) {
                    // Channel logo and name
                    HStack(spacing: 20) {
                        // Logo
                        if let logoURL = channel.logo, let url = URL(string: logoURL) {
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let image):
                                    image
                                        .resizable()
                                        .aspectRatio(contentMode: .fit)
                                        .frame(width: 80, height: 60)
                                default:
                                    Image(systemName: "tv")
                                        .font(.system(size: 40))
                                        .foregroundColor(.white)
                                        .frame(width: 80, height: 60)
                                }
                            }
                        } else {
                            Image(systemName: "tv")
                                .font(.system(size: 40))
                                .foregroundColor(.white)
                                .frame(width: 80, height: 60)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            // Channel number and name
                            HStack(spacing: 10) {
                                if let number = channel.number {
                                    Text(number)
                                        .font(.title2)
                                        .fontWeight(.bold)
                                        .foregroundColor(.white)
                                }

                                Text(channel.name)
                                    .font(.title2)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.white)
                            }

                            // Category
                            if let category = channel.categoryName {
                                Text(category)
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                        }
                    }

                    // Current program
                    if let program = currentProgram {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Now Playing")
                                .font(.caption)
                                .foregroundColor(.gray)

                            Text(program.title)
                                .font(.title3)
                                .fontWeight(.medium)
                                .foregroundColor(.white)

                            // Progress bar
                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    Rectangle()
                                        .fill(Color.white.opacity(0.3))
                                        .frame(height: 6)
                                        .cornerRadius(3)

                                    Rectangle()
                                        .fill(Color.red)
                                        .frame(width: geometry.size.width * program.progress, height: 6)
                                        .cornerRadius(3)
                                }
                            }
                            .frame(height: 6)
                            .frame(width: 400)

                            // Time
                            HStack {
                                Text(formatTime(program.startDate))
                                Spacer()
                                Text(formatTime(program.endDate))
                            }
                            .font(.caption)
                            .foregroundColor(.gray)
                            .frame(width: 400)
                        }
                    }

                    // Next program
                    if let next = nextProgram {
                        HStack(spacing: 10) {
                            Text("Up Next:")
                                .font(.caption)
                                .foregroundColor(.gray)

                            Text(next.title)
                                .font(.caption)
                                .foregroundColor(.white)

                            Text("at \(formatTime(next.startDate))")
                                .font(.caption)
                                .foregroundColor(.gray)
                        }
                    }
                }

                Spacer()

                // Controls
                VStack(alignment: .trailing, spacing: 20) {
                    // Favorite button
                    Button(action: onToggleFavorite) {
                        HStack(spacing: 10) {
                            Image(systemName: isFavorite ? "heart.fill" : "heart")
                                .foregroundColor(isFavorite ? .red : .white)
                            Text(isFavorite ? "Favorited" : "Add to Favorites")
                        }
                    }

                    // Channel switching hint
                    HStack(spacing: 15) {
                        VStack(spacing: 5) {
                            Image(systemName: "chevron.up")
                            Text("Prev")
                                .font(.caption2)
                        }

                        VStack(spacing: 5) {
                            Image(systemName: "chevron.down")
                            Text("Next")
                                .font(.caption2)
                        }
                    }
                    .foregroundColor(.gray)
                }
            }
            .padding(40)
            .background(
                LinearGradient(
                    gradient: Gradient(colors: [.clear, .black.opacity(0.8)]),
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()

        PlayerOverlayView(
            channel: try! JSONDecoder().decode(
                Channel.self,
                from: """
                {"stream_id": "1", "name": "ESPN", "num": 206, "stream_icon": null, "category_name": "Sports"}
                """.data(using: .utf8)!
            ),
            currentProgram: nil,
            nextProgram: nil,
            isFavorite: false,
            onToggleFavorite: {}
        )
    }
}
