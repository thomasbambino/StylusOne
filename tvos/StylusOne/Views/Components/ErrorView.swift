import SwiftUI

struct ErrorView: View {
    let message: String
    let retryAction: (() -> Void)?

    init(message: String, retryAction: (() -> Void)? = nil) {
        self.message = message
        self.retryAction = retryAction
    }

    var body: some View {
        VStack(spacing: 30) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 60))
                .foregroundColor(.red)

            Text(message)
                .font(.title2)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)

            if let retry = retryAction {
                Button("Try Again") {
                    retry()
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(40)
    }
}

#Preview {
    ZStack {
        Color.black.ignoresSafeArea()
        ErrorView(message: "Something went wrong", retryAction: {})
    }
}
