import SwiftUI

@main
struct StylusOneApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
        }
    }
}

struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if appState.isLoading {
                LoadingView(message: "Loading...")
            } else if appState.isAuthenticated {
                HomeView()
            } else {
                TVCodeLoginView()
            }
        }
        .task {
            await appState.checkAuthStatus()
        }
    }
}
