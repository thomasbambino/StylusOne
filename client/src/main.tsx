import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativePlatform } from "./lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

// Initialize Google Auth for native platforms
if (isNativePlatform()) {
  GoogleAuth.initialize({
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    scopes: ['profile', 'email'],
    grantOfflineAccess: true,
  });
  console.log('GoogleAuth initialized for native platform');
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