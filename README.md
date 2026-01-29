# Homelab Dashboard

A self-hosted dashboard for managing homelab services including media servers, live TV, game servers, subscriptions, and more. Built with React, Express, PostgreSQL, and Capacitor for mobile.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Server-Side](#server-side)
- [Client-Side](#client-side)
- [Live TV & Media](#live-tv--media)
- [Game Servers](#game-servers)
- [Subscriptions & Payments](#subscriptions--payments)
- [Mobile App](#mobile-app)
- [iOS App](#ios-app)
- [Android App](#android-app)
- [Google Sign-In](#google-sign-in)
- [Infrastructure](#infrastructure)
- [Shared Code](#shared-code)
- [Logging System](#logging-system)
- [Environment Variables](#environment-variables)

---

## Quick Start

```bash
# Development
npm install
npm run dev

# Docker deployment
./homelab-control.sh deploy

# Type checking
npm run check
```

See `CLAUDE.md` for detailed deployment commands and troubleshooting.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (React)                           │
│  Wouter Router │ TanStack Query │ shadcn/ui │ Tailwind CSS     │
└─────────────────────────────────────────────────────────────────┘
                              │
                    REST API + WebSocket
                              │
┌─────────────────────────────────────────────────────────────────┐
│                      Server (Express)                           │
│  Passport Auth │ Rate Limiting │ Feature Gates │ Validation    │
├─────────────────────────────────────────────────────────────────┤
│                        Services Layer                           │
│  EPG │ IPTV │ Streaming │ AMP │ Tautulli │ Stripe │ Email     │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    PostgreSQL + Drizzle ORM                     │
│  Users │ Services │ IPTV │ Subscriptions │ Game Servers        │
└─────────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Frontend**: React 18, Wouter, TanStack Query, shadcn/ui, Tailwind CSS, Framer Motion
- **Backend**: Express.js, Passport.js, Drizzle ORM
- **Database**: PostgreSQL 16
- **Mobile**: Capacitor 7 (iOS/Android)
- **Build**: Vite, esbuild, TypeScript
- **Deployment**: Docker Compose

---

## Server-Side

### Directory Structure

```
server/
├── index.ts                 # Express app setup + startup
├── routes.ts                # Main API routes (121+ endpoints)
├── db.ts                    # Drizzle ORM connection
├── auth.ts                  # Passport.js authentication
├── static.ts                # Static files + HLS streaming
├── storage.ts               # File upload management
├── middleware/
│   ├── security.ts          # CORS, Helmet, CSP
│   ├── rateLimiter.ts       # Rate limiting
│   ├── validation.ts        # Input validation (express-validator)
│   └── feature-gate.ts      # Subscription feature access
├── routes/
│   ├── admin-iptv.ts        # IPTV provider management
│   ├── admin-subscriptions.ts
│   ├── books.ts             # EPUB management
│   ├── stripe-webhooks.ts   # Payment webhooks
│   └── ...
├── services/                # 27 service implementations
│   ├── epg-service.ts       # Electronic Program Guide
│   ├── xtream-codes-service.ts  # IPTV provider
│   ├── streaming-service.ts # HLS/FFmpeg
│   ├── amp-service.ts       # Game server management
│   └── ...
├── lib/
│   ├── logger.ts            # Server logging
│   ├── startup.ts           # Service initialization
│   └── startup-display.ts   # Boot status display
└── utils/
    ├── encryption.ts        # AES-256-GCM for credentials
    └── path-security.ts     # Upload path validation
```

### Authentication

**Framework**: Passport.js with Express Session

**Strategies:**
1. **Local** - Username/password with scrypt hashing
2. **Google OAuth 2.0** - Via Firebase
3. **TV Code** - Netflix-style code login for TV devices

**Session Storage**: PostgreSQL via `connect-pg-simple`

**Rate Limiting:**
- Login: 5 attempts per 15 minutes (per IP)
- API: 500 requests per 15 minutes
- Admin: 5 actions per minute
- Game Servers: 30 requests per minute

### API Routes

**Total**: 121+ endpoints organized by resource

| Category | Example Endpoints |
|----------|-------------------|
| **Auth** | `POST /api/login`, `POST /api/register`, `GET /api/auth/google/callback` |
| **Users** | `GET /api/users`, `PUT /api/users/:id`, `GET /api/login-attempts` |
| **Services** | `GET /api/services`, `POST /api/services`, `DELETE /api/services/:id` |
| **Game Servers** | `GET /api/game-servers`, `POST /api/game-servers/:id/start` |
| **IPTV** | `GET /api/iptv/channels`, `GET /api/iptv/stream/:id.m3u8` |
| **EPG** | `GET /api/epg/current/:channelId`, `POST /api/epg/update` |
| **Subscriptions** | `GET /api/subscriptions`, `POST /api/subscriptions` |
| **Plex** | `GET /api/tautulli/activity`, `GET /api/tautulli/libraries` |

### Database Schema

**ORM**: Drizzle with PostgreSQL

**Core Tables** (30+):

```
users              # Authentication, roles, preferences
userSessions       # Session storage (connect-pg-simple)
services           # Service monitoring
gameServers        # AMP game server tracking
iptvProviders      # IPTV provider configs
iptvCredentials    # Encrypted IPTV credentials
iptvChannels       # Channel inventory
subscriptionPlans  # Stripe plans with features
userSubscriptions  # User plan assignments
invoices           # Payment history
books              # EPUB library
favoriteChannels   # User channel preferences
loginAttempts      # Security audit log with geolocation
```

### Middleware

**Security** (`middleware/security.ts`):
- Helmet with custom CSP for Cast SDK
- CORS with origin validation
- Session cookies: httpOnly, sameSite: lax

**Validation** (`middleware/validation.ts`):
- Input sanitization with express-validator
- Dangerous command blocking for console access
- HTML tag stripping for XSS prevention

**Feature Gates** (`middleware/feature-gate.ts`):
```typescript
// Require subscription feature
router.get('/api/books', requireFeature('books_access'), ...)

// Features: plex_access, live_tv_access, books_access, game_servers_access
```

---

## Client-Side

### Directory Structure

```
client/src/
├── App.tsx                  # Root router
├── main.tsx                 # Entry with Capacitor init
├── pages/                   # 27 page components
│   ├── home-page.tsx        # Dashboard
│   ├── live-tv-page.tsx     # EPG browser
│   ├── live-tv-native.tsx   # TV-optimized interface
│   ├── plex-page.tsx        # Plex activity
│   └── ...
├── components/              # 44+ components
│   ├── ui/                  # shadcn/ui primitives (47 files)
│   ├── service-card.tsx
│   ├── game-server-card.tsx
│   └── ...
├── hooks/
│   ├── use-auth.tsx         # Auth context + mutations
│   ├── use-settings.ts      # Global settings
│   └── use-mobile.tsx       # Mobile detection
├── lib/
│   ├── queryClient.ts       # TanStack Query setup
│   ├── capacitor.ts         # Native platform detection
│   ├── logger.ts            # Browser logging
│   └── stream-decision.ts   # Playback mode selection
└── contexts/
    └── ReminderContext.tsx  # TV program reminders
```

### Routing

**Framework**: Wouter (lightweight alternative to React Router)

**Protected Routes:**
```typescript
// Standard protection (auth required)
<ProtectedRoute path="/dashboard" component={Dashboard} />

// Feature-gated (subscription required)
<FeatureProtectedRoute path="/books" feature="books_access" component={BooksPage} />
```

**Key Routes:**
| Path | Component | Protection |
|------|-----------|------------|
| `/` | HomePage | Auth |
| `/live-tv` | LiveTVAdaptive | Auth + Feature |
| `/plex` | PlexPage | Auth + Feature |
| `/books` | BooksPage | Auth + Feature |
| `/game-servers` | GameServersPage | Auth + Feature |
| `/auth` | AuthPage | Public |
| `/tvcode` | TvCodePage | Public (TV devices) |

### State Management

**Server State**: TanStack React Query
```typescript
// Custom query client with native caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: Infinity, retry: false }
  }
});

// Cacheable endpoints for offline support (mobile)
'/api/settings'        → 1 hour
'/api/user'            → 1 hour
'/api/iptv/channels'   → 24 hours
'/api/favorite-channels' → 24 hours
```

**Client State**: React Context
- `AuthContext` - User session, login/logout mutations
- `ReminderContext` - TV program reminders (mobile)
- `ThemeProvider` - Dark/light/system themes

### UI Components

**Library**: shadcn/ui (Radix UI + Tailwind)

**47 Primitives**: button, dialog, card, dropdown-menu, tabs, accordion, form inputs, chart, etc.

**Custom Components:**
- `service-card.tsx` - Service status display
- `game-server-card.tsx` - Game server with controls
- `navigation-bar.tsx` - Main navigation
- `authenticated-image.tsx` - Images with auth headers

---

## Live TV & Media

### IPTV System

**Multi-provider support:**
1. **Xtream Codes** - Full IPTV API with EPG
2. **M3U Playlists** - Standard playlist format
3. **HDHomeRun** - OTA antenna tuning

**Database Schema:**
```
iptvProviders     → Provider configs (type, URLs)
iptvCredentials   → Encrypted auth (AES-256-GCM)
iptvChannels      → Channel inventory with EPG mapping
channelPackages   → Channel groupings
```

**Key Services:**
- `xtream-codes-service.ts` - Xtream API client with 30-min cache
- `m3u-parser-service.ts` - M3U playlist parsing
- `hdhomerun-service.ts` - Device discovery and streaming
- `channel-mapping-service.ts` - Cross-provider channel deduplication

### EPG (Electronic Program Guide)

**Service**: `server/services/epg-service.ts`

**Features:**
- 7-day program caching
- Auto-refresh every 6 hours
- Multi-source aggregation (Xtream, M3U XMLTV, HDHomeRun)
- Channel name-to-EPG ID mapping

**API:**
```
GET /api/epg/channels           # All EPG channels
GET /api/epg/current/:channelId # Currently playing
GET /api/epg/upcoming/:channelId # Next programs
POST /api/admin/epg/refresh     # Manual refresh
```

### Stream Management

**Services:**
- `streaming-service.ts` - FFmpeg HLS transcoding
- `stream-tracker-service.ts` - Concurrent connection limits
- `stream-probe-service.ts` - Codec detection

**Playback Modes:**
1. **Direct** - Native playback if codecs compatible
2. **Proxy** - Server proxy for CORS issues
3. **Transcode** - FFmpeg for incompatible codecs

**Connection Management:**
```typescript
POST /api/stream/acquire   # Request stream slot
POST /api/stream/heartbeat # Keep alive (60s timeout)
POST /api/stream/release   # Free slot
```

### Plex Integration

**Via Tautulli** (Plex monitoring service)

**Features:**
- Real-time activity (currently playing)
- Library information
- Watch history
- Recently added content

**API:**
```
GET /api/tautulli/activity        # Active streams
GET /api/tautulli/libraries       # Available libraries
GET /api/tautulli/recently-added  # New content
GET /api/tautulli/history         # Watch history
```

---

## Game Servers

### AMP Integration

**Service**: `server/services/amp-service.ts`

AMP (Application Management Panel) manages game servers like Minecraft, Valheim, etc.

**Features:**
- Server status and metrics (CPU, memory, players)
- Start/stop/restart controls
- Console command execution
- Backup management

**API:**
```
GET  /api/game-servers                    # List servers
GET  /api/game-servers/:id                # Server details
POST /api/game-servers/:id/start          # Start server
POST /api/game-servers/:id/stop           # Stop server
POST /api/game-servers/:id/restart        # Restart
POST /api/game-servers/:id/console        # Send command
GET  /api/game-servers/:id/console-output # Console logs
POST /api/game-servers/:id/backup         # Create backup
```

**Database:**
```sql
gameServers {
  instanceId,      -- AMP instance ID
  name,
  displayName,
  status,          -- online/offline/starting
  playerCount,
  maxPlayers,
  hidden,
  autoStart
}
```

---

## Subscriptions & Payments

### Stripe Integration

**Service**: `server/services/stripe-service.ts`

**Features:**
- Multiple subscription plans
- Monthly/annual billing
- Feature gating per plan
- Webhook handling for payment events

**Database:**
```sql
subscriptionPlans {
  name, price_monthly, price_annual,
  stripe_price_id_monthly, stripe_price_id_annual,
  features  -- JSONB: {plex_access, live_tv_access, ...}
}

userSubscriptions {
  user_id, plan_id, stripe_subscription_id,
  status,  -- active/canceled/past_due
  billing_period,
  current_period_end
}
```

**Feature Flags:**
- `plex_access` - Plex/Tautulli features
- `live_tv_access` - IPTV streaming
- `books_access` - EPUB library
- `game_servers_access` - Game server controls
- `max_favorite_channels` - Channel limit

### Referral System

```sql
referralCodes { user_id, code }
referrals { referrer_user_id, referred_user_id, commission_earned }
referralCredits { user_id, credit_type, amount, applied }
```

---

## Mobile App

### Capacitor Configuration

**File**: `capacitor.config.ts`

```typescript
{
  appId: 'com.stylusone.app',
  appName: 'Stylus One',
  webDir: 'dist/public'
}
```

**Plugins:**
- `@capacitor/device` - Device info
- `@capacitor/haptics` - Vibration feedback
- `@capacitor/local-notifications` - Push notifications
- `@capacitor/preferences` - Native storage
- `@capacitor/screen-orientation` - Rotation control
- `@caprockapps/capacitor-chromecast` - Cast support
- `@capacitor-community/keep-awake` - Screen keep-awake

### Platform Detection

```typescript
// client/src/lib/capacitor.ts
isNativePlatform()    // true on iOS/Android
getDeviceType()       // 'phone' | 'tablet' | 'tv' | 'web'
getPlatform()         // 'ios' | 'android' | 'web'
getApiBaseUrl()       // Uses VITE_API_URL for native
```

### Build Commands

```bash
npm run cap:sync      # Build web + sync to mobile
npm run cap:open      # Open Android Studio
npm run cap:run       # Build, sync, and open
npm run android:build # Build debug APK
```

---

## iOS App

### Directory Structure

```
ios/App/
├── App/
│   ├── AppDelegate.swift           # App lifecycle, notifications
│   ├── PiPBridgeViewController.swift  # Custom WebView with PiP
│   ├── NativeTabBarPlugin.swift    # Custom native tab bar
│   ├── Info.plist                  # App configuration
│   └── Assets.xcassets/            # App icons
├── App.xcworkspace/                # Open this in Xcode
├── Podfile                         # CocoaPods dependencies
└── Pods/                           # Installed dependencies
```

### Capacitor iOS Configuration

**File**: `capacitor.config.ts`

```typescript
const config: CapacitorConfig = {
  appId: 'com.stylusone.app',
  appName: 'Stylus One',
  webDir: 'dist/public',
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      iosClientId: process.env.VITE_GOOGLE_IOS_CLIENT_ID,
    }
  }
};
```

Web assets are **bundled** with the app for fast load times and offline support.

### Native Swift Code

#### AppDelegate.swift

Handles app lifecycle and notifications:

```swift
func application(_ application: UIApplication, didFinishLaunchingWithOptions...) {
    // Black background prevents white flash on launch
    window?.backgroundColor = .black

    // Show notifications in foreground
    UNUserNotificationCenter.current().delegate = self
}

// Forward notification taps to Capacitor
func userNotificationCenter(_ center: UNUserNotificationCenter,
                           didReceive response: UNNotificationResponse...) {
    NotificationCenter.default.post(
        name: .capacitorDidReceiveLocalNotification,
        object: response.notification
    )
}
```

#### PiPBridgeViewController.swift

Custom WebView with video features:

```swift
class PiPBridgeViewController: CAPBridgeViewController {
    override func webViewConfiguration(for config: WKWebViewConfiguration) {
        config.allowsPictureInPictureMediaPlayback = true
        config.allowsAirPlayForMediaPlayback = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
    }
}
```

#### NativeTabBarPlugin.swift

Custom Capacitor plugin for native iOS tab bar:

```swift
@objc(NativeTabBarPlugin)
public class NativeTabBarPlugin: CAPPlugin {
    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIView.animate(withDuration: 0.35, delay: 0,
                          usingSpringWithDamping: 0.8,
                          initialSpringVelocity: 0.5) {
                self.tabBar?.transform = .identity
            }
        }
    }

    @objc func setSelected(_ call: CAPPluginCall) {
        // Haptic feedback on tab selection
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }
}
```

### Info.plist Configuration

```xml
<!-- Background audio for streaming -->
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>

<!-- Allow HTTP for image CDN -->
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoadsInWebContent</key>
    <true/>
</dict>

<!-- Google Sign-In URL scheme -->
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>com.googleusercontent.apps.YOUR_CLIENT_ID</string>
        </array>
    </dict>
</array>
```

### CocoaPods Dependencies

**File**: `ios/App/Podfile`

```ruby
platform :ios, '14.0'

target 'App' do
  capacitor_pods

  pod 'CapacitorDevice'
  pod 'CapacitorHaptics'
  pod 'CapacitorLocalNotifications'
  pod 'CapacitorPreferences'
  pod 'CapacitorScreenOrientation'
  pod 'CapacitorCommunityKeepAwake'
  pod 'CaprockappsCapacitorChromecast'
  pod 'CodetrixStudioCapacitorGoogleAuth'
end
```

### Client-Side iOS Handling

#### HTTP Requests with Cookies

iOS WKWebView doesn't share cookies with `fetch()`, so use CapacitorHttp:

```typescript
import { CapacitorHttp } from '@capacitor/core';

export async function apiRequest(url: string, options: RequestInit = {}) {
  if (isNativePlatform()) {
    // CapacitorHttp handles cookies properly on iOS
    return CapacitorHttp.request({
      url: getApiBaseUrl() + url,
      method: options.method || 'GET',
      headers: options.headers as Record<string, string>,
      data: options.body,
    });
  }
  return fetch(url, { ...options, credentials: 'include' });
}
```

#### Native Tab Bar Control

```typescript
import { registerPlugin } from '@capacitor/core';

const NativeTabBar = registerPlugin<NativeTabBarPlugin>('NativeTabBarPlugin');

export async function showNativeTabBar() {
  if (Capacitor.getPlatform() !== 'ios') return;
  await NativeTabBar.show();
}
```

#### Haptic Feedback

```typescript
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export async function hapticLight() {
  if (!isNativePlatform()) return;
  await Haptics.impact({ style: ImpactStyle.Light });
}
```

### iOS Build Workflow

```bash
# Build and sync
npm run build
npx cap sync ios

# Open in Xcode
npx cap open ios

# Or all-in-one
npm run cap:run
```

#### Pod Installation

```bash
cd ios/App
pod install
cd ../..
```

### iOS-Specific Features

| Feature | Implementation |
|---------|----------------|
| **Picture-in-Picture** | `PiPBridgeViewController` enables PiP for HLS streams |
| **AirPlay** | WebView configured for Apple TV streaming |
| **Background Audio** | Info.plist `UIBackgroundModes: audio` |
| **Native Tab Bar** | Custom `NativeTabBarPlugin.swift` with haptics |
| **Google Sign-In** | Native OAuth with iOS-specific client ID |
| **Keep Awake** | Prevents sleep during video playback |

### Splash Screen Architecture

The iOS app uses a **three-layer splash screen** system for smooth loading:

```
iOS Launch Screen (static image)
         ↓
HTML Initial Splash (black screen)
         ↓
React App renders
         ↓
Animated splash shows for 3 seconds
         ↓
Fade out → Main app visible
```

#### Layer 1: Native Launch Screen

**File**: `ios/App/App/Base.lproj/LaunchScreen.storyboard`

Static image displayed by iOS while the app binary loads:

```xml
<imageView contentMode="scaleAspectFill" image="Splash">
    <color key="backgroundColor" red="0" green="0" blue="0" alpha="1"/>
</imageView>
```

#### Layer 2: HTML Transition Splash

**File**: `client/index.html`

Black div covering the screen while React initializes:

```html
<div id="initial-splash" style="position: fixed; inset: 0; z-index: 9999; background-color: #000;"></div>

<script>
  // Hide immediately on web, keep visible on native until React is ready
  window.__hideInitialSplash = function() {
    var splash = document.getElementById('initial-splash');
    splash.style.transition = 'opacity 0.3s ease-out';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 300);
  };
</script>
```

#### Layer 3: Animated React Splash

**File**: `client/src/pages/live-tv-native.tsx`

Animated splash with Framer Motion (shows for 3 seconds):

```tsx
const [showSplash, setShowSplash] = useState(true);

useEffect(() => {
  const timer = setTimeout(() => setShowSplash(false), 3000);
  return () => clearTimeout(timer);
}, []);

<AnimatePresence>
  {showSplash && (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[100] bg-black"
    >
      {/* 20 floating particles */}
      {[...Array(20)].map((_, i) => (
        <motion.div
          className="absolute w-1 h-1 bg-white/20 rounded-full"
          animate={{ y: [null, -100], opacity: [0, 0.5, 0] }}
          transition={{ duration: 3 + Math.random() * 2, repeat: Infinity }}
        />
      ))}

      {/* Radial blue glow background */}
      <div className="absolute inset-0 bg-gradient-radial from-blue-900/20" />

      {/* Logo with blur glow */}
      <div className="absolute w-64 h-64 bg-blue-600/20 rounded-full blur-[80px]" />
      <img src={settings.logo_url_large} className="w-24 h-24" />

      {/* App name */}
      <h1 className="text-2xl font-bold text-white">{settings.site_title}</h1>

      {/* Animated loading bar */}
      <motion.div
        className="h-1 w-1/3 bg-gradient-to-r from-transparent via-blue-500 to-transparent"
        animate={{ x: ['-100%', '400%'] }}
        transition={{ duration: 1.2, repeat: Infinity }}
      />
    </motion.div>
  )}
</AnimatePresence>
```

#### Animation Elements

| Element | Animation |
|---------|-----------|
| **Particles** | 20 dots floating upward, fading in/out on loop |
| **Background** | Radial blue gradient glow |
| **Logo** | Static with 80px blurred blue glow |
| **Loading bar** | Blue gradient sliding left-to-right infinitely |
| **Exit** | Entire splash fades out over 0.4s |

### App Store Submission

1. In Xcode: Product → Archive
2. Click "Distribute App" → "App Store Connect"
3. Upload to App Store Connect
4. Submit for review

**Required assets:**
- App icon: 1024x1024 PNG
- Screenshots: iPhone 6.7" and iPad 12.9"
- Privacy policy URL

### iOS Environment Variables

```bash
VITE_API_URL=https://your-server.com
VITE_GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### Common iOS Issues

| Problem | Solution |
|---------|----------|
| White flash on launch | Set black background in AppDelegate + PiPBridgeViewController |
| 401 errors on API calls | Use `CapacitorHttp` instead of `fetch` |
| Cookies not persisting | WKWebView issue - must use CapacitorHttp |
| Pod install fails | Run `pod repo update` then retry |
| Build fails after plugin update | `npx cap sync --force` and clean build |

---

## Android App

### Directory Structure

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/com/stylusone/app/
│   │   │   └── MainActivity.java      # Minimal Capacitor wrapper
│   │   ├── res/
│   │   │   ├── values/strings.xml     # App name, Google Client ID
│   │   │   ├── drawable/              # Splash screens
│   │   │   └── mipmap-*/              # Launcher icons
│   │   └── AndroidManifest.xml
│   └── build.gradle                   # App-level config
├── build.gradle                       # Root build config
├── variables.gradle                   # SDK versions
├── stylusone-release.keystore         # Play Store signing key
└── capacitor-cordova-android-plugins/
```

### Native Android Configuration

#### MainActivity.java

Minimal implementation - Capacitor handles everything:

```java
package com.stylusone.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
```

No custom Java code needed - all functionality lives in TypeScript/React.

#### SDK Versions (`variables.gradle`)

```gradle
ext {
    minSdkVersion = 23           // Android 6.0
    compileSdkVersion = 35       // Android 15
    targetSdkVersion = 35
    javaVersion = VERSION_21
}
```

#### AndroidManifest.xml

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/AppTheme">

        <activity
            android:name=".MainActivity"
            android:launchMode="singleTask"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

### Capacitor Plugins

| Plugin | Purpose |
|--------|---------|
| `@capacitor/device` | Device info (model, platform, OS) |
| `@capacitor/haptics` | Vibration feedback |
| `@capacitor/local-notifications` | Push notifications |
| `@capacitor/preferences` | Native key-value storage |
| `@capacitor/screen-orientation` | Lock/unlock rotation |
| `@capacitor-community/keep-awake` | Prevent screen sleep |
| `@caprockapps/capacitor-chromecast` | Cast to Chromecast |
| `@codetrix-studio/capacitor-google-auth` | Google Sign-In |

### Build Configuration

#### Signing (`app/build.gradle`)

```gradle
android {
    signingConfigs {
        release {
            storeFile file('../stylusone-release.keystore')
            storePassword 'your-password'
            keyAlias 'stylusone'
            keyPassword 'your-password'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

### Client-Side Android Handling

#### Platform Detection

```typescript
import { Device } from '@capacitor/device';

export async function getDeviceType(): Promise<'phone' | 'tablet' | 'tv' | 'web'> {
  if (!isNativePlatform()) return 'web';

  const info = await Device.getInfo();

  // Android TV detection
  if (info.platform === 'android') {
    const model = info.model.toLowerCase();
    if (model.includes('tv') || model.includes('shield') ||
        model.includes('firetv') || model.includes('chromecast')) {
      return 'tv';
    }
    if (window.innerWidth >= 600) return 'tablet';
  }
  return 'phone';
}
```

#### HTTP Requests with Cookies

```typescript
import { CapacitorHttp } from '@capacitor/core';

export async function apiRequest(url: string, options: RequestInit = {}) {
  if (isNativePlatform()) {
    // CapacitorHttp shares cookies with WebView
    return CapacitorHttp.request({
      url: getApiBaseUrl() + url,
      method: options.method || 'GET',
      headers: options.headers as Record<string, string>,
      data: options.body,
    });
  }
  return fetch(url, { ...options, credentials: 'include' });
}
```

### Google Auth Auto-Configuration

Script (`scripts/update-android-config.cjs`) auto-injects Client ID from `.env`:

```javascript
// Reads VITE_GOOGLE_CLIENT_ID from .env
// Injects into android/app/src/main/res/values/strings.xml
const clientId = env.match(/VITE_GOOGLE_CLIENT_ID=(.+)/)?.[1];
strings = strings.replace(
  /<string name="server_client_id">.*<\/string>/,
  `<string name="server_client_id">${clientId}</string>`
);
```

### Android Build Commands

```bash
# Build web + sync to Android
npm run cap:sync

# Open Android Studio
npm run cap:open

# Build, sync, and open (all-in-one)
npm run cap:run

# Build debug APK
npm run android:build

# Build release APK
cd android && ./gradlew assembleRelease

# Build App Bundle for Play Store
cd android && ./gradlew bundleRelease
```

#### Build Output

```
android/app/build/outputs/
├── apk/
│   ├── debug/app-debug.apk
│   └── release/app-release.apk
└── bundle/
    └── release/app-release.aab    # Play Store
```

### Android-Specific Features

| Feature | Implementation |
|---------|----------------|
| **Google Sign-In** | Auto-injected Client ID in `strings.xml` |
| **Haptic Feedback** | Vibration on user interactions |
| **Keep Awake** | Prevents sleep during video |
| **Chromecast** | Cast streams to Chromecast devices |
| **Screen Orientation** | Lock landscape for fullscreen video |
| **Android TV** | Detection by model name + optimized UI |

### Play Store Deployment

1. Update version in `server/lib/startup-display.ts`
2. Build release bundle:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
3. Upload `app-release.aab` to Google Play Console
4. Configure store listing (screenshots, description, privacy policy)
5. Submit for review (1-3 days)

### Android Environment Variables

```bash
VITE_API_URL=https://your-server.com
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### Common Android Issues

| Problem | Solution |
|---------|----------|
| 401 errors on API calls | Use `CapacitorHttp` instead of `fetch` |
| Google Sign-In fails | Check `server_client_id` in `strings.xml` |
| Build fails with SDK error | Update `compileSdkVersion` in `variables.gradle` |
| Cookies not persisting | Must use CapacitorHttp for authenticated requests |
| Chromecast not finding devices | Ensure same WiFi network |

### iOS vs Android Comparison

| Aspect | Android | iOS |
|--------|---------|-----|
| **Native Code** | None (pure Capacitor) | Custom Swift (PiP, Tab Bar) |
| **Tab Bar** | Web-based (React) | Native UITabBar |
| **Package Manager** | Gradle | CocoaPods |
| **Signing** | Keystore file | Xcode signing |
| **Distribution** | APK/AAB → Play Store | IPA → App Store |
| **Google Auth Config** | `strings.xml` | `capacitor.config.ts` |

---

## Google Sign-In

The app implements **two OAuth flows**: web (Passport.js redirect) and native (Capacitor plugin).

### Flow Diagrams

**Web Flow:**
```
Click "Sign in with Google" → Redirect to /api/auth/google/start
→ Google login screen → Callback to /api/auth/google/callback
→ Verify profile → Create/find user → Session cookie → Redirect to dashboard
```

**Native Flow (iOS/Android):**
```
Click "Sign in with Google" → GoogleAuth.signIn() native dialog
→ Returns ID token → POST /api/auth/google with token
→ Firebase verifies token → Create/find user → Session → Return user JSON
```

### Client Implementation

**File**: `client/src/components/google-auth-button.tsx`

```tsx
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { CapacitorHttp } from '@capacitor/core';

export function GoogleAuthButton({ onSuccess, redirect }: Props) {

  const handleClick = async () => {
    if (!isNativePlatform()) {
      // WEB: OAuth redirect
      window.location.href = `/api/auth/google/start`;
      return;
    }

    // NATIVE: Capacitor plugin
    const result = await GoogleAuth.signIn();
    const idToken = result.authentication.idToken;

    // CapacitorHttp required for cookie handling on native
    const response = await CapacitorHttp.post({
      url: `${getApiBaseUrl()}/api/auth/google`,
      headers: { 'Content-Type': 'application/json' },
      data: { token: idToken },
    });

    if (response.status === 403) {
      // User needs admin approval
      return;
    }

    queryClient.setQueryData(['/api/user'], response.data);
    onSuccess?.(response.data);
  };

  return <Button onClick={handleClick}>Sign in with Google</Button>;
}
```

### Server Implementation

**File**: `server/auth.ts`

#### Passport Google Strategy (Web)

```typescript
passport.use(new GoogleStrategy({
    clientID: process.env.VITE_GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: `${process.env.APP_URL}/api/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;

    let user = await storage.getUserByEmail(email);
    if (!user) {
      user = await storage.createUser({
        username: profile.displayName,
        email,
        password: crypto.randomBytes(32).toString('hex'),
        role: 'pending',
        approved: false,
      });
    }

    return done(null, user);
  }
));
```

#### Token Verification Endpoint (Native)

```typescript
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;

  // Verify with Firebase Admin SDK
  const decoded = await admin.auth().verifyIdToken(token);
  const email = decoded.email;

  let user = await storage.getUserByEmail(email);
  if (!user) {
    user = await storage.createUser({ email, ... });
  }

  if (!user.approved) {
    return res.status(403).json({
      message: 'Account pending approval',
      requiresApproval: true,
    });
  }

  req.login(user, (err) => {
    res.json(user);
  });
});
```

### Capacitor Configuration

**File**: `capacitor.config.ts`

```typescript
plugins: {
  GoogleAuth: {
    scopes: ['profile', 'email'],
    iosClientId: process.env.VITE_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.VITE_GOOGLE_CLIENT_ID,
  }
}
```

### Platform Configuration

**iOS** (`Info.plist`):
```xml
<key>CFBundleURLSchemes</key>
<array>
    <string>com.googleusercontent.apps.YOUR_IOS_CLIENT_ID</string>
</array>
```

**Android** (`strings.xml` - auto-injected from `.env`):
```xml
<string name="server_client_id">YOUR_GOOGLE_CLIENT_ID</string>
```

### Environment Variables

```bash
# Firebase
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=1:123456:web:abc123

# Google OAuth
VITE_GOOGLE_CLIENT_ID=123456.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...

# iOS-specific
VITE_GOOGLE_IOS_CLIENT_ID=123456.apps.googleusercontent.com
```

### User Approval Flow

New users are created with `approved: false` by default. Admin must approve before access is granted.

**Not Approved (403):**
```json
{ "message": "Account pending approval", "requiresApproval": true }
```

**Approved (200):**
```json
{ "id": 123, "email": "user@example.com", "approved": true }
```

### Web vs Native Comparison

| Aspect | Web | Native |
|--------|-----|--------|
| **Flow** | OAuth redirect | Native SDK dialog |
| **Client ID** | `VITE_GOOGLE_CLIENT_ID` | iOS: `VITE_GOOGLE_IOS_CLIENT_ID` |
| **Token Transport** | Via redirect callback | POST body |
| **Cookie Handling** | Automatic | Requires CapacitorHttp |
| **Verification** | Passport auto-verifies | Firebase Admin SDK |

### Security Features

| Feature | Implementation |
|---------|----------------|
| **Token Verification** | Firebase Admin SDK |
| **Rate Limiting** | 5 attempts per 10 minutes |
| **Session Cookies** | httpOnly, secure, sameSite: lax |
| **Login Tracking** | IP, ISP, city, country logged |

### Key Files

| File | Purpose |
|------|---------|
| `client/src/components/google-auth-button.tsx` | Sign-in button |
| `client/src/lib/firebase.ts` | Firebase initialization |
| `server/auth.ts` | Passport strategies, token verification |
| `capacitor.config.ts` | GoogleAuth plugin config |

---

## Infrastructure

### Docker Setup

**File**: `docker-compose.yml`

**Services:**
1. **app** - Node.js application (port 5000)
2. **db** - PostgreSQL 16 Alpine

**Volumes:**
- `postgres_data` - Database persistence
- `app_uploads` - User file uploads
- `app_data` - EPG cache and data

### Dockerfile

**Multi-stage build:**
1. **Builder** - Node 20-slim, installs deps, runs Vite build
2. **Runner** - Minimal image with Python, FFmpeg for streaming

**Key directories:**
```
/app/dist        # Built web assets
/app/server      # Server source
/app/data        # EPG cache (volume)
/app/uploads     # User uploads (volume)
```

### Build System

**Vite** for client, **esbuild** for server

```bash
npm run build
# 1. Vite bundles React → dist/public/
# 2. esbuild bundles server → dist/index.js
```

**Output:**
```
dist/
├── index.js          # Server (ESM)
├── public/
│   ├── index.html    # SPA entry
│   ├── assets/       # JS/CSS chunks
│   └── streams/      # HLS segments
```

---

## Shared Code

**Directory**: `shared/`

Code shared between client and server:

```
shared/
├── schema.ts              # Drizzle database schema (30+ tables)
└── lib/logger/
    ├── types.ts           # LogLevel, LogModule, Logger interface
    ├── constants.ts       # ANSI colors, status symbols
    └── index.ts           # Exports
```

**Pattern**: Define types once, implement twice (server + client)

---

## Logging System

### Architecture

```
shared/lib/logger/types.ts    # Shared types and interface
server/lib/logger.ts          # Server implementation (Node.js console)
client/src/lib/logger.ts      # Client implementation (browser console)
```

### Log Levels

| Level | Priority | Description |
|-------|----------|-------------|
| `trace` | 10 | Very detailed debugging (rarely used) |
| `debug` | 20 | Development debugging info |
| `info` | 30 | General operational messages |
| `warn` | 40 | Warning conditions |
| `error` | 50 | Error conditions |
| `fatal` | 60 | Critical failures |

### Environment Filtering

- **Production**: Shows `info` and above
- **Development**: Shows `debug` and above, with colorized output

### Usage

```typescript
// Server-side
import { loggers } from './lib/logger';
loggers.epg.info('Loaded 240 channels');
loggers.auth.error('Login failed', { userId: 123 });

// Client-side
import { loggers } from '@/lib/logger';
loggers.tv.debug('Playing channel', { channelId: 5 });
```

### Output Format

```
14:30:45 [INFO ] [EPG] Loaded 240 channels
14:30:45 [ERROR] [Auth] Login failed { userId: 123 }
```

### Available Modules

**Server**: `database`, `session`, `express`, `auth`, `firebase`, `plex`, `tautulli`, `tmdb`, `epg`, `hdHomeRun`, `iptv`, `xtreamCodes`, `stream`, `providerHealth`, `amp`, and more

**Client**: `tv`, `cache`, `imageCache`, `queryClient`, `capacitor`, `nativeVideo`, `nativeStorage`, `stripe`, `books`, `iptv`, `admin`

### Adding a New Module

1. Add module name to `shared/lib/logger/types.ts` in `LogModule` type
2. Add pre-created logger to `server/lib/logger.ts` in `loggers` object
3. Add pre-created logger to `client/src/lib/logger.ts` in `loggers` object

---

## Startup Display

On server boot, a formatted ASCII box shows service health:

```
╔══════════════════════════════════════════════════════════════════════╗
║                    Homelab Dashboard v1.5.44                         ║
╠══════════════════════════════════════════════════════════════════════╣
║ INFRASTRUCTURE                                                        ║
║   ✓ Database                connected (45ms)                          ║
║   ✓ Session Store           PostgreSQL pool ready                     ║
╠══════════════════════════════════════════════════════════════════════╣
║ MEDIA SERVICES                                                        ║
║   ✓ Plex                    configured                                ║
║   - Tautulli                not configured                            ║
╠══════════════════════════════════════════════════════════════════════╣
║ BACKGROUND TASKS                                                      ║
║   • Stream Tracker          cleanup every 30s                         ║
║   • Provider Health         monitoring every 5m                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

### Status Indicators

| Symbol | Color  | Meaning |
|--------|--------|---------|
| ✓      | Green  | Service healthy |
| ✗      | Red    | Service failed |
| ⟳      | Yellow | Initializing in background |
| -      | Gray   | Not configured |

### Service Categories

1. Infrastructure (Database, Session)
2. Authentication (Firebase, OAuth)
3. Media Services (Plex, Tautulli, TMDB)
4. Payment & Email (Stripe, Mailgun)
5. Live TV & IPTV (HDHomeRun, Xtream Codes, EPG)
6. Game Servers (AMP)
7. Background Tasks
8. Server (Express, Routes, Listening)

### Adding a Service

Edit `server/lib/startup.ts`:

```typescript
function checkMyService(): ServiceInfo {
  if (!process.env.MY_SERVICE_API_KEY) {
    return { name: 'My Service', status: 'skipped', message: 'not configured' };
  }
  return { name: 'My Service', status: 'success', message: 'connected' };
}

// In initializeWithDisplay()
display.addService('Media Services', checkMyService());
```

---

## Environment Variables

### Required

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/dashboard
SESSION_SECRET=your-secret-key
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

### Optional Services

```bash
# Plex monitoring
TAUTULLI_URL=http://localhost:8181
TAUTULLI_API_KEY=...

# TV metadata
TMDB_API_KEY=...

# Email
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...

# Live TV
HDHOMERUN_URL=http://192.168.1.100
XTREAM_SERVER_URL=...
XTREAM_USERNAME=...
XTREAM_PASSWORD=...

# Game servers
AMP_API_URL=...
AMP_API_USERNAME=...
AMP_API_PASSWORD=...

# Payments
STRIPE_SECRET_KEY=...
VITE_STRIPE_PUBLISHABLE_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Mobile
VITE_API_URL=https://your-server.com
VITE_GOOGLE_CLIENT_ID=...
```

---

## Viewing Logs

- **Browser console** for client-side logs
- **Docker**: `docker-compose logs app --tail 100`
- **Development**: Colorized output in terminal

---

## Related Documentation

- `CLAUDE.md` - Development commands and deployment guide
- `MOBILE.md` - Mobile app setup (Android/iOS via Capacitor)
- `SUBSCRIPTION_SETUP.md` - Stripe subscription configuration
- `CAST_RECEIVER_SETUP.md` - Chromecast receiver setup
