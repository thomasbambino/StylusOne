import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/**
 * Haptic feedback utilities for native iOS/Android
 * Uses Capacitor.isNativePlatform() directly for reliability
 */

const triggerHaptic = async (action: () => Promise<void>) => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await action();
  } catch (e) {
    console.warn('[Haptics] Failed:', e);
  }
};

export const haptics = {
  /** Light tap - for selections, toggles */
  light: () => triggerHaptic(() => Haptics.impact({ style: ImpactStyle.Light })),

  /** Medium tap - for button presses, confirmations */
  medium: () => triggerHaptic(() => Haptics.impact({ style: ImpactStyle.Medium })),

  /** Heavy tap - for important actions, errors */
  heavy: () => triggerHaptic(() => Haptics.impact({ style: ImpactStyle.Heavy })),

  /** Success notification */
  success: () => triggerHaptic(() => Haptics.notification({ type: NotificationType.Success })),

  /** Warning notification */
  warning: () => triggerHaptic(() => Haptics.notification({ type: NotificationType.Warning })),

  /** Error notification */
  error: () => triggerHaptic(() => Haptics.notification({ type: NotificationType.Error })),

  /** Selection changed - subtle tick */
  selection: () => triggerHaptic(() => Haptics.selectionChanged()),
};
