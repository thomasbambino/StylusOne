# Mobile App Development Guide

This guide covers building and deploying the Stylus One Android app using Capacitor.

## Prerequisites

### Required Software

1. **Node.js** (v18 or higher)
   ```bash
   node --version
   ```

2. **Android Studio** (Latest stable version)
   - Download from: https://developer.android.com/studio
   - Install with "Android SDK", "Android SDK Platform", and "Android Virtual Device"

3. **Java JDK** (17 or higher)
   ```bash
   java --version
   ```
   - Download from: https://adoptium.net/ or use your system package manager

4. **Android SDK**
   - Installed via Android Studio
   - Set ANDROID_HOME environment variable:
     ```bash
     # macOS/Linux (add to ~/.zshrc or ~/.bashrc)
     export ANDROID_HOME=$HOME/Library/Android/sdk
     export PATH=$PATH:$ANDROID_HOME/platform-tools
     export PATH=$PATH:$ANDROID_HOME/tools
     ```

## Environment Configuration

1. **Copy environment file**:
   ```bash
   cp .env.example .env
   ```

2. **Configure mobile settings**:
   ```bash
   # In .env file
   VITE_API_URL=https://stylus.services  # Your production server URL
   ```

## Development Workflow

### 1. Build the Web Assets

Before working with the mobile app, build the latest web assets:

```bash
npm run build
```

### 2. Sync with Android

Sync the web assets to the Android project:

```bash
npm run cap:sync
```

This command:
- Builds the web assets
- Copies them to android/app/src/main/assets/public
- Updates Capacitor plugins

### 3. Open in Android Studio

```bash
npm run cap:open
```

Or use the combined command:

```bash
npm run cap:run
```

This builds, syncs, and opens Android Studio in one step.

### 4. Run on Device/Emulator

In Android Studio:
1. Select your device/emulator from the dropdown
2. Click the "Run" button (green play icon)
3. The app will install and launch

## Building APK

### Debug APK (for testing)

```bash
npm run android:build
```

The APK will be located at:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK (for production)

1. **Generate a signing key**:
   ```bash
   cd android
   keytool -genkey -v -keystore my-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias my-key-alias
   ```

2. **Update gradle.properties** (add these lines):
   ```properties
   MYAPP_RELEASE_STORE_FILE=my-release-key.jks
   MYAPP_RELEASE_KEY_ALIAS=my-key-alias
   MYAPP_RELEASE_STORE_PASSWORD=****
   MYAPP_RELEASE_KEY_PASSWORD=****
   ```

3. **Update build.gradle** (already configured):
   ```gradle
   android {
       signingConfigs {
           release {
               storeFile file(MYAPP_RELEASE_STORE_FILE)
               storePassword MYAPP_RELEASE_STORE_PASSWORD
               keyAlias MYAPP_RELEASE_KEY_ALIAS
               keyPassword MYAPP_RELEASE_KEY_PASSWORD
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
               minifyEnabled false
               proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
           }
       }
   }
   ```

4. **Build release APK**:
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

5. **Find the APK**:
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

## Publishing to Google Play Store

### 1. Create Google Play Console Account

- Go to: https://play.google.com/console
- Pay the $25 one-time registration fee
- Set up your developer profile

### 2. Create App Listing

1. Click "Create app"
2. Fill in app details:
   - App name: Stylus One
   - Default language: English (United States)
   - App/Game: App
   - Free/Paid: Free

### 3. Prepare Store Listing

Required assets:
- **App icon**: 512x512 PNG
- **Feature graphic**: 1024x500 PNG
- **Screenshots**: At least 2 phone screenshots (min 320px, max 3840px)
- **Privacy policy URL**: Required if app handles user data

### 4. Upload APK/AAB

For production, use Android App Bundle (AAB) instead of APK:

