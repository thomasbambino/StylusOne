import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, inMemoryPersistence, setPersistence } from 'firebase/auth';
import { loggers } from './logger';

// Verify Firebase configuration values
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "stylus-dashboard-f6c70.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: undefined
};

loggers.firebase.debug('Initializing Firebase', {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  hasApiKey: !!firebaseConfig.apiKey
});

// Initialize Firebase with error handling
let app: any = null;
let auth: any = null;
let googleProvider: any = null;
let authInitialized = false;

// Function to initialize auth with persistence
async function initializeAuth() {
  try {
    // Check if Firebase config is complete
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
      throw new Error('Firebase configuration is incomplete');
    }

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // Use in-memory persistence to avoid browser storage issues with tracking prevention
    // This prevents Firebase from trying to store auth state in localStorage/indexedDB
    // IMPORTANT: This must complete BEFORE any auth operations
    await setPersistence(auth, inMemoryPersistence);
    loggers.firebase.info('Firebase initialized with in-memory persistence');

    // Configure Google Provider after Firebase is initialized
    try {
      googleProvider = new GoogleAuthProvider();
      googleProvider.addScope('email');
      googleProvider.addScope('profile');
      googleProvider.setCustomParameters({
        prompt: 'select_account'
      });
      loggers.firebase.debug('Google Provider configured');
    } catch (error) {
      loggers.firebase.error('Failed to configure Google Provider', { error });
    }

    authInitialized = true;
  } catch (error) {
    loggers.firebase.error('Firebase initialization failed', { error });
    loggers.firebase.warn('Running in fallback mode without Firebase authentication');

    // Create mock auth object for fallback
    auth = {
      currentUser: null,
      onAuthStateChanged: (callback: Function) => {
        callback(null);
        return () => {};
      },
      signInWithPopup: () => Promise.reject(new Error('Firebase not available')),
      signOut: () => Promise.resolve()
    };
    authInitialized = true;
  }
}

// Start initialization immediately
initializeAuth();

export { app, auth, googleProvider, authInitialized };

// Log auth state changes for debugging (only if auth is available)
if (auth && typeof auth.onAuthStateChanged === 'function') {
  auth.onAuthStateChanged((user: any) => {
    if (user) {
      loggers.firebase.debug('User signed in', { email: user.email });
    } else {
      loggers.firebase.debug('User signed out');
    }
  });
}