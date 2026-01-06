import SwiftUI

struct CategoryRow: View {
    let title: String
    let channels: [Channel]
    let onChannelSelect: (Channel) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Category title
            Text(title)
                .font(.title2)
                .fontWeight(.semibold)
                .foregroundColor(.white)
                .padding(.horizontal, 80)

            // Horizontal scroll of channels
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 40) {
                    ForEach(channels) { channel in
                        ChannelCardFocusable(channel: channel) {
                            onChannelSelect(channel)
                        }
                    }
                }
                .padding(.horizontal, 80)
            }
            .focusSection()
        }
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()

        CategoryRow(
            title: "Sports",
            channels: [],
            onChannelSelect: { _ in }
        )
    }
}
