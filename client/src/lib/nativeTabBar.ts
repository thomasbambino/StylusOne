import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isNativePlatform } from './capacitor';
import { Capacitor } from '@capacitor/core';
import { loggers } from './logger';

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
    loggers.nativeTabBar.warn('Failed to show', { error: e });
    return false;
  }
};

export const hideNativeTabBar = async (): Promise<boolean> => {
  if (!isIOSNative()) return false;
  try {
    const result = await NativeTabBar.hide();
    return !result.visible;
  } catch (e) {
    loggers.nativeTabBar.warn('Failed to hide', { error: e });
    return false;
  }
};

export const setNativeTabBarSelected = async (tabId: string): Promise<void> => {
  if (!isIOSNative()) return;
  try {
    await NativeTabBar.setSelectedTab({ tabId });
  } catch (e) {
    loggers.nativeTabBar.warn('Failed to set selected tab', { error: e });
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
    loggers.nativeTabBar.warn('Failed to add listener', { error: e });
    return null;
  }
};

export const setNativeTabBarTabs = async (tabs: string[]): Promise<boolean> => {
  if (!isIOSNative()) return false;
  try {
    await NativeTabBar.setTabs({ tabs });
    return true;
  } catch (e) {
    loggers.nativeTabBar.warn('Failed to set tabs', { error: e });
    return false;
  }
};

export { NativeTabBar };
