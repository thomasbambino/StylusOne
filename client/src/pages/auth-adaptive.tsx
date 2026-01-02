import { isNativePlatform } from '@/lib/capacitor';
import AuthTvPage from './auth-tv-page';
import AuthPage from './auth-page';

/**
 * Adaptive Auth component that switches layouts based on platform
 * - Native mobile apps (iOS/Android): TV-style login with Google Sign-In
 * - Web: Standard login page
 */
export default function AuthAdaptive() {
  // On native platforms, use the TV-style auth page
  if (isNativePlatform()) {
    return <AuthTvPage />;
  }

  // On web, use the standard auth page
  return <AuthPage />;
}
