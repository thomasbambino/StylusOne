import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Play, Pause, Volume2, VolumeX, Info, Plus, MoreHorizontal, Star, X, Check, CreditCard, Calendar, ExternalLink, LogOut, LayoutGrid, Airplay, Search, Volume1, Minus, Settings, PictureInPicture2, Filter, Package, Tv, Clock, Zap, Radio, TrendingUp, Users, Bell, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getQueryFn, apiRequest, queryClient } from '@/lib/queryClient';
import { buildApiUrl, isNativePlatform, getDeviceTypeSync, getPlatform } from '@/lib/capacitor';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/hooks/use-auth';
import Hls from 'hls.js';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import { isIOSNative, showNativeTabBar, hideNativeTabBar, addNativeTabBarListener, setNativeTabBarSelected, setNativeTabBarTabs } from '@/lib/nativeTabBar';
import { useFeatureAccess } from '@/lib/feature-gate';
import { getCachedEPG, cacheEPG, cleanupExpiredCache, prefetchEPG, clearAllCache } from '@/lib/epgCache';
import { useReminders } from '@/contexts/ReminderContext';
import { useToast } from '@/hooks/use-toast';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface Channel {
  GuideName: string;
  GuideNumber: string;
  URL: string;
  source: 'hdhomerun' | 'iptv' | 'static';
  iptvId?: string;
  epgId?: string;
  logo?: string;
  categoryId?: string;
  categoryName?: string;
}

interface EPGProgram {
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
  episodeTitle?: string;
  season?: number;
  episode?: number;
  rating?: string;
  thumbnail?: string;
}

interface ChannelEPG {
  currentProgram: EPGProgram | null;
  nextProgram: EPGProgram | null;
  programs: EPGProgram[]; // All programs for time-shifting
}

type EventCategory = 'nfl' | 'nba' | 'mlb' | 'nhl' | 'soccer' | 'basketball' | 'wrestling' | 'winter' | 'motorsports' | 'tennis' | 'golf' | 'other';

interface ParsedEvent {
  channelId: number;
  streamId: string;
  channelName: string;
  network: string;
  networkNumber: string;
  league: string | null;
  eventName: string;
  category: EventCategory;
  startTime: string;
  endTime?: string;
  teams?: { home: string; away: string };
  streamUrl: string;
  logo?: string;
  providerId: number;
  progress?: number;
  timeRemaining?: string;
  isLive?: boolean;
  espnGameId?: string;
  espnRecapUrl?: string;
  score?: { home: number; away: number };
  finalScore?: { home: number; away: number };
}

interface EventsResponse {
  live: ParsedEvent[];
  upcoming: ParsedEvent[];
  past: ParsedEvent[];
  categories: string[];
}

interface Category {
  category_id: string;
  category_name: string;
}

