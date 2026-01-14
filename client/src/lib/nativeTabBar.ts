import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativePlatform } from './capacitor';
import { Capacitor } from '@capacitor/core';

export interface NativeTabBarPlugin {
  show(): Promise<{ visible: boolean }>;
  hide(): Promise<{ visible: boolean }>;
  setSelectedTab(options: { tabId: string }): Promise<void>;
  updateBadge(options: { tabId: string; value?: number }): Promise<void>;
  setTabs(options: { tabs: string[] }): Promise<{ tabs: string[] }>;
  addListener(
    eventName: 'tabSelected',
    listenerFunc: (event: { tabId: string }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeTabBar = registerPlugin<NativeTabBarPlugin>('NativeTabBar');

// Check if we're on iOS (native tab bar only works on iOS)
export const isIOSNative = (): boolean => {
  return isNativePlatform() && Capacitor.getPlatform() === 'ios';
};

// Wrapper functions with platform checks
export const showNativeTabBar = async (): Promise<boolean> => {
  if (!isIOSNative()) return false;
  try {
    const result = await NativeTabBar.show();
    return result.visible;
  } catch (e) {
    console.warn('[NativeTabBar] Failed to show:', e);
    return false;
  }
};

export const hideNativeTabBar = async (): Promise<boolean> => {
  if (!isIOSNative()) return false;
  try {
    const result = await NativeTabBar.hide();
    return !result.visible;
  } catch (e) {
    console.warn('[NativeTabBar] Failed to hide:', e);
    return false;
  }
};

export const setNativeTabBarSelected = async (tabId: string): Promise<void> => {
  if (!isIOSNative()) return;
  try {
    await NativeTabBar.setSelectedTab({ tabId });
  } catch (e) {
    console.warn('[NativeTabBar] Failed to set selected tab:', e);
  }
};

export const addNativeTabBarListener = async (
  callback: (tabId: string) => void
): Promise<PluginListenerHandle | null> => {
  if (!isIOSNative()) return null;
  try {
    return await NativeTabBar.addListener('tabSelected', (event) => {
      callback(event.tabId);
    });
  } catch (e) {
    console.warn('[NativeTabBar] Failed to add listener:', e);
    return null;
  }
};

export const setNativeTabBarTabs = async (tabs: string[]): Promise<boolean> => {
  if (!isIOSNative()) return false;
  try {
    await NativeTabBar.setTabs({ tabs });
    return true;
  } catch (e) {
    console.warn('[NativeTabBar] Failed to set tabs:', e);
    return false;
  }
};

export { NativeTabBar };
