import SwiftUI

struct ProgramCell: View {
    let program: EPGProgram
    let width: CGFloat
    let height: CGFloat
    let onSelect: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 4) {
                Text(program.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(isFocused ? .black : .white)
                    .lineLimit(2)

                Spacer()

                // Time range
                Text("\(formatTime(program.startDate)) - \(formatTime(program.endDate))")
                    .font(.caption2)
                    .foregroundColor(isFocused ? .black.opacity(0.7) : .gray)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(width: max(width - 4, 50), height: height - 4)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(backgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isFocused ? Color.white : Color.white.opacity(0.2), lineWidth: isFocused ? 4 : 1)
            )
        }
        .buttonStyle(PlainButtonStyle())
        .focusable()
        .focused($isFocused)
        .padding(2)
    }

    private var backgroundColor: Color {
        if isFocused {
            return .white
        } else if program.isCurrentlyAiring {
            return Color.blue.opacity(0.3)
        } else {
            return Color.white.opacity(0.1)
        }
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm"
        return formatter.string(from: date)
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()

        HStack(spacing: 10) {
            ProgramCell(
                program: EPGProgram(
                    id: "1",
                    title: "SportsCenter",
                    start: Date().timeIntervalSince1970,
                    end: Date().timeIntervalSince1970 + 3600
                ),
                width: 200,
                height: 100,
                onSelect: {}
            )
        }
        .padding()
    }
}