```bash
cd android
./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

### 5. Submit for Review

1. Upload the AAB
2. Complete all required sections
3. Submit for review (typically takes 1-7 days)

## Capacitor Configuration

The app configuration is in `capacitor.config.ts`:

```typescript
const config: CapacitorConfig = {
  appId: 'com.stylusone.app',
  appName: 'Stylus One',
  webDir: 'dist/public',
};
```

### Server Mode vs Bundled Mode

**Bundled Mode** (current, recommended):
- Web assets are packaged with the app
- Faster load times
- Works offline (for static content)
- API calls go to VITE_API_URL

**Server Mode** (for development):
```typescript
const config: CapacitorConfig = {
  // ...
  server: {
    url: 'https://stylus.services',
    cleartext: true
  }
};
```
- Loads from remote server
- Useful for testing without rebuilding
- Requires internet connection

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build web assets |
| `npm run cap:sync` | Build and sync to Android |
| `npm run cap:open` | Open Android Studio |
| `npm run cap:run` | Build, sync, and open Android Studio |
| `npm run android:build` | Build debug APK |
| `npx cap sync` | Sync changes to native projects |
| `npx cap copy` | Copy web assets only |
| `npx cap update` | Update Capacitor plugins |

## Adding Capacitor Plugins

### Example: Adding Camera Plugin

```bash
npm install @capacitor/camera
npx cap sync
```

Then use in your code:
```typescript
import { Camera, CameraResultType } from '@capacitor/camera';

const takePicture = async () => {
  const image = await Camera.getPhoto({
    quality: 90,
    allowEditing: true,
    resultType: CameraResultType.Uri
  });
};
```

### Useful Plugins for Stylus One

```bash
# Push notifications
npm install @capacitor/push-notifications

# Network status
npm install @capacitor/network

# Status bar customization
npm install @capacitor/status-bar

# Splash screen
npm install @capacitor/splash-screen

# Video player (for Live TV)
npm install capacitor-video-player
```

## Troubleshooting

### Build Errors

**Gradle build failed**:
```bash
cd android
./gradlew clean
./gradlew build
```

**Android SDK not found**:
- Ensure ANDROID_HOME is set correctly
- Check Android Studio SDK location: Preferences → Appearance & Behavior → System Settings → Android SDK

**Capacitor sync failed**:
```bash
npm run build  # Ensure web assets are built first
npx cap sync --force
```

### Runtime Issues

**API calls not working**:
- Check VITE_API_URL is set correctly in .env
- Ensure the server is accessible from the device
- Check network permissions in AndroidManifest.xml

**White screen on launch**:
- Check browser console in Android Studio (Logcat)
- Ensure dist/public/index.html exists
- Run `npm run build` and `npx cap sync`

**Session/Cookie issues**:
- Capacitor uses capacitor://localhost as the origin
- May need to adjust CORS settings on server
- Consider using token-based auth for mobile

## Platform-Specific Code

Detect if running in native app:

```typescript
import { Capacitor } from '@capacitor/core';

if (Capacitor.isNativePlatform()) {
  // Running in native app
  console.log('Platform:', Capacitor.getPlatform());  // 'android' or 'ios'
} else {
  // Running in web browser
}
```

## Live TV Streaming on Mobile

The app includes live TV streaming via HDHomeRun and IPTV. For mobile:

1. **HLS.js** works on Android WebView
2. Consider using native video player for better performance:
   ```bash
   npm install capacitor-video-player
   ```

3. Update video player component to use native player on mobile

## App Icon and Splash Screen

### App Icon

1. Create icon at 1024x1024 PNG
2. Use Android Studio's Asset Studio:
   - Right-click `android/app/res` → New → Image Asset
   - Select your icon file
   - Generate all sizes

### Splash Screen

1. Create splash image at 2732x2732 PNG
2. Use `@capacitor/splash-screen` plugin:
   ```bash
   npm install @capacitor/splash-screen
   ```

3. Configure in capacitor.config.ts:
   ```typescript
   plugins: {
     SplashScreen: {
       launchShowDuration: 2000,
       backgroundColor: "#000000",
       showSpinner: false
     }
   }
   ```

## Performance Optimization

1. **Enable Proguard** for release builds (shrinks APK size)
2. **Use native navigation** for better performance
3. **Optimize images** before bundling
4. **Enable Hermes** JavaScript engine (if using older Capacitor)
5. **Code splitting** in Vite for faster load times

## Next Steps

1. Test on physical Android device
2. Add app icon and splash screen
3. Implement push notifications (if needed)
4. Optimize video streaming for mobile
5. Add offline support (Service Worker)
6. Submit to Google Play Store

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Android Developer Guide](https://developer.android.com)
- [Google Play Console](https://play.google.com/console)
- [Capacitor Plugins](https://capacitorjs.com/docs/plugins)
