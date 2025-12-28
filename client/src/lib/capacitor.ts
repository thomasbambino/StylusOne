import { Capacitor } from '@capacitor/core';

/**
 * Check if the app is running on a native platform (iOS, Android)
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get the platform name (web, ios, android)
 */
export function getPlatform(): string {
  return Capacitor.getPlatform();
}

/**
 * Get the API base URL based on the platform
 * In native apps, we need to use the full server URL
 * In web, we can use relative URLs
 */
export function getApiBaseUrl(): string {
  if (isNativePlatform()) {
    // Use environment variable or fallback to production URL
    const apiUrl = import.meta.env.VITE_API_URL || 'https://stylus.services';
    console.log('[Capacitor] Native platform detected, using API URL:', apiUrl);
    console.log('[Capacitor] Environment VITE_API_URL:', import.meta.env.VITE_API_URL);
    return apiUrl;
  }
  // For web, use relative URLs (handled by the server)
  console.log('[Capacitor] Web platform detected, using relative URLs');
  return '';
}

/**
 * Build a full API URL
 */
export function buildApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${baseUrl}${normalizedPath}`;
  console.log('[Capacitor] Building API URL:', path, '->', fullUrl);
  return fullUrl;
}
