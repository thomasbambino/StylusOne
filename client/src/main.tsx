import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativePlatform } from "./lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';
import { loggers } from "./lib/logger";

// Initialize Google Auth for native platforms
if (isNativePlatform()) {
  try {
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
  } catch (error) {
    loggers.oauth.error('GoogleAuth initialization failed', { error });
  }
}

// Register service worker for offline capabilities (web only)
// Native apps use bundled assets and their own caching - a service worker
// can serve stale cached content causing blank screens after updates
if ('serviceWorker' in navigator && !isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        loggers.capacitor.debug('ServiceWorker registration successful', { scope: registration.scope });
      })
      .catch(error => {
        loggers.capacitor.error('ServiceWorker registration failed', { error });
      });
  });
} else if (isNativePlatform() && 'serviceWorker' in navigator) {
  // Unregister any existing service workers on native platforms
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(registration => {
      registration.unregister();
      loggers.capacitor.info('Unregistered stale service worker on native platform');
    });
  });
}

// Ensure splash is hidden even if app crashes during render
window.addEventListener('error', () => {
  if ((window as any).__hideInitialSplash) {
    (window as any).__hideInitialSplash();
  }
});

createRoot(document.getElementById("root")!).render(<App />);