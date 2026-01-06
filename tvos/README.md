# Stylus One tvOS App

Native tvOS app for the Stylus One streaming platform.

## Features

- **TV Code Authentication**: Netflix-style pairing via code displayed on screen
- **Channel Browsing**: Browse channels by category with focus-based navigation
- **HLS Video Playback**: Native AVPlayer with stream token management
- **EPG (Program Guide)**: Full grid-based program guide
- **Favorites**: Save favorite channels for quick access
- **Siri Remote Support**: Full navigation with swipe and click gestures

## Requirements

- Xcode 15.0+
- tvOS 17.0+ SDK
- Apple TV (4th generation or later) or tvOS Simulator

## Setup in Xcode

### Option 1: Create New Project (Recommended)

1. Open Xcode
2. File → New → Project
3. Select **tvOS** → **App**
4. Configure:
   - Product Name: `StylusOne`
   - Team: Your development team
   - Organization Identifier: `com.stylus.one`
   - Interface: **SwiftUI**
   - Language: **Swift**
5. Choose the `tvos` folder as the location
6. Delete the auto-generated files (ContentView.swift, StylusOneApp.swift, Assets.xcassets)
7. Drag all files from `StylusOne/` folder into the Xcode project
8. Build and run on tvOS Simulator or device

### Option 2: Add Files to Existing Project

1. Open your Xcode project
2. Right-click on the project navigator
3. Select "Add Files to [Project]..."
4. Navigate to `tvos/StylusOne/` and select all Swift files
5. Ensure "Copy items if needed" is checked
6. Click Add

## Project Structure

```
StylusOne/
├── App/
│   ├── StylusOneApp.swift      # App entry point
│   └── AppState.swift          # Global app state management
├── Models/
│   ├── User.swift
│   ├── Channel.swift
│   ├── Category.swift
│   ├── EPGProgram.swift
│   ├── FavoriteChannel.swift
│   └── Subscription.swift
├── Services/
│   ├── APIClient.swift         # HTTP client with async/await
│   ├── AuthService.swift       # Authentication logic
│   ├── ChannelService.swift    # Channel/streaming operations
│   ├── EPGService.swift        # Program guide data
│   ├── FavoritesService.swift  # Favorites management
│   └── KeychainService.swift   # Secure credential storage
├── Views/
│   ├── Auth/
│   │   └── TVCodeLoginView.swift
│   ├── Home/
│   │   ├── HomeView.swift
│   │   └── CategoryRow.swift
│   ├── Player/
│   │   ├── PlayerView.swift
│   │   └── PlayerOverlayView.swift
│   ├── Guide/
│   │   ├── GuideView.swift
│   │   └── ProgramCell.swift
│   └── Components/
│       ├── ChannelCard.swift
│       ├── LoadingView.swift
│       └── ErrorView.swift
└── Utilities/
    ├── Constants.swift
    └── Extensions.swift
```

## Navigation Controls

### Home Screen
- **Swipe Left/Right**: Navigate between channels in a row
- **Swipe Up/Down**: Navigate between category rows
- **Click**: Select channel to start playback
- **Menu**: Access settings

### Video Player
- **Click**: Toggle play/pause and show/hide overlay
- **Swipe Up**: Previous channel
- **Swipe Down**: Next channel
- **Menu**: Exit player and return to home
- **Play/Pause Button**: Toggle playback

### Program Guide
- **Swipe**: Navigate the grid
- **Click**: Tune to selected channel
- **Menu**: Close guide

## API Endpoints Used

The app communicates with the Stylus One backend at `https://stylus.services`:

- `POST /api/tv-codes/generate` - Generate pairing code
- `GET /api/tv-codes/status/:code` - Poll for code verification
- `POST /api/tv-codes/login` - Complete authentication
- `GET /api/iptv/channels` - Fetch channel list
- `GET /api/iptv/categories` - Fetch categories
- `GET /api/iptv/epg/:streamId` - Fetch program guide
- `POST /api/iptv/generate-token` - Get stream access token
- `POST /api/iptv/stream/heartbeat` - Keep stream alive
- `POST /api/iptv/stream/release` - Release stream slot
- `GET /api/favorite-channels` - Fetch favorites
- `POST /api/favorite-channels` - Add favorite
- `DELETE /api/favorite-channels/:id` - Remove favorite

## Configuration

Edit `Utilities/Constants.swift` to change:

```swift
enum APIConfig {
    static let baseURL = "https://stylus.services"  // Your server URL
    static let streamTokenDuration: TimeInterval = 3600
    static let heartbeatInterval: TimeInterval = 30
    static let tvCodePollInterval: TimeInterval = 3
}
```

## Testing

### On Simulator
1. Select "Apple TV" simulator in Xcode
2. Press Cmd+R to build and run
3. Use arrow keys or trackpad for navigation

### On Device
1. Connect Apple TV to same network as Mac
2. Enable Developer Mode on Apple TV (Settings → Privacy & Security)
3. Pair Apple TV with Xcode (Window → Devices and Simulators)
4. Select your Apple TV in the device dropdown
5. Build and run

## Troubleshooting

### "No such module" errors
Ensure all Swift files are added to the target. Check File Inspector → Target Membership.

### Stream not playing
1. Check network connectivity
2. Verify API URL in Constants.swift
3. Check Xcode console for error messages
4. Ensure session cookie is being stored correctly

### TV Code not working
1. Verify the code is entered correctly on stylus.services/tvcode
2. Check that the code hasn't expired (15 minute timeout)
3. Ensure the polling is working (check Xcode console)

## License

Proprietary - Stylus Services
