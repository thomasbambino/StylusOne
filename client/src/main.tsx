import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativePlatform } from "./lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { Capacitor } from '@capacitor/core';

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
    console.log(`GoogleAuth initialized for ${platform}`);
  } else {
    console.warn(`GoogleAuth not initialized - no client ID for ${platform}`);
  }
}

// Register service worker for offline capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registration successful:', registration.scope);
      })
      .catch(error => {
        console.error('ServiceWorker registration failed:', error);
      });
  });
}

createRoot(document.getElementById("root")!).render(<App />);

// Hide the initial splash screen once React has rendered
if (typeof window !== 'undefined' && (window as any).__hideInitialSplash) {
  // Small delay to ensure the app has painted
  setTimeout(() => {
    (window as any).__hideInitialSplash();
  }, 100);
}