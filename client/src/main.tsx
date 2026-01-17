import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativePlatform } from "./lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';
import { loggers } from "./lib/logger";

// Initialize Google Auth for native platforms
if (isNativePlatform()) {
  const platform = Capacitor.getPlatform();
  // Use iOS client ID for iOS, regular client ID for Android
  const clientId = platform === 'ios'
    ? import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID
    : import.meta.env.VITE_GOOGLE_CLIENT_ID;

  if (clientId) {
    GoogleAuth.initialize({
      clientId,
      scopes: ['profile', 'email'],
      grantOfflineAccess: true,
    });
    loggers.oauth.info('GoogleAuth initialized', { platform });
  } else {
    loggers.oauth.warn('GoogleAuth not initialized - no client ID', { platform });
  }
}

// Register service worker for offline capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        loggers.capacitor.debug('ServiceWorker registration successful', { scope: registration.scope });
      })
      .catch(error => {
        loggers.capacitor.error('ServiceWorker registration failed', { error });
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);