interface CurrentSubscription {
  id: number;
  plan_id: number;
  status: string;
  billing_period: 'monthly' | 'annual';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  plan_name: string;
  price_monthly: number;
  price_annual: number;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const formatTimeRange = (start: string, end: string): string => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${formatTime(startDate)} - ${formatTime(endDate)}`;
};

const getTimeRemaining = (endTime: string | Date | undefined): string | null => {
  if (!endTime) return null;
  const end = endTime instanceof Date ? endTime.getTime() : new Date(endTime).getTime();
  if (isNaN(end)) return null;
  const now = Date.now();
  const remaining = Math.floor((end - now) / 60000);
  if (remaining <= 0) return null;
  if (remaining < 60) return `${remaining} min`;
  const hours = Math.floor(remaining / 60);
  const mins = remaining % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const getProgramProgress = (program: EPGProgram): number => {
  const now = new Date().getTime();
  const start = new Date(program.startTime).getTime();
  const end = new Date(program.endTime).getTime();
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
};

const decodeBase64 = (str: string | undefined): string => {
  if (!str) return '';
  try {
    // Decode base64 and handle UTF-8 characters properly
    const decoded = atob(str);
    // Convert to UTF-8
    return decodeURIComponent(
      decoded.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch {
    // If decoding fails, return original string (might not be base64 encoded)
    return str;
  }
};

// Update MediaSession for Control Center / Lock Screen metadata
const updateMediaSession = (channel: Channel | null, program: EPGProgram | null) => {
  if (!('mediaSession' in navigator)) return;

  try {
    const title = program?.title || channel?.GuideName || 'Live TV';
    const artist = channel?.GuideName || '';
    const album = program?.episodeTitle || '';

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork: channel?.logo ? [
        { src: channel.logo, sizes: '512x512', type: 'image/png' }
      ] : []
    });

    // Set playback state
    navigator.mediaSession.playbackState = 'playing';
  } catch (e) {
    console.log('[MediaSession] Error updating metadata:', e);
  }
};

// ============================================================================
// COMPONENTS
// ============================================================================

// Program Progress Bar
const ProgressBar = memo(({ progress, showLive = false }: { progress: number; showLive?: boolean }) => (
  <div className="relative">
    <div className="h-1 bg-white/20 rounded-full overflow-hidden">
      <div
        className="h-full bg-red-600 transition-all duration-1000"
        style={{ width: `${progress}%` }}
      />
    </div>
    {showLive && (
      <span className="absolute -top-6 left-0 text-red-500 text-sm font-bold tracking-wider">LIVE</span>
    )}
  </div>
));
ProgressBar.displayName = 'ProgressBar';

// Playback Controls
const PlaybackControls = memo(({
  isPlaying,
  isMuted,
  onPlayPause,
  onMute
}: {
  isPlaying: boolean;
  isMuted: boolean;
  onPlayPause: () => void;
  onMute: () => void;
}) => (
  <div className="flex items-center gap-8">
    <button
      onClick={onPlayPause}
      className="w-16 h-16 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
    >
      {isPlaying ? (
        <Pause className="w-8 h-8 text-black" />
      ) : (
        <Play className="w-8 h-8 text-black ml-1" />
      )}
    </button>
  </div>
));
PlaybackControls.displayName = 'PlaybackControls';

// Action Buttons (Favorites, Info, More) - PiP/AirPlay now in top right corner
const ActionButtons = memo(({
  onShowFavorites,
  onShowInfo,
  onShowMenu
}: {
  onShowFavorites: () => void;
  onShowInfo: () => void;
  onShowMenu: () => void;
}) => (
  <div className="flex items-center gap-6">
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors focus:outline-none"
      onClick={onShowFavorites}
    >
      <Star className="w-7 h-7 text-white/70 fill-white/70" />
    </button>
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors focus:outline-none"
      onClick={onShowInfo}
    >
      <Info className="w-7 h-7 text-white/80" />
    </button>
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors focus:outline-none"
      onClick={onShowMenu}
    >
      <MoreHorizontal className="w-7 h-7 text-white/80" />
    </button>
  </div>
));
ActionButtons.displayName = 'ActionButtons';

// Program Info Modal
const InfoModal = memo(({
  program,
  channel,
  onClose,
  hasReminder,
  onSetReminder,
  onCancelReminder
}: {
  program: EPGProgram | null;
  channel: Channel | null;
  onClose: () => void;
  hasReminder?: boolean;
  onSetReminder?: () => void;
  onCancelReminder?: () => void;
}) => {
  // Check if program is in the future (can set reminder)
  const isFutureProgram = program && new Date(program.startTime) > new Date();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
      onTouchEnd={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-xl p-8 max-w-2xl w-full mx-8"
        onClick={e => e.stopPropagation()}
        onTouchEnd={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">
              {program?.title || channel?.GuideName || 'No Program Info'}
            </h2>
            {program && (
              <div className="text-white/60 text-lg">
                {formatTimeRange(program.startTime, program.endTime)}
                {program.episodeTitle && ` • ${program.episodeTitle}`}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            className="p-2 hover:bg-white/10 active:bg-white/20 rounded-full"
          >
            <X className="w-6 h-6 text-white/60" />
          </button>
        </div>

        {program?.description ? (
          <p className="text-white/80 text-lg leading-relaxed">{program.description}</p>
        ) : (
          <p className="text-white/50 text-lg">No description available for this program.</p>
        )}

        {/* Reminder Button - only show for future programs on native platforms */}
        {isFutureProgram && isNativePlatform() && onSetReminder && onCancelReminder && (
          <div className="mt-6">
            {hasReminder ? (
              <button
                onClick={(e) => { e.stopPropagation(); onCancelReminder(); }}
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onCancelReminder(); }}
                className="flex items-center gap-2 px-4 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 rounded-lg text-white font-medium transition-colors"
              >
                <BellOff className="w-5 h-5" />
                Cancel Reminder
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onSetReminder(); }}
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onSetReminder(); }}
                className="flex items-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg text-white font-medium transition-colors"
              >
                <Bell className="w-5 h-5" />
                Remind Me
              </button>
            )}
          </div>
        )}

        {channel && (
          <div className="mt-6 pt-6 border-t border-white/10 flex items-center gap-3">
            {channel.logo && (
              <img src={channel.logo} alt="" className="h-8 w-auto object-contain" />
            )}
            <span className="text-white/70">{channel.GuideName}</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
});
InfoModal.displayName = 'InfoModal';

// Menu Popup
const MenuPopup = memo(({
  onShowSubscription,
  onLogout,
  onClose
}: {
  onShowSubscription: () => void;
  onLogout: () => void;
  onClose: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="absolute inset-0 z-50"
    onClick={onClose}
    onTouchEnd={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
  >
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-20 right-12 bg-zinc-800 rounded-lg shadow-xl overflow-hidden min-w-[200px]"
      onClick={e => e.stopPropagation()}
      onTouchEnd={e => e.stopPropagation()}
    >
      <button
        className="w-full px-6 py-4 text-left text-white hover:bg-white/10 active:bg-white/20 flex items-center gap-3 border-b border-white/10"
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onShowSubscription(); onClose(); }}
        onClick={() => { onShowSubscription(); onClose(); }}
      >
        <CreditCard className="w-5 h-5 text-white" />
        <span className="text-lg">My Subscription</span>
      </button>
      <button
        className="w-full px-6 py-4 text-left text-white hover:bg-white/10 active:bg-white/20 flex items-center gap-3"
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onLogout(); onClose(); }}
        onClick={() => { onLogout(); onClose(); }}
      >
        <LogOut className="w-5 h-5 text-white" />
        <span className="text-lg">Log Out</span>
      </button>
    </motion.div>
  </motion.div>
));
MenuPopup.displayName = 'MenuPopup';

// Favorites Popup
const FavoritesPopup = memo(({
  favorites,
  channels,
  onSelectChannel,
  onClose,
  onReorder
}: {
  favorites: any[];
  channels: Channel[];
  onSelectChannel: (channel: Channel) => void;
  onClose: () => void;
  onReorder?: (newOrder: string[]) => void;
}) => {
  // Track touch for scroll detection
  const touchStartY = useRef<number | null>(null);
  const [isReorderMode, setIsReorderMode] = useState(false);

  // Get saved order from localStorage
  const savedOrder = useMemo(() => {
    try {
      const order = localStorage.getItem('favoriteOrder');
      return order ? JSON.parse(order) : [];
    } catch {
      return [];
    }
  }, []);

  // Map favorites to full channel objects with custom order
  const favoriteChannels = useMemo(() => {
    const mapped = favorites.map(fav => {
      const channel = channels.find(ch => ch.iptvId === fav.channelId);
      return channel || {
        GuideName: fav.channelName,
        GuideNumber: '',
        URL: '',
        source: 'iptv' as const,
        iptvId: fav.channelId,
        logo: fav.channelLogo
      };
    }).filter(Boolean);

    // Sort by saved order if available
    if (savedOrder.length > 0) {
      return mapped.sort((a, b) => {
        const aIdx = savedOrder.indexOf(a.iptvId);
        const bIdx = savedOrder.indexOf(b.iptvId);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      });
    }

    return mapped;
  }, [favorites, channels, savedOrder]);

  // Move favorite up or down
  const moveItem = (index: number, direction: 'up' | 'down') => {
    const newOrder = favoriteChannels.map(c => c.iptvId);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= newOrder.length) return;

    // Swap
    [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];

    // Save to localStorage
    try {
      localStorage.setItem('favoriteOrder', JSON.stringify(newOrder));
    } catch (e) {
      console.warn('[TV] Failed to save favorite order:', e);
    }

    // Trigger re-render
    if (onReorder) onReorder(newOrder);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
      onTouchEnd={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-xl p-6 max-w-lg w-full mx-8 max-h-[70vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        onTouchEnd={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star className="w-6 h-6 text-white fill-white" />
            Favorites
          </h2>
          <div className="flex items-center gap-2">
            {favoriteChannels.length > 1 && (
              <button
                onClick={() => setIsReorderMode(!isReorderMode)}
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setIsReorderMode(!isReorderMode); }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-sm transition-colors",
                  isReorderMode ? "bg-white text-black" : "bg-white/10 text-white/70 hover:bg-white/20"
                )}
              >
                {isReorderMode ? 'Done' : 'Reorder'}
              </button>
            )}
            <button
              onClick={onClose}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
              className="p-2 hover:bg-white/10 active:bg-white/20 rounded-full"
            >
              <X className="w-6 h-6 text-white/60" />
            </button>
          </div>
        </div>

        {favoriteChannels.length === 0 ? (
          <p className="text-white/50 text-center py-8">No favorite channels yet. Press ★ on a channel to add it.</p>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-2">
            {favoriteChannels.map((channel, index) => (
              <div
                key={channel.iptvId}
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-white/10 active:bg-white/20 rounded-lg transition-colors"
              >
                {/* Reorder buttons */}
                {isReorderMode && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); moveItem(index, 'up'); }}
                      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); moveItem(index, 'up'); }}
                      disabled={index === 0}
                      className={cn(
                        "p-1 rounded",
                        index === 0 ? "opacity-30" : "hover:bg-white/20 active:bg-white/30"
                      )}
                    >
                      <ChevronUp className="w-4 h-4 text-white" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); moveItem(index, 'down'); }}
                      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); moveItem(index, 'down'); }}
                      disabled={index === favoriteChannels.length - 1}
                      className={cn(
                        "p-1 rounded",
                        index === favoriteChannels.length - 1 ? "opacity-30" : "hover:bg-white/20 active:bg-white/30"
                      )}
                    >
                      <ChevronDown className="w-4 h-4 text-white" />
                    </button>
                  </div>
                )}

                {/* Channel button */}
                <button
                  className="flex-1 flex items-center gap-4"
                  onTouchStart={(e) => {
                    if (!isReorderMode) touchStartY.current = e.touches[0].clientY;
                  }}
                  onTouchEnd={(e) => {
                    if (isReorderMode) return;
                    e.stopPropagation();
                    // Only select if it was a tap, not a scroll
                    if (touchStartY.current !== null) {
                      const distance = Math.abs(e.changedTouches[0].clientY - touchStartY.current);
                      if (distance < 10) {
                        e.preventDefault();
                        if (channel.URL) {
                          onSelectChannel(channel);
                        }
                        onClose();
                      }
                    }
                    touchStartY.current = null;
                  }}
                  onClick={() => {
                    if (isReorderMode) return;
                    if (channel.URL) {
                      onSelectChannel(channel);
                    }
                    onClose();
                  }}
                >
                  {channel.logo ? (
                    <img src={channel.logo} alt="" className="w-12 h-9 object-contain shrink-0" />
                  ) : (
                    <div className="w-12 h-9 bg-white/10 rounded flex items-center justify-center shrink-0">
                      <Star className="w-5 h-5 text-white/30" />
                    </div>
                  )}
                  <span className="text-white text-lg">{channel.GuideName}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
});
FavoritesPopup.displayName = 'FavoritesPopup';

// Subscription Popup
const SubscriptionPopup = memo(({
  subscription,
  isLoading,
  onClose
}: {
  subscription: CurrentSubscription | null;
  isLoading: boolean;
  onClose: () => void;
}) => {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getDaysRemaining = (endDate: string) => {
    const end = new Date(endDate).getTime();
    const now = new Date().getTime();
    const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    return days;
  };

  const openWebsite = () => {
    // Open the subscription page on the website
    window.open('https://stylus.services/my-subscription', '_blank');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
      onTouchEnd={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-xl p-4 max-w-sm w-full mx-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        onTouchEnd={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-white" />
            My Subscription
          </h2>
          <button
            onClick={onClose}
            onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            className="p-1.5 hover:bg-white/10 active:bg-white/20 rounded-full"
          >
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
            <p className="text-white/50 mt-4">Loading subscription...</p>
          </div>
        ) : subscription ? (
          <div className="space-y-3">
            {/* Plan Name & Status */}
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-white">{subscription.plan_name}</h3>
                <p className="text-white/60 text-xs capitalize">{subscription.billing_period} billing</p>
              </div>
              <span className={cn(
                "px-3 py-1 rounded-full text-sm font-medium",
                subscription.status === 'active' ? "bg-green-500/20 text-green-400" :
                subscription.status === 'canceled' ? "bg-red-500/20 text-red-400" :
                "bg-yellow-500/20 text-yellow-400"
              )}>
                {subscription.status === 'active' ? 'Active' :
                 subscription.status === 'canceled' ? 'Canceled' : subscription.status}
              </span>
            </div>

            {/* Price */}
            <div className="bg-white/5 rounded-lg p-3">
              <div className="text-2xl font-bold text-white">
                {formatPrice(subscription.billing_period === 'monthly'
                  ? subscription.price_monthly
                  : subscription.price_annual)}
                <span className="text-sm font-normal text-white/60">
                  /{subscription.billing_period === 'monthly' ? 'mo' : 'yr'}
                </span>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2 text-white/80">
                <Calendar className="w-4 h-4 text-white/50 shrink-0" />
                <div>
                  <p className="text-xs text-white/50">Started</p>
                  <p className="text-xs">{formatDate(subscription.current_period_start)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-white/80">
                <Calendar className="w-4 h-4 text-white/50 shrink-0" />
                <div>
                  <p className="text-xs text-white/50">
                    {subscription.cancel_at_period_end ? 'Expires' : 'Renews'}
                  </p>
                  <p className="text-xs">
                    {formatDate(subscription.current_period_end)}
                  </p>
                </div>
              </div>
            </div>

            {subscription.cancel_at_period_end && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
                <p className="text-yellow-400 text-sm">
                  Your subscription will end on {formatDate(subscription.current_period_end)}.
                </p>
              </div>
            )}

            {/* Manage Link */}
            <button
              onClick={openWebsite}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); openWebsite(); }}
              className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-lg text-white flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink className="w-5 h-5" />
              Manage on Website
            </button>
            <p className="text-white/40 text-xs text-center">
              Update payment method, download invoices, and more
            </p>
          </div>
        ) : (
          <div className="py-8 text-center">
            <CreditCard className="w-12 h-12 text-white/30 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Active Subscription</h3>
            <p className="text-white/50 mb-6">Subscribe to access premium features</p>
            <button
              onClick={openWebsite}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 rounded-lg text-white flex items-center justify-center gap-2 mx-auto transition-colors"
            >
              <ExternalLink className="w-5 h-5" />
              Subscribe Now
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
});
SubscriptionPopup.displayName = 'SubscriptionPopup';

// Timeline Header
const TimelineHeader = memo(({ slots, onPrev, onNext, canGoPrev, canGoNext }: {
  slots: Date[];
  onPrev?: () => void;
  onNext?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
}) => (
  <div className="flex h-10 border-b border-white/10">
    <div className="w-48 shrink-0 flex items-center justify-between px-4">
      {/* Today label + nav arrows */}
      <span className="text-sm text-white/70 font-medium">Today</span>
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          disabled={!canGoPrev}
          className={cn("p-1 rounded", canGoPrev ? "hover:bg-white/10 active:bg-white/20" : "opacity-30")}
        >
          <ChevronLeft className="w-4 h-4 text-white/70" />
        </button>
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className={cn("p-1 rounded", canGoNext ? "hover:bg-white/10 active:bg-white/20" : "opacity-30")}
        >
          <ChevronRight className="w-4 h-4 text-white/70" />
        </button>
      </div>
    </div>
    <div className="flex-1 flex">
      {slots.map((slot, index) => (
        <div key={index} className="flex-1 px-4 flex items-center border-l border-white/10">
          <span className="text-sm text-white/50">{formatTime(slot)}</span>
        </div>
      ))}
    </div>
  </div>
));
TimelineHeader.displayName = 'TimelineHeader';

// Guide Channel Row
const GuideChannelRow = memo(({
  channel,
  epgData,
  timelineStart,
  timelineEnd,
  isFocused,
  isPlaying,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onProgramClick,
  wasScrolling
}: {
  channel: Channel;
  epgData: ChannelEPG | undefined;
  timelineStart: Date;
  timelineEnd: Date;
  isFocused: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onProgramClick?: (program: EPGProgram) => void;
  wasScrolling?: () => boolean;
}) => {
  const now = new Date();
  const totalMs = timelineEnd.getTime() - timelineStart.getTime();

  const renderProgram = (program: EPGProgram | null, isNow: boolean, fallbackTitle?: string) => {
    // If no program data, show fallback for current program - clicking plays channel
    if (!program) {
      if (isNow && fallbackTitle) {
        const handleFallbackTap = (e: React.MouseEvent | React.TouchEvent) => {
          e.stopPropagation();
          e.preventDefault();
          // Don't trigger if user was scrolling
          if (wasScrolling?.()) {
            console.log('[Guide] Ignoring fallback tap - was scrolling');
            return;
          }
          console.log('[Guide] FALLBACK TAP - no EPG data, playing channel');
          onSelect(); // Play channel when no program info available
        };
        return (
          <div
            onClick={handleFallbackTap}
            onTouchEnd={handleFallbackTap}
            className={cn(
              "absolute top-1 bottom-1 left-0 right-0 px-3 py-1 rounded border overflow-hidden cursor-pointer",
              isFocused ? "bg-white border-white" : "bg-white/10 border-white/20"
            )}
          >
            <div className={cn(
              "text-sm font-medium truncate pointer-events-none",
              isFocused ? "text-black" : "text-white/70"
            )}>{fallbackTitle}</div>
          </div>
        );
      }
      return null;
    }

    const programStart = new Date(program.startTime);
    const programEnd = new Date(program.endTime);

    // Calculate position
    const startOffset = Math.max(0, programStart.getTime() - timelineStart.getTime());
    const endOffset = Math.min(totalMs, programEnd.getTime() - timelineStart.getTime());
    const left = (startOffset / totalMs) * 100;
    const width = ((endOffset - startOffset) / totalMs) * 100;

    // If program is outside timeline, skip
    if (width <= 0 || left >= 100) return null;

    const title = program.title || fallbackTitle || 'No Program Info';

    const handleProgramTap = (e: React.MouseEvent | React.TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();
      // Don't trigger if user was scrolling
      if (wasScrolling?.()) {
        console.log('[Guide] Ignoring program tap - was scrolling');
        return;
      }
      console.log('[Guide] PROGRAM TAP - program:', program.title, 'onProgramClick exists:', !!onProgramClick);
      if (onProgramClick) {
        console.log('[Guide] Calling onProgramClick for:', program.title);
        onProgramClick(program);
      } else {
        console.log('[Guide] NO onProgramClick, falling back to onSelect');
        onSelect();
      }
    };

    return (
      <div
        key={program.startTime}
        onClick={handleProgramTap}
        onTouchEnd={handleProgramTap}
        className={cn(
          "absolute top-1 bottom-1 px-3 py-1 rounded border overflow-hidden transition-all flex items-center cursor-pointer hover:ring-2 hover:ring-white/30",
          isFocused && isNow ? "bg-white border-white" : "bg-white/10 border-white/20",
          isNow && !isFocused && "border-l-2 border-l-red-500"
        )}
        style={{ left: `${left}%`, width: `${Math.max(width, 10)}%`, minWidth: '100px' }}
      >
        <div className={cn(
          "text-sm font-medium truncate pointer-events-none",
          isFocused && isNow ? "text-black" : "text-white"
        )}>{title}</div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex h-14 transition-all border-b border-white/5 select-none",
        isFocused && "bg-white/10 ring-2 ring-white/50"
      )}
    >
      {/* Sticky Channel Section - stays visible when scrolling horizontally */}
      <div className={cn(
        "sticky left-0 z-10 flex shrink-0 bg-black",
        isFocused && "bg-zinc-900"
      )}>
        {/* Favorite Button */}
        <button
          onClick={onToggleFavorite}
          onTouchEnd={(e) => { e.preventDefault(); onToggleFavorite(); }}
          className="w-10 shrink-0 flex items-center justify-center hover:bg-white/10 active:bg-white/20"
        >
          <Star className={cn("w-4 h-4", isFavorite ? "text-yellow-400 fill-yellow-400" : "text-white/30")} />
        </button>

        {/* Channel Info - clicking this plays the channel */}
        <div
          onClick={() => { console.log('[Guide] CHANNEL INFO CLICK'); onSelect(); }}
          onTouchEnd={(e) => { e.preventDefault(); console.log('[Guide] CHANNEL INFO TOUCH'); onSelect(); }}
          className={cn(
            "w-40 shrink-0 flex items-center gap-2 px-2 border-r border-white/10 cursor-pointer",
            isPlaying && "bg-red-600/20"
          )}
        >
          <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center overflow-hidden shrink-0 pointer-events-none">
            {channel.logo ? (
              <img src={channel.logo} alt="" className="w-full h-full object-contain p-0.5" loading="lazy" />
            ) : (
              <span className="text-xs font-bold text-white/60">{channel.GuideNumber}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 pointer-events-none">
            <div className="text-sm font-medium text-white truncate">{channel.GuideName}</div>
          </div>
        </div>
      </div>

      {/* Programs - scrolls horizontally, clicking opens info modal */}
      <div className="flex-1 relative">
        {renderProgram(epgData?.currentProgram || null, true, channel.GuideName)}
        {renderProgram(epgData?.nextProgram || null, false)}
      </div>
    </div>
  );
});
GuideChannelRow.displayName = 'GuideChannelRow';

// Focused Program Details Panel - positioned in top-left of guide
const FocusedProgramPanel = memo(({
  channel,
  program
}: {
  channel: Channel | null;
  program: EPGProgram | null;
}) => {
  if (!channel) {
    return (
      <div className="p-4">
        <div className="text-white/50">Select a channel</div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-md">
      {/* Channel info */}
      <div className="flex items-center gap-3 mb-2">
        {channel.logo && (
          <div className="w-12 h-9 flex items-center justify-center overflow-hidden shrink-0">
            <img src={channel.logo} alt="" className="w-full h-full object-contain" loading="lazy" />
          </div>
        )}
        <span className="text-white text-xl font-bold">{channel.GuideName}</span>
      </div>

      {/* Program info */}
      {program ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-white text-lg font-medium truncate">{program.title}</h2>
            <span className="text-red-500 text-sm shrink-0">{getTimeRemaining(program.endTime)}</span>
          </div>
          <div className="text-white/60 text-sm">
            {formatTimeRange(program.startTime, program.endTime)}
          </div>
          {program.description && (
            <div className="text-white/50 text-sm mt-1 line-clamp-2">{program.description}</div>
          )}
        </div>
      ) : (
        <div className="text-white/50 text-sm">No program information available</div>
      )}
    </div>
  );
});
FocusedProgramPanel.displayName = 'FocusedProgramPanel';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LiveTVTvPage() {
  // Auth
  const { user, logoutMutation } = useAuth();

  // Reminders context
  const { hasReminder, setReminder, cancelReminder, pendingChannel, clearPendingChannel } = useReminders();

  // Toast for feedback
  const { toast } = useToast();

  // Check events access permission
  const { hasAccess: hasEventsAccess, isLoading: eventsAccessLoading } = useFeatureAccess('events_access');

  // Portrait mode detection - check immediately on init
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < window.innerHeight;
    }
    return false;
  });

  // Track rotation to show black screen during transition
  const [isRotating, setIsRotating] = useState(false);

  // Device type - phones have orientation locked on home/profile
  const isPhoneDevice = useMemo(() => {
    if (!isNativePlatform()) return false;
    return getDeviceTypeSync() !== 'tablet';
  }, []);

  // View state: 'player' (fullscreen), 'guide' (with PiP), 'home' (favorites), 'events' (sports events), 'profile' (user profile)
  const [viewMode, setViewMode] = useState<'player' | 'guide' | 'home' | 'events' | 'profile'>('home');
  // Ref to track viewMode for orientation listener (which can't access state directly)
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [showOverlay, setShowOverlay] = useState(true);
  const [guideSearchQuery, setGuideSearchQuery] = useState('');
  // Package IDs to hide from guide - load from localStorage
  const [hiddenPackages, setHiddenPackages] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('guideHiddenPackages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return new Set(parsed);
        }
      }
    } catch (e) {
      console.warn('[Guide] Failed to load hidden packages from localStorage:', e);
    }
    return new Set();
  });
  const [showPackageDropdown, setShowPackageDropdown] = useState(false);

  // Home page state
  const [homeSearchQuery, setHomeSearchQuery] = useState('');
  const [homeCategory, setHomeCategory] = useState<string | null>(null);

  // Events page state
  const [eventsCategory, setEventsCategory] = useState<EventCategory | 'all'>('all');

  // Sports schedule modal state
  const [scheduleModal, setScheduleModal] = useState<'nfl' | 'nba' | 'mlb' | null>(null);

  // Splash screen state
  const [showSplash, setShowSplash] = useState(true);

  // Immediately hide native tab bar and HTML splash on mount
  useEffect(() => {
    // Hide the HTML initial splash screen (black background with loading indicator)
    if (typeof window !== 'undefined' && (window as any).__hideInitialSplash) {
      (window as any).__hideInitialSplash();
    }
    // Immediately hide native tab bar during splash
    hideNativeTabBar();
  }, []);

  // Splash screen timer - show for 3 seconds
  useEffect(() => {
    if (!showSplash) return;
    const timer = setTimeout(() => setShowSplash(false), 3000);
    return () => clearTimeout(timer);
  }, [showSplash]);

  // Sync viewMode with native tab bar selection
  useEffect(() => {
    if (showSplash) return; // Don't update during splash
    const tabMap: Record<string, string> = {
      home: 'home',
      player: 'nowplaying',
      events: 'events',
      guide: 'guide',
      profile: 'profile',
    };
    const tabId = tabMap[viewMode];
    if (tabId) {
      setNativeTabBarSelected(tabId);
    }
  }, [viewMode, showSplash]);

  // Save hidden packages to localStorage when changed
  useEffect(() => {
    try {
      localStorage.setItem('guideHiddenPackages', JSON.stringify(Array.from(hiddenPackages)));
    } catch (e) {
      console.warn('[Guide] Failed to save hidden packages to localStorage:', e);
    }
  }, [hiddenPackages]);

  // Helper: Calculate program progress percentage
  const getProgramProgress = useCallback((program: EPGProgram | null | undefined): number => {
    if (!program) return 0;
    const now = Date.now();
    const start = new Date(program.startTime).getTime();
    const end = new Date(program.endTime).getTime();
    if (now < start) return 0;
    if (now > end) return 100;
    return Math.round(((now - start) / (end - start)) * 100);
  }, []);

  // Helper: Get time remaining in program (takes full program object)
  const getProgramTimeRemaining = useCallback((program: EPGProgram | null | undefined): string => {
    if (!program || !program.endTime) return '';
    const now = Date.now();
    const end = program.endTime instanceof Date ? program.endTime.getTime() : new Date(program.endTime).getTime();
    if (isNaN(end)) return '';
    const remaining = Math.max(0, end - now);
    const minutes = Math.floor(remaining / 60000);
    if (minutes <= 0) return '';
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  }, []);

  // Helper: Check if program is starting soon (within 15 minutes)
  const isStartingSoon = useCallback((program: EPGProgram | null | undefined): boolean => {
    if (!program) return false;
    const now = Date.now();
    const start = new Date(program.startTime).getTime();
    const diff = start - now;
    return diff > 0 && diff <= 15 * 60 * 1000; // Within 15 minutes
  }, []);

  // Helper: Get minutes until program starts
  const getMinutesUntilStart = useCallback((program: EPGProgram | null | undefined): number => {
    if (!program) return 0;
    const now = Date.now();
    const start = new Date(program.startTime).getTime();
    return Math.max(0, Math.ceil((start - now) / 60000));
  }, []);

  // Playback state
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.75); // 0-1 scale
  const [isLoading, setIsLoading] = useState(false);
  const [isAirPlaying, setIsAirPlaying] = useState(false);
  const [airPlayEnabled, setAirPlayEnabled] = useState(false); // Only enable AirPlay when user requests it

  // Guide navigation
  const [focusedChannelIndex, setFocusedChannelIndex] = useState(0);
  const [guideTimeOffset, setGuideTimeOffset] = useState(0); // Offset in 30-minute increments from now
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [guideScrollIndex, setGuideScrollIndex] = useState(0); // Track scroll position for EPG loading

  // Persistent set of EPG IDs we've loaded - never shrinks, only grows
  const loadedEpgIdsRef = useRef<Set<string>>(new Set());
  const scrollDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Progressive rendering - start with fewer channels for faster initial load
  const [renderLimit, setRenderLimit] = useState(30);

  // Time ticker for auto-updating program info (updates every 30 seconds)
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Modal/popup state
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showMenuPopup, setShowMenuPopup] = useState(false);
  const [showFavoritesPopup, setShowFavoritesPopup] = useState(false);
  const [useNativeTabBar, setUseNativeTabBar] = useState(false);
  const [favoriteOrderVersion, setFavoriteOrderVersion] = useState(0); // Trigger re-render on reorder
  const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);

  // Guide program info modal state - for showing program details when tapping in guide
  const [guideInfoModal, setGuideInfoModal] = useState<{ program: EPGProgram; channel: Channel } | null>(null);

  // Ref to prevent multiple concurrent reminder calls (not state to avoid re-render issues)
  const isSettingReminderRef = useRef(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const guideScrollRef = useRef<HTMLDivElement>(null);

  // Stream retry state
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelVersionRef = useRef(0); // Track channel changes to prevent stale event handlers
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Debounce loading spinner
  const MAX_RETRIES = 5;
  const [streamError, setStreamError] = useState<string | null>(null);

  // Network status
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [showOfflineIndicator, setShowOfflineIndicator] = useState(false);

  // Touch/swipe gesture tracking
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressChannel = useRef<Channel | null>(null);

  // Dropdown scroll tracking - prevent selection when scrolling
  const dropdownTouchStartY = useRef<number | null>(null);
  const dropdownDidScroll = useRef(false);

  // Guide scroll tracking - prevent selection when scrolling
  const guideTouchStart = useRef<{ x: number; y: number } | null>(null);
  const guideDidScroll = useRef(false);

  // Stream tracking
  const streamSessionToken = useRef<string | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Query client for mutations
  const queryClient = useQueryClient();

  // Auto-update current time every 30 seconds to refresh program info
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Progressive rendering - expand limit after guide opens for faster initial load
  useEffect(() => {
    if (viewMode === 'guide') {
      // Start with 30, expand to all after a short delay
      setRenderLimit(30);
      const timer = setTimeout(() => setRenderLimit(Infinity), 100);
      return () => clearTimeout(timer);
    }
  }, [viewMode]);

  // Track if we need to retry stream when back online
  const needsRetryOnReconnect = useRef(false);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Show "back online" briefly
      setShowOfflineIndicator(true);
      setTimeout(() => setShowOfflineIndicator(false), 2000);

      // If there was a stream error or we were offline, retry the stream
      if (needsRetryOnReconnect.current) {
        needsRetryOnReconnect.current = false;
        // Will retry via the streamError/selectedChannel effect
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowOfflineIndicator(true);
      needsRetryOnReconnect.current = true;
      haptics.warning();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Keep screen awake while playing or loading
  useEffect(() => {
    if (!isNativePlatform()) return;

    const shouldKeepAwake = selectedChannel !== null || isLoading;

    if (shouldKeepAwake) {
      KeepAwake.keepAwake().catch(console.warn);
    } else {
      KeepAwake.allowSleep().catch(console.warn);
    }

    return () => {
      KeepAwake.allowSleep().catch(console.warn);
    };
  }, [selectedChannel, isLoading]);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  // Settings query for logo
  const { data: settings } = useQuery<{ logo_url_large?: string; site_title?: string }>({
    queryKey: ['/api/settings'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60 * 60 * 1000, // Cache for 1 hour
  });

  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ['/api/iptv/channels'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
  });

  // Cache channels to localStorage for offline/faster startup
  const channels = useMemo(() => {
    const raw = (channelsData as any)?.channels || [];

    if (raw.length > 0) {
      // Process and cache fresh data
      const processed = raw.filter((ch: any) => !ch.hidden).map((ch: any) => ({
        GuideName: ch.name,
        GuideNumber: ch.number || String(ch.id),
        URL: ch.streamUrl,
        source: 'iptv' as const,
        iptvId: String(ch.id),
        epgId: ch.epgId,
        logo: ch.logo,
        categoryId: ch.categoryId,
        categoryName: ch.categoryName
      }));

      // Cache to localStorage
      try {
        localStorage.setItem('cachedChannels', JSON.stringify({
          channels: processed,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.warn('[TV] Failed to cache channels:', e);
      }

      return processed;
    }

    // Try loading from cache if no fresh data
    try {
      const cached = localStorage.getItem('cachedChannels');
      if (cached) {
        const { channels: cachedChannels, timestamp } = JSON.parse(cached);
        const age = Date.now() - timestamp;
        // Use cache if less than 24 hours old
        if (age < 24 * 60 * 60 * 1000 && Array.isArray(cachedChannels)) {
          console.log('[TV] Using cached channels from', Math.round(age / 60000), 'minutes ago');
          return cachedChannels;
        }
      }
    } catch (e) {
      console.warn('[TV] Failed to load cached channels:', e);
    }

    return [];
  }, [channelsData]);

  // Background prefetch ALL EPG data when channels load (native only)
  // This ensures thumbnails show on homepage without needing to scroll through guide
  const prefetchStartedRef = useRef(false);
  useEffect(() => {
    if (!isNativePlatform() || channels.length === 0 || prefetchStartedRef.current) return;

    prefetchStartedRef.current = true;
    console.log(`[TV] Starting background EPG prefetch for ${channels.length} channels...`);

    // Get all unique epgIds
    const epgIds = [...new Set(channels.map((ch: Channel) => ch.epgId).filter(Boolean))] as string[];

    // Clear old IndexedDB cache first to ensure we get fresh data with TMDB thumbnails
    // Server's TMDB cache is now persisted to disk, so thumbnails won't be lost
    clearAllCache().then(() => {
      console.log('[TV] Cleared old EPG cache, fetching fresh data...');

      // Prefetch in background - don't await
      return prefetchEPG(epgIds, async (epgId: string) => {
        const channel = channels.find((ch: Channel) => ch.epgId === epgId);
        const channelName = channel?.GuideName || '';
        const url = `/api/epg/upcoming/${encodeURIComponent(epgId)}?hours=168&name=${encodeURIComponent(channelName)}`;
        const fullUrl = buildApiUrl(url);

        try {
          const response: HttpResponse = await CapacitorHttp.get({
            url: fullUrl,
            responseType: 'json',
          });
          if (response.status === 200 && response.data?.programs) {
            return response.data.programs;
          }
        } catch (e) {
          // Silently fail - this is background prefetch
        }
        return [];
      });
    }).then(() => {
      console.log('[TV] Background EPG prefetch complete - invalidating EPG queries');
      // Invalidate all EPG queries so they re-fetch from IndexedDB cache
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/epg/upcoming/');
        }
      });
    });
  }, [channels, queryClient]);

  // Extract unique categories from channels
  const categories = useMemo(() => {
    const categoryMap = new Map<string, string>();
    channels.forEach((ch: Channel) => {
      if (ch.categoryId && ch.categoryName) {
        categoryMap.set(ch.categoryId, ch.categoryName);
      }
    });
    // Sort alphabetically by name
    return Array.from(categoryMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [channels]);

  // === PACKAGE FILTERING (must be defined BEFORE filteredChannels) ===

  // Channel packages query for user's plan
  interface ChannelPackage {
    id: number;
    packageId: number;
    packageName: string;
    providerId: number;
    isActive: boolean;
    channelCount: number;
  }

  interface PackageChannel {
    id: number;
    name: string;
    logo: string | null;
    categoryName: string | null;
  }

  const { data: userPackages = [], isLoading: packagesLoading } = useQuery<ChannelPackage[]>({
    queryKey: ['/api/subscriptions/packages'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: viewMode === 'profile' || viewMode === 'home' || viewMode === 'guide' || viewMode === 'events',
    select: (data) => data || [],
  });

  // Fetch all package channels for guide filtering
  const allPackageChannelsQueries = useQueries({
    queries: userPackages.map(pkg => ({
      queryKey: [`/api/subscriptions/packages/${pkg.packageId}/channels`],
      queryFn: getQueryFn({ on401: "returnNull" }),
      enabled: viewMode === 'guide' && !!pkg.packageId,
      staleTime: 10 * 60 * 1000, // Cache for 10 minutes
      select: (data: PackageChannel[] | null) => ({
        packageId: pkg.packageId,
        packageName: pkg.packageName,
        channels: data || []
      })
    }))
  });

  // Build a map of channel name -> package IDs for filtering
  const channelToPackages = useMemo(() => {
    const map = new Map<string, Set<number>>();
    allPackageChannelsQueries.forEach(query => {
      if (query.data) {
        const { packageId, channels } = query.data;
        channels.forEach((ch: PackageChannel) => {
          const existing = map.get(ch.name) || new Set();
          existing.add(packageId);
          map.set(ch.name, existing);
        });
      }
    });
    return map;
  }, [allPackageChannelsQueries]);

  // === END PACKAGE FILTERING ===

  // Filtered channels for guide search and package visibility
  const filteredChannels = useMemo(() => {
    let filtered = channels;

    // Filter out channels from hidden packages
    if (hiddenPackages.size > 0 && channelToPackages.size > 0) {
      filtered = filtered.filter((ch: Channel) => {
        const packageIds = channelToPackages.get(ch.GuideName);
        // If channel isn't in any package, show it
        if (!packageIds || packageIds.size === 0) return true;
        // Show channel if at least one of its packages is not hidden
        return Array.from(packageIds).some(pkgId => !hiddenPackages.has(pkgId));
      });
    }

    // Then filter by search query
    if (guideSearchQuery.trim()) {
      const query = guideSearchQuery.toLowerCase();
      filtered = filtered.filter((ch: Channel) =>
        ch.GuideName.toLowerCase().includes(query) ||
        ch.GuideNumber.includes(query)
      );
    }

    return filtered;
  }, [channels, guideSearchQuery, hiddenPackages, channelToPackages]);

  // Favorites query
  const { data: favoritesData } = useQuery({
    queryKey: ['/api/favorite-channels'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60 * 1000, // Consider fresh for 1 minute
  });

  // Subscription query
  const { data: subscriptionData, isLoading: subscriptionLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['/api/subscriptions/current'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: showSubscriptionPopup || viewMode === 'profile', // Fetch when popup or profile view is opened
  });

  // Events query - fetch when on events tab
  const { data: eventsData, isLoading: eventsLoading } = useQuery<EventsResponse>({
    queryKey: ['/api/events', eventsCategory],
    queryFn: async () => {
      const url = eventsCategory !== 'all'
        ? `/api/events?category=${eventsCategory}`
        : '/api/events';
      const response = await apiRequest('GET', url);
      return response.json();
    },
    enabled: viewMode === 'events',
    refetchInterval: 60000, // Refresh every minute for live updates
    staleTime: 30000, // Consider fresh for 30 seconds
  });

  const [expandedPackageId, setExpandedPackageId] = useState<number | null>(null);

  // Fetch channels for expanded package (profile view)
  const { data: packageChannels = [], isLoading: packageChannelsLoading } = useQuery<PackageChannel[]>({
    queryKey: [`/api/subscriptions/packages/${expandedPackageId}/channels`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!expandedPackageId,
    select: (data) => data || [],
  });

  // Find sport package IDs
  const nflPackage = userPackages.find(p => p.packageName?.toLowerCase().includes('nfl'));
  const nbaPackage = userPackages.find(p => p.packageName?.toLowerCase().includes('nba'));
  const mlbPackage = userPackages.find(p => p.packageName?.toLowerCase().includes('mlb'));

  // Debug logging for sports packages
  useEffect(() => {
    if (userPackages.length > 0 && viewMode === 'home') {
      console.log('[Sports] User packages:', userPackages.map(p => p.packageName));
      console.log('[Sports] NFL package:', nflPackage?.packageName || 'NOT FOUND');
      console.log('[Sports] NBA package:', nbaPackage?.packageName || 'NOT FOUND');
      console.log('[Sports] MLB package:', mlbPackage?.packageName || 'NOT FOUND');
    }
  }, [userPackages, nflPackage, nbaPackage, mlbPackage, viewMode]);

  // Fetch channels for sport packages on Home view
  const { data: nflChannels = [] } = useQuery<PackageChannel[]>({
    queryKey: [`/api/subscriptions/packages/${nflPackage?.packageId}/channels`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: viewMode === 'home' && !!nflPackage?.packageId,
    select: (data) => data || [],
  });

  const { data: nbaChannels = [] } = useQuery<PackageChannel[]>({
    queryKey: [`/api/subscriptions/packages/${nbaPackage?.packageId}/channels`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: viewMode === 'home' && !!nbaPackage?.packageId,
    select: (data) => data || [],
  });

  const { data: mlbChannels = [] } = useQuery<PackageChannel[]>({
    queryKey: [`/api/subscriptions/packages/${mlbPackage?.packageId}/channels`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: viewMode === 'home' && !!mlbPackage?.packageId,
    select: (data) => data || [],
  });

  // Sports schedule from ESPN API
  interface SportsGame {
    id: string;
    name: string;
    shortName: string;
    date: string;
    homeTeam: { name: string; abbreviation: string; logo?: string; score?: number };
    awayTeam: { name: string; abbreviation: string; logo?: string; score?: number };
    broadcast: string[];
    venue?: string;
    status: 'scheduled' | 'live' | 'final' | 'postponed';
    statusDetail?: string;
  }

  const { data: sportsSchedule, isLoading: scheduleLoading } = useQuery<{ sport: string; games: SportsGame[] }>({
    queryKey: [`/api/sports/schedule/${scheduleModal}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!scheduleModal,
    staleTime: 60 * 1000, // Cache for 1 minute
    refetchInterval: scheduleModal ? 60 * 1000 : false, // Refetch every minute for live scores
  });

  // Trending channels query
  interface TrendingChannel {
    channelId: string;
    channelName: string;
    currentViewers: number;
    logo: string | null;
  }

  const { data: trendingChannels = [] } = useQuery<TrendingChannel[]>({
    queryKey: ['/api/iptv/trending'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: viewMode === 'home',
    refetchInterval: 15000, // Refresh every 15 seconds for real-time viewer counts
    select: (data: any) => data?.trending || [],
  });

  // Cache favorites to localStorage for offline/faster startup
  const favorites = useMemo(() => {
    if (Array.isArray(favoritesData) && favoritesData.length >= 0) {
      // Cache favorites
      try {
        localStorage.setItem('cachedFavorites', JSON.stringify(favoritesData));
      } catch (e) {
        console.warn('[TV] Failed to cache favorites:', e);
      }
      return favoritesData;
    }

    // Try loading from cache
    try {
      const cached = localStorage.getItem('cachedFavorites');
      if (cached) {
        const cachedFavorites = JSON.parse(cached);
        if (Array.isArray(cachedFavorites)) {
          return cachedFavorites;
        }
      }
    } catch (e) {
      console.warn('[TV] Failed to load cached favorites:', e);
    }

    return [];
  }, [favoritesData]);

  const isFavorite = useMemo(() => {
    if (!selectedChannel?.iptvId) return false;
    // Compare as strings to handle type mismatches
    return favorites.some((fav: any) => String(fav.channelId) === String(selectedChannel.iptvId));
  }, [favorites, selectedChannel]);

  // Add favorite mutation
  const addFavoriteMutation = useMutation({
    mutationFn: async (channel: Channel) => {
      const res = await apiRequest('POST', '/api/favorite-channels', {
        channelId: channel.iptvId,
        channelName: channel.GuideName,
        channelLogo: channel.logo || ''
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-channels'] });
    }
  });

  // Remove favorite mutation
  const removeFavoriteMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await apiRequest('DELETE', `/api/favorite-channels/${channelId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-channels'] });
    }
  });

  const toggleFavorite = useCallback(() => {
    if (!selectedChannel?.iptvId) return;

    if (isFavorite) {
      removeFavoriteMutation.mutate(selectedChannel.iptvId);
    } else {
      addFavoriteMutation.mutate(selectedChannel);
    }
  }, [selectedChannel, isFavorite, addFavoriteMutation, removeFavoriteMutation]);

  // Toggle favorite for any channel (used in guide)
  const toggleChannelFavorite = useCallback((channel: Channel) => {
    if (!channel.iptvId) return;
    if (addFavoriteMutation.isPending || removeFavoriteMutation.isPending) return;

    // Haptic feedback on favorite toggle
    haptics.medium();

    const isChannelFavorite = favorites.some(f => f.channelId === channel.iptvId);
    if (isChannelFavorite) {
      removeFavoriteMutation.mutate(channel.iptvId);
    } else {
      addFavoriteMutation.mutate(channel);
    }
  }, [favorites, addFavoriteMutation, removeFavoriteMutation]);

  // Handle AirPlay - enable AirPlay on the video element first, then show picker
  const handleAirPlay = useCallback(() => {
    if (videoRef.current) {
      const video = videoRef.current as any;

      // Enable AirPlay on the video element if not already enabled
      if (!airPlayEnabled) {
        console.log('[AirPlay] Enabling AirPlay on video element');
        video.setAttribute('x-webkit-airplay', 'allow');
        setAirPlayEnabled(true);
      }

      // Small delay to let the attribute take effect, then show picker
      setTimeout(() => {
        if (video.webkitShowPlaybackTargetPicker) {
          console.log('📺 Showing AirPlay picker');
          video.webkitShowPlaybackTargetPicker();
        } else {
          console.log('AirPlay picker not available');
        }
      }, 100);
    }
  }, [airPlayEnabled]);

  // Handle Picture-in-Picture
  const handlePiP = useCallback(async () => {
    if (!videoRef.current) return;

    const video = videoRef.current as any;

    try {
      // Check if already in PiP
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        console.log('📺 Exited PiP');
      } else if (video.webkitSupportsPresentationMode && typeof video.webkitSetPresentationMode === 'function') {
        // Safari/iOS specific PiP
        video.webkitSetPresentationMode(
          video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture'
        );
        console.log('📺 Toggled Safari PiP');
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        // Standard PiP API
        await video.requestPictureInPicture();
        console.log('📺 Entered PiP');
      } else {
        console.log('PiP not supported');
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
  }, []);

  // EPG queries - pre-load first batch for faster guide opening
  // Use epgId (XMLTV channel ID) and /api/epg/upcoming endpoint like the web version
  const visibleEpgIds = useMemo(() => {
    const idsSet = new Set<string>();

    // Always include the currently selected channel for player overlay
    if (selectedChannel?.epgId) {
      idsSet.add(selectedChannel.epgId);
    }

    // Always include favorite channels (for Home view thumbnails)
    favorites.forEach((fav: any) => {
      const channel = channels.find((ch: Channel) => ch.iptvId === fav.channelId);
      if (channel?.epgId) idsSet.add(channel.epgId);
    });

    // Include sports package channels (for Home view NFL/NBA/MLB sections)
    if (viewMode === 'home') {
      [...nflChannels, ...nbaChannels, ...mlbChannels].forEach((pkgChannel) => {
        const channel = channels.find((ch: Channel) => ch.GuideName === pkgChannel.name || ch.name === pkgChannel.name);
        if (channel?.epgId) idsSet.add(channel.epgId);
      });

      // Include trending channels (for Home view Trending section)
      trendingChannels.forEach((trending) => {
        const channel = channels.find((ch: Channel) => ch.iptvId === trending.channelId);
        if (channel?.epgId) idsSet.add(channel.epgId);
      });
    }

    // Pre-load first 50 channels' EPG data even before guide opens (for faster initial load)
    channels.slice(0, 50).forEach((ch: Channel) => {
      if (ch.epgId) idsSet.add(ch.epgId);
    });

    // When guide is open, load EPG for visible channels based on scroll position
    if (viewMode === 'guide') {
      // Always load first 100 channels
      channels.slice(0, 100).forEach((ch: Channel) => {
        if (ch.epgId) idsSet.add(ch.epgId);
      });

      // Load large buffer around current scroll position (100 channels before, 100 after)
      const scrollStart = Math.max(0, guideScrollIndex - 100);
      const scrollEnd = Math.min(channels.length, guideScrollIndex + 100);
      channels.slice(scrollStart, scrollEnd).forEach((ch: Channel) => {
        if (ch.epgId) idsSet.add(ch.epgId);
      });

      // Also include channels around the focused one (for keyboard navigation)
      const focusStart = Math.max(0, focusedChannelIndex - 50);
      const focusEnd = Math.min(channels.length, focusedChannelIndex + 50);
      channels.slice(focusStart, focusEnd).forEach((ch: Channel) => {
        if (ch.epgId) idsSet.add(ch.epgId);
      });
    }

    // Add all new IDs to the persistent set (never shrinks)
    idsSet.forEach(id => loadedEpgIdsRef.current.add(id));

    // Return ALL IDs we've ever loaded - this ensures data never disappears
    return Array.from(loadedEpgIdsRef.current);
  }, [channels, favorites, focusedChannelIndex, guideScrollIndex, viewMode, selectedChannel, nflChannels, nbaChannels, mlbChannels, trendingChannels]);

  const epgQueries = useQueries({
    queries: visibleEpgIds.map(epgId => {
      // Find channel name for this epgId for fallback matching
      const channel = channels.find((ch: Channel) => ch.epgId === epgId);
      const channelName = channel?.GuideName || '';

      return {
        queryKey: [`/api/epg/upcoming/${encodeURIComponent(epgId)}?hours=168&name=${encodeURIComponent(channelName)}`],
        queryFn: async () => {
          // Check IndexedDB cache first (for native apps)
          if (isNativePlatform()) {
            const cached = await getCachedEPG(epgId);
            if (cached && cached.length > 0) {
              return { programs: cached, fromCache: true };
            }
          }

          // Fetch from API - include channel name for fallback matching
          const url = `/api/epg/upcoming/${encodeURIComponent(epgId)}?hours=168&name=${encodeURIComponent(channelName)}`;
          const fullUrl = buildApiUrl(url);

          let data: any = null;

          // Use CapacitorHttp for native apps to handle auth properly
          if (isNativePlatform()) {
            const response: HttpResponse = await CapacitorHttp.get({
              url: fullUrl,
              responseType: 'json',
            });
            if (response.status !== 200) return null;
            data = response.data;
          } else {
            // Use fetch for web
            const response = await fetch(fullUrl, {
              credentials: 'include'
            });
            if (!response.ok) return null;
            data = await response.json();
          }

          // Cache the data for native apps
          if (isNativePlatform() && data?.programs?.length > 0) {
            cacheEPG(epgId, data.programs).catch(console.error);
          }

          return data;
        },
        staleTime: 30 * 60 * 1000, // 30 minutes before refetch (data is cached for longer)
        gcTime: 6 * 60 * 60 * 1000, // Keep in cache for 6 hours
        retry: 1,
      };
    })
  });

  // Build EPG data map from /api/epg/upcoming response (array of programs)
  const epgDataMap = useMemo(() => {
    const map = new Map<string, ChannelEPG>();
    const now = new Date().getTime();

    epgQueries.forEach((query, index) => {
      const epgId = visibleEpgIds[index];
      // API returns { programs: [...] }, not a raw array
      const responseData = query.data as any;
      const rawPrograms = responseData?.programs;
      if (rawPrograms && Array.isArray(rawPrograms)) {
        // Convert all programs to EPGProgram format
        const allPrograms: EPGProgram[] = rawPrograms.map(p => ({
          title: p.title || '',
          startTime: p.startTime,
          endTime: p.endTime,
          description: p.description || '',
          episodeTitle: p.episodeTitle || '',
          season: p.season,
          episode: p.episode,
          rating: p.rating,
          thumbnail: p.thumbnail
        }));

        // Find current program (startTime <= now < endTime)
        const currentProgram = allPrograms.find(p => {
          const start = new Date(p.startTime).getTime();
          const end = new Date(p.endTime).getTime();
          return start <= now && now < end;
        });

        // Find next program (starts after current ends, or first future program)
        const nextProgram = allPrograms.find(p => {
          const start = new Date(p.startTime).getTime();
          return start > now && (!currentProgram || start >= new Date(currentProgram.endTime).getTime());
        });

        // Find the channel with this epgId to map back to iptvId
        const channel = channels.find((ch: Channel) => ch.epgId === epgId);
        if (channel?.iptvId) {
          map.set(channel.iptvId, {
            currentProgram: currentProgram || null,
            nextProgram: nextProgram || null,
            programs: allPrograms
          });
        }
      }
    });

    return map;
  }, [epgQueries, visibleEpgIds, channels, currentTime]);

  // Timeline slots - adjusted by guideTimeOffset
  const timelineSlots = useMemo(() => {
    const now = new Date();
    const startTime = new Date(now);
    startTime.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0);
    // Apply offset
    startTime.setTime(startTime.getTime() + guideTimeOffset * 30 * 60 * 1000);

    const slots: Date[] = [];
    for (let i = 0; i < 4; i++) {
      const slot = new Date(startTime);
      slot.setMinutes(startTime.getMinutes() + i * 30);
      slots.push(slot);
    }
    return slots;
  }, [guideTimeOffset]);

  const timelineStart = timelineSlots[0];
  const timelineEnd = new Date(timelineSlots[0]);
  timelineEnd.setHours(timelineEnd.getHours() + 2);

  // Get current channel from channels array (ensures we have latest data including logo)
  const currentChannel = useMemo(() => {
    if (!selectedChannel?.iptvId) return selectedChannel;
    return channels.find((ch: Channel) => ch.iptvId === selectedChannel.iptvId) || selectedChannel;
  }, [selectedChannel, channels]);

  // Current program for selected channel
  const currentEPG = currentChannel?.iptvId ? epgDataMap.get(currentChannel.iptvId) : undefined;

  // Update MediaSession (Control Center / Lock Screen) when channel or program changes
  useEffect(() => {
    if (currentChannel && isPlaying) {
      updateMediaSession(currentChannel, currentEPG?.currentProgram || null);
    }
  }, [currentChannel, currentEPG?.currentProgram, isPlaying]);

  // Detect AirPlay status and handle connect/disconnect
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isNativePlatform()) return;

    let wasAirPlaying = (video as any).webkitCurrentPlaybackTargetIsWireless || false;

    const handleAirPlayChange = async () => {
      const isWireless = (video as any).webkitCurrentPlaybackTargetIsWireless;
      console.log('[AirPlay] Wireless playback changed:', isWireless, 'was:', wasAirPlaying);
      setIsAirPlaying(!!isWireless);

      if (isWireless && !wasAirPlaying) {
        // Just connected to AirPlay - try to ensure playback
        console.log('[AirPlay] Connected - ensuring playback');
        try {
          if (video.paused) {
            await video.play();
            console.log('[AirPlay] Play succeeded after connect');
          }
        } catch (e) {
          console.error('[AirPlay] Play failed after connect:', e);
        }
      } else if (!isWireless && wasAirPlaying) {
        // Just disconnected from AirPlay - reload the stream
        console.log('[AirPlay] Disconnected - reloading stream');
        if (selectedChannel) {
          // Show loading spinner
          setIsLoading(true);
          // Small delay to let the video element settle
          setTimeout(() => {
            if (videoRef.current && selectedChannel) {
              console.log('[AirPlay] Restarting local playback');
              // Reload the current source
              const currentSrc = videoRef.current.src;
              if (currentSrc) {
                videoRef.current.load();
                videoRef.current.play().catch(e => {
                  console.error('[AirPlay] Failed to restart playback:', e);
                  setIsLoading(false);
                });
              } else {
                setIsLoading(false);
              }
            } else {
              setIsLoading(false);
            }
          }, 500);
        }
      }

      wasAirPlaying = isWireless;
    };

    // Check initial state
    handleAirPlayChange();

    // Listen for changes
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleAirPlayChange);

    return () => {
      video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleAirPlayChange);
    };
  }, [selectedChannel]); // Re-attach when channel changes

  // Focused channel in guide
  const focusedChannel = channels[focusedChannelIndex] || null;
  const focusedEPG = focusedChannel?.iptvId ? epgDataMap.get(focusedChannel.iptvId) : undefined;

  // ============================================================================
  // VIDEO PLAYBACK
  // ============================================================================

  // Release previous stream and stop heartbeats
  const releaseCurrentStream = useCallback(async () => {
    // Stop heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Release stream session
    if (streamSessionToken.current) {
      try {
        await apiRequest('POST', '/api/iptv/stream/release', {
          sessionToken: streamSessionToken.current
        });
      } catch (e) {
        console.log('[TV] Error releasing stream:', e);
      }
      streamSessionToken.current = null;
    }
  }, []);

  const playStream = useCallback(async (channel: Channel, isRetry = false) => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    setIsLoading(true);
    setSelectedChannel(channel);
    setStreamError(null);

    // Reset retry count for new channel (not retries)
    if (!isRetry) {
      retryCountRef.current = 0;
      channelVersionRef.current++; // Increment version to invalidate old event handlers
      // Clear any pending loading spinner timeout
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // Haptic feedback on channel change (not on retry)
      haptics.light();
    }

    // Capture current version for this playStream call
    const thisVersion = channelVersionRef.current;

    // Release previous stream
    await releaseCurrentStream();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    try {
      let streamUrl = buildApiUrl(channel.URL);

      // For IPTV channels, get token (native) or acquire session (web)
      // OPTIMIZED: Don't block streaming on acquire - it's just for tracking
      if (channel.source === 'iptv' && channel.iptvId) {
        const isNative = isNativePlatform();

        if (isNative) {
          // Native platforms: need token for URL (generate-token also does acquire internally)
          try {
            console.log('[TV] Getting stream token for:', channel.iptvId, 'platform:', getPlatform());
            const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
              streamId: channel.iptvId,
              deviceType: getPlatform()
            });
            const tokenData = await tokenResponse.json();

            if (tokenData?.token) {
              streamUrl = `${streamUrl}?token=${tokenData.token}`;
            }

            // Set up session tracking from token response
            if (tokenData?.sessionToken) {
              streamSessionToken.current = tokenData.sessionToken;
              // Clear any existing heartbeat
              if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
              }
              // Start heartbeat every 30 seconds
              heartbeatIntervalRef.current = setInterval(async () => {
                if (streamSessionToken.current) {
                  try {
                    await apiRequest('POST', '/api/iptv/stream/heartbeat', {
                      sessionToken: streamSessionToken.current
                    });
                  } catch (e) {
                    console.log('[TV] Heartbeat error:', e);
                  }
                }
              }, 30000);
            }
          } catch (e) {
            console.log('[TV] Could not generate token:', e);
            // Continue anyway - stream might work without token
          }
        } else {
          // Web: acquire stream session for tracking
          try {
            console.log('[TV] Acquiring stream session for:', channel.iptvId);
            const acquireResponse = await apiRequest('POST', '/api/iptv/stream/acquire', {
              streamId: channel.iptvId,
              deviceType: getPlatform() // 'ios', 'android', or 'web'
            });
            const data = await acquireResponse.json();
            console.log('[TV] Stream acquire response:', data);
            const { sessionToken } = data;
            streamSessionToken.current = sessionToken;

            // Start heartbeat every 30 seconds
            heartbeatIntervalRef.current = setInterval(async () => {
              if (streamSessionToken.current) {
                try {
                  await apiRequest('POST', '/api/iptv/stream/heartbeat', {
                    sessionToken: streamSessionToken.current
                  });
                } catch (e) {
                  console.log('[TV] Heartbeat error:', e);
                }
              }
            }, 30000);
          } catch (e) {
            console.log('[TV] Could not acquire stream session:', e);
            // Continue anyway - stream might still work
          }
        }
      }

      // On iOS, use native HLS for AirPlay support (HLS.js doesn't support AirPlay video)
      const canPlayNativeHLS = video.canPlayType('application/vnd.apple.mpegurl');
      const useNativeHLS = isNativePlatform() && canPlayNativeHLS;

      console.log('[TV] Playback decision:', {
        isNative: isNativePlatform(),
        canPlayNativeHLS,
        useNativeHLS,
        hlsSupported: Hls.isSupported(),
        streamUrl
      });

      if (useNativeHLS) {
        // Native iOS HLS - supports AirPlay with video
        console.log('[TV] 📱 Using NATIVE HLS for AirPlay support');
        console.log('[TV] Stream URL:', streamUrl);

        // Add error handlers before setting src
        // All handlers check thisVersion to prevent stale updates from rapid channel changes
        const handleError = (e: Event) => {
          // Ignore events from previous channel
          if (channelVersionRef.current !== thisVersion) {
            console.log('[TV] Ignoring error from stale channel version');
            return;
          }
          const mediaError = video.error;
          console.error('[TV] Native HLS error event:', e);
          console.error('[TV] Video error code:', mediaError?.code);
          console.error('[TV] Video error message:', mediaError?.message);
          console.error('[TV] Network state:', video.networkState);
          console.error('[TV] Ready state:', video.readyState);

          // Trigger retry with exponential backoff
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000);
            console.log(`[TV] Retrying stream in ${delay}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);
            setStreamError(`Reconnecting... (${retryCountRef.current}/${MAX_RETRIES})`);
            setIsLoading(true);

            retryTimeoutRef.current = setTimeout(() => {
              if (channel && channelVersionRef.current === thisVersion) {
                video.src = streamUrl;
                video.load(); // play() will be called in handleCanPlay
              }
            }, delay);
          } else {
            setIsLoading(false);
            setStreamError('Unable to connect. Please try again.');
            haptics.error();
          }
        };

        const handleLoadedMetadata = () => {
          if (channelVersionRef.current !== thisVersion) return;
          console.log('[TV] Native HLS: metadata loaded');
          console.log('[TV] Duration:', video.duration);
          console.log('[TV] Video dimensions:', video.videoWidth, 'x', video.videoHeight);
        };

        const handleCanPlay = () => {
          if (channelVersionRef.current !== thisVersion) return;
          console.log('[TV] Native HLS: can play');
          // Cancel pending loading spinner and hide immediately
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
          }
          setIsLoading(false);
          setStreamError(null); // Clear any error when stream is ready
          // Now safe to play - video has enough data
          video.play().then(() => {
            console.log('[TV] Native HLS: play() succeeded');
            setIsPlaying(true);
          }).catch((err) => {
            console.error('[TV] Native HLS play() error in canplay:', err);
          });
        };

        const handlePlaying = () => {
          if (channelVersionRef.current !== thisVersion) return;
          console.log('[TV] Native HLS: playing');
          // Cancel pending loading spinner and hide immediately
          if (loadingTimeoutRef.current) {
            clearTimeout(loadingTimeoutRef.current);
            loadingTimeoutRef.current = null;
          }
          setIsPlaying(true);
          setIsLoading(false);
          setStreamError(null); // Clear any error when stream is playing
          retryCountRef.current = 0; // Reset retry count on successful play
        };

        const handleWaiting = () => {
          if (channelVersionRef.current !== thisVersion) return;
          // Debounce loading spinner - only show if buffering persists for 500ms
          if (!loadingTimeoutRef.current) {
            loadingTimeoutRef.current = setTimeout(() => {
              if (channelVersionRef.current === thisVersion) {
                console.log('[TV] Native HLS: waiting/buffering (showing spinner)');
                setIsLoading(true);
              }
              loadingTimeoutRef.current = null;
            }, 500);
          }
        };

        const handleStalled = () => {
          if (channelVersionRef.current !== thisVersion) return;
          // Debounce loading spinner - only show if stalled persists for 500ms
          if (!loadingTimeoutRef.current) {
            loadingTimeoutRef.current = setTimeout(() => {
              if (channelVersionRef.current === thisVersion) {
                console.log('[TV] Native HLS: stalled (showing spinner)');
                setIsLoading(true);
              }
              loadingTimeoutRef.current = null;
            }, 500);
          }
        };

        // Fallback: clear loading when video is actually progressing
        const handleTimeUpdate = () => {
          if (channelVersionRef.current !== thisVersion) return;
          // If video is playing (has currentTime > 0), clear loading state
          if (video.currentTime > 0 && !video.paused) {
            // Cancel pending loading spinner
            if (loadingTimeoutRef.current) {
              clearTimeout(loadingTimeoutRef.current);
              loadingTimeoutRef.current = null;
            }
            setIsLoading(false);
            setStreamError(null);
          }
        };

        // Clean up old listeners
        video.removeEventListener('error', handleError);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('playing', handlePlaying);
        video.removeEventListener('waiting', handleWaiting);
        video.removeEventListener('stalled', handleStalled);
        video.removeEventListener('timeupdate', handleTimeUpdate);

        // Add new listeners
        video.addEventListener('error', handleError);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('stalled', handleStalled);
        video.addEventListener('timeupdate', handleTimeUpdate);

        video.src = streamUrl;
        video.load(); // Explicitly load - play() will be called in handleCanPlay
      } else if (Hls.isSupported()) {
        console.log('[TV] Using HLS.js');
        const hls = new Hls({
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 60,
          manifestLoadingTimeOut: 30000,
          manifestLoadingMaxRetry: 4,
          levelLoadingTimeOut: 30000,
          fragLoadingTimeOut: 60000,
          xhrSetup: (xhr) => { xhr.withCredentials = false; },
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().then(() => {
            setIsPlaying(true);
            setIsLoading(false);
          }).catch(() => setIsLoading(false));
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              hls.destroy();
              setIsLoading(false);
            }
          }
        });

        hls.attachMedia(video);
        hls.loadSource(streamUrl);
      } else if (canPlayNativeHLS) {
        // Fallback for non-native platforms with native HLS support (Safari desktop)
        console.log('[TV] Using native HLS fallback');
        video.src = streamUrl;
        video.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        }).catch(() => setIsLoading(false));
      }
    } catch (error) {
      console.error('[TV] Stream error:', error);
      handleStreamError('Failed to start stream');
    }
  }, [releaseCurrentStream]);

  // Retry stream with exponential backoff
  const retryStream = useCallback(() => {
    if (!selectedChannel) return;
    if (retryCountRef.current >= MAX_RETRIES) {
      console.log('[TV] Max retries reached, giving up');
      setStreamError('Unable to connect. Please try again later.');
      haptics.error();
      return;
    }

    retryCountRef.current++;
    const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000); // 1s, 2s, 4s, 8s, 10s
    console.log(`[TV] Retrying stream in ${delay}ms (attempt ${retryCountRef.current}/${MAX_RETRIES})`);

    setStreamError(`Reconnecting... (${retryCountRef.current}/${MAX_RETRIES})`);

    retryTimeoutRef.current = setTimeout(() => {
      playStream(selectedChannel, true);
    }, delay);
  }, [selectedChannel, playStream]);

  // Handle stream errors with retry
  const handleStreamError = useCallback((errorMessage: string) => {
    console.error('[TV] Stream error:', errorMessage);
    setIsLoading(false);

    if (retryCountRef.current < MAX_RETRIES) {
      retryStream();
    } else {
      setStreamError(errorMessage);
      needsRetryOnReconnect.current = true;
      haptics.error();
    }
  }, [retryStream]);

  // Retry stream when coming back online after error
  useEffect(() => {
    if (isOnline && streamError && selectedChannel) {
      console.log('[TV] Back online, retrying stream...');
      setStreamError(null);
      retryCountRef.current = 0;
      playStream(selectedChannel);
    }
  }, [isOnline, streamError, selectedChannel, playStream]);

  // ============================================================================
  // CHANNEL NAVIGATION
  // ============================================================================

  const changeChannel = useCallback((direction: 'up' | 'down') => {
    if (channels.length === 0) return;

    const currentIndex = selectedChannel
      ? channels.findIndex((ch: Channel) => ch.iptvId === selectedChannel.iptvId)
      : -1;

    let newIndex: number;
    if (direction === 'up') {
      newIndex = currentIndex <= 0 ? channels.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex >= channels.length - 1 ? 0 : currentIndex + 1;
    }

    playStream(channels[newIndex]);
  }, [channels, selectedChannel, playStream]);

  const selectChannelFromGuide = useCallback((channel: Channel) => {
    playStream(channel);
    setViewMode('player');
  }, [playStream]);

  // Handle pending channel from notification tap - auto-play the channel
  useEffect(() => {
    if (pendingChannel && channels.length > 0) {
      console.log('[LiveTV] Handling pending channel from notification:', pendingChannel);
      const channel = channels.find((ch: Channel) => ch.iptvId === pendingChannel);
      if (channel) {
        console.log('[LiveTV] Found channel, starting playback:', channel.GuideName);
        selectChannelFromGuide(channel);
      } else {
        console.warn('[LiveTV] Channel not found for pending ID:', pendingChannel);
      }
      clearPendingChannel();
    }
  }, [pendingChannel, channels, selectChannelFromGuide, clearPendingChannel]);

  // Reminder handlers for InfoModal
  const handleSetReminder = useCallback(async (program: EPGProgram, channel: Channel) => {
    // Prevent concurrent calls using ref
    if (isSettingReminderRef.current) {
      console.log('[Reminder] Already setting reminder, ignoring duplicate call');
      return;
    }

    console.log('[Reminder] Setting reminder for:', program.title, 'on', channel.GuideName);
    isSettingReminderRef.current = true;

    try {
      const success = await setReminder({
        channelId: channel.iptvId || '',
        channelName: channel.GuideName,
        programTitle: program.title,
        programStart: program.startTime
      });
      console.log('[Reminder] Set reminder result:', success);
      if (success) {
        haptics.notification('success');
        toast({
          title: 'Reminder Set',
          description: `You'll be notified before "${program.title}" starts`,
        });
        // Close the modal after setting reminder
        setGuideInfoModal(null);
      } else {
        haptics.notification('error');
        toast({
          title: 'Could not set reminder',
          description: 'Check notification permissions in Settings',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('[Reminder] Error setting reminder:', error);
      haptics.notification('error');
      toast({
        title: 'Error',
        description: 'Failed to set reminder',
        variant: 'destructive',
      });
    } finally {
      isSettingReminderRef.current = false;
    }
  }, [setReminder, toast]);

  const handleCancelReminder = useCallback(async (channelId: string, programStart: string) => {
    console.log('[Reminder] Cancelling reminder for channel:', channelId);
    try {
      await cancelReminder(channelId, programStart);
      haptics.notification('warning');
      toast({
        title: 'Reminder Cancelled',
        description: 'You will no longer be notified',
      });
      // Close the modal after cancelling
      setGuideInfoModal(null);
    } catch (error) {
      console.error('[Reminder] Error cancelling reminder:', error);
    }
  }, [cancelReminder, toast]);

  // ============================================================================
  // KEYBOARD NAVIGATION
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Reset overlay timeout
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
      }
      setShowOverlay(true);
      overlayTimeoutRef.current = setTimeout(() => {
        if (viewMode === 'player') setShowOverlay(false);
      }, 5000);

      if (viewMode === 'player') {
        switch (e.key) {
          case 'ArrowUp':
            // Hide overlay when pressing up
            if (showOverlay) {
              setShowOverlay(false);
              if (overlayTimeoutRef.current) {
                clearTimeout(overlayTimeoutRef.current);
              }
            }
            break;
          case 'ArrowDown':
            if (!showOverlay) {
              // First down press: show overlay
              setShowOverlay(true);
            } else {
              // Second down press: open guide
              setViewMode('guide');
              // Set focus to current channel in guide
              const currentIdx = selectedChannel
                ? channels.findIndex((ch: Channel) => ch.iptvId === selectedChannel.iptvId)
                : 0;
              setFocusedChannelIndex(Math.max(0, currentIdx));
            }
            break;
          case 'Enter':
          case ' ':
            if (isPlaying && videoRef.current) {
              videoRef.current.pause();
              setIsPlaying(false);
            } else if (selectedChannel) {
              // Start playing the selected channel
              playStream(selectedChannel);
            }
            break;
          case 'm':
          case 'M':
            setIsMuted(!isMuted);
            if (videoRef.current) videoRef.current.muted = !isMuted;
            break;
          case 'Escape':
          case 'Backspace':
            setShowOverlay(!showOverlay);
            break;
        }
      } else if (viewMode === 'guide') {
        switch (e.key) {
          case 'ArrowUp':
            if (focusedChannelIndex === 0) {
              // At top channel - go back to video
              setViewMode('player');
            } else {
              setFocusedChannelIndex(prev => prev - 1);
            }
            break;
          case 'ArrowDown':
            setFocusedChannelIndex(prev => Math.min(channels.length - 1, prev + 1));
            break;
          case 'Enter':
            if (focusedChannel) {
              selectChannelFromGuide(focusedChannel);
            }
            break;
          case 'Escape':
          case 'Backspace':
            setViewMode('player');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, channels, selectedChannel, focusedChannel, isPlaying, isMuted, showOverlay, changeChannel, selectChannelFromGuide]);

  // ============================================================================
  // TOUCH/SWIPE GESTURE HANDLERS
  // ============================================================================

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return;

    const touchEndY = e.changedTouches[0].clientY;
    const touchEndX = e.changedTouches[0].clientX;
    const deltaY = touchStartY.current - touchEndY;
    const deltaX = Math.abs(touchStartX.current - touchEndX);

    const TAP_THRESHOLD = 10;
    const isTap = Math.abs(deltaY) < TAP_THRESHOLD && deltaX < TAP_THRESHOLD;

    // In landscape mode with video playing (player/guide only), or in portrait player mode, tap toggles overlay
    // Don't toggle overlay on home/profile pages - those are locked to portrait on phones
    const shouldToggleOverlay = isTap && (viewMode === 'player' || (!isPortrait && selectedChannel && (viewMode === 'player' || viewMode === 'guide')));
    if (shouldToggleOverlay) {
      // Tap to toggle overlay visibility
      if (showOverlay) {
        setShowOverlay(false);
        if (overlayTimeoutRef.current) {
          clearTimeout(overlayTimeoutRef.current);
        }
      } else {
        setShowOverlay(true);
        if (overlayTimeoutRef.current) {
          clearTimeout(overlayTimeoutRef.current);
        }
        overlayTimeoutRef.current = setTimeout(() => {
          setShowOverlay(false);
        }, 5000);
      }
    }

    // Reset touch tracking
    touchStartY.current = null;
    touchStartX.current = null;
  }, [viewMode, showOverlay, selectedChannel, channels]);

  // Handle guide scroll to load EPG data for visible channels (debounced)
  const handleGuideScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const rowHeight = 56; // h-14 = 56px
    const newScrollIndex = Math.floor(scrollTop / rowHeight);

    // Clear any pending debounce
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }

    // Debounce scroll updates - wait 200ms after scrolling stops
    // Only update if scrolled at least 20 rows to batch requests
    scrollDebounceRef.current = setTimeout(() => {
      if (Math.abs(newScrollIndex - guideScrollIndex) >= 20) {
        setGuideScrollIndex(newScrollIndex);
      }
    }, 200);
  }, [guideScrollIndex]);

  // Detect portrait/landscape on native platforms using Capacitor ScreenOrientation API
  useEffect(() => {
    if (!isNativePlatform()) {
      setIsPortrait(false);
      return;
    }

    let lastOrientation: boolean | null = null;
    let rotationTimeout: ReturnType<typeof setTimeout> | null = null;

    const checkOrientation = (fromRotation = false) => {
      const portrait = window.innerWidth < window.innerHeight;
      if (portrait !== lastOrientation) {
        lastOrientation = portrait;
        setIsPortrait(portrait);
      }
      // Clear rotating state after a longer delay to allow React to render new guide
      if (fromRotation) {
        if (rotationTimeout) clearTimeout(rotationTimeout);
        rotationTimeout = setTimeout(() => setIsRotating(false), 350);
      }
    };

    // Check immediately on mount
    lastOrientation = window.innerWidth < window.innerHeight;
    setIsPortrait(lastOrientation);

    // Check if we should ignore orientation changes (home/profile on phone)
    const shouldIgnoreOrientationChange = () => {
      const currentViewMode = viewModeRef.current;
      return isPhoneDevice && (currentViewMode === 'home' || currentViewMode === 'profile');
    };

    // Use Capacitor ScreenOrientation API for reliable detection
    const setupOrientationListener = async () => {
      try {
        await ScreenOrientation.addListener('screenOrientationChange', (info) => {
          // On home/profile on phones, ignore orientation changes (locked to portrait)
          if (shouldIgnoreOrientationChange()) {
            return;
          }
          setIsRotating(true); // Show black screen immediately
          // Update state based on new orientation
          const portrait = info.type.includes('portrait');
          if (portrait !== lastOrientation) {
            lastOrientation = portrait;
            setIsPortrait(portrait);
          }
          // Clear rotating after React renders - use longer delay for smoother transition
          if (rotationTimeout) clearTimeout(rotationTimeout);
          rotationTimeout = setTimeout(() => setIsRotating(false), 350);
        });
      } catch (e) {
        // Fallback to window events if Capacitor API fails
        console.log('ScreenOrientation API not available, using fallback');
      }
    };
    setupOrientationListener();

    // Fallback: Listen for resize as backup
    const handleResize = () => {
      if (!shouldIgnoreOrientationChange()) {
        checkOrientation(false);
      }
    };
    window.addEventListener('resize', handleResize);

    // Fallback: window orientationchange event
    const handleOrientationChange = () => {
      // On home/profile on phones, ignore orientation changes (locked to portrait)
      if (shouldIgnoreOrientationChange()) {
        return;
      }
      setIsRotating(true); // Show black screen immediately
      setTimeout(() => checkOrientation(true), 50);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    // Re-check when app regains focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkOrientation(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (rotationTimeout) clearTimeout(rotationTimeout);
      ScreenOrientation.removeAllListeners();
    };
  }, []);

  // No auto-play - user starts from Home page and selects a channel manually

  // Save last watched channel to localStorage
  useEffect(() => {
    if (selectedChannel?.iptvId) {
      localStorage.setItem('lastWatchedChannelId', selectedChannel.iptvId);
    }
  }, [selectedChannel]);

  // Native Tab Bar for iOS - show in portrait mode only
  // Track latest state in refs to avoid stale closures
  const isPortraitRef = useRef(isPortrait);
  const isRotatingRef = useRef(isRotating);
  isPortraitRef.current = isPortrait;
  isRotatingRef.current = isRotating;

  const tabBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabBarCurrentState = useRef<boolean | null>(null); // null = unknown, true = shown, false = hidden
  const showSplashRef = useRef(showSplash);
  showSplashRef.current = showSplash;

  useEffect(() => {
    if (!isIOSNative()) {
      setUseNativeTabBar(false);
      return;
    }

    // Clear any pending action
    if (tabBarTimer.current) {
      clearTimeout(tabBarTimer.current);
      tabBarTimer.current = null;
    }

    // Determine if we should show: portrait AND not rotating AND splash is done
    const shouldShow = isPortrait && !isRotating && !showSplash;

    // Skip if already in desired state
    if (tabBarCurrentState.current === shouldShow) {
      return;
    }

    // Debounce all state changes to prevent rapid switching
    tabBarTimer.current = setTimeout(() => {
      // Re-check current conditions using refs (they reflect latest values)
      const stillShouldShow = isPortraitRef.current && !isRotatingRef.current && !showSplashRef.current;

      if (stillShouldShow && tabBarCurrentState.current !== true) {
        tabBarCurrentState.current = true;
        showNativeTabBar().then((shown) => {
          setUseNativeTabBar(shown);
        });
      } else if (!stillShouldShow && tabBarCurrentState.current !== false) {
        tabBarCurrentState.current = false;
        hideNativeTabBar();
        setUseNativeTabBar(false);
      }
    }, shouldShow ? 200 : 50); // Longer debounce for show, shorter for hide

    return () => {
      if (tabBarTimer.current) {
        clearTimeout(tabBarTimer.current);
      }
    };
  }, [isPortrait, isRotating, showSplash]);

  // Listen for native tab bar selections
  useEffect(() => {
    if (!isIOSNative()) return;

    let listener: any = null;

    const setupListener = async () => {
      listener = await addNativeTabBarListener((tabId) => {
        haptics.light();
        switch (tabId) {
          case 'home':
            setViewMode('home');
            break;
          case 'nowplaying':
            setViewMode('player');
            break;
          case 'events':
            setViewMode('events');
            break;
          case 'guide':
            setViewMode('guide');
            break;
          case 'profile':
            setViewMode('profile');
            break;
        }
      });
    };

    setupListener();

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, [handleAirPlay]);

  // Configure native tab bar tabs based on feature access
  useEffect(() => {
    if (!isIOSNative() || eventsAccessLoading) return;

    // Build tabs array based on feature access
    const tabs = ['home', 'nowplaying'];
    if (hasEventsAccess) {
      tabs.push('events');
    }
    tabs.push('guide', 'profile');

    console.log('[TabBar] Setting tabs based on events access:', hasEventsAccess, tabs);
    setNativeTabBarTabs(tabs);
  }, [hasEventsAccess, eventsAccessLoading]);

  // Lock orientation to portrait for home/profile pages on phones (not tablets)
  useEffect(() => {
    if (!isNativePlatform()) return;

    const deviceType = getDeviceTypeSync();
    const isTablet = deviceType === 'tablet';

    // On tablets, allow all orientations for all views
    // On phones, lock to portrait for home, events, and profile pages
    const lockToPortrait = async () => {
      if (!isTablet && (viewMode === 'home' || viewMode === 'events' || viewMode === 'profile')) {
        try {
          await ScreenOrientation.lock({ orientation: 'portrait' });
        } catch (e) {
          console.log('[Orientation] Failed to lock:', e);
        }
      } else {
        try {
          await ScreenOrientation.unlock();
        } catch (e) {
          console.log('[Orientation] Failed to unlock:', e);
        }
      }
    };

    lockToPortrait();
  }, [viewMode]);

  // Auto-scroll guide to keep focused channel visible
  useEffect(() => {
    if (viewMode === 'guide' && guideScrollRef.current) {
      const rowHeight = 56; // h-14 = 56px
      const scrollContainer = guideScrollRef.current;
      const targetScroll = focusedChannelIndex * rowHeight - scrollContainer.clientHeight / 2 + rowHeight / 2;
      scrollContainer.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [focusedChannelIndex, viewMode]);

  // Track previous viewMode to detect when guide is opened
  const prevViewModeRef = useRef(viewMode);

  // Auto-scroll to currently playing channel when guide is opened
  useEffect(() => {
    const wasGuide = prevViewModeRef.current === 'guide';
    prevViewModeRef.current = viewMode;

    // Only scroll when entering guide view (not when already in guide)
    if (viewMode === 'guide' && !wasGuide && selectedChannel && guideScrollRef.current) {
      // Find the index of the playing channel in filtered list
      const playingIndex = filteredChannels.findIndex(
        (ch: Channel) => ch.iptvId === selectedChannel.iptvId
      );

      if (playingIndex >= 0) {
        const scrollContainer = guideScrollRef.current;
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
          // Find the actual element in the scroll container
          const channelElements = scrollContainer.children;
          if (channelElements[playingIndex]) {
            const element = channelElements[playingIndex] as HTMLElement;
            // Scroll so the playing channel is at the top
            scrollContainer.scrollTo({ top: element.offsetTop, behavior: 'smooth' });
          }
        }, 150);
      }
    }
  }, [viewMode, selectedChannel, filteredChannels]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current);
      // Release stream on unmount
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (streamSessionToken.current) {
        // Use sendBeacon for reliable cleanup on page unload
        navigator.sendBeacon(
          buildApiUrl('/api/iptv/stream/release'),
          JSON.stringify({ sessionToken: streamSessionToken.current })
        );
      }
    };
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================


  return (
    <div
      className="relative w-screen h-screen bg-black overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Splash Screen - renders immediately with no delays */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center"
          >
            {/* Animated particles background */}
            <div className="absolute inset-0 overflow-hidden">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 h-1 bg-white/20 rounded-full"
                  initial={{
                    x: Math.random() * (typeof window !== 'undefined' ? window.innerWidth : 400),
                    y: Math.random() * (typeof window !== 'undefined' ? window.innerHeight : 800),
                  }}
                  animate={{
                    y: [null, -100],
                    opacity: [0, 0.5, 0],
                  }}
                  transition={{
                    duration: 3 + Math.random() * 2,
                    repeat: Infinity,
                    delay: Math.random() * 2,
                  }}
                />
              ))}
            </div>

            {/* Gradient glow effect */}
            <div className="absolute inset-0 bg-gradient-radial from-blue-900/20 via-transparent to-transparent" />

            {/* App Logo - only show when settings loaded */}
            {settings?.logo_url_large && (
              <div className="relative">
                {/* Logo glow */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="absolute w-64 h-64 bg-blue-600/20 rounded-full blur-[80px]" />
                </div>

                {/* App Logo */}
                <img
                  src={settings.logo_url_large}
                  alt="Logo"
                  className="relative w-24 h-24 object-contain"
                />
              </div>
            )}

            {/* App Name - shows immediately */}
            <h1 className="mt-6 text-2xl font-bold text-white tracking-wide">
              {settings?.site_title || 'Stylus One'}
            </h1>

            {/* Pulsing blue loading line - shows immediately */}
            <div className="mt-8 w-32 h-1 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-500 to-transparent rounded-full"
                animate={{ x: ['-100%', '400%'] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Network Status Indicator - positioned below notch */}
      <AnimatePresence>
        {showOfflineIndicator && (
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            className={cn(
              "fixed left-4 right-4 z-50 py-3 px-4 text-center text-sm font-medium rounded-xl shadow-lg",
              isOnline ? "bg-green-600 text-white" : "bg-red-600 text-white"
            )}
            style={{
              top: isNativePlatform() ? 'calc(env(safe-area-inset-top, 44px) + 8px)' : '16px'
            }}
          >
            {isOnline ? 'Back Online' : 'No Internet Connection'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Video Element - Full screen, PiP, or Portrait top */}
      <motion.div
        className="absolute bg-black"
        initial={{
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          borderRadius: 0
        }}
        animate={
          viewMode === 'guide' && isPortrait && isNativePlatform() ? {
            // Portrait guide - large video in video area (below search bar)
            top: 140,
            left: 16,
            right: 16,
            bottom: 'auto',
            width: 'calc(100vw - 32px)',
            height: 'calc((100vw - 32px) * 0.5625)',
            zIndex: 35,
            borderRadius: 12
          } : viewMode === 'guide' ? {
            // Landscape guide - PiP in corner
            top: 24,
            right: 24,
            left: 'auto',
            bottom: 'auto',
            width: 320,
            height: 180,
            zIndex: 30,
            borderRadius: 12
          } : isPortrait && isNativePlatform() && !isAirPlaying ? {
            // Portrait player mode - video below notch with 16:9 aspect
            top: 50,
            left: 0,
            right: 0,
            bottom: 'auto',
            width: '100%',
            height: '56.25vw',
            zIndex: 10,
            borderRadius: 0
          } : {
            // Landscape player mode - fullscreen
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            zIndex: 0,
            borderRadius: 0
          }
        }
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-contain [&::-webkit-media-controls]:hidden [&::-webkit-media-controls-enclosure]:hidden [&::-webkit-media-controls-panel]:hidden [&::-webkit-media-controls-play-button]:hidden [&::-webkit-media-controls-start-playback-button]:hidden"
          playsInline
          muted={isMuted}
          controls={false}
          autoPlay={false}
          preload="none"
          poster="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
          style={{ WebkitAppearance: 'none' } as React.CSSProperties}
          {...(airPlayEnabled ? { 'x-webkit-airplay': 'allow' } : {})}
        />
        {/* Loading Indicator - inside video container, with TMDB thumbnail background if available */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-30">
            {/* TMDB thumbnail background - only if available */}
            {currentEPG?.currentProgram?.thumbnail && (
              <div className="absolute inset-0">
                <img
                  src={currentEPG.currentProgram.thumbnail}
                  alt=""
                  className="w-full h-full object-cover opacity-40"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/40" />
              </div>
            )}
            {/* Loading content */}
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
              <p className="text-white text-lg font-medium">
                {streamError ? streamError : 'Loading Stream'}
              </p>
              {currentChannel && (
                <p className="text-white/60 text-sm mt-1">{currentChannel.GuideName}</p>
              )}
            </div>
          </div>
        )}
        {/* Stream Error - when max retries reached */}
        {!isLoading && streamError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black z-30">
            <div className="w-12 h-12 mb-4 text-red-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-white text-lg font-medium">{streamError}</p>
            <button
              onClick={(e) => { e.stopPropagation(); setStreamError(null); retryCountRef.current = 0; if (selectedChannel) playStream(selectedChannel); }}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); setStreamError(null); retryCountRef.current = 0; if (selectedChannel) playStream(selectedChannel); }}
              className="mt-4 px-6 py-2 bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-full text-white text-sm transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
        {/* No channel selected - prompt user to select one */}
        {!isLoading && !selectedChannel && (viewMode === 'player' || viewMode === 'guide') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black rounded-xl">
            <Play className={cn("text-white/30 mb-2", viewMode === 'guide' ? "w-8 h-8" : "w-12 h-12 mb-4")} />
            <p className={cn("text-white font-medium", viewMode === 'guide' ? "text-sm" : "text-lg")}>No Channel Selected</p>
            {viewMode === 'player' && (
              <p className="text-white/50 text-sm mt-1">Choose a channel from Home or Guide</p>
            )}
          </div>
        )}
        {/* Tap zone for portrait video to toggle overlay */}
        {isPortrait && isNativePlatform() && viewMode === 'player' && !isAirPlaying && (
          <div
            className="absolute inset-0 z-20"
            onClick={() => setShowOverlay(prev => !prev)}
            onTouchEnd={(e) => { e.preventDefault(); setShowOverlay(prev => !prev); }}
          />
        )}
        {/* PiP button - top right corner (portrait player mode, dismisses on tap away) */}
        {isPortrait && isNativePlatform() && viewMode === 'player' && !isLoading && selectedChannel && showOverlay && (
          <div className="absolute top-2 right-2 z-30">
            <button
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handlePiP(); }}
              onClick={(e) => { e.stopPropagation(); handlePiP(); }}
              className="w-10 h-10 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95"
            >
              <PictureInPicture2 className="w-5 h-5 text-white" />
            </button>
          </div>
        )}
        {viewMode === 'guide' && !isLoading && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="text-xs text-white truncate">{currentChannel?.GuideName}</div>
          </div>
        )}
      </motion.div>

      {/* Portrait AirPlay Remote UI */}
      {isPortrait && isNativePlatform() && viewMode === 'player' && isAirPlaying && (
        <div className="absolute inset-0 bg-black flex flex-col z-40 pt-14">
          {/* AirPlay Status - small indicator at top */}
          <div className="flex items-center justify-center gap-2 py-3">
            <Airplay className="w-4 h-4 text-blue-400" />
            <span className="text-blue-400 text-xs">AirPlay Connected</span>
          </div>

          {/* Spacer to push content toward center */}
          <div className="flex-1" />

          {/* Program Details - Centered in screen */}
          <div className="px-8 pb-6">
            {/* Channel Logo & Name */}
            <div className="flex items-center justify-center gap-3 mb-4">
              {currentChannel?.logo && (
                <img
                  key={`airplay-logo-${currentChannel.iptvId || currentChannel.GuideNumber}`}
                  src={currentChannel.logo}
                  alt=""
                  className="h-10 max-w-24 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span className="text-white/60 text-base">{currentChannel?.GuideName}</span>
            </div>
            {/* Program Title */}
            <h2 className="text-white text-2xl font-bold text-center mb-2">{currentEPG?.currentProgram?.title || 'Live TV'}</h2>
            {/* Description */}
            {currentEPG?.currentProgram?.description && (
              <p className="text-white/40 text-sm text-center line-clamp-2 mb-4">{currentEPG.currentProgram.description}</p>
            )}
            {/* Timeline */}
            {currentEPG?.currentProgram && (
              <div className="max-w-xs mx-auto">
                <div className="h-1 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${getProgramProgress(currentEPG.currentProgram)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-white/40">
                  <span>{new Date(currentEPG.currentProgram.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  <span>{getTimeRemaining(currentEPG.currentProgram.endTime) ? `${getTimeRemaining(currentEPG.currentProgram.endTime)} left` : ''}</span>
                  <span>{new Date(currentEPG.currentProgram.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls - Play/Pause centered, Up/Down on sides */}
          <div className="px-8 pb-4">
            <div className="flex items-center justify-center gap-10">
              <button
                onTouchEnd={(e) => { e.preventDefault(); changeChannel('up'); }}
                onClick={() => changeChannel('up')}
                className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center active:bg-white/20"
              >
                <ChevronUp className="w-7 h-7 text-white" />
              </button>
              <button
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (videoRef.current) {
                    if (isPlaying) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    } else {
                      videoRef.current.play();
                      setIsPlaying(true);
                    }
                  }
                }}
                onClick={() => {
                  if (videoRef.current) {
                    if (isPlaying) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    } else {
                      videoRef.current.play();
                      setIsPlaying(true);
                    }
                  }
                }}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-10 h-10 text-black" />
                ) : (
                  <Play className="w-10 h-10 text-black ml-1" />
                )}
              </button>
              <button
                onTouchEnd={(e) => { e.preventDefault(); changeChannel('down'); }}
                onClick={() => changeChannel('down')}
                className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center active:bg-white/20"
              >
                <ChevronDown className="w-7 h-7 text-white" />
              </button>
            </div>
          </div>

          {/* Action Buttons - Favorites & AirPlay */}
          <div className="flex items-center justify-center gap-4 pb-4">
            <button
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); haptics.light(); toggleFavorite(selectedChannel!); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptics.light(); toggleFavorite(selectedChannel!); }}
              disabled={!selectedChannel}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full active:scale-95 active:bg-white/20 disabled:opacity-50"
            >
              <Star className={cn("w-5 h-5", selectedChannel && favorites.some(f => f.channelId === selectedChannel.iptvId) ? "text-yellow-400 fill-yellow-400" : "text-white")} />
              <span className="text-white text-sm font-medium">Favorite</span>
            </button>
            <button
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleAirPlay(); }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAirPlay(); }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500 rounded-full active:scale-95"
            >
              <Airplay className="w-5 h-5 text-white" />
              <span className="text-white text-sm font-medium">AirPlay</span>
            </button>
          </div>

          {/* Mute Button */}
          <div className="flex justify-center pb-6">
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                haptics.light();
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                if (videoRef.current) videoRef.current.muted = newMuted;
              }}
              onClick={() => {
                haptics.light();
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                if (videoRef.current) videoRef.current.muted = newMuted;
              }}
              className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center active:scale-95",
                isMuted ? "bg-red-500/20" : "bg-white/10 active:bg-white/20"
              )}
            >
              {isMuted ? <VolumeX className="w-6 h-6 text-red-400" /> : <Volume2 className="w-6 h-6 text-white" />}
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

        </div>
      )}

      {/* Portrait Player UI - Controls positioned BELOW video area (not AirPlaying) */}
      {isPortrait && isNativePlatform() && viewMode === 'player' && !isAirPlaying && (
        <div
          className="absolute left-0 right-0 bottom-0 bg-black flex flex-col"
          style={{ top: 'calc(50px + 56.25vw)', zIndex: 15 }}
        >
          {/* Channel Bar - Fixed height */}
          <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10 h-[72px] shrink-0">
            {channelsLoading ? (
              <>
                {/* Skeleton loader - only when actually loading */}
                <div className="w-16 h-12 bg-white/10 rounded animate-pulse shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="h-5 w-32 bg-white/10 rounded animate-pulse mb-2" />
                  <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
                </div>
              </>
            ) : !currentChannel ? (
              <div className="flex-1" />
            ) : (
              <>
                {/* Fixed-width logo container for consistent layout */}
                <div className="w-16 h-12 shrink-0 flex items-center justify-center">
                  {currentChannel.logo && (
                    <img
                      key={currentChannel.iptvId || currentChannel.GuideNumber}
                      src={currentChannel.logo}
                      alt=""
                      className="max-h-12 max-w-16 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-white text-lg font-semibold truncate">{currentChannel.GuideName}</h2>
                    <span className="text-red-500 text-xs font-bold px-1.5 py-0.5 bg-red-500/20 rounded shrink-0">LIVE</span>
                  </div>
                  {currentEPG?.currentProgram && (
                    <p className="text-white/60 text-sm truncate mt-0.5">{currentEPG.currentProgram.title}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Program Info & Progress - Fixed height with scrollable content */}
          <div className="h-[140px] shrink-0 border-b border-white/10">
            {channelsLoading ? (
              <div className="px-4 py-3 h-full">
                <div className="flex justify-between items-center mb-2">
                  <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
                  <div className="h-4 w-16 bg-white/10 rounded animate-pulse" />
                </div>
                <div className="h-1.5 bg-white/10 rounded-full animate-pulse" />
                <div className="h-4 w-full bg-white/10 rounded animate-pulse mt-2" />
              </div>
            ) : !currentChannel ? (
              <div className="h-full" />
            ) : currentEPG?.currentProgram ? (
              (() => {
                // Extract season/episode from description if not in dedicated fields
                let season = currentEPG.currentProgram.season;
                let episode = currentEPG.currentProgram.episode;
                const desc = currentEPG.currentProgram.description || '';

                if (!season || !episode) {
                  // Try patterns like "S1 E5", "Season 1 Episode 5", "s01e05", "(S1, E5)"
                  const seMatch = desc.match(/[Ss](\d+)\s*[Ee](\d+)/);
                  const seasonEpMatch = desc.match(/[Ss]eason\s*(\d+).*?[Ee]pisode\s*(\d+)/i);
                  if (seMatch) {
                    season = parseInt(seMatch[1]);
                    episode = parseInt(seMatch[2]);
                  } else if (seasonEpMatch) {
                    season = parseInt(seasonEpMatch[1]);
                    episode = parseInt(seasonEpMatch[2]);
                  }
                }

                // Try to extract rating from description if not in dedicated field
                let rating = currentEPG.currentProgram.rating;
                if (!rating) {
                  const ratingMatch = desc.match(/\b(TV-Y7?|TV-G|TV-PG|TV-14|TV-MA|G|PG|PG-13|R|NC-17|NR)\b/i);
                  if (ratingMatch) {
                    rating = ratingMatch[1].toUpperCase();
                  }
                }

                // Clean description - remove season/episode and rating info if we extracted them
                let cleanDesc = desc;
                if (season && episode) {
                  cleanDesc = cleanDesc.replace(/[Ss]\d+\s*[Ee]\d+[:\s-]*/g, '').trim();
                  cleanDesc = cleanDesc.replace(/[Ss]eason\s*\d+.*?[Ee]pisode\s*\d+[:\s-]*/gi, '').trim();
                }

                return (
                  <div className="px-4 py-3 h-full flex flex-col overflow-hidden">
                    {/* Time & Progress - Fixed */}
                    <div className="flex justify-between items-center shrink-0">
                      <span className="text-white/50 text-sm">
                        {new Date(currentEPG.currentProgram.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(currentEPG.currentProgram.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span className="text-white/50 text-sm">{getTimeRemaining(currentEPG.currentProgram.endTime) ? `${getTimeRemaining(currentEPG.currentProgram.endTime)} left` : ''}</span>
                    </div>
                    <div className="h-1.5 bg-white/20 rounded-full overflow-hidden mt-2 shrink-0">
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{ width: `${getProgramProgress(currentEPG.currentProgram)}%` }}
                      />
                    </div>

                    {/* Season/Episode & Rating - Fixed */}
                    {(season || episode || rating) && (
                      <div className="flex items-center gap-2 flex-wrap mt-2 shrink-0">
                        {(season || episode) && (
                          <span className="text-white/70 text-sm font-medium bg-white/10 px-2 py-0.5 rounded">
                            {season && `S${season}`}
                            {season && episode && ' '}
                            {episode && `E${episode}`}
                          </span>
                        )}
                        {rating && (
                          <span className="text-white/60 text-xs font-medium bg-white/10 px-2 py-0.5 rounded border border-white/20">
                            {rating}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Episode Title (if different from main title) - Fixed */}
                    {currentEPG.currentProgram.episodeTitle && currentEPG.currentProgram.episodeTitle !== currentEPG.currentProgram.title && (
                      <p className="text-white/70 text-sm font-medium mt-2 shrink-0 truncate">"{currentEPG.currentProgram.episodeTitle}"</p>
                    )}

                    {/* Description - Scrollable in remaining space */}
                    {cleanDesc && (
                      <div className="flex-1 overflow-y-auto mt-2 min-h-0">
                        <p className="text-white/50 text-sm leading-relaxed">{cleanDesc}</p>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <div className="px-4 py-3 h-full flex items-center justify-center">
                <p className="text-white/30 text-sm">No program information available</p>
              </div>
            )}
          </div>

          {/* Playback Controls - Flexible height to fill space */}
          <div className="flex-1 flex flex-col justify-center min-h-[100px] gap-4">
            {/* Channel and Play/Pause Controls */}
            <div className="flex items-center justify-center gap-6">
              <button
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); changeChannel('up'); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); changeChannel('up'); }}
                className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center active:scale-95 active:bg-white/20"
              >
                <ChevronUp className="w-7 h-7 text-white" />
              </button>
              <button
                onTouchEnd={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (videoRef.current) {
                    if (isPlaying) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    } else {
                      videoRef.current.play();
                      setIsPlaying(true);
                    }
                  }
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (videoRef.current) {
                    if (isPlaying) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    } else {
                      videoRef.current.play();
                      setIsPlaying(true);
                    }
                  }
                }}
                className="w-20 h-20 bg-white rounded-full flex items-center justify-center active:scale-95"
              >
                {isPlaying ? (
                  <Pause className="w-10 h-10 text-black" />
                ) : (
                  <Play className="w-10 h-10 text-black ml-1" />
                )}
              </button>
              <button
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); changeChannel('down'); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); changeChannel('down'); }}
                className="w-14 h-14 bg-white/10 rounded-full flex items-center justify-center active:scale-95 active:bg-white/20"
              >
                <ChevronDown className="w-7 h-7 text-white" />
              </button>
            </div>

            {/* Action Buttons - Favorites & AirPlay */}
            <div className="flex items-center justify-center gap-4">
              <button
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); haptics.light(); toggleFavorite(selectedChannel!); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptics.light(); toggleFavorite(selectedChannel!); }}
                disabled={!selectedChannel}
                className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full active:scale-95 active:bg-white/20 disabled:opacity-50"
              >
                <Star className={cn("w-5 h-5", selectedChannel && favorites.some(f => f.channelId === selectedChannel.iptvId) ? "text-yellow-400 fill-yellow-400" : "text-white")} />
                <span className="text-white text-sm font-medium">Favorite</span>
              </button>
              <button
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleAirPlay(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAirPlay(); }}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-full active:scale-95",
                  isAirPlaying ? "bg-blue-500" : "bg-white/10 active:bg-white/20"
                )}
              >
                <Airplay className="w-5 h-5 text-white" />
                <span className="text-white text-sm font-medium">AirPlay</span>
              </button>
            </div>
          </div>

          {/* Bottom Action Bar - Hidden on iOS native (uses native tab bar instead) */}
          {!isIOSNative() && (
            <div className="shrink-0 px-4 pb-8 pt-3 flex items-center justify-around border-t border-white/10 bg-black">
              <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setViewMode('guide'); }} onClick={() => { haptics.light(); setViewMode('guide'); }} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <LayoutGrid className="w-6 h-6 text-white" />
                <span className="text-white text-xs font-medium">Guide</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setShowFavoritesPopup(true); }} onClick={() => { haptics.light(); setShowFavoritesPopup(true); }} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Star className="w-6 h-6 text-white/50 fill-white/50" />
                <span className="text-white/50 text-xs">Favorites</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); handleAirPlay(); }} onClick={handleAirPlay} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Airplay className="w-6 h-6 text-white/50" />
                <span className="text-white/50 text-xs">AirPlay</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); setShowMenuPopup(true); }} onClick={() => setShowMenuPopup(true)} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Settings className="w-6 h-6 text-white/50" />
                <span className="text-white/50 text-xs">Settings</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Black overlay during rotation - only for guide view to prevent flash */}
      {isRotating && isNativePlatform() && viewMode === 'guide' && (
        <div
          className="fixed inset-0 bg-black pointer-events-none"
          style={{ zIndex: 9999 }}
        />
      )}

      {/* Portrait Guide View - Plex-style with large video at top */}
      {/* CSS landscape:opacity-0 instantly hides when screen rotates, before React state updates */}
      {!isRotating && isPortrait && isNativePlatform() && viewMode === 'guide' && (
        <div
          className="absolute inset-0 bg-black flex flex-col landscape:opacity-0 landscape:pointer-events-none animate-viewSlideUp"
          style={{ zIndex: 30 }}
        >
          {/* Header with close button and search */}
          <div className="shrink-0 pt-16 px-4 pb-4 flex items-center gap-2">
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                setViewMode('player');
                setGuideSearchQuery('');
                setGuideTimeOffset(0);
                console.log('[Guide] Closing guide, setting tab to nowplaying');
                setNativeTabBarSelected('nowplaying').then(() => console.log('[Guide] Tab selection complete'));
              }}
              onClick={() => {
                setViewMode('player');
                setGuideSearchQuery('');
                setGuideTimeOffset(0);
                console.log('[Guide] Closing guide, setting tab to nowplaying');
                setNativeTabBarSelected('nowplaying').then(() => console.log('[Guide] Tab selection complete'));
              }}
              className="p-2 bg-white/10 rounded-full active:bg-white/20 shrink-0"
            >
              <X className="w-5 h-5 text-white" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                inputMode="search"
                enterKeyHint="search"
                placeholder="Search channels..."
                value={guideSearchQuery}
                onChange={(e) => setGuideSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  e.stopPropagation();
                }}
                className="w-full h-10 pl-10 pr-4 bg-white/10 rounded-full text-white text-sm placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
              />
            </div>
            {/* Package filter button - opens dropdown */}
            {userPackages.length > 0 && (
              <button
                onTouchEnd={(e) => { e.preventDefault(); setShowPackageDropdown(!showPackageDropdown); haptics.light(); }}
                onClick={() => { setShowPackageDropdown(!showPackageDropdown); haptics.light(); }}
                className={cn(
                  "shrink-0 h-10 px-3 rounded-full flex items-center gap-1.5",
                  showPackageDropdown ? "bg-white/20" : "bg-white/10 active:bg-white/20"
                )}
              >
                <Package className="w-4 h-4 text-white/70" />
                <span className="text-white text-sm max-w-24 truncate">
                  {hiddenPackages.size > 0 ? `${userPackages.length - hiddenPackages.size}/${userPackages.length}` : 'All'}
                </span>
                <ChevronDown className={cn("w-4 h-4 text-white/50 transition-transform", showPackageDropdown && "rotate-180")} />
              </button>
            )}
          </div>

          {/* Video player area - more space from header */}
          <div className="relative mx-4 mt-10 aspect-video">
            {/* Video positioned here via motion.div animate */}
          </div>

          {/* Current Channel Info */}
          <div className="px-4 py-2 flex items-center gap-3 border-b border-white/10">
            {channelsLoading ? (
              <>
                <div className="h-8 w-12 bg-white/10 rounded animate-pulse" />
                <div className="flex-1 min-w-0">
                  <div className="h-4 w-24 bg-white/10 rounded animate-pulse mb-1" />
                  <div className="h-3 w-32 bg-white/10 rounded animate-pulse" />
                </div>
              </>
            ) : !currentChannel ? (
              <>
                <Play className="w-8 h-8 text-white/20" />
                <div className="flex-1 min-w-0">
                  <p className="text-white/50 text-sm">No channel selected</p>
                  <p className="text-white/30 text-xs">Tap a channel below to start</p>
                </div>
              </>
            ) : (
              <>
                {currentChannel.logo && (
                  <img
                    key={`guide-logo-${currentChannel.iptvId || currentChannel.GuideNumber}`}
                    src={currentChannel.logo}
                    alt=""
                    className="h-8 max-w-16 object-contain"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-white text-sm font-medium">{currentChannel.GuideName}</span>
                  {currentEPG?.currentProgram && (
                    <p className="text-white/50 text-xs truncate">{currentEPG.currentProgram.title}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Timeline Header - "Today" + current time + arrows */}
          <div className="shrink-0 py-2.5 px-4 flex items-center border-b border-white/10 bg-black/50">
            {/* Today label */}
            <div className="shrink-0 bg-white/10 rounded-full px-3 py-1.5">
              <span className="text-white text-sm font-medium">
                {(() => {
                  const now = new Date();
                  const displayTime = new Date(now);
                  displayTime.setTime(displayTime.getTime() + guideTimeOffset * 30 * 60 * 1000);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const displayDay = new Date(displayTime);
                  displayDay.setHours(0, 0, 0, 0);
                  const dayDiff = Math.round((displayDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
                  if (dayDiff === 0) return 'Today';
                  if (dayDiff === 1) return 'Tomorrow';
                  return displayTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                })()}
              </span>
            </div>
            {/* Current time slot */}
            <div className="flex-1 px-4">
              <span className="text-white/70 text-sm">
                {(() => {
                  const now = new Date();
                  const displayTime = new Date(now);
                  displayTime.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
                  displayTime.setTime(displayTime.getTime() + guideTimeOffset * 30 * 60 * 1000);
                  return displayTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                })()}
              </span>
            </div>
            {/* Navigation arrows */}
            <div className="flex items-center gap-1 shrink-0">
              {guideTimeOffset > 0 && (
                <button
                  onTouchEnd={(e) => { e.preventDefault(); setGuideTimeOffset(0); haptics.light(); }}
                  onClick={() => { setGuideTimeOffset(0); haptics.light(); }}
                  className="px-2 py-1 rounded-full bg-red-600 text-white text-xs font-medium mr-1 active:bg-red-700"
                >
                  Now
                </button>
              )}
              <button
                onTouchEnd={(e) => { e.preventDefault(); if (guideTimeOffset > 0) { setGuideTimeOffset(guideTimeOffset - 1); haptics.light(); } }}
                onClick={() => { if (guideTimeOffset > 0) { setGuideTimeOffset(guideTimeOffset - 1); haptics.light(); } }}
                className={cn("p-2 rounded-full bg-white/10", guideTimeOffset > 0 ? "active:bg-white/20" : "opacity-30")}
                disabled={guideTimeOffset === 0}
              >
                <ChevronLeft className="w-4 h-4 text-white" />
              </button>
              <button
                onTouchEnd={(e) => { e.preventDefault(); if (guideTimeOffset < 336) { setGuideTimeOffset(guideTimeOffset + 1); haptics.light(); } }}
                onClick={() => { if (guideTimeOffset < 336) { setGuideTimeOffset(guideTimeOffset + 1); haptics.light(); } }}
                className={cn("p-2 rounded-full bg-white/10", guideTimeOffset < 336 ? "active:bg-white/20" : "opacity-30")}
                disabled={guideTimeOffset >= 336}
              >
                <ChevronRight className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Channel List */}
          <div
            ref={guideScrollRef}
            className="flex-1 overflow-y-auto relative"
            onScroll={(e) => {
              handleGuideScroll(e);
              guideDidScroll.current = true;
            }}
            onTouchStart={(e) => {
              guideTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              guideDidScroll.current = false;
            }}
            onTouchMove={() => {
              guideDidScroll.current = true;
            }}
          >
            {filteredChannels.slice(0, renderLimit).map((channel: Channel, index: number) => {
              const channelEpg = epgDataMap.get(channel.iptvId || '');
              const isCurrentChannel = selectedChannel?.iptvId === channel.iptvId;

              // Calculate time-shifted programs based on guideTimeOffset
              const offsetTime = new Date();
              offsetTime.setMinutes(offsetTime.getMinutes() < 30 ? 0 : 30, 0, 0);
              offsetTime.setTime(offsetTime.getTime() + guideTimeOffset * 30 * 60 * 1000);
              const offsetMs = offsetTime.getTime();

              // Find program playing at offset time
              const shiftedCurrentProgram = channelEpg?.programs?.find(p => {
                const start = new Date(p.startTime).getTime();
                const end = new Date(p.endTime).getTime();
                return start <= offsetMs && offsetMs < end;
              }) || null;

              // Find next program after current
              const shiftedNextProgram = channelEpg?.programs?.find(p => {
                const start = new Date(p.startTime).getTime();
                return shiftedCurrentProgram
                  ? start >= new Date(shiftedCurrentProgram.endTime).getTime()
                  : start > offsetMs;
              }) || null;

              const timeRemaining = shiftedCurrentProgram ? getTimeRemaining(shiftedCurrentProgram.endTime) : '';

              return (
                <div
                  key={channel.iptvId || index}
                  className={cn(
                    "w-full flex items-stretch select-none",
                    isCurrentChannel && "bg-white/5"
                  )}
                  style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                >
                  {/* Fixed Left Section - Favorite + Logo */}
                  <div className="shrink-0 flex items-center gap-1 pl-2 pr-1 py-2">
                    {/* Favorite Star Button */}
                    <button
                      onTouchStart={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        touchStartY.current = null;
                        longPressChannel.current = null;
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current);
                          longPressTimer.current = null;
                        }
                      }}
                      onTouchEnd={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleChannelFavorite(channel);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        toggleChannelFavorite(channel);
                      }}
                      className="shrink-0 w-7 flex items-center justify-center"
                    >
                      <Star className={cn(
                        "w-4 h-4",
                        favorites.some(f => f.channelId === (channel.iptvId || ''))
                          ? "text-yellow-400 fill-yellow-400"
                          : "text-white/30"
                      )} />
                    </button>

                    {/* Channel Logo - tap to play channel */}
                    <div
                      onClick={() => {
                        // Ignore clicks on mobile - handled by onTouchEnd
                        if ('ontouchstart' in window) return;
                        console.log('[Portrait Guide] LOGO TAP - playing channel:', channel.GuideName);
                        playStream(channel);
                        setViewMode('player');
                        setGuideSearchQuery('');
                      }}
                      onTouchEnd={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Don't trigger if user was scrolling
                        if (guideDidScroll.current) {
                          console.log('[Portrait Guide] Ignoring logo touch - was scrolling');
                          return;
                        }
                        console.log('[Portrait Guide] LOGO TOUCH - playing channel:', channel.GuideName);
                        playStream(channel);
                        setViewMode('player');
                        setGuideSearchQuery('');
                      }}
                      className="shrink-0 w-11 h-8 flex items-center justify-center bg-white/10 rounded cursor-pointer active:bg-white/20"
                    >
                      {channel.logo ? (
                        <img
                          src={channel.logo}
                          alt=""
                          className="max-w-[36px] max-h-[28px] object-contain pointer-events-none"
                          loading="lazy"
                          draggable={false}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-white/40 text-xs font-medium pointer-events-none">{channel.GuideNumber}</span>
                      )}
                    </div>
                  </div>

                  {/* Scrollable Programs Section */}
                  <div className="flex-1 overflow-x-auto scrollbar-hide py-2 pr-2">
                    <div className="flex gap-2 min-w-max">
                      {/* Current Program (at offset time) - tap to show info modal */}
                      <div
                        onClick={() => {
                          // Ignore clicks on mobile - handled by onTouchEnd
                          if ('ontouchstart' in window) return;
                          if (shiftedCurrentProgram) {
                            console.log('[Portrait Guide] PROGRAM TAP - opening info for:', shiftedCurrentProgram.title);
                            setGuideInfoModal({ program: shiftedCurrentProgram, channel });
                          } else {
                            console.log('[Portrait Guide] NO PROGRAM - playing channel:', channel.GuideName);
                            playStream(channel);
                            setViewMode('player');
                            setGuideSearchQuery('');
                          }
                        }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Don't trigger if user was scrolling
                          if (guideDidScroll.current) {
                            console.log('[Portrait Guide] Ignoring touch - was scrolling');
                            return;
                          }
                          if (shiftedCurrentProgram) {
                            console.log('[Portrait Guide] PROGRAM TOUCH - opening info for:', shiftedCurrentProgram.title);
                            setGuideInfoModal({ program: shiftedCurrentProgram, channel });
                          } else {
                            console.log('[Portrait Guide] NO PROGRAM TOUCH - playing channel:', channel.GuideName);
                            playStream(channel);
                            setViewMode('player');
                            setGuideSearchQuery('');
                          }
                        }}
                        className={cn(
                          "w-40 shrink-0 text-left py-1.5 px-2.5 rounded-lg border cursor-pointer active:ring-2 active:ring-white/30",
                          isCurrentChannel ? "border-white/30 bg-white/10" : "border-white/10"
                        )}
                      >
                        <p
                          key={shiftedCurrentProgram?.title || 'no-program'}
                          className={cn(
                            "text-sm truncate font-medium pointer-events-none",
                            isCurrentChannel ? "text-white" : "text-white/90",
                            shiftedCurrentProgram && "animate-fadeSlideIn"
                          )}
                        >
                          {shiftedCurrentProgram?.title || channel.GuideName}
                        </p>
                        <p className="text-white/50 text-xs pointer-events-none">{timeRemaining ? `${timeRemaining} left` : 'Live'}</p>
                      </div>

                      {/* Next Program (at offset time) - tap to show info modal */}
                      {shiftedNextProgram && (
                        <div
                          onClick={() => {
                            // Ignore clicks on mobile - handled by onTouchEnd
                            if ('ontouchstart' in window) return;
                            console.log('[Portrait Guide] NEXT PROGRAM TAP - opening info for:', shiftedNextProgram.title);
                            setGuideInfoModal({ program: shiftedNextProgram, channel });
                          }}
                          onTouchEnd={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Don't trigger if user was scrolling
                            if (guideDidScroll.current) {
                              console.log('[Portrait Guide] Ignoring touch - was scrolling');
                              return;
                            }
                            console.log('[Portrait Guide] NEXT PROGRAM TOUCH - opening info for:', shiftedNextProgram.title);
                            setGuideInfoModal({ program: shiftedNextProgram, channel });
                          }}
                          className="w-36 shrink-0 text-left py-1.5 px-2.5 rounded-lg border border-white/5 bg-white/5 cursor-pointer active:ring-2 active:ring-white/30"
                        >
                          <p key={shiftedNextProgram.title} className="text-white/70 text-sm truncate animate-fadeSlideIn pointer-events-none">{shiftedNextProgram.title}</p>
                          <p className="text-white/40 text-xs pointer-events-none">
                            {new Date(shiftedNextProgram.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredChannels.length === 0 && guideSearchQuery && (
              <div className="px-4 py-8 text-center text-white/50">
                No channels found for "{guideSearchQuery}"
              </div>
            )}
          </div>

          {/* Bottom Tab Bar - Hidden on iOS native (uses native tab bar instead) */}
          {!isIOSNative() && (
            <div className="shrink-0 px-4 pb-8 pt-3 flex items-center justify-around border-t border-white/10 bg-black">
              <button onTouchEnd={(e) => { e.preventDefault(); setViewMode('player'); setGuideSearchQuery(''); }} onClick={() => { setViewMode('player'); setGuideSearchQuery(''); }} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <LayoutGrid className="w-6 h-6 text-white" />
                <span className="text-white text-xs font-medium">Guide</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); setShowFavoritesPopup(!showFavoritesPopup); }} onClick={() => setShowFavoritesPopup(!showFavoritesPopup)} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Star className="w-6 h-6 text-white/50 fill-white/50" />
                <span className="text-white/50 text-xs">Favorites</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); handleAirPlay(); }} onClick={handleAirPlay} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Airplay className="w-6 h-6 text-white/50" />
                <span className="text-white/50 text-xs">AirPlay</span>
              </button>
              <button onTouchEnd={(e) => { e.preventDefault(); setShowMenuPopup(true); }} onClick={() => setShowMenuPopup(true)} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
                <Settings className="w-6 h-6 text-white/50" />
                <span className="text-white/50 text-xs">Settings</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Portrait Guide Package Dropdown - rendered outside container, positioned below header */}
      {!isRotating && isPortrait && isNativePlatform() && viewMode === 'guide' && showPackageDropdown && userPackages.length > 0 && (
        <div
          className="fixed right-4 bg-zinc-900 rounded-xl border border-white/10 shadow-xl max-h-80 overflow-y-auto min-w-48"
          style={{ zIndex: 9999, top: 'calc(env(safe-area-inset-top, 44px) + 56px + 48px)' }}
          onTouchStart={(e) => {
            dropdownTouchStartY.current = e.touches[0].clientY;
            dropdownDidScroll.current = false;
          }}
          onTouchMove={(e) => {
            if (dropdownTouchStartY.current !== null) {
              const deltaY = Math.abs(e.touches[0].clientY - dropdownTouchStartY.current);
              if (deltaY > 10) dropdownDidScroll.current = true;
            }
          }}
        >
          <div className="px-4 py-2.5 text-xs font-medium text-white/50 uppercase tracking-wider">
            Channel Packages
          </div>
          {/* Show All button */}
          <button
            onTouchEnd={(e) => {
              e.preventDefault();
              if (dropdownDidScroll.current) return;
              haptics.selection();
              setHiddenPackages(new Set());
            }}
            onClick={() => { haptics.selection(); setHiddenPackages(new Set()); }}
            className={cn(
              "w-full px-4 py-2 text-left text-sm border-t border-white/5",
              hiddenPackages.size === 0 ? "bg-white/10 text-white" : "text-white/70 active:bg-white/5"
            )}
          >
            Show All Packages
          </button>
          {/* Individual package toggles */}
          {userPackages.map((pkg) => {
            const isVisible = !hiddenPackages.has(pkg.packageId);
            return (
              <button
                key={pkg.packageId}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  if (dropdownDidScroll.current) return;
                  haptics.selection();
                  setHiddenPackages(prev => {
                    const newSet = new Set(prev);
                    if (isVisible) {
                      newSet.add(pkg.packageId);
                    } else {
                      newSet.delete(pkg.packageId);
                    }
                    return newSet;
                  });
                }}
                onClick={() => {
                  haptics.selection();
                  setHiddenPackages(prev => {
                    const newSet = new Set(prev);
                    if (isVisible) {
                      newSet.add(pkg.packageId);
                    } else {
                      newSet.delete(pkg.packageId);
                    }
                    return newSet;
                  });
                }}
                className="w-full px-4 py-2.5 text-left text-sm border-t border-white/5 flex items-center justify-between active:bg-white/5"
              >
                <span className={isVisible ? "text-white" : "text-white/40"}>{pkg.packageName}</span>
                <div className={cn(
                  "w-5 h-5 rounded flex items-center justify-center",
                  isVisible ? "bg-blue-500" : "bg-white/10"
                )}>
                  {isVisible && <Check className="w-3.5 h-3.5 text-white" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Player Overlay - In landscape mode with video playing, or landscape player mode */}
      {/* Don't show landscape player on home/profile pages on phones - those are locked to portrait */}
      <AnimatePresence>
        {showOverlay && !isPortrait && selectedChannel && (viewMode === 'player' || viewMode === 'guide') && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10"
          >
            {/* Bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-96 bg-gradient-to-t from-black via-black/80 to-transparent" />

            {/* PiP & AirPlay - Top Right (landscape) */}
            {isNativePlatform() && (
              <div className="absolute top-8 right-8 flex items-center gap-3 z-20">
                <button
                  onClick={(e) => { e.stopPropagation(); handlePiP(); }}
                  className="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 hover:bg-black/70"
                >
                  <PictureInPicture2 className="w-6 h-6 text-white" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleAirPlay(); }}
                  className={cn(
                    "w-12 h-12 backdrop-blur-sm rounded-full flex items-center justify-center active:scale-95 hover:bg-black/70",
                    isAirPlaying ? "bg-blue-500" : "bg-black/50"
                  )}
                >
                  <Airplay className="w-6 h-6 text-white" />
                </button>
              </div>
            )}

            {/* YouTube TV Style Program Info - Only show if EPG data available */}
            {currentEPG?.currentProgram && (
              <div className="absolute bottom-44 left-16 max-w-2xl">
                {/* Time Range */}
                <div className="text-white/70 text-xl mb-1">
                  {formatTimeRange(currentEPG.currentProgram.startTime, currentEPG.currentProgram.endTime)}
                </div>

                {/* Metadata Line: Rating • Season/Episode • Episode Title */}
                {(() => {
                  // Try to extract season/episode from description if not in dedicated fields
                  let season = currentEPG.currentProgram.season;
                  let episode = currentEPG.currentProgram.episode;
                  const desc = currentEPG.currentProgram.description || '';

                  if (!season || !episode) {
                    // Try patterns like "S1 E5", "Season 1 Episode 5", "s01e05", "(S1, E5)"
                    const seMatch = desc.match(/[Ss](\d+)\s*[Ee](\d+)/);
                    const seasonEpMatch = desc.match(/[Ss]eason\s*(\d+).*?[Ee]pisode\s*(\d+)/i);
                    if (seMatch) {
                      season = parseInt(seMatch[1]);
                      episode = parseInt(seMatch[2]);
                    } else if (seasonEpMatch) {
                      season = parseInt(seasonEpMatch[1]);
                      episode = parseInt(seasonEpMatch[2]);
                    }
                  }

                  const hasSeasonEpisode = season && episode;
                  const hasEpisodeTitle = !!currentEPG.currentProgram.episodeTitle;
                  const hasRating = !!currentEPG.currentProgram.rating;

                  if (!hasRating && !hasSeasonEpisode && !hasEpisodeTitle) return null;

                  return (
                    <div className="text-white/60 text-lg mb-2 flex items-center gap-2">
                      {hasRating && (
                        <>
                          <span>{currentEPG.currentProgram.rating}</span>
                          {(hasSeasonEpisode || hasEpisodeTitle) && <span className="text-white/40">•</span>}
                        </>
                      )}
                      {hasSeasonEpisode && (
                        <>
                          <span>S{season} E{episode}</span>
                          {hasEpisodeTitle && <span className="text-white/40">•</span>}
                        </>
                      )}
                      {hasEpisodeTitle && (
                        <span>{currentEPG.currentProgram.episodeTitle}</span>
                      )}
                    </div>
                  );
                })()}

                {/* Large Program Title */}
                <h1 key={currentEPG.currentProgram.title} className="text-5xl font-bold text-white animate-fadeSlideIn">
                  {currentEPG.currentProgram.title}
                </h1>
              </div>
            )}

            {/* Progress Bar - Full width just above controls */}
            {currentEPG?.currentProgram && (
              <div className="absolute bottom-24 left-16 right-16">
                <div className="h-1.5 bg-white/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-1000"
                    style={{ width: `${getProgramProgress(currentEPG.currentProgram)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-red-500 text-sm font-bold tracking-wider">LIVE</span>
                  <span className="text-white/70 text-sm">{getTimeRemaining(currentEPG.currentProgram.endTime) ? `${getTimeRemaining(currentEPG.currentProgram.endTime)} left` : ''}</span>
                </div>
              </div>
            )}

            {/* Channel Selector - Bottom Left, aligned with progress bar */}
            <div className="absolute bottom-2 left-16">
              <div className="relative flex flex-col items-center">
                {/* Channel Up - positioned above logo */}
                <button
                  onClick={(e) => { e.stopPropagation(); changeChannel('up'); }}
                  className="p-1 text-white/60 hover:text-white active:scale-95 transition-all"
                >
                  <ChevronUp className="w-5 h-5" />
                </button>

                {/* Channel Logo + Name - at same level as play/pause button */}
                <div className="flex items-center gap-2 py-1">
                  {currentChannel?.logo && (
                    <img
                      key={`landscape-logo-${currentChannel.iptvId || currentChannel.GuideNumber}`}
                      src={currentChannel.logo}
                      alt=""
                      className="h-6 max-w-20 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="text-white text-sm font-medium">{currentChannel?.GuideName}</span>
                </div>

                {/* Channel Down - positioned below logo */}
                <button
                  onClick={(e) => { e.stopPropagation(); changeChannel('down'); }}
                  className="p-1 text-white/60 hover:text-white active:scale-95 transition-all"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Controls Bar - Bottom Center */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
              <PlaybackControls
                isPlaying={isPlaying}
                isMuted={isMuted}
                onPlayPause={() => {
                  if (videoRef.current) {
                    if (isPlaying) {
                      videoRef.current.pause();
                      setIsPlaying(false);
                    } else {
                      videoRef.current.play();
                      setIsPlaying(true);
                    }
                  }
                }}
                onMute={() => {
                  setIsMuted(!isMuted);
                  if (videoRef.current) videoRef.current.muted = !isMuted;
                }}
              />
            </div>

            {/* Action Buttons - Bottom Right */}
            <div className="absolute bottom-8 right-8 flex items-center gap-3">
              {/* Guide Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setViewMode('guide');
                  const currentIdx = selectedChannel
                    ? channels.findIndex((ch: Channel) => ch.iptvId === selectedChannel.iptvId)
                    : 0;
                  setFocusedChannelIndex(Math.max(0, currentIdx));
                }}
                className="flex items-center gap-2 px-4 py-2 hover:bg-white/20 rounded-lg text-white transition-all active:scale-95 active:bg-white/10"
              >
                <LayoutGrid className="w-5 h-5" />
                <span className="text-sm font-medium">Guide</span>
              </button>

              <ActionButtons
                onShowFavorites={() => setShowFavoritesPopup(true)}
                onShowInfo={() => setShowInfoModal(true)}
                onShowMenu={() => setShowMenuPopup(true)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guide View - Landscape on native, always on non-native */}
      {/* CSS portrait:opacity-0 instantly hides on native when screen rotates to portrait */}
      {!isRotating && viewMode === 'guide' && !(isPortrait && isNativePlatform()) && (
      <div className={cn(
        "absolute inset-0 bg-black/95 z-20 flex flex-col animate-in fade-in duration-150",
        isNativePlatform() && "portrait:opacity-0 portrait:pointer-events-none"
      )}>
            {/* Top section - Program details on left, PiP space on right */}
            <div className="h-60 shrink-0 flex relative">
              {/* Close Button + Search - Top Left, aligned with channel column */}
              <div className="absolute top-6 left-16 flex items-center gap-4 z-10">
                <button
                  onClick={() => { setViewMode('player'); setGuideSearchQuery(''); setNativeTabBarSelected('nowplaying'); }}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all active:scale-95"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    type="text"
                    placeholder="Search channels..."
                    value={guideSearchQuery}
                    onChange={(e) => setGuideSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      e.stopPropagation();
                    }}
                    className="w-64 h-10 pl-9 pr-3 bg-white/10 hover:bg-white/15 rounded-lg text-white text-sm placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/30 transition-colors"
                  />
                </div>
                {/* Package Filter Button & Dropdown */}
                {userPackages.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => { setShowPackageDropdown(!showPackageDropdown); haptics.light(); }}
                      className={cn(
                        "h-10 px-3 rounded-lg text-white text-sm transition-colors flex items-center gap-2",
                        showPackageDropdown ? "bg-white/20" : "bg-white/10 hover:bg-white/15"
                      )}
                    >
                      <Package className="w-4 h-4 text-white/70" />
                      <span>
                        {hiddenPackages.size > 0 ? `${userPackages.length - hiddenPackages.size}/${userPackages.length} Packages` : 'All Packages'}
                      </span>
                      <ChevronDown className={cn("w-4 h-4 text-white/50 transition-transform", showPackageDropdown && "rotate-180")} />
                    </button>
                    {/* Dropdown */}
                    {showPackageDropdown && (
                      <div className="absolute top-12 right-0 bg-zinc-900 rounded-xl border border-white/10 shadow-xl max-h-80 overflow-y-auto min-w-56 z-50">
                        <div className="px-4 py-2.5 text-xs font-medium text-white/50 uppercase tracking-wider">
                          Channel Packages
                        </div>
                        <button
                          onClick={() => { haptics.selection(); setHiddenPackages(new Set()); }}
                          className={cn(
                            "w-full px-4 py-2 text-left text-sm border-t border-white/5",
                            hiddenPackages.size === 0 ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5"
                          )}
                        >
                          Show All Packages
                        </button>
                        {userPackages.map((pkg) => {
                          const isVisible = !hiddenPackages.has(pkg.packageId);
                          return (
                            <button
                              key={pkg.packageId}
                              onClick={() => {
                                haptics.selection();
                                setHiddenPackages(prev => {
                                  const newSet = new Set(prev);
                                  if (isVisible) {
                                    newSet.add(pkg.packageId);
                                  } else {
                                    newSet.delete(pkg.packageId);
                                  }
                                  return newSet;
                                });
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm border-t border-white/5 flex items-center justify-between hover:bg-white/5"
                            >
                              <span className={isVisible ? "text-white" : "text-white/40"}>{pkg.packageName}</span>
                              <div className={cn(
                                "w-5 h-5 rounded flex items-center justify-center",
                                isVisible ? "bg-blue-500" : "bg-white/10"
                              )}>
                                {isVisible && <Check className="w-3.5 h-3.5 text-white" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Program Details - fills left side, aligned with search bar */}
              <div className="flex-1 flex items-end pb-4 pl-16 pt-24">
                <FocusedProgramPanel channel={focusedChannel} program={focusedEPG?.currentProgram || null} />
              </div>
              {/* Space for PiP video (320px + padding) */}
              <div className="w-96 shrink-0" />
            </div>

            {/* Timeline Header */}
            <div className="shrink-0 border-t border-white/10">
              <TimelineHeader
                slots={timelineSlots}
                onPrev={() => { if (guideTimeOffset > 0) { setGuideTimeOffset(guideTimeOffset - 1); haptics.light(); } }}
                onNext={() => { if (guideTimeOffset < 336) { setGuideTimeOffset(guideTimeOffset + 1); haptics.light(); } }}
                canGoPrev={guideTimeOffset > 0}
                canGoNext={guideTimeOffset < 336}
              />
            </div>

            {/* Channel Grid - takes remaining space, supports horizontal scrolling, pb-24 for tab bar */}
            <div
              ref={guideScrollRef}
              className="flex-1 overflow-auto pb-24"
              onScroll={(e) => {
                handleGuideScroll(e);
                guideDidScroll.current = true;
              }}
              onTouchStart={(e) => {
                guideTouchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                guideDidScroll.current = false;
              }}
              onTouchMove={() => {
                guideDidScroll.current = true;
              }}
            >
              {filteredChannels.slice(0, renderLimit).map((channel: Channel, index: number) => (
                <GuideChannelRow
                  key={channel.iptvId || channel.GuideNumber}
                  channel={channel}
                  epgData={epgDataMap.get(channel.iptvId || '')}
                  timelineStart={timelineStart}
                  timelineEnd={timelineEnd}
                  isFocused={focusedChannelIndex === index}
                  isPlaying={selectedChannel?.iptvId === channel.iptvId}
                  isFavorite={favorites.some(f => f.channelId === (channel.iptvId || ''))}
                  onSelect={() => selectChannelFromGuide(channel)}
                  onToggleFavorite={() => toggleChannelFavorite(channel)}
                  onProgramClick={(program) => setGuideInfoModal({ program, channel })}
                  wasScrolling={() => guideDidScroll.current}
                />
              ))}
              {filteredChannels.length === 0 && guideSearchQuery && (
                <div className="px-8 py-12 text-center text-white/50">
                  No channels found for "{guideSearchQuery}"
                </div>
              )}
            </div>

      </div>
      )}

      {/* Portrait Home View - Apple TV+ Style */}
      {/* On phones: always render (orientation locked). On tablets: only in portrait */}
      {!isRotating && isNativePlatform() && viewMode === 'home' && (isPhoneDevice || isPortrait) && (
        <div
          className="absolute inset-0 bg-black flex flex-col animate-viewSlideUp"
          style={{ zIndex: 30 }}
        >
          {/* Minimal Header */}
          <div className="shrink-0 pt-16 px-5 pb-2">
            <h1 className="text-3xl font-bold text-white tracking-tight">Watch Now</h1>
          </div>

          {/* Scrollable Content - pb-24 allows content to scroll under tab bar */}
          <div className="flex-1 overflow-y-auto pb-24">

            {/* Featured - First Favorite (Large Card) */}
            {favorites && favorites.length > 0 && (() => {
              const fav = favorites[0];
              const channel = channels.find(c => c.iptvId === fav.channelId);
              if (!channel) return null;
              const channelEpg = epgDataMap.get(channel.iptvId || '');
              const thumbnail = channelEpg?.currentProgram?.thumbnail;
              const channelLogo = fav.channelLogo || channel.logo;
              const progress = getProgramProgress(channelEpg?.currentProgram);
              const timeLeft = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : null;
              const category = channel.categoryName;
              const rating = channelEpg?.currentProgram?.rating;

              return (
                <div className="px-5 mb-6 mt-4">
                  <div
                    className="relative rounded-2xl overflow-hidden active:scale-[0.98] transition-transform duration-200"
                    onClick={() => { haptics.medium(); playStream(channel); setViewMode('player'); }}
                  >
                    <div className="aspect-[16/9]">
                      {thumbnail ? (
                        <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : channelLogo ? (
                        <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-12">
                          <img src={channelLogo} alt="" className="max-w-[60%] max-h-[60%] object-contain opacity-80" />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-zinc-900" />
                      )}
                    </div>
                    {/* Top badges row */}
                    <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
                      {/* Category tag */}
                      {category && (
                        <span className="px-2 py-1 bg-white/20 backdrop-blur-sm rounded text-white text-[10px] font-medium uppercase tracking-wide">
                          {category}
                        </span>
                      )}
                      {/* Rating badge */}
                      {rating && (
                        <span className="px-1.5 py-0.5 border border-white/40 rounded text-white/90 text-[10px] font-medium">
                          {rating}
                        </span>
                      )}
                    </div>
                    {/* Play button */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                        <Play className="w-8 h-8 text-white ml-1" fill="white" />
                      </div>
                    </div>
                    {/* Bottom info overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                      <div className="flex items-start gap-4">
                        {/* Channel logo */}
                        {channelLogo && (
                          <div className="shrink-0 w-14 h-14 rounded-lg bg-white/10 p-2 flex items-center justify-center">
                            <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-white font-semibold text-xl">{fav.channelName || channel.GuideName}</p>
                          {channelEpg?.currentProgram && (
                            <div className="flex items-center gap-2 mt-1">
                              <p className="text-white/60 text-sm truncate">{channelEpg.currentProgram.title}</p>
                              {timeLeft && (
                                <span className="text-white/40 text-xs shrink-0">• {timeLeft}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Progress bar */}
                      {progress > 0 && (
                        <div className="mt-3 h-1 bg-white/20 rounded-full overflow-hidden">
                          <div className="h-full bg-white/80 rounded-full" style={{ width: `${progress}%` }} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Favorites - Remaining Favorites */}
            {favorites && favorites.length > 1 && (
              <div className="mb-6 relative z-10">
                <h2 className="px-5 text-xl font-semibold text-white/90 mb-4">Favorites</h2>
                <div className="flex gap-4 overflow-x-auto overflow-y-hidden px-5 scrollbar-hide">
                  {favorites.slice(1).map((fav) => {
                    const channel = channels.find(c => c.iptvId === fav.channelId);
                    if (!channel) return null;
                    const channelEpg = epgDataMap.get(channel.iptvId || '');
                    const thumbnail = channelEpg?.currentProgram?.thumbnail;
                    const channelLogo = fav.channelLogo || channel.logo;
                    const progress = getProgramProgress(channelEpg?.currentProgram);
                    const timeLeft = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : null;
                    const rating = channelEpg?.currentProgram?.rating;

                    return (
                      <div
                        key={fav.channelId}
                        className="shrink-0 w-72 active:scale-[0.97] transition-transform duration-200"
                        onClick={() => { haptics.light(); playStream(channel); setViewMode('player'); }}
                      >
                        <div className="relative rounded-xl overflow-hidden mb-3">
                          <div className="aspect-video">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : channelLogo ? (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-6">
                                <img src={channelLogo} alt="" className="max-w-[50%] max-h-[50%] object-contain opacity-70" />
                              </div>
                            ) : (
                              <div className="w-full h-full bg-zinc-900" />
                            )}
                          </div>
                          {/* Rating badge top-right */}
                          {rating && (
                            <div className="absolute top-2 right-2">
                              <span className="px-1.5 py-0.5 bg-black/60 backdrop-blur-sm border border-white/30 rounded text-white/90 text-[9px] font-medium">
                                {rating}
                              </span>
                            </div>
                          )}
                          {/* Play button */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                              <Play className="w-6 h-6 text-white ml-0.5" fill="white" />
                            </div>
                          </div>
                          {/* Progress bar at bottom */}
                          {progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                              <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        {/* Channel info with logo on left */}
                        <div className="flex items-start gap-3">
                          {channelLogo && (
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-zinc-800 p-1.5 flex items-center justify-center">
                              <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium text-sm truncate">{fav.channelName || channel.GuideName}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <p className="text-white/40 text-xs truncate flex-1">
                                {channelEpg?.currentProgram?.title || 'No program info'}
                              </p>
                              {timeLeft && (
                                <span className="text-white/30 text-[10px] shrink-0">{timeLeft}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section Divider */}
            {favorites && favorites.length > 0 && (nflPackage || nbaPackage || mlbPackage) && (
              <div className="px-5 mb-4">
                <div className="h-px bg-white/10" />
              </div>
            )}

            {/* No Favorites - Clean empty state */}
            {(!favorites || favorites.length === 0) && (
              <div className="px-5 mb-4 mt-2">
                <div className="rounded-2xl bg-zinc-900/50 p-8 text-center">
                  <p className="text-white/60 text-lg font-medium">No favorites yet</p>
                  <p className="text-white/30 text-sm mt-2">Add channels from the Guide tab</p>
                </div>
              </div>
            )}

            {/* Trending Section */}
            {trendingChannels.length > 0 && (
              <div className="mb-6 relative z-10">
                <div className="px-5 mb-4 flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-orange-500" />
                  <h2 className="text-xl font-semibold text-white/90">Trending</h2>
                </div>
                <div className="flex gap-4 overflow-x-auto overflow-y-hidden px-5 scrollbar-hide">
                  <AnimatePresence mode="popLayout">
                    {trendingChannels.map((trending) => {
                      const channel = channels.find(c => c.iptvId === trending.channelId);
                      if (!channel) return null;
                      const channelEpg = epgDataMap.get(channel.iptvId || '');
                      const thumbnail = channelEpg?.currentProgram?.thumbnail;
                      const channelLogo = trending.logo || channel.logo;
                      const progress = getProgramProgress(channelEpg?.currentProgram);
                      const timeLeft = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : null;

                      return (
                        <motion.div
                          key={trending.channelId}
                          layout
                          initial={false}
                          animate={{ opacity: 1, scale: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.9, x: -20 }}
                          transition={{
                            duration: 0.25,
                            layout: { duration: 0.25, ease: 'easeInOut' }
                          }}
                          className="shrink-0 w-72 active:scale-[0.97] transition-transform duration-200"
                          onClick={() => { haptics.light(); playStream(channel); setViewMode('player'); }}
                        >
                          <div className="relative rounded-xl overflow-hidden mb-3">
                            <div className="aspect-video">
                              {thumbnail ? (
                                <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                              ) : channelLogo ? (
                                <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-6">
                                  <img src={channelLogo} alt="" className="max-w-[50%] max-h-[50%] object-contain opacity-70" />
                                </div>
                              ) : (
                                <div className="w-full h-full bg-zinc-900" />
                              )}
                            </div>
                            {/* Top row badges */}
                            <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                              {/* Viewer count badge */}
                              <AnimatePresence mode="wait">
                                {trending.currentViewers > 0 && (
                                  <motion.div
                                    key="viewers"
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.8 }}
                                    transition={{ duration: 0.2 }}
                                    className="flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-sm rounded"
                                  >
                                    <Users className="w-3 h-3 text-white" />
                                    <motion.span
                                      key={trending.currentViewers}
                                      initial={{ opacity: 0 }}
                                      animate={{ opacity: 1 }}
                                      className="text-white text-[10px] font-medium"
                                    >
                                      {trending.currentViewers} watching
                                    </motion.span>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                              {/* Spacer when no viewers */}
                              {trending.currentViewers === 0 && <div />}
                              {/* Network logo */}
                              {channelLogo && thumbnail && (
                                <div className="w-8 h-8 rounded bg-black/40 backdrop-blur-sm p-1 flex items-center justify-center">
                                  <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain" />
                                </div>
                              )}
                            </div>
                            {/* Progress bar at bottom */}
                            {progress > 0 && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                                <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
                              </div>
                            )}
                          </div>
                          <p className="text-white font-medium text-sm">{trending.channelName}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-white/40 text-xs truncate flex-1">
                              {channelEpg?.currentProgram?.title || 'Live'}
                            </p>
                            {timeLeft && progress > 0 && (
                              <span className="text-white/30 text-[10px] shrink-0">{timeLeft}</span>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Section Divider - Between Trending and Sports */}
            {trendingChannels.length > 0 && (nflPackage || nbaPackage || mlbPackage) && (
              <div className="px-5 mb-4">
                <div className="h-px bg-white/10" />
              </div>
            )}

            {/* NFL Section - Large Cards */}
            {nflPackage && nflChannels.length > 0 && (
              <div className="mb-6 relative z-10">
                <div className="px-5 mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nfl.png&w=100&h=100" alt="NFL" className="h-6 w-6 object-contain" />
                    <h2 className="text-xl font-semibold text-white/90">NFL</h2>
                  </div>
                  <button
                    onClick={() => { haptics.light(); setScheduleModal('nfl'); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-white/70" />
                    <span className="text-sm text-white/70">Schedule</span>
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto overflow-y-hidden px-5 scrollbar-hide">
                  {nflChannels.map((pkgChannel) => {
                    const channel = channels.find(c => c.GuideName === pkgChannel.name || c.name === pkgChannel.name);
                    if (!channel) return null;
                    const channelEpg = epgDataMap.get(channel.iptvId || '');
                    const thumbnail = channelEpg?.currentProgram?.thumbnail;
                    const channelLogo = pkgChannel.logo || channel.logo;
                    const progress = getProgramProgress(channelEpg?.currentProgram);
                    const timeLeft = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : null;
                    const programTitle = channelEpg?.currentProgram?.title || '';
                    const isNoGame = programTitle.toLowerCase().includes('no game');

                    return (
                      <div
                        key={pkgChannel.id}
                        className="shrink-0 w-72 active:scale-[0.97] transition-transform duration-200"
                        onClick={() => { haptics.light(); playStream(channel); setViewMode('player'); }}
                      >
                        <div className="relative rounded-xl overflow-hidden mb-3">
                          <div className="aspect-video">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : channelLogo ? (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-6">
                                <img src={channelLogo} alt="" className="max-w-[50%] max-h-[50%] object-contain opacity-70" />
                              </div>
                            ) : (
                              <div className="w-full h-full bg-zinc-900" />
                            )}
                          </div>
                          {/* Top row badges */}
                          <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                            {/* LIVE badge - only show if there's an actual game */}
                            {!isNoGame && (
                              <div className="flex items-center gap-1 px-2 py-1 bg-red-600 rounded">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                </span>
                                <span className="text-white text-[10px] font-bold">LIVE</span>
                              </div>
                            )}
                            {isNoGame && <div />}
                            {/* Network logo */}
                            {channelLogo && thumbnail && (
                              <div className="w-8 h-8 rounded bg-black/40 backdrop-blur-sm p-1 flex items-center justify-center">
                                <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain" />
                              </div>
                            )}
                          </div>
                          {/* Progress bar at bottom */}
                          {progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                              <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        <p className="text-white font-medium text-sm">{pkgChannel.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-white/40 text-xs truncate flex-1">
                            {programTitle || 'Live'}
                          </p>
                          {timeLeft && progress > 0 && (
                            <span className="text-white/30 text-[10px] shrink-0">{timeLeft}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* NBA Section - Compact Cards for variety */}
            {nbaPackage && nbaChannels.length > 0 && (
              <div className="mb-6 relative z-10">
                <div className="px-5 mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nba.png&w=100&h=100" alt="NBA" className="h-6 w-6 object-contain" />
                    <h2 className="text-xl font-semibold text-white/90">NBA</h2>
                  </div>
                  <button
                    onClick={() => { haptics.light(); setScheduleModal('nba'); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-white/70" />
                    <span className="text-sm text-white/70">Schedule</span>
                  </button>
                </div>
                <div className="flex gap-3 overflow-x-auto overflow-y-hidden px-5 scrollbar-hide">
                  {nbaChannels.map((pkgChannel) => {
                    const channel = channels.find(c => c.GuideName === pkgChannel.name || c.name === pkgChannel.name);
                    if (!channel) return null;
                    const channelEpg = epgDataMap.get(channel.iptvId || '');
                    const channelLogo = pkgChannel.logo || channel.logo;
                    const progress = getProgramProgress(channelEpg?.currentProgram);
                    const programTitle = channelEpg?.currentProgram?.title || '';
                    const isNoGame = programTitle.toLowerCase().includes('no game');

                    return (
                      <div
                        key={pkgChannel.id}
                        className="shrink-0 w-36 active:scale-[0.97] transition-transform duration-200"
                        onClick={() => { haptics.light(); playStream(channel); setViewMode('player'); }}
                      >
                        <div className="relative rounded-xl overflow-hidden mb-2">
                          <div className="aspect-square">
                            {channelLogo ? (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-4">
                                <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain opacity-80" />
                              </div>
                            ) : (
                              <div className="w-full h-full bg-zinc-900 flex items-center justify-center">
                                <Tv className="w-8 h-8 text-zinc-700" />
                              </div>
                            )}
                          </div>
                          {/* LIVE badge - smaller (hidden for No Game) */}
                          {!isNoGame && (
                            <div className="absolute top-1.5 left-1.5 flex items-center gap-0.5 px-1.5 py-0.5 bg-red-600 rounded">
                              <span className="relative flex h-1 w-1">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1 w-1 bg-white"></span>
                              </span>
                              <span className="text-white text-[8px] font-bold">LIVE</span>
                            </div>
                          )}
                          {/* Progress bar at bottom */}
                          {progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/50">
                              <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        <p className="text-white font-medium text-xs text-center truncate">{pkgChannel.name}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Section Divider */}
            {(nflPackage || nbaPackage) && mlbPackage && (
              <div className="px-5 mb-4">
                <div className="h-px bg-white/10" />
              </div>
            )}

            {/* MLB Section - Large Cards */}
            {mlbPackage && mlbChannels.length > 0 && (
              <div className="mb-6 relative z-10">
                <div className="px-5 mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src="https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/mlb.png&w=100&h=100" alt="MLB" className="h-6 w-6 object-contain" />
                    <h2 className="text-xl font-semibold text-white/90">MLB</h2>
                  </div>
                  <button
                    onClick={() => { haptics.light(); setScheduleModal('mlb'); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 active:bg-white/20 transition-colors"
                  >
                    <Calendar className="w-4 h-4 text-white/70" />
                    <span className="text-sm text-white/70">Schedule</span>
                  </button>
                </div>
                <div className="flex gap-4 overflow-x-auto overflow-y-hidden px-5 scrollbar-hide">
                  {mlbChannels.map((pkgChannel) => {
                    const channel = channels.find(c => c.GuideName === pkgChannel.name || c.name === pkgChannel.name);
                    if (!channel) return null;
                    const channelEpg = epgDataMap.get(channel.iptvId || '');
                    const thumbnail = channelEpg?.currentProgram?.thumbnail;
                    const channelLogo = pkgChannel.logo || channel.logo;
                    const progress = getProgramProgress(channelEpg?.currentProgram);
                    const timeLeft = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : null;
                    const programTitle = channelEpg?.currentProgram?.title || '';
                    const isNoGame = programTitle.toLowerCase().includes('no game');

                    return (
                      <div
                        key={pkgChannel.id}
                        className="shrink-0 w-72 active:scale-[0.97] transition-transform duration-200"
                        onClick={() => { haptics.light(); playStream(channel); setViewMode('player'); }}
                      >
                        <div className="relative rounded-xl overflow-hidden mb-3">
                          <div className="aspect-video">
                            {thumbnail ? (
                              <img src={thumbnail} alt="" className="w-full h-full object-cover" />
                            ) : channelLogo ? (
                              <div className="w-full h-full flex items-center justify-center bg-zinc-900 p-6">
                                <img src={channelLogo} alt="" className="max-w-[50%] max-h-[50%] object-contain opacity-70" />
                              </div>
                            ) : (
                              <div className="w-full h-full bg-zinc-900" />
                            )}
                          </div>
                          {/* Top row badges */}
                          <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
                            {/* LIVE badge (hidden for No Game) */}
                            {!isNoGame ? (
                              <div className="flex items-center gap-1 px-2 py-1 bg-red-600 rounded">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                                </span>
                                <span className="text-white text-[10px] font-bold">LIVE</span>
                              </div>
                            ) : (
                              <div />
                            )}
                            {/* Network logo */}
                            {channelLogo && thumbnail && (
                              <div className="w-8 h-8 rounded bg-black/40 backdrop-blur-sm p-1 flex items-center justify-center">
                                <img src={channelLogo} alt="" className="max-w-full max-h-full object-contain" />
                              </div>
                            )}
                          </div>
                          {/* Progress bar at bottom */}
                          {progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                              <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                        <p className="text-white font-medium text-sm">{pkgChannel.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="text-white/40 text-xs truncate flex-1">
                            {channelEpg?.currentProgram?.title || 'Live'}
                          </p>
                          {timeLeft && progress > 0 && (
                            <span className="text-white/30 text-[10px] shrink-0">{timeLeft}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

        </div>
      )}

      {/* Portrait Profile View - User info, subscription, packages, logout */}
      {/* On phones: always render (orientation locked). On tablets: only in portrait */}
      {!isRotating && isNativePlatform() && viewMode === 'profile' && (isPhoneDevice || isPortrait) && (
        <div
          className="absolute inset-0 bg-black flex flex-col animate-viewSlideUp"
          style={{ zIndex: 30 }}
        >
          {/* Header */}
          <div className="shrink-0 pt-20 px-4 pb-4">
            <h1 className="text-2xl font-bold text-white">My Profile</h1>
          </div>

          {/* Profile Content */}
          <div className="flex-1 overflow-y-auto px-4 pb-24">
            {/* User Info Card */}
            <div className="bg-white/5 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
                  <span className="text-2xl text-white font-bold">
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-lg">{user?.username || 'User'}</p>
                  <p className="text-white/50 text-sm truncate">{user?.email || ''}</p>
                </div>
              </div>
            </div>

            {/* Subscription Info */}
            <div className="bg-white/5 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4 text-white/50" />
                <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider">Subscription</h3>
              </div>
              {subscriptionLoading ? (
                <div className="animate-pulse space-y-3">
                  <div className="flex justify-between">
                    <div className="h-5 w-24 bg-white/10 rounded" />
                    <div className="h-5 w-16 bg-white/10 rounded-full" />
                  </div>
                  <div className="h-10 w-full bg-white/10 rounded" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="h-8 bg-white/10 rounded" />
                    <div className="h-8 bg-white/10 rounded" />
                  </div>
                </div>
              ) : subscriptionData ? (
                <div className="space-y-3">
                  {/* Plan Name & Status */}
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-base font-semibold text-white">{subscriptionData.plan_name}</h4>
                      <p className="text-white/60 text-xs capitalize">{subscriptionData.billing_period} billing</p>
                    </div>
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium",
                      subscriptionData.status === 'active' ? "bg-green-500/20 text-green-400" :
                      subscriptionData.status === 'canceled' ? "bg-red-500/20 text-red-400" :
                      "bg-yellow-500/20 text-yellow-400"
                    )}>
                      {subscriptionData.status === 'active' ? 'Active' :
                       subscriptionData.status === 'canceled' ? 'Canceled' : subscriptionData.status}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="bg-white/5 rounded-lg p-3">
                    <div className="text-xl font-bold text-white">
                      ${((subscriptionData.billing_period === 'monthly'
                        ? subscriptionData.price_monthly
                        : subscriptionData.price_annual) / 100).toFixed(2)}
                      <span className="text-sm font-normal text-white/60">
                        /{subscriptionData.billing_period === 'monthly' ? 'mo' : 'yr'}
                      </span>
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-white/80">
                      <Calendar className="w-3.5 h-3.5 text-white/50 shrink-0" />
                      <div>
                        <p className="text-xs text-white/50">Started</p>
                        <p className="text-xs">{new Date(subscriptionData.current_period_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-white/80">
                      <Calendar className="w-3.5 h-3.5 text-white/50 shrink-0" />
                      <div>
                        <p className="text-xs text-white/50">
                          {subscriptionData.cancel_at_period_end ? 'Expires' : 'Renews'}
                        </p>
                        <p className="text-xs">{new Date(subscriptionData.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    </div>
                  </div>

                  {subscriptionData.cancel_at_period_end && (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5">
                      <p className="text-yellow-400 text-xs">
                        Your subscription will end on {new Date(subscriptionData.current_period_end).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
                      </p>
                    </div>
                  )}

                  {/* Manage Link */}
                  <button
                    onClick={() => window.open('https://stylus.services/my-subscription', '_blank')}
                    onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); window.open('https://stylus.services/my-subscription', '_blank'); }}
                    className="w-full py-2.5 bg-white/10 active:bg-white/20 rounded-lg text-white text-sm flex items-center justify-center gap-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Manage on Website
                  </button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <CreditCard className="w-10 h-10 text-white/30 mx-auto mb-3" />
                  <p className="text-white font-medium mb-1">No Active Subscription</p>
                  <p className="text-white/50 text-xs mb-3">Subscribe to access premium features</p>
                  <button
                    onClick={() => window.open('https://stylus.services/my-subscription', '_blank')}
                    onTouchEnd={(e) => { e.preventDefault(); window.open('https://stylus.services/my-subscription', '_blank'); }}
                    className="px-4 py-2 bg-red-600 active:bg-red-700 rounded-lg text-white text-sm flex items-center justify-center gap-2 mx-auto"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Subscribe Now
                  </button>
                </div>
              )}
            </div>

            {/* Channel Packages */}
            <div className="bg-white/5 rounded-xl p-4 mb-4">
              <h3 className="text-white/50 text-xs font-medium uppercase tracking-wider mb-3">Channel Packages</h3>
              <div className="space-y-2">
                {packagesLoading ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-10 w-full bg-white/10 rounded" />
                    <div className="h-10 w-full bg-white/10 rounded" />
                  </div>
                ) : userPackages.length > 0 ? (
                  userPackages.map((pkg) => (
                    <div key={pkg.packageId}>
                      <button
                        onClick={() => {
                          haptics.light();
                          setExpandedPackageId(prev => prev === pkg.packageId ? null : pkg.packageId);
                        }}
                        className="w-full flex items-center justify-between p-3 bg-white/5 rounded-lg active:bg-white/10"
                      >
                        <div className="flex items-center gap-3">
                          <Package className="w-5 h-5 text-blue-400" />
                          <div className="text-left">
                            <p className="text-white text-sm font-medium">{pkg.packageName}</p>
                            <p className="text-white/50 text-xs">{pkg.channelCount} channels</p>
                          </div>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-white/50 transition-transform ${expandedPackageId === pkg.packageId ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Expanded channel list */}
                      {expandedPackageId === pkg.packageId && (
                        <div className="mt-2 ml-8 space-y-1 max-h-48 overflow-y-auto">
                          {packageChannelsLoading ? (
                            <div className="animate-pulse space-y-1">
                              <div className="h-6 w-full bg-white/5 rounded" />
                              <div className="h-6 w-full bg-white/5 rounded" />
                              <div className="h-6 w-full bg-white/5 rounded" />
                            </div>
                          ) : packageChannels.length > 0 ? (
                            packageChannels.map((channel) => (
                              <div key={channel.id} className="flex items-center gap-2 py-1">
                                {channel.logo ? (
                                  <img src={channel.logo} alt="" className="w-5 h-5 rounded object-contain bg-white/10" />
                                ) : (
                                  <div className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center">
                                    <Tv className="w-3 h-3 text-zinc-500" />
                                  </div>
                                )}
                                <span className="text-white/70 text-xs truncate">{channel.name}</span>
                              </div>
                            ))
                          ) : (
                            <p className="text-white/40 text-xs">No channels in package</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-white/50 text-sm">No packages available</p>
                )}
              </div>
            </div>

            {/* Logout Button */}
            <button
              onTouchEnd={(e) => {
                e.preventDefault();
                haptics.warning();
                logoutMutation.mutate();
              }}
              onClick={() => {
                haptics.warning();
                logoutMutation.mutate();
              }}
              className="w-full bg-red-500/20 text-red-400 rounded-xl p-4 flex items-center justify-center gap-2 active:bg-red-500/30"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Log Out</span>
            </button>
          </div>

        </div>
      )}

      {/* Portrait Events View - Sports events and PPV channels */}
      {/* On phones: always render (orientation locked). On tablets: only in portrait */}
      {!isRotating && isNativePlatform() && viewMode === 'events' && (isPhoneDevice || isPortrait) && (
        <div
          className="absolute inset-0 bg-black flex flex-col animate-viewSlideUp"
          style={{ zIndex: 30 }}
        >
          {/* Header */}
          <div className="shrink-0 pt-20 px-5 pb-4">
            <h1 className="text-2xl font-bold text-white">Events</h1>
          </div>

          {/* Category Pills - Horizontal scroll */}
          <div className="shrink-0 flex gap-2 overflow-x-auto px-5 pb-4 scrollbar-hide">
            {([
              { id: 'all', label: 'All' },
              { id: 'nfl', label: 'NFL' },
              { id: 'nba', label: 'NBA' },
              { id: 'mlb', label: 'MLB' },
              { id: 'nhl', label: 'NHL' },
              { id: 'soccer', label: 'Soccer' },
              { id: 'basketball', label: 'Basketball' },
              { id: 'wrestling', label: 'Wrestling' },
              { id: 'winter', label: 'Winter' },
              { id: 'motorsports', label: 'Motorsports' },
              { id: 'tennis', label: 'Tennis' },
              { id: 'golf', label: 'Golf' },
              { id: 'other', label: 'Other' },
            ] as const).map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  haptics.light();
                  setEventsCategory(cat.id);
                }}
                className={cn(
                  "shrink-0 px-4 py-2 rounded-full text-sm font-medium transition",
                  eventsCategory === cat.id ? "bg-white text-black" : "bg-white/10 text-white active:bg-white/20"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Events Content */}
          <div className="flex-1 overflow-y-auto pb-24">
            {eventsLoading ? (
              <div className="px-5 space-y-6">
                {/* Loading skeleton */}
                <div>
                  <div className="h-6 w-24 bg-white/10 rounded mb-3" />
                  <div className="flex gap-4 overflow-hidden">
                    {[1, 2].map(i => (
                      <div key={i} className="shrink-0 w-72">
                        <div className="aspect-video bg-white/10 rounded-xl" />
                        <div className="h-4 w-48 bg-white/10 rounded mt-2" />
                        <div className="h-3 w-24 bg-white/10 rounded mt-1" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : !eventsData || (eventsData.live.length === 0 && eventsData.upcoming.length === 0 && eventsData.past.length === 0) ? (
              <div className="flex flex-col items-center justify-center h-full px-5 text-center">
                <Radio className="w-16 h-16 text-white/20 mb-4" />
                <h3 className="text-white font-semibold text-lg mb-2">No Events Found</h3>
                <p className="text-white/50 text-sm max-w-xs">
                  {eventsCategory !== 'all'
                    ? `No ${eventsCategory.toUpperCase()} events are currently available. Try a different category.`
                    : 'No live, upcoming, or recent events are available right now.'
                  }
                </p>
              </div>
            ) : (
              <>
                {/* Live Now Section */}
                {eventsData.live.length > 0 && (
                  <section className="mb-6">
                    <h2 className="px-5 text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                      </span>
                      Live Now
                    </h2>
                    <div className="flex gap-4 overflow-x-auto px-5 scrollbar-hide">
                      {eventsData.live.map((event: ParsedEvent) => (
                        <div
                          key={`${event.channelId}-${event.streamId}`}
                          className="shrink-0 w-72 active:scale-[0.97] transition-transform cursor-pointer"
                          onClick={() => {
                            haptics.light();
                            // Create a channel object to play
                            // Note: Don't call buildApiUrl here - playStream will do it
                            const channel: Channel = {
                              GuideName: event.eventName,
                              GuideNumber: event.networkNumber,
                              URL: event.streamUrl,
                              source: 'iptv',
                              iptvId: event.streamId,
                              logo: event.logo,
                            };
                            playStream(channel);
                            setViewMode('player');
                          }}
                        >
                          <div className="relative rounded-xl overflow-hidden">
                            <div className="aspect-video bg-zinc-900 flex items-center justify-center">
                              {event.logo ? (
                                <img src={event.logo} alt="" className="w-16 h-16 object-contain" />
                              ) : (
                                <Tv className="w-12 h-12 text-zinc-700" />
                              )}
                            </div>

                            {/* LIVE Badge */}
                            <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-1 bg-red-600 rounded">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute h-full w-full rounded-full bg-white opacity-75" />
                                <span className="relative rounded-full h-1.5 w-1.5 bg-white" />
                              </span>
                              <span className="text-white text-[10px] font-bold">LIVE</span>
                            </div>

                            {/* Time Remaining */}
                            {event.timeRemaining && (
                              <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 rounded text-white text-[10px]">
                                {event.timeRemaining}
                              </div>
                            )}

                            {/* Score (if available) */}
                            {event.score && event.teams && (
                              <div className="absolute bottom-10 left-0 right-0 text-center">
                                <span className="text-white text-2xl font-bold">
                                  {event.score.away} - {event.score.home}
                                </span>
                              </div>
                            )}

                            {/* Progress Bar */}
                            {event.progress !== undefined && (
                              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                                <div className="h-full bg-red-500" style={{ width: `${event.progress}%` }} />
                              </div>
                            )}
                          </div>

                          <p className="text-white font-medium text-sm mt-2 truncate">{event.eventName}</p>
                          <p className="text-white/40 text-xs">{event.network}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Upcoming Section */}
                {eventsData.upcoming.length > 0 && (
                  <section className="mb-6">
                    <h2 className="px-5 text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-white/50" />
                      Upcoming
                    </h2>
                    <div className="flex gap-4 overflow-x-auto px-5 scrollbar-hide">
                      {eventsData.upcoming.slice(0, 20).map((event: ParsedEvent) => (
                        <div
                          key={`${event.channelId}-${event.streamId}`}
                          className="shrink-0 w-56"
                        >
                          <div className="relative rounded-xl overflow-hidden bg-zinc-900">
                            <div className="aspect-video flex items-center justify-center">
                              {event.logo ? (
                                <img src={event.logo} alt="" className="w-12 h-12 object-contain opacity-60" />
                              ) : (
                                <Tv className="w-10 h-10 text-zinc-700" />
                              )}
                            </div>

                            {/* Start time badge */}
                            <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/60 rounded text-white text-[10px]">
                              {new Date(event.startTime).toLocaleString(undefined, {
                                weekday: 'short',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>

                          <p className="text-white/80 font-medium text-sm mt-2 truncate">{event.eventName}</p>
                          <p className="text-white/40 text-xs">{event.network} • {event.league?.replace(/_/g, ' ') || event.category}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Past Events Section */}
                {eventsData.past.length > 0 && (
                  <section>
                    <h2 className="px-5 text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-white/50" />
                      Recent Results
                    </h2>
                    <div className="px-5 space-y-2">
                      {eventsData.past.slice(0, 20).map((event: ParsedEvent) => (
                        <div
                          key={`${event.channelId}-${event.streamId}-past`}
                          className="flex items-center gap-3 py-3 border-b border-white/10"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm truncate">{event.eventName}</p>
                            <p className="text-white/40 text-xs">
                              {new Date(event.startTime).toLocaleDateString(undefined, {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                              {' • '}{event.network}
                            </p>
                          </div>

                          {event.finalScore && event.teams && (
                            <span className="text-white font-medium text-sm">
                              {event.finalScore.away} - {event.finalScore.home}
                            </span>
                          )}

                          {event.espnRecapUrl && (
                            <button
                              onClick={() => window.open(event.espnRecapUrl, '_blank')}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-full active:bg-white/20"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-white" />
                              <span className="text-white text-xs">Recap</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

        </div>
      )}

      {/* Info Modal - for current playing channel */}
      <AnimatePresence>
        {showInfoModal && currentChannel && (
          <InfoModal
            program={currentEPG?.currentProgram || null}
            channel={currentChannel}
            onClose={() => setShowInfoModal(false)}
            hasReminder={currentEPG?.currentProgram ? hasReminder(currentChannel.iptvId || '', currentEPG.currentProgram.startTime) : false}
            onSetReminder={() => {
              if (currentEPG?.currentProgram && currentChannel) {
                handleSetReminder(currentEPG.currentProgram, currentChannel);
              }
            }}
            onCancelReminder={() => {
              if (currentEPG?.currentProgram && currentChannel) {
                handleCancelReminder(currentChannel.iptvId || '', currentEPG.currentProgram.startTime);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Info Modal - for guide program clicks */}
      <AnimatePresence>
        {guideInfoModal && (
          <InfoModal
            program={guideInfoModal.program}
            channel={guideInfoModal.channel}
            onClose={() => setGuideInfoModal(null)}
            hasReminder={hasReminder(guideInfoModal.channel.iptvId || '', guideInfoModal.program.startTime)}
            onSetReminder={() => handleSetReminder(guideInfoModal.program, guideInfoModal.channel)}
            onCancelReminder={() => handleCancelReminder(guideInfoModal.channel.iptvId || '', guideInfoModal.program.startTime)}
          />
        )}
      </AnimatePresence>

      {/* Sports Schedule Modal */}
      <AnimatePresence>
        {scheduleModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-50 flex items-end justify-center"
            onClick={() => setScheduleModal(null)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-zinc-900 rounded-t-3xl w-full max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <img
                    src={`https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/${scheduleModal}.png&w=100&h=100`}
                    alt={scheduleModal.toUpperCase()}
                    className="h-6 w-6 object-contain"
                  />
                  <h2 className="text-xl font-semibold text-white">
                    {scheduleModal.toUpperCase()} Schedule
                  </h2>
                </div>
                <button
                  onClick={() => setScheduleModal(null)}
                  className="p-2 rounded-full bg-white/10 active:bg-white/20"
                >
                  <X className="w-5 h-5 text-white/70" />
                </button>
              </div>

              {/* Schedule List */}
              <div className="flex-1 overflow-y-auto px-5 py-4 pb-28">
                {scheduleLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  </div>
                ) : !sportsSchedule?.games?.length ? (
                  <div className="text-center py-12">
                    <Calendar className="w-12 h-12 text-white/20 mx-auto mb-4" />
                    <p className="text-white/50">No upcoming games scheduled</p>
                  </div>
                ) : (() => {
                  // Separate games into upcoming and past
                  const now = new Date();
                  const upcomingGames = sportsSchedule.games
                    .filter(g => g.status === 'scheduled' || g.status === 'live')
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .slice(0, 5);

                  const pastGames = sportsSchedule.games
                    .filter(g => g.status === 'final' || g.status === 'postponed')
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Most recent first
                    .slice(0, 5);

                  // Get sport channels for matching
                  const sportChannels = scheduleModal === 'nfl' ? nflChannels
                    : scheduleModal === 'nba' ? nbaChannels
                    : mlbChannels;

                  // Helper to find matching channel by broadcast network
                  const findChannelForBroadcast = (broadcasts: string[]) => {
                    for (const network of broadcasts) {
                      const networkLower = network.toLowerCase();
                      // Try to find a matching channel
                      for (const pkgChannel of sportChannels) {
                        const channelName = pkgChannel.name.toLowerCase();
                        if (channelName.includes(networkLower) || networkLower.includes(channelName.replace(/\s+/g, ''))) {
                          const channel = channels.find(c => c.GuideName === pkgChannel.name || c.name === pkgChannel.name);
                          if (channel) return { channel, networkName: network };
                        }
                      }
                      // Check all channels for network match
                      const channel = channels.find(c => {
                        const name = c.GuideName.toLowerCase();
                        return name.includes(networkLower) || name === networkLower;
                      });
                      if (channel) return { channel, networkName: network };
                    }
                    return null;
                  };

                  // Render a game card
                  const renderGameCard = (game: typeof sportsSchedule.games[0]) => {
                    const startTime = new Date(game.date);
                    const timeStr = startTime.toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    });
                    const matchedChannel = findChannelForBroadcast(game.broadcast);
                    const isLive = game.status === 'live';
                    const isFinal = game.status === 'final';
                    const isPostponed = game.status === 'postponed';
                    const isFuture = startTime > now;
                    const isStartingSoon = isFuture && startTime.getTime() - now.getTime() < 30 * 60 * 1000;
                    const showWatchButton = matchedChannel && !isFinal && (isLive || isStartingSoon);
                    const channelIdForReminder = matchedChannel?.channel.iptvId || game.id;
                    const hasGameReminder = hasReminder(channelIdForReminder, game.date);

                    return (
                      <div
                        key={game.id}
                        className={cn(
                          "bg-white/5 rounded-xl p-4 transition-colors",
                          isFinal ? "opacity-70" : ""
                        )}
                      >
                        {/* Teams Row with Scores */}
                        <div className="flex items-center gap-3 mb-2">
                          {/* Away Team */}
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {game.awayTeam.logo && (
                              <img src={game.awayTeam.logo} alt="" className="w-8 h-8 object-contain" />
                            )}
                            <span className={cn(
                              "font-medium truncate",
                              isFinal && game.awayTeam.score !== undefined && game.homeTeam.score !== undefined
                                ? game.awayTeam.score > game.homeTeam.score ? "text-white" : "text-white/50"
                                : "text-white"
                            )}>
                              {game.awayTeam.abbreviation}
                            </span>
                            {(isLive || isFinal) && game.awayTeam.score !== undefined && (
                              <span className={cn(
                                "font-bold text-lg",
                                isFinal && game.awayTeam.score > (game.homeTeam.score || 0) ? "text-white" : "text-white/70"
                              )}>
                                {game.awayTeam.score}
                              </span>
                            )}
                          </div>

                          <span className="text-white/40 text-sm">
                            {(isLive || isFinal) ? "-" : "@"}
                          </span>

                          {/* Home Team */}
                          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                            {(isLive || isFinal) && game.homeTeam.score !== undefined && (
                              <span className={cn(
                                "font-bold text-lg",
                                isFinal && game.homeTeam.score > (game.awayTeam.score || 0) ? "text-white" : "text-white/70"
                              )}>
                                {game.homeTeam.score}
                              </span>
                            )}
                            <span className={cn(
                              "font-medium truncate",
                              isFinal && game.homeTeam.score !== undefined && game.awayTeam.score !== undefined
                                ? game.homeTeam.score > game.awayTeam.score ? "text-white" : "text-white/50"
                                : "text-white"
                            )}>
                              {game.homeTeam.abbreviation}
                            </span>
                            {game.homeTeam.logo && (
                              <img src={game.homeTeam.logo} alt="" className="w-8 h-8 object-contain" />
                            )}
                          </div>
                        </div>

                        {/* Info Row */}
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 flex-wrap">
                            {isLive && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-red-600 rounded text-white text-xs font-medium">
                                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                                LIVE
                              </span>
                            )}
                            {isFinal && (
                              <span className="px-2 py-0.5 bg-white/20 rounded text-white/70 text-xs font-medium">
                                FINAL
                              </span>
                            )}
                            {isPostponed && (
                              <span className="px-2 py-0.5 bg-yellow-600/50 rounded text-yellow-200 text-xs font-medium">
                                PPD
                              </span>
                            )}
                            <span className="text-white/50 text-xs">{timeStr}</span>
                            {game.broadcast.length > 0 && !isFinal && (
                              <span className="text-white/30 text-xs">• {game.broadcast[0]}</span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 shrink-0">
                            {isFuture && !isLive && !isFinal && !isPostponed && matchedChannel && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  haptics.light();
                                  if (hasGameReminder) {
                                    handleCancelReminder(channelIdForReminder, game.date);
                                  } else {
                                    handleSetReminder(
                                      {
                                        title: game.shortName,
                                        startTime: game.date,
                                        endTime: new Date(new Date(game.date).getTime() + 3 * 60 * 60 * 1000).toISOString(),
                                      },
                                      matchedChannel.channel
                                    );
                                  }
                                }}
                                className={cn(
                                  "p-2 rounded-full transition-colors",
                                  hasGameReminder ? "bg-blue-600 text-white" : "bg-white/10 text-white/70"
                                )}
                              >
                                {hasGameReminder ? <Bell className="w-4 h-4 fill-current" /> : <Bell className="w-4 h-4" />}
                              </button>
                            )}

                            {showWatchButton && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  haptics.light();
                                  playStream(matchedChannel.channel);
                                  setViewMode('player');
                                  setScheduleModal(null);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 rounded-full text-white text-sm font-medium active:bg-blue-700"
                              >
                                <Play className="w-3.5 h-3.5" />
                                Watch
                              </button>
                            )}

                            {isFinal && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  haptics.light();
                                  const sport = scheduleModal || 'nfl';
                                  window.open(`https://www.espn.com/${sport}/game/_/gameId/${game.id}`, '_blank');
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-full text-white text-sm font-medium active:bg-white/20"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                                Recap
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {/* Upcoming Games */}
                      {upcomingGames.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-white/50 mb-3">Upcoming</h3>
                          <div className="space-y-3">
                            {upcomingGames.map(renderGameCard)}
                          </div>
                        </div>
                      )}

                      {/* Past Games */}
                      {pastGames.length > 0 && (
                        <div className="mb-6">
                          <h3 className="text-sm font-medium text-white/50 mb-3">Recent Results</h3>
                          <div className="space-y-3">
                            {pastGames.map(renderGameCard)}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menu Popup */}
      <AnimatePresence>
        {showMenuPopup && (
          <MenuPopup
            onShowSubscription={() => setShowSubscriptionPopup(true)}
            onLogout={() => logoutMutation.mutate()}
            onClose={() => setShowMenuPopup(false)}
          />
        )}
      </AnimatePresence>

      {/* Favorites Popup */}
      <AnimatePresence>
        {showFavoritesPopup && (
          <FavoritesPopup
            key={favoriteOrderVersion}
            favorites={favorites}
            channels={channels}
            onSelectChannel={(channel) => {
              playStream(channel);
              setShowFavoritesPopup(false);
            }}
            onClose={() => setShowFavoritesPopup(false)}
            onReorder={() => setFavoriteOrderVersion(v => v + 1)}
          />
        )}
      </AnimatePresence>

      {/* Subscription Popup */}
      <AnimatePresence>
        {showSubscriptionPopup && (
          <SubscriptionPopup
            subscription={subscriptionData || null}
            isLoading={subscriptionLoading}
            onClose={() => setShowSubscriptionPopup(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
