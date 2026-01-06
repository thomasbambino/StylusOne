import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNativePlatform } from './capacitor';

/**
 * Haptic feedback utilities for native iOS/Android
 * Falls back to navigator.vibrate on web
 */

export const haptics = {
  /** Light tap - for selections, toggles */
  light: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch (e) {
        // Fallback
        if (navigator.vibrate) navigator.vibrate(10);
      }
    }
  },

  /** Medium tap - for button presses, confirmations */
  medium: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Medium });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate(25);
      }
    }
  },

  /** Heavy tap - for important actions, errors */
  heavy: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.impact({ style: ImpactStyle.Heavy });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate(50);
      }
    }
  },

  /** Success notification */
  success: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.notification({ type: NotificationType.Success });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate([10, 50, 10]);
      }
    }
  },

  /** Warning notification */
  warning: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.notification({ type: NotificationType.Warning });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate([25, 50, 25]);
      }
    }
  },

  /** Error notification */
  error: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.notification({ type: NotificationType.Error });
      } catch (e) {
        if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
      }
    }
  },

  /** Selection changed - subtle tick */
  selection: async () => {
    if (isNativePlatform()) {
      try {
        await Haptics.selectionChanged();
      } catch (e) {
        // No fallback for selection - too subtle
      }
    }
  }
};
