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
    return import.meta.env.VITE_API_URL || 'https://stylus.services';
  }
  // For web, use relative URLs (handled by the server)
  return '';
}

/**
 * Build a full API URL
 */
export function buildApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
