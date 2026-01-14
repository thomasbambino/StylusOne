import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { isNativePlatform } from './capacitor';

const STORAGE_KEY = 'program_reminders';

export interface ProgramReminder {
  id: string;                    // Unique ID: `${channelId}-${startTime}`
  channelId: string;             // Channel to play when notification tapped
  channelName: string;           // For display
  programTitle: string;          // Program name
  programStart: string;          // ISO timestamp
  notificationIds: number[];     // IDs of scheduled notifications (15min, 1min)
}

// Global store for pending channel to play (set when notification is tapped)
let pendingChannelToPlay: string | null = null;

/**
 * Get the pending channel to play (set by notification tap)
 */
export function getPendingChannel(): string | null {
  const channel = pendingChannelToPlay;
  pendingChannelToPlay = null; // Clear after reading
  return channel;
}

/**
 * Set a pending channel to play (called from notification listener)
 */
export function setPendingChannel(channelId: string): void {
  pendingChannelToPlay = channelId;
}

/**
 * Generate a unique notification ID from reminder ID and offset
 */
function generateNotificationId(reminderId: string, offset: number): number {
  // Create a hash from the string and offset
  let hash = 0;
  const str = `${reminderId}-${offset}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Get LocalNotifications - use static import
 */
function getLocalNotifications() {
  console.log('[Reminders] Getting LocalNotifications (static import)');
  return LocalNotifications;
}

export const reminderService = {
  /**
   * Check if notifications are available
   */
  async isAvailable(): Promise<boolean> {
    if (!isNativePlatform()) return false;
    const LocalNotifications = getLocalNotifications();
    return LocalNotifications !== null;
  },

  /**
   * Request notification permissions with timeout
   */
  async requestPermissions(): Promise<boolean> {
    console.log('[Reminders] requestPermissions called');
    if (!isNativePlatform()) {
      console.log('[Reminders] Not on native platform, skipping permission request');
      return false;
    }

    try {
      console.log('[Reminders] Getting LocalNotifications for permission check...');
      const LocalNotifications = getLocalNotifications();
      if (!LocalNotifications) {
        console.log('[Reminders] LocalNotifications not available for permission check');
        return false;
      }

      // Add timeout wrapper for permission calls
      const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, name: string): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
      };

      console.log('[Reminders] Checking current permissions...');
      let status;
      try {
        status = await withTimeout(LocalNotifications.checkPermissions(), 5000, 'checkPermissions');
        console.log('[Reminders] Current permission status:', status.display);
      } catch (timeoutError) {
        console.error('[Reminders] checkPermissions timed out, trying requestPermissions directly');
        // If checkPermissions times out, try requesting directly
        try {
          const result = await withTimeout(LocalNotifications.requestPermissions(), 10000, 'requestPermissions');
          console.log('[Reminders] Direct request result:', result.display);
          return result.display === 'granted';
        } catch (reqError) {
          console.error('[Reminders] requestPermissions also failed:', reqError);
          return false;
        }
      }

      if (status.display === 'granted') {
        console.log('[Reminders] Permissions already granted');
        return true;
      }

      if (status.display === 'denied') {
        console.log('[Reminders] Permissions denied, cannot request');
        return false;
      }

      // Request permissions
      console.log('[Reminders] Requesting permissions...');
      const result = await withTimeout(LocalNotifications.requestPermissions(), 10000, 'requestPermissions');
      console.log('[Reminders] Permission request result:', result.display);
      return result.display === 'granted';
    } catch (error) {
      console.error('[Reminders] Error requesting permissions:', error);
      return false;
    }
  },

  /**
   * Check if permission is granted
   */
  async hasPermission(): Promise<boolean> {
    if (!isNativePlatform()) return false;

    try {
      const LocalNotifications = getLocalNotifications();
      if (!LocalNotifications) return false;

      const status = await LocalNotifications.checkPermissions();
      return status.display === 'granted';
    } catch {
      return false;
    }
  },

  /**
   * Get all stored reminders
   */
  async getReminders(): Promise<ProgramReminder[]> {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (!value) return [];
      return JSON.parse(value) as ProgramReminder[];
    } catch (error) {
      console.error('[Reminders] Error reading reminders:', error);
      return [];
    }
  },

  /**
   * Save reminders to storage
   */
  async saveReminders(reminders: ProgramReminder[]): Promise<void> {
    try {
      await Preferences.set({
        key: STORAGE_KEY,
        value: JSON.stringify(reminders)
      });
    } catch (error) {
      console.error('[Reminders] Error saving reminders:', error);
    }
  },

  /**
   * Check if a reminder exists for a specific program
   */
  async hasReminder(channelId: string, programStart: string): Promise<boolean> {
    const reminders = await this.getReminders();
    const id = `${channelId}-${programStart}`;
    return reminders.some(r => r.id === id);
  },

  /**
   * Set a reminder for a program
   */
  async setReminder(data: {
    channelId: string;
    channelName: string;
    programTitle: string;
    programStart: string;
  }): Promise<boolean> {
    console.log('[Reminders] setReminder called for:', data.programTitle);

    if (!isNativePlatform()) {
      console.log('[Reminders] Not on native platform');
      return false;
    }
    console.log('[Reminders] Is native platform, using LocalNotifications...');

    // First check current permission status
    console.log('[Reminders] Checking current permission status...');
    try {
      const checkResult = await LocalNotifications.checkPermissions();
      console.log('[Reminders] Current status:', checkResult.display);

      if (checkResult.display === 'granted') {
        console.log('[Reminders] Already have permission, proceeding...');
      } else if (checkResult.display === 'denied') {
        console.log('[Reminders] Permission denied, cannot proceed');
        return false;
      } else {
        // Need to request permissions
        console.log('[Reminders] Requesting permissions...');
        const permResult = await LocalNotifications.requestPermissions();
        console.log('[Reminders] Permission result:', permResult.display);

        if (permResult.display !== 'granted') {
          console.log('[Reminders] Permissions not granted');
          return false;
        }
      }
    } catch (error) {
      console.error('[Reminders] Permission check/request failed:', error);
      return false;
    }

    const reminderId = `${data.channelId}-${data.programStart}`;
    const programTime = new Date(data.programStart).getTime();
    const now = Date.now();

    const notificationIds: number[] = [];
    const notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
      extra: { channelId: string; reminderId: string };
    }> = [];

    // Schedule 15-minute reminder
    const fifteenMinBefore = programTime - 15 * 60 * 1000;
    if (fifteenMinBefore > now) {
      const id15 = generateNotificationId(reminderId, 15);
      notificationIds.push(id15);
      notifications.push({
        id: id15,
        title: data.programTitle,
        body: `Starting in 15 minutes on ${data.channelName}`,
        schedule: { at: new Date(fifteenMinBefore) },
        extra: {
          channelId: data.channelId,
          reminderId: reminderId
        }
      });
    }

    // Schedule 1-minute reminder
    const oneMinBefore = programTime - 1 * 60 * 1000;
    if (oneMinBefore > now) {
      const id1 = generateNotificationId(reminderId, 1);
      notificationIds.push(id1);
      notifications.push({
        id: id1,
        title: data.programTitle,
        body: `Starting now on ${data.channelName}!`,
        schedule: { at: new Date(oneMinBefore) },
        extra: {
          channelId: data.channelId,
          reminderId: reminderId
        }
      });
    }

    if (notifications.length === 0) {
      console.log('[Reminders] Program starts too soon, no reminders scheduled');
      return false;
    }

    try {
      // Schedule the notifications
      await LocalNotifications.schedule({ notifications });
      console.log('[Reminders] Scheduled notifications:', notifications.length);

      // Save to storage
      const reminders = await this.getReminders();
      const newReminder: ProgramReminder = {
        id: reminderId,
        channelId: data.channelId,
        channelName: data.channelName,
        programTitle: data.programTitle,
        programStart: data.programStart,
        notificationIds
      };

      // Remove any existing reminder for this program
      const filtered = reminders.filter(r => r.id !== reminderId);
      filtered.push(newReminder);
      await this.saveReminders(filtered);

      console.log('[Reminders] Reminder saved:', reminderId);
      return true;
    } catch (error) {
      console.error('[Reminders] Error scheduling notifications:', error);
      return false;
    }
  },

  /**
   * Cancel a reminder for a program
   */
  async cancelReminder(channelId: string, programStart: string): Promise<void> {
    const reminderId = `${channelId}-${programStart}`;
    const reminders = await this.getReminders();
    const reminder = reminders.find(r => r.id === reminderId);

    if (reminder && reminder.notificationIds.length > 0) {
      try {
        const LocalNotifications = getLocalNotifications();
        if (LocalNotifications) {
          await LocalNotifications.cancel({
            notifications: reminder.notificationIds.map(id => ({ id }))
          });
          console.log('[Reminders] Cancelled notifications for:', reminderId);
        }
      } catch (error) {
        console.error('[Reminders] Error cancelling notifications:', error);
      }
    }

    // Remove from storage
    const filtered = reminders.filter(r => r.id !== reminderId);
    await this.saveReminders(filtered);
    console.log('[Reminders] Reminder removed:', reminderId);
  },

  /**
   * Clean up expired reminders (call on app start)
   */
  async cleanupExpiredReminders(): Promise<void> {
    try {
      const reminders = await this.getReminders();
      const now = Date.now();

      const activeReminders = reminders.filter(r => {
        const programTime = new Date(r.programStart).getTime();
        return programTime > now;
      });

      if (activeReminders.length !== reminders.length) {
        console.log('[Reminders] Cleaning up expired reminders:',
          reminders.length - activeReminders.length, 'removed');
        await this.saveReminders(activeReminders);
      }
    } catch (error) {
      console.error('[Reminders] Error cleaning up reminders:', error);
    }
  },

  /**
   * Handle notification tap - returns channelId to play
   */
  getChannelFromNotification(notificationExtra: Record<string, unknown>): string | null {
    if (notificationExtra && typeof notificationExtra.channelId === 'string') {
      return notificationExtra.channelId;
    }
    return null;
  },

  /**
   * Initialize notification listeners
   * Call this once on app startup
   */
  async initializeListeners(): Promise<void> {
    if (!isNativePlatform()) return;

    try {
      const LocalNotifications = getLocalNotifications();
      if (!LocalNotifications) {
        console.log('[Reminders] LocalNotifications not available, skipping listener setup');
        return;
      }

      // Listen for notification taps
      await LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
        console.log('[Reminders] Notification tapped:', notification);

        const extra = notification.notification.extra as Record<string, unknown> | undefined;
        if (extra) {
          const channelId = this.getChannelFromNotification(extra);
          if (channelId) {
            console.log('[Reminders] Setting pending channel:', channelId);
            setPendingChannel(channelId);
          }
        }
      });

      console.log('[Reminders] Notification listeners initialized');
    } catch (error) {
      console.error('[Reminders] Error initializing listeners:', error);
    }
  }
};
