import SwiftUI

struct ChannelCard: View {
    let channel: Channel
    let isFocused: Bool
    let onSelect: () -> Void

    @State private var imageLoaded = false

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 15) {
                // Channel logo
                ZStack {
                    RoundedRectangle(cornerRadius: 15)
                        .fill(Color.white.opacity(0.1))

                    if let logoURL = channel.logo, let url = URL(string: logoURL) {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .empty:
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .gray))
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .padding(20)
                            case .failure:
                                Image(systemName: "tv")
                                    .font(.system(size: 40))
                                    .foregroundColor(.gray)
                            @unknown default:
                                EmptyView()
                            }
                        }
                    } else {
                        Image(systemName: "tv")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)
                    }
                }
                .frame(width: 200, height: 150)
                .overlay(
                    RoundedRectangle(cornerRadius: 15)
                        .stroke(isFocused ? Color.white : Color.clear, lineWidth: 4)
                )
                .shadow(color: isFocused ? .white.opacity(0.3) : .clear, radius: 20)

                // Channel name
                Text(channel.name)
                    .font(.headline)
                    .foregroundColor(isFocused ? .white : .gray)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 200)

                // Channel number
                if let number = channel.number {
                    Text("Ch. \(number)")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
        }
        .buttonStyle(PlainButtonStyle())
        .scaleEffect(isFocused ? 1.1 : 1.0)
        .animation(.spring(response: 0.3), value: isFocused)
    }
}

struct ChannelCardFocusable: View {
    let channel: Channel
    let onSelect: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        ChannelCard(channel: channel, isFocused: isFocused, onSelect: onSelect)
            .focusable()
            .focused($isFocused)
    }
}

#Preview {
    HStack(spacing: 40) {
        ChannelCard(
            channel: try! JSONDecoder().decode(
                Channel.self,
                from: """
                {"stream_id": "1", "name": "ESPN", "num": 206, "stream_icon": "https://example.com/espn.png", "category_name": "Sports"}
                """.data(using: .utf8)!
            ),
            isFocused: false,
            onSelect: {}
        )

        ChannelCard(
            channel: try! JSONDecoder().decode(
                Channel.self,
                from: """
                {"stream_id": "2", "name": "CNN", "num": 202, "category_name": "News"}
                """.data(using: .utf8)!
            ),
            isFocused: true,
            onSelect: {}
        )
    }
    .padding(100)
    .background(Color.black)
}
