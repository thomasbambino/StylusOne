import SwiftUI

// MARK: - Date Extensions

extension Date {
    var isToday: Bool {
        Calendar.current.isDateInToday(self)
    }

    var isTomorrow: Bool {
        Calendar.current.isDateInTomorrow(self)
    }

    func formatted(as format: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = format
        return formatter.string(from: self)
    }

    var timeString: String {
        formatted(as: "h:mm a")
    }

    var shortTimeString: String {
        formatted(as: "h:mm")
    }

    var dateTimeString: String {
        formatted(as: "MMM d, h:mm a")
    }
}

// MARK: - View Extensions

extension View {
    func onFocusChange(_ action: @escaping (Bool) -> Void) -> some View {
        self.onChange(of: false) { _, _ in
            // This is a placeholder - actual focus tracking needs FocusState
        }
    }
}

// MARK: - Color Extensions

extension Color {
    static let appBackground = Color.black
    static let appAccent = Color.red
    static let appSecondary = Color.gray

    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - String Extensions

extension String {
    var isValidURL: Bool {
        guard let url = URL(string: self) else { return false }
        return url.scheme != nil && url.host != nil
    }
}

// MARK: - TimeInterval Extensions

extension TimeInterval {
    var formatted: String {
        let hours = Int(self) / 3600
        let minutes = Int(self) / 60 % 60
        let seconds = Int(self) % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%d:%02d", minutes, seconds)
        }
    }

    var durationString: String {
        let hours = Int(self) / 3600
        let minutes = Int(self) / 60 % 60

        if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else {
            return "\(minutes) min"
        }
    }
}
