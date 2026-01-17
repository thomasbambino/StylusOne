import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { isNativePlatform } from '@/lib/capacitor';
import { loggers } from '@/lib/logger';

// Types
interface ReminderData {
  channelId: string;
  channelName: string;
  programTitle: string;
  programStart: string;
}

interface ReminderContextType {
  reminders: Set<string>;
  hasReminder: (channelId: string, programStart: string) => boolean;
  setReminder: (data: ReminderData) => Promise<boolean>;
  cancelReminder: (channelId: string, programStart: string) => Promise<void>;
  pendingChannel: string | null;
  clearPendingChannel: () => void;
}

const ReminderContext = createContext<ReminderContextType | null>(null);

// Reminder service module - loaded dynamically
let reminderModule: typeof import('@/lib/reminders') | null = null;

async function loadReminderModule() {
  if (reminderModule) return reminderModule;
  if (!isNativePlatform()) return null;
  try {
    reminderModule = await import('@/lib/reminders');
    return reminderModule;
  } catch (e) {
    loggers.reminders.error('Failed to load reminder module', { error: e });
    return null;
  }
}

export function ReminderProvider({ children }: { children: ReactNode }) {
  const [reminders, setReminders] = useState<Set<string>>(new Set());
  const [pendingChannel, setPendingChannel] = useState<string | null>(null);

  // Initialize reminders on mount
  useEffect(() => {
    if (!isNativePlatform()) return;

    const initReminders = async () => {
      try {
        const module = await loadReminderModule();
        if (!module) return;

        // Initialize notification listeners
        await module.reminderService.initializeListeners();

        // Load existing reminders
        const existingReminders = await module.reminderService.getReminders();
        const reminderIds = new Set(existingReminders.map(r => r.id));
        setReminders(reminderIds);
        loggers.reminders.info('Loaded reminders', { count: reminderIds.size });

        // Cleanup expired reminders
        await module.reminderService.cleanupExpiredReminders();
      } catch (error) {
        loggers.reminders.error('Error initializing reminders', { error });
      }
    };

    initReminders();
  }, []);

  // Check for pending channel periodically and on visibility change
  useEffect(() => {
    if (!isNativePlatform()) return;

    const checkPendingChannel = async () => {
      try {
        const module = await loadReminderModule();
        if (!module) return;
        const channelId = module.getPendingChannel();
        if (channelId) {
          loggers.reminders.info('Found pending channel', { channelId });
          setPendingChannel(channelId);
        }
      } catch (error) {
        loggers.reminders.error('Error checking pending channel', { error });
      }
    };

    // Check immediately
    checkPendingChannel();

    // Check on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPendingChannel();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const hasReminder = useCallback((channelId: string, programStart: string): boolean => {
    const reminderId = `${channelId}-${programStart}`;
    return reminders.has(reminderId);
  }, [reminders]);

  const setReminderFn = useCallback(async (data: ReminderData): Promise<boolean> => {
    loggers.reminders.debug('setReminderFn called', { programTitle: data.programTitle });
    try {
      loggers.reminders.debug('Loading reminder module');
      const module = await loadReminderModule();
      loggers.reminders.debug('Module loaded', { loaded: !!module });
      if (!module) {
        loggers.reminders.debug('No module available');
        return false;
      }

      loggers.reminders.debug('Calling reminderService.setReminder');
      const success = await module.reminderService.setReminder(data);
      loggers.reminders.debug('setReminder returned', { success });
      if (success) {
        const reminderId = `${data.channelId}-${data.programStart}`;
        setReminders(prev => new Set([...prev, reminderId]));
        loggers.reminders.info('Reminder set', { reminderId });
      }
      return success;
    } catch (error) {
      loggers.reminders.error('Error setting reminder', { error });
      return false;
    }
  }, []);

  const cancelReminderFn = useCallback(async (channelId: string, programStart: string): Promise<void> => {
    try {
      const module = await loadReminderModule();
      if (!module) return;

      await module.reminderService.cancelReminder(channelId, programStart);
      const reminderId = `${channelId}-${programStart}`;
      setReminders(prev => {
        const newSet = new Set(prev);
        newSet.delete(reminderId);
        return newSet;
      });
      loggers.reminders.info('Reminder cancelled', { reminderId });
    } catch (error) {
      loggers.reminders.error('Error cancelling reminder', { error });
    }
  }, []);

  const clearPendingChannel = useCallback(() => {
    setPendingChannel(null);
  }, []);

  return (
    <ReminderContext.Provider
      value={{
        reminders,
        hasReminder,
        setReminder: setReminderFn,
        cancelReminder: cancelReminderFn,
        pendingChannel,
        clearPendingChannel
      }}
    >
      {children}
    </ReminderContext.Provider>
  );
}

export function useReminders() {
  const context = useContext(ReminderContext);
  if (!context) {
    // Return a no-op context for non-native platforms or when provider is missing
    return {
      reminders: new Set<string>(),
      hasReminder: () => false,
      setReminder: async () => false,
      cancelReminder: async () => {},
      pendingChannel: null,
      clearPendingChannel: () => {}
    };
  }
  return context;
}
