import SwiftUI

struct TVCodeLoginView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = TVCodeLoginViewModel()

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                gradient: Gradient(colors: [Color.black, Color(white: 0.1)]),
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 60) {
                // Logo and title
                VStack(spacing: 20) {
                    Image(systemName: "tv")
                        .font(.system(size: 80))
                        .foregroundColor(.red)

                    Text(AppConstants.appName)
                        .font(.system(size: 60, weight: .bold))
                        .foregroundColor(.white)
                }

                // Main content
                if viewModel.isLoading {
                    VStack(spacing: 20) {
                        ProgressView()
                            .scaleEffect(2)
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))

                        Text("Generating code...")
                            .font(.title2)
                            .foregroundColor(.gray)
                    }
                } else if let code = viewModel.tvCode {
                    // Show the code
                    VStack(spacing: 40) {
                        Text("Enter this code at")
                            .font(.title2)
                            .foregroundColor(.gray)

                        Text("stylus.services/tvcode")
                            .font(.title)
                            .foregroundColor(.white)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 15)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(10)

                        // Code display
                        HStack(spacing: 20) {
                            ForEach(Array(code.enumerated()), id: \.offset) { _, char in
                                Text(String(char))
                                    .font(.system(size: 80, weight: .bold, design: .monospaced))
                                    .foregroundColor(.white)
                                    .frame(width: 90, height: 120)
                                    .background(
                                        RoundedRectangle(cornerRadius: 15)
                                            .fill(Color.white.opacity(0.15))
                                            .overlay(
                                                RoundedRectangle(cornerRadius: 15)
                                                    .stroke(Color.white.opacity(0.3), lineWidth: 2)
                                            )
                                    )
                            }
                        }

                        // Expiry info
                        if let expiresIn = viewModel.expiresInSeconds {
                            Text("Code expires in \(formatTime(expiresIn))")
                                .font(.title3)
                                .foregroundColor(.gray)
                        }

                        // Status indicator
                        HStack(spacing: 10) {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .gray))

                            Text("Waiting for verification...")
                                .font(.title3)
                                .foregroundColor(.gray)
                        }
                        .padding(.top, 20)
                    }
                } else if let error = viewModel.errorMessage {
                    // Error state
                    VStack(spacing: 30) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 60))
                            .foregroundColor(.red)

                        Text(error)
                            .font(.title2)
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)

                        Button("Try Again") {
                            Task {
                                await viewModel.generateCode()
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                }
            }
            .padding(80)
        }
        .task {
            await viewModel.generateCode()
        }
        .onChange(of: viewModel.authToken) { oldValue, newValue in
            if let token = newValue {
                Task {
                    do {
                        try await appState.login(with: token)
                    } catch {
                        viewModel.errorMessage = error.localizedDescription
                    }
                }
            }
        }
    }

    private func formatTime(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}

@MainActor
class TVCodeLoginViewModel: ObservableObject {
    @Published var tvCode: String?
    @Published var expiresInSeconds: Int?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var authToken: String?

    private var pollingTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?

    private let authService = AuthService.shared

    func generateCode() async {
        isLoading = true
        errorMessage = nil
        tvCode = nil
        authToken = nil

        stopPolling()

        do {
            let response = try await authService.generateTVCode()
            tvCode = response.code
            expiresInSeconds = response.expiresInSeconds
            isLoading = false

            startPolling(code: response.code)
            startCountdown()
        } catch {
            isLoading = false
            errorMessage = error.localizedDescription
        }
    }

    private func startPolling(code: String) {
        pollingTask = Task {
            while !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: UInt64(APIConfig.tvCodePollInterval * 1_000_000_000))

                    let status = try await authService.checkTVCodeStatus(code: code)

                    if status.verified, let token = status.authToken {
                        self.authToken = token
                        stopPolling()
                        return
                    }
                } catch {
                    // Continue polling on error
                    print("Polling error: \(error)")
                }
            }
        }
    }

    private func startCountdown() {
        countdownTask = Task {
            while !Task.isCancelled, let remaining = expiresInSeconds, remaining > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
                if !Task.isCancelled {
                    expiresInSeconds = (expiresInSeconds ?? 1) - 1

                    if expiresInSeconds == 0 {
                        stopPolling()
                        errorMessage = "Code expired. Please try again."
                        tvCode = nil
                    }
                }
            }
        }
    }

    private func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
        countdownTask?.cancel()
        countdownTask = nil
    }

    deinit {
        pollingTask?.cancel()
        countdownTask?.cancel()
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.title2)
            .foregroundColor(.white)
            .padding(.horizontal, 40)
            .padding(.vertical, 15)
            .background(Color.red)
            .cornerRadius(10)
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
    }
}

#Preview {
    TVCodeLoginView()
        .environmentObject(AppState())
}
