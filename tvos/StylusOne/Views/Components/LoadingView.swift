import SwiftUI

struct LoadingView: View {
    let message: String

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 30) {
                ProgressView()
                    .scaleEffect(2)
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))

                Text(message)
                    .font(.title2)
                    .foregroundColor(.gray)
            }
        }
    }
}

#Preview {
    LoadingView(message: "Loading...")
}
