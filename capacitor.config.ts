import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stylusone.app',
  appName: 'Stylus One',
  webDir: 'dist/public',
  plugins: {
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // For iOS: Create an iOS OAuth Client ID in Google Cloud Console
      // and add the reversed client ID as a URL scheme in Info.plist
      iosClientId: process.env.VITE_GOOGLE_IOS_CLIENT_ID || '',
      // For Android: Uses the Web Client ID from VITE_GOOGLE_CLIENT_ID
      androidClientId: process.env.VITE_GOOGLE_CLIENT_ID || '',
    }
  }
  // Comment out server.url to bundle the app (better performance)
  // Uncomment to load from remote server for development
  // server: {
  //   url: 'https://stylus.services',
  //   cleartext: true
  // }
};

export default config;
