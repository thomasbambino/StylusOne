import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.stylusone.app',
  appName: 'Stylus One',
  webDir: 'dist/public',
  // Comment out server.url to bundle the app (better performance)
  // Uncomment to load from remote server for development
  // server: {
  //   url: 'https://stylus.services',
  //   cleartext: true
  // }
};

export default config;
