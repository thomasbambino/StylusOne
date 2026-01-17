import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { loggers } from './logger';

export type DeviceType = 'phone' | 'tablet' | 'tv' | 'web';

/**
 * Check if the app is running on a native platform (iOS, Android)
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Detect the device type (phone, tablet, tv, web)
 */
let cachedDeviceType: DeviceType | null = null;

export async function getDeviceType(): Promise<DeviceType> {
  // Return cached value if available
  if (cachedDeviceType) {
    return cachedDeviceType;
  }

  // Web platform
  if (!isNativePlatform()) {
    cachedDeviceType = 'web';
    return 'web';
  }

  try {
    const info = await Device.getInfo();
    loggers.capacitor.debug('Device info', { info });

    // Check if running on Android TV
    if (info.platform === 'android') {
      // First check model/name for Android TV indicators
      const modelLower = (info.model || '').toLowerCase();
      const nameLower = (info.name || '').toLowerCase();
      const isAndroidTV = modelLower.includes('atv') ||
                          modelLower.includes('android tv') ||
                          modelLower.includes('fire tv') ||
                          modelLower.includes('shield') ||
                          nameLower.includes('atv') ||
                          nameLower.includes('android tv') ||
                          nameLower.includes('television');

      loggers.capacitor.debug('Android TV check', { model: info.model, name: info.name, isAndroidTV });

      if (isAndroidTV) {
        cachedDeviceType = 'tv';
        loggers.capacitor.info('Detected: TV (by model/name)');
        return 'tv';
      }

      // Fallback: Check screen size (CSS pixels * devicePixelRatio = physical pixels)
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;
      const devicePixelRatio = window.devicePixelRatio || 1;
      const physicalWidth = screenWidth * devicePixelRatio;
      const physicalHeight = screenHeight * devicePixelRatio;
      const largerPhysical = Math.max(physicalWidth, physicalHeight);

      loggers.capacitor.debug('Screen dimensions', { screenWidth, screenHeight, physicalWidth, physicalHeight, devicePixelRatio });

      // TV detection: physical resolution >= 1920 or large CSS pixels with low DPR
      const isTVByScreen = largerPhysical >= 1920 ||
                           (Math.max(screenWidth, screenHeight) >= 1280 && devicePixelRatio <= 1.5);

      loggers.capacitor.debug('TV detection by screen', { isTVByScreen });

      if (isTVByScreen) {
        cachedDeviceType = 'tv';
        loggers.capacitor.info('Detected: TV (by screen size)');
        return 'tv';
      }

      // Differentiate between phone and tablet based on screen size
      // Tablets typically have diagonal >= 7 inches
      // Using 600dp as the breakpoint (standard Android tablet breakpoint)
      const smallestWidth = Math.min(screenWidth, screenHeight);
      const isTablet = smallestWidth >= 600;

      cachedDeviceType = isTablet ? 'tablet' : 'phone';
      return cachedDeviceType;
    }

    // iOS devices
    if (info.platform === 'ios') {
      // iPads are tablets, iPhones are phones
      // We can check screen size or use iPad detection
      const isIPad = /iPad/.test(navigator.userAgent) ||
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      cachedDeviceType = isIPad ? 'tablet' : 'phone';
      return cachedDeviceType;
    }

    // Default to phone for unknown platforms
    cachedDeviceType = 'phone';
    return 'phone';
  } catch (error) {
    loggers.capacitor.error('Error detecting device type', { error });
    cachedDeviceType = 'phone';
    return 'phone';
  }
}

/**
 * Synchronous device type check (uses cached value or returns 'web')
 * Must call getDeviceType() first to populate cache
 */
export function getDeviceTypeSync(): DeviceType {
  return cachedDeviceType || 'web';
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
    loggers.capacitor.debug('Native platform detected', { apiUrl, envUrl: import.meta.env.VITE_API_URL });
    return apiUrl;
  }
  // For web, use relative URLs (handled by the server)
  loggers.capacitor.debug('Web platform detected, using relative URLs');
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
  loggers.capacitor.trace('Building API URL', { path, fullUrl });
  return fullUrl;
}
