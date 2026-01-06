import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Play, Pause, Volume2, VolumeX, Info, Plus, MoreHorizontal, Star, X, Check, CreditCard, Calendar, ExternalLink, LogOut, LayoutGrid, Airplay, Search, Volume1, Minus, Settings, PictureInPicture2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getQueryFn, apiRequest, queryClient } from '@/lib/queryClient';
import { buildApiUrl, isNativePlatform } from '@/lib/capacitor';
import { haptics } from '@/lib/haptics';
import { useAuth } from '@/hooks/use-auth';
import Hls from 'hls.js';
import { ScreenOrientation } from '@capacitor/screen-orientation';

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
}

interface ChannelEPG {
  currentProgram: EPGProgram | null;
  nextProgram: EPGProgram | null;
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

const getTimeRemaining = (endTime: string): string => {
  const end = new Date(endTime).getTime();
  const now = new Date().getTime();
  const remaining = Math.floor((end - now) / 60000);
  if (remaining < 60) return `${remaining} min`;
  const hours = Math.floor(remaining / 60);
  const mins = remaining % 60;
  return `${hours}h ${mins}m`;
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
      <Star className="w-7 h-7 text-white/80" />
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
  onClose
}: {
  program: EPGProgram | null;
  channel: Channel | null;
  onClose: () => void;
}) => (
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
));
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
const TimelineHeader = memo(({ slots }: { slots: Date[] }) => (
  <div className="flex h-10 border-b border-white/10">
    <div className="w-48 shrink-0" /> {/* Channel column spacer */}
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
  onToggleFavorite
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
}) => {
  const now = new Date();
  const totalMs = timelineEnd.getTime() - timelineStart.getTime();

  const renderProgram = (program: EPGProgram | null, isNow: boolean, fallbackTitle?: string) => {
    // If no program data, show fallback for current program
    if (!program) {
      if (isNow && fallbackTitle) {
        return (
          <div
            className={cn(
              "absolute top-1 bottom-1 left-0 right-0 px-3 py-1 rounded border overflow-hidden",
              isFocused ? "bg-white border-white" : "bg-white/10 border-white/20"
            )}
          >
            <div className={cn(
              "text-sm font-medium truncate",
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

    return (
      <div
        key={program.startTime}
        className={cn(
          "absolute top-1 bottom-1 px-3 py-1 rounded border overflow-hidden transition-all flex items-center",
          isFocused && isNow ? "bg-white border-white" : "bg-white/10 border-white/20",
          isNow && !isFocused && "border-l-2 border-l-red-500"
        )}
        style={{ left: `${left}%`, width: `${Math.max(width, 10)}%`, minWidth: '100px' }}
      >
        <div className={cn(
          "text-sm font-medium truncate",
          isFocused && isNow ? "text-black" : "text-white"
        )}>{title}</div>
      </div>
    );
  };

  return (
    <div
      onClick={onSelect}
      className={cn(
        "flex h-14 cursor-pointer transition-all border-b border-white/5 select-none",
        isFocused && "bg-white/10 ring-2 ring-white/50"
      )}
    >
      {/* Favorite Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="w-10 shrink-0 flex items-center justify-center hover:bg-white/10 active:bg-white/20"
      >
        <Star className={cn("w-4 h-4", isFavorite ? "text-yellow-400 fill-yellow-400" : "text-white/30")} />
      </button>

      {/* Channel Info */}
      <div className={cn(
        "w-40 shrink-0 flex items-center gap-2 px-2 border-r border-white/10",
        isPlaying && "bg-red-600/20"
      )}>
        <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
          {channel.logo ? (
            <img src={channel.logo} alt="" className="w-full h-full object-contain p-0.5" />
          ) : (
            <span className="text-xs font-bold text-white/60">{channel.GuideNumber}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{channel.GuideName}</div>
        </div>
      </div>

      {/* Programs */}
      <div className="flex-1 relative">
        {/* Now indicator */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
          style={{
            left: `${Math.min(100, Math.max(0, ((now.getTime() - timelineStart.getTime()) / totalMs) * 100))}%`
          }}
        />
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
            <img src={channel.logo} alt="" className="w-full h-full object-contain" />
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
  const { logoutMutation } = useAuth();

  // Portrait mode detection - check immediately on init
  const [isPortrait, setIsPortrait] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < window.innerHeight;
    }
    return false;
  });

  // View state: 'player' (fullscreen) or 'guide' (with PiP)
  const [viewMode, setViewMode] = useState<'player' | 'guide'>('player');
  const [showOverlay, setShowOverlay] = useState(true);
  const [guideSearchQuery, setGuideSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Playback state
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAirPlaying, setIsAirPlaying] = useState(false);
  const [airPlayEnabled, setAirPlayEnabled] = useState(false); // Only enable AirPlay when user requests it

  // Guide navigation
  const [focusedChannelIndex, setFocusedChannelIndex] = useState(0);

  // Time ticker for auto-updating program info (updates every 30 seconds)
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Modal/popup state
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showMenuPopup, setShowMenuPopup] = useState(false);
  const [showFavoritesPopup, setShowFavoritesPopup] = useState(false);
  const [favoriteOrderVersion, setFavoriteOrderVersion] = useState(0); // Trigger re-render on reorder
  const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const guideScrollRef = useRef<HTMLDivElement>(null);

  // Stream retry state
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Show "back online" briefly
      setShowOfflineIndicator(true);
      setTimeout(() => setShowOfflineIndicator(false), 2000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowOfflineIndicator(true);
      haptics.warning();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

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

  // Filtered channels for guide search and category
  const filteredChannels = useMemo(() => {
    let filtered = channels;

    // Filter by category first
    if (selectedCategory) {
      filtered = filtered.filter((ch: Channel) => ch.categoryId === selectedCategory);
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
  }, [channels, guideSearchQuery, selectedCategory]);

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
    enabled: showSubscriptionPopup, // Only fetch when popup is opened
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

  // EPG queries - always load for current channel, load more when guide opens
  // Use epgId (XMLTV channel ID) and /api/epg/upcoming endpoint like the web version
  const visibleEpgIds = useMemo(() => {
    const idsSet = new Set<string>();

    // Always include the currently selected channel for player overlay
    if (selectedChannel?.epgId) {
      idsSet.add(selectedChannel.epgId);
    }

    // When guide is open, load first 50 + around focused channel
    if (viewMode === 'guide') {
      // First 50 channels
      channels.slice(0, 50).forEach((ch: Channel) => {
        if (ch.epgId) idsSet.add(ch.epgId);
      });

      // Also include channels around the focused one (for scrolling beyond 50)
      const start = Math.max(0, focusedChannelIndex - 10);
      const end = Math.min(channels.length, focusedChannelIndex + 20);
      channels.slice(start, end).forEach((ch: Channel) => {
        if (ch.epgId) idsSet.add(ch.epgId);
      });
    }

    return Array.from(idsSet);
  }, [channels, focusedChannelIndex, viewMode, selectedChannel]);

  const epgQueries = useQueries({
    queries: visibleEpgIds.map(epgId => ({
      queryKey: [`/api/epg/upcoming/${encodeURIComponent(epgId)}?hours=3`],
      queryFn: getQueryFn({ on401: "returnNull" }),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    }))
  });

  // Build EPG data map from /api/epg/upcoming response (array of programs)
  const epgDataMap = useMemo(() => {
    const map = new Map<string, ChannelEPG>();
    const now = new Date().getTime();

    epgQueries.forEach((query, index) => {
      const epgId = visibleEpgIds[index];
      // API returns { programs: [...] }, not a raw array
      const responseData = query.data as any;
      const programs = responseData?.programs;
      if (programs && Array.isArray(programs)) {

        // Find current program (startTime <= now < endTime)
        const currentProgram = programs.find(p => {
          const start = new Date(p.startTime).getTime();
          const end = new Date(p.endTime).getTime();
          return start <= now && now < end;
        });

        // Find next program (starts after current ends, or first future program)
        const nextProgram = programs.find(p => {
          const start = new Date(p.startTime).getTime();
          return start > now && (!currentProgram || start >= new Date(currentProgram.endTime).getTime());
        });

        // Find the channel with this epgId to map back to iptvId
        const channel = channels.find((ch: Channel) => ch.epgId === epgId);
        if (channel?.iptvId) {
          map.set(channel.iptvId, {
            currentProgram: currentProgram ? {
              title: currentProgram.title || '',
              startTime: currentProgram.startTime,
              endTime: currentProgram.endTime,
              description: currentProgram.description || '',
              episodeTitle: currentProgram.episodeTitle || '',
              season: currentProgram.season,
              episode: currentProgram.episode,
              rating: currentProgram.rating
            } : null,
            nextProgram: nextProgram ? {
              title: nextProgram.title || '',
              startTime: nextProgram.startTime,
              endTime: nextProgram.endTime,
              description: nextProgram.description || '',
              episodeTitle: nextProgram.episodeTitle || '',
              season: nextProgram.season,
              episode: nextProgram.episode,
              rating: nextProgram.rating
            } : null
          });
        }
      }
    });

    return map;
  }, [epgQueries, visibleEpgIds, channels, currentTime]);

  // Timeline slots
  const timelineSlots = useMemo(() => {
    const now = new Date();
    const startTime = new Date(now);
    startTime.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0);

    const slots: Date[] = [];
    for (let i = 0; i < 4; i++) {
      const slot = new Date(startTime);
      slot.setMinutes(startTime.getMinutes() + i * 30);
      slots.push(slot);
    }
    return slots;
  }, []);

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
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      // Haptic feedback on channel change (not on retry)
      haptics.light();
    }

    // Release previous stream
    await releaseCurrentStream();

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    try {
      let streamUrl = buildApiUrl(channel.URL);

      // For IPTV channels, acquire stream session for tracking
      if (channel.source === 'iptv' && channel.iptvId) {
        try {
          console.log('[TV] Acquiring stream session for:', channel.iptvId);
          const acquireResponse = await apiRequest('POST', '/api/iptv/stream/acquire', {
            streamId: channel.iptvId
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

      if (isNativePlatform() && channel.source === 'iptv' && channel.iptvId) {
        const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
          streamId: channel.iptvId
        });
        const { token, sessionToken } = await tokenResponse.json();
        streamUrl = `${streamUrl}?token=${token}`;

        // Use sessionToken from generate-token for stream tracking on native platforms
        if (sessionToken) {
          console.log('[TV] Got session token from generate-token:', sessionToken);
          streamSessionToken.current = sessionToken;

          // Clear any existing heartbeat interval before creating new one
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
        const handleError = (e: Event) => {
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
              if (channel) {
                video.src = streamUrl;
                video.load();
                video.play().catch(() => {});
              }
            }, delay);
          } else {
            setIsLoading(false);
            setStreamError('Unable to connect. Please try again.');
            haptics.error();
          }
        };

        const handleLoadedMetadata = () => {
          console.log('[TV] Native HLS: metadata loaded');
          console.log('[TV] Duration:', video.duration);
          console.log('[TV] Video dimensions:', video.videoWidth, 'x', video.videoHeight);
        };

        const handleCanPlay = () => {
          console.log('[TV] Native HLS: can play');
        };

        const handlePlaying = () => {
          console.log('[TV] Native HLS: playing');
          setIsPlaying(true);
          setIsLoading(false);
        };

        const handleWaiting = () => {
          console.log('[TV] Native HLS: waiting/buffering');
        };

        const handleStalled = () => {
          console.log('[TV] Native HLS: stalled');
        };

        // Clean up old listeners
        video.removeEventListener('error', handleError);
        video.removeEventListener('loadedmetadata', handleLoadedMetadata);
        video.removeEventListener('canplay', handleCanPlay);
        video.removeEventListener('playing', handlePlaying);
        video.removeEventListener('waiting', handleWaiting);
        video.removeEventListener('stalled', handleStalled);

        // Add new listeners
        video.addEventListener('error', handleError);
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('canplay', handleCanPlay);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('stalled', handleStalled);

        video.src = streamUrl;
        video.load(); // Explicitly load

        video.play().then(() => {
          console.log('[TV] Native HLS: play() succeeded');
          setIsPlaying(true);
          setIsLoading(false);
        }).catch((err) => {
          console.error('[TV] Native HLS play() error:', err);
          console.error('[TV] Error name:', err.name);
          console.error('[TV] Error message:', err.message);
          setIsLoading(false);
        });
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
      haptics.error();
    }
  }, [retryStream]);

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

    if (isTap && viewMode === 'player') {
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

  // Detect portrait/landscape on native platforms with debounce for smooth transitions
  useEffect(() => {
    if (!isNativePlatform()) {
      setIsPortrait(false);
      return;
    }

    let debounceTimer: NodeJS.Timeout | null = null;
    let lastOrientation: boolean | null = null;

    const checkOrientation = (immediate = false) => {
      const portrait = window.innerWidth < window.innerHeight;

      // Only update if orientation actually changed
      if (portrait === lastOrientation) return;

      if (immediate) {
        lastOrientation = portrait;
        setIsPortrait(portrait);
      } else {
        // Debounce to prevent multiple rapid updates during rotation
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastOrientation = portrait;
          setIsPortrait(portrait);
        }, 150);
      }
    };

    // Check immediately on mount
    lastOrientation = window.innerWidth < window.innerHeight;
    setIsPortrait(lastOrientation);

    // Listen for resize and orientation events
    window.addEventListener('resize', () => checkOrientation(false));
    window.addEventListener('orientationchange', () => {
      // Delay after orientation change event for dimensions to settle
      setTimeout(() => checkOrientation(true), 200);
    });

    // Re-check when app regains focus (e.g., after PiP closes)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => checkOrientation(true), 100);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', () => checkOrientation(false));
      window.removeEventListener('orientationchange', () => checkOrientation(true));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Auto-play last watched channel (or first channel) with delay
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      // Try to get last watched channel from localStorage
      const lastChannelId = localStorage.getItem('lastWatchedChannelId');
      let channelToPlay = channels[0]; // Default to first channel

      if (lastChannelId) {
        const savedChannel = channels.find(ch => ch.iptvId === lastChannelId);
        if (savedChannel) {
          channelToPlay = savedChannel;
        }
      }

      // Small delay before auto-playing to let UI settle
      const timer = setTimeout(() => {
        playStream(channelToPlay);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [channels, selectedChannel, playStream]);

  // Save last watched channel to localStorage
  useEffect(() => {
    if (selectedChannel?.iptvId) {
      localStorage.setItem('lastWatchedChannelId', selectedChannel.iptvId);
    }
  }, [selectedChannel]);

  // Auto-scroll guide to keep focused channel visible
  useEffect(() => {
    if (viewMode === 'guide' && guideScrollRef.current) {
      const rowHeight = 56; // h-14 = 56px
      const scrollContainer = guideScrollRef.current;
      const targetScroll = focusedChannelIndex * rowHeight - scrollContainer.clientHeight / 2 + rowHeight / 2;
      scrollContainer.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    }
  }, [focusedChannelIndex, viewMode]);

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
      {/* Network Status Indicator */}
      <AnimatePresence>
        {showOfflineIndicator && (
          <motion.div
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className={cn(
              "fixed top-0 left-0 right-0 z-50 py-2 px-4 text-center text-sm font-medium",
              isOnline ? "bg-green-600 text-white" : "bg-red-600 text-white"
            )}
            style={{ paddingTop: isNativePlatform() ? 'calc(env(safe-area-inset-top) + 8px)' : '8px' }}
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
            top: 100,
            left: 16,
            right: 16,
            bottom: 'auto',
            width: 'calc(100vw - 32px)',
            height: 'calc((100vw - 32px) * 0.5625)',
            zIndex: 25,
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
        {/* Loading Indicator - inside video container */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 rounded-xl">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
            <p className="text-white text-lg font-medium">
              {streamError ? streamError : 'Loading Stream'}
            </p>
            {currentChannel && (
              <p className="text-white/60 text-sm mt-1">{currentChannel.GuideName}</p>
            )}
          </div>
        )}
        {/* Stream Error - when max retries reached */}
        {!isLoading && streamError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 rounded-xl">
            <div className="w-12 h-12 mb-4 text-red-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <p className="text-white text-lg font-medium">{streamError}</p>
            <button
              onClick={() => { setStreamError(null); retryCountRef.current = 0; if (selectedChannel) playStream(selectedChannel); }}
              className="mt-4 px-6 py-2 bg-white/20 hover:bg-white/30 rounded-full text-white text-sm transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
        {/* Initial startup indicator - before first channel loads */}
        {!isLoading && !selectedChannel && viewMode === 'player' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mb-4" />
            <p className="text-white text-lg font-medium">Starting Up</p>
            <p className="text-white/50 text-sm mt-1">Preparing your stream...</p>
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
                  src={currentChannel.logo}
                  alt=""
                  className="h-10 w-auto object-contain"
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
                  <span>{getTimeRemaining(currentEPG.currentProgram.endTime)} left</span>
                  <span>{new Date(currentEPG.currentProgram.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls - Play/Pause centered, Up/Down on sides */}
          <div className="px-8 pb-6">
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

          {/* Volume Controls */}
          <div className="px-8 pb-6">
            <div className="flex items-center justify-center gap-4 max-w-xs mx-auto">
              <button
                onTouchEnd={() => { setIsMuted(!isMuted); if (videoRef.current) videoRef.current.muted = !isMuted; }}
                onClick={() => { setIsMuted(!isMuted); if (videoRef.current) videoRef.current.muted = !isMuted; }}
                className="w-11 h-11 bg-white/10 rounded-full flex items-center justify-center active:bg-white/20 shrink-0"
              >
                {isMuted ? <VolumeX className="w-5 h-5 text-white/60" /> : <Volume2 className="w-5 h-5 text-white" />}
              </button>
              <div className="flex-1 h-1.5 bg-white/20 rounded-full">
                <div className={cn("h-full bg-white/60 rounded-full transition-all", isMuted ? "w-0" : "w-3/4")} />
              </div>
            </div>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Bottom Action Bar - Guide, Favorites, AirPlay, Settings */}
          <div className="px-4 pb-8 flex items-center justify-around border-t border-white/10 pt-4">
            <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setViewMode('guide'); }} onClick={() => { haptics.light(); setViewMode('guide'); }} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <LayoutGrid className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Guide</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setShowFavoritesPopup(true); }} onClick={() => { haptics.light(); setShowFavoritesPopup(true); }} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Star className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Favorites</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); handleAirPlay(); }} onClick={handleAirPlay} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Airplay className="w-6 h-6 text-blue-400" />
              <span className="text-blue-400 text-xs">AirPlay</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); setShowMenuPopup(true); }} onClick={() => setShowMenuPopup(true)} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Settings className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Settings</span>
            </button>
          </div>
        </div>
      )}

      {/* Portrait Player UI - Controls positioned BELOW video area (not AirPlaying) */}
      {isPortrait && isNativePlatform() && viewMode === 'player' && !isAirPlaying && (
        <div
          className="absolute left-0 right-0 bottom-0 bg-black flex flex-col"
          style={{ top: 'calc(50px + 56.25vw)', zIndex: 15 }}
        >
          {/* Channel Bar */}
          <div className="px-4 py-3 flex items-center gap-3 border-b border-white/10">
            {currentChannel?.logo && (
              <img
                src={currentChannel.logo}
                alt=""
                className="h-12 w-auto object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-white text-lg font-semibold truncate">{currentChannel?.GuideName || 'No Channel'}</h2>
                <span className="text-red-500 text-xs font-bold px-1.5 py-0.5 bg-red-500/20 rounded">LIVE</span>
              </div>
              {currentEPG?.currentProgram && (
                <p className="text-white/60 text-sm truncate mt-0.5">{currentEPG.currentProgram.title}</p>
              )}
            </div>
          </div>

          {/* Program Info & Progress */}
          {currentEPG?.currentProgram && (
            <div className="px-4 py-3 border-b border-white/10">
              <div className="flex justify-between items-center mb-2">
                <span className="text-white/50 text-sm">
                  {new Date(currentEPG.currentProgram.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(currentEPG.currentProgram.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="text-white/50 text-sm">{getTimeRemaining(currentEPG.currentProgram.endTime)} left</span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 rounded-full"
                  style={{ width: `${getProgramProgress(currentEPG.currentProgram)}%` }}
                />
              </div>
              {currentEPG.currentProgram.description && (
                <p className="text-white/40 text-sm mt-2 line-clamp-2">{currentEPG.currentProgram.description}</p>
              )}
            </div>
          )}

          {/* Playback Controls */}
          <div className="flex-1 flex flex-col justify-center py-4">
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
          </div>

          {/* Bottom Action Bar - Guide, Favorites, AirPlay, Settings */}
          <div className="px-4 pb-8 flex items-center justify-around">
            <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setViewMode('guide'); }} onClick={() => { haptics.light(); setViewMode('guide'); }} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <LayoutGrid className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Guide</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); haptics.light(); setShowFavoritesPopup(true); }} onClick={() => { haptics.light(); setShowFavoritesPopup(true); }} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Star className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Favorites</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); handleAirPlay(); }} onClick={handleAirPlay} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Airplay className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">AirPlay</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); setShowMenuPopup(true); }} onClick={() => setShowMenuPopup(true)} className="flex flex-col items-center gap-1.5 py-2 px-4 active:opacity-70">
              <Settings className="w-6 h-6 text-white/70" />
              <span className="text-white/50 text-xs">Settings</span>
            </button>
          </div>
        </div>
      )}

      {/* Portrait Guide View - Plex-style with large video at top */}
      {isPortrait && isNativePlatform() && viewMode === 'guide' && (
        <div className="absolute inset-0 bg-black flex flex-col z-20">
          {/* Header with close button and search */}
          <div className="shrink-0 pt-14 px-4 flex items-center gap-3">
            <button
              onTouchEnd={(e) => { e.preventDefault(); setViewMode('player'); setGuideSearchQuery(''); setSelectedCategory(null); }}
              onClick={() => { setViewMode('player'); setGuideSearchQuery(''); setSelectedCategory(null); }}
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
          </div>

          {/* Category Filter Chips */}
          {categories.length > 0 && (
            <div className="px-4 pt-2 overflow-x-auto scrollbar-hide">
              <div className="flex gap-2">
                <button
                  onTouchEnd={(e) => { e.preventDefault(); haptics.selection(); setSelectedCategory(null); }}
                  onClick={() => { haptics.selection(); setSelectedCategory(null); }}
                  className={cn(
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    selectedCategory === null
                      ? "bg-white text-black"
                      : "bg-white/10 text-white/70 active:bg-white/20"
                  )}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onTouchEnd={(e) => { e.preventDefault(); haptics.selection(); setSelectedCategory(cat.id); }}
                    onClick={() => { haptics.selection(); setSelectedCategory(cat.id); }}
                    className={cn(
                      "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                      selectedCategory === cat.id
                        ? "bg-white text-black"
                        : "bg-white/10 text-white/70 active:bg-white/20"
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Video player area - space for the motion.div video */}
          <div className="relative mx-4 mt-3 aspect-video">
            {/* Video positioned here via motion.div animate */}
          </div>

          {/* Now playing info */}
          <div className="px-4 py-3 flex items-center gap-3">
            {currentChannel?.logo && (
              <img
                src={currentChannel.logo}
                alt=""
                className="h-8 w-auto object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className="text-white/70 text-sm">Now on - {currentChannel?.GuideName || 'Live TV'}</span>
          </div>

          {/* Channel List */}
          <div className="flex-1 overflow-y-auto">
            {filteredChannels.map((channel: Channel, index: number) => {
              const channelEpg = epgDataMap.get(channel.iptvId || '');
              const isCurrentChannel = selectedChannel?.iptvId === channel.iptvId;
              const timeRemaining = channelEpg?.currentProgram ? getTimeRemaining(channelEpg.currentProgram.endTime) : '';

              return (
                <button
                  key={channel.iptvId || index}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    touchStartY.current = e.touches[0].clientY;
                    longPressChannel.current = channel;
                    // Start long press timer
                    longPressTimer.current = setTimeout(() => {
                      // Long press - toggle favorite
                      if (longPressChannel.current) {
                        const channelId = longPressChannel.current.iptvId || '';
                        const isAlreadyFavorite = favorites.some(f => f.channelId === channelId);
                        if (isAlreadyFavorite) {
                          removeFavoriteMutation.mutate(channelId);
                        } else {
                          addFavoriteMutation.mutate(longPressChannel.current);
                        }
                        // Haptic feedback for long press
                        haptics.heavy();
                      }
                      longPressChannel.current = null;
                    }, 500);
                  }}
                  onTouchMove={(e) => {
                    // Cancel long press if user scrolls
                    if (touchStartY.current !== null) {
                      const distance = Math.abs(e.touches[0].clientY - touchStartY.current);
                      if (distance > 10 && longPressTimer.current) {
                        clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                        longPressChannel.current = null;
                      }
                    }
                  }}
                  onTouchEnd={(e) => {
                    // Clear long press timer
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      longPressTimer.current = null;
                    }
                    // Only select if it was a tap (not scroll, not long press)
                    if (touchStartY.current !== null && longPressChannel.current) {
                      const touchEndY = e.changedTouches[0].clientY;
                      const distance = Math.abs(touchEndY - touchStartY.current);
                      if (distance < 10) {
                        playStream(channel);
                        setViewMode('player');
                        setGuideSearchQuery('');
                      }
                    }
                    touchStartY.current = null;
                    longPressChannel.current = null;
                  }}
                  onClick={() => {
                    playStream(channel);
                    setViewMode('player');
                    setGuideSearchQuery('');
                  }}
                  className={cn(
                    "w-full px-4 py-2.5 flex items-center gap-3 active:bg-white/10 select-none",
                    isCurrentChannel && "bg-white/5"
                  )}
                  style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
                >
                  {/* Favorite Star Button */}
                  <button
                    onTouchStart={(e) => {
                      e.stopPropagation();
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
                    className="shrink-0 w-8 flex items-center justify-center"
                  >
                    <Star className={cn(
                      "w-4 h-4",
                      favorites.some(f => f.channelId === (channel.iptvId || ''))
                        ? "text-yellow-400 fill-yellow-400"
                        : "text-white/30"
                    )} />
                  </button>

                  {/* Channel Logo */}
                  <div className="shrink-0 w-12 h-9 flex items-center justify-center bg-white/10 rounded-lg">
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt=""
                        className="max-w-[40px] max-h-[32px] object-contain pointer-events-none"
                        loading="lazy"
                        draggable={false}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span className="text-white/40 text-xs font-medium">{channel.GuideNumber}</span>
                    )}
                  </div>

                  {/* Current Program */}
                  <div className={cn(
                    "flex-1 min-w-0 text-left py-1.5 px-3 rounded-lg border",
                    isCurrentChannel ? "border-white/30 bg-white/10" : "border-white/10"
                  )}>
                    <p className={cn(
                      "text-sm truncate font-medium",
                      isCurrentChannel ? "text-white" : "text-white/90"
                    )}>
                      {channelEpg?.currentProgram?.title || channel.GuideName}
                    </p>
                    <p className="text-white/50 text-xs">{timeRemaining ? `${timeRemaining} left` : 'Live'}</p>
                  </div>

                  {/* Next Program (partially visible) */}
                  {channelEpg?.nextProgram && (
                    <div className="shrink-0 w-24 text-left opacity-50">
                      <p className="text-white/70 text-xs truncate">{channelEpg.nextProgram.title}</p>
                      <p className="text-white/40 text-[10px]">
                        {new Date(channelEpg.nextProgram.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
            {filteredChannels.length === 0 && guideSearchQuery && (
              <div className="px-4 py-8 text-center text-white/50">
                No channels found for "{guideSearchQuery}"
              </div>
            )}
          </div>

          {/* Bottom Tab Bar */}
          <div className="shrink-0 px-4 pb-8 pt-3 flex items-center justify-around border-t border-white/10 bg-black">
            <button onTouchEnd={(e) => { e.preventDefault(); setViewMode('player'); setGuideSearchQuery(''); setSelectedCategory(null); }} onClick={() => { setViewMode('player'); setGuideSearchQuery(''); setSelectedCategory(null); }} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
              <LayoutGrid className="w-6 h-6 text-white" />
              <span className="text-white text-xs font-medium">Guide</span>
            </button>
            <button onTouchEnd={(e) => { e.preventDefault(); setShowFavoritesPopup(!showFavoritesPopup); }} onClick={() => setShowFavoritesPopup(!showFavoritesPopup)} className="flex flex-col items-center gap-1 py-2 px-4 active:opacity-70">
              <Star className="w-6 h-6 text-white/50" />
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
        </div>
      )}

      {/* Player Overlay - Only in landscape player mode */}
      <AnimatePresence>
        {viewMode === 'player' && showOverlay && !(isPortrait && isNativePlatform()) && (
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
              <div className="absolute bottom-44 left-12 max-w-2xl">
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
                <h1 className="text-5xl font-bold text-white">
                  {currentEPG.currentProgram.title}
                </h1>
              </div>
            )}

            {/* Progress Bar - Full width just above controls */}
            {currentEPG?.currentProgram && (
              <div className="absolute bottom-24 left-12 right-12">
                <div className="h-1.5 bg-white/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-1000"
                    style={{ width: `${getProgramProgress(currentEPG.currentProgram)}%` }}
                  />
                </div>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-red-500 text-sm font-bold tracking-wider">LIVE</span>
                  <span className="text-white/70 text-sm">{getTimeRemaining(currentEPG.currentProgram.endTime)} left</span>
                </div>
              </div>
            )}

            {/* Channel Selector - Bottom Left, logo row centered with controls */}
            <div className="absolute bottom-2 left-8">
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
                      src={currentChannel.logo}
                      alt=""
                      className="h-6 w-auto object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="text-white text-sm font-medium max-w-[100px] truncate">{currentChannel?.GuideName}</span>
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

      {/* Guide View - Only for landscape or non-native */}
      {!(isPortrait && isNativePlatform()) && viewMode === 'guide' && (
      <div className="absolute inset-0 bg-black/95 z-20 flex flex-col">
            {/* Top section - Program details on left, PiP space on right */}
            <div className="h-60 shrink-0 flex relative">
              {/* Close Button + Search - Top Left */}
              <div className="absolute top-6 left-6 flex items-center gap-4 z-10">
                <button
                  onClick={() => { setViewMode('player'); setGuideSearchQuery(''); setSelectedCategory(null); }}
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
                {/* Category Filter Dropdown */}
                {categories.length > 0 && (
                  <select
                    value={selectedCategory || ''}
                    onChange={(e) => { haptics.selection(); setSelectedCategory(e.target.value || null); }}
                    className="h-10 px-3 bg-white/10 hover:bg-white/15 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/30 transition-colors cursor-pointer appearance-none"
                    style={{ minWidth: '140px' }}
                  >
                    <option value="" className="bg-black text-white">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id} className="bg-black text-white">
                        {cat.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Program Details - fills left side, positioned below search */}
              <div className="flex-1 flex items-end pb-4 pl-6 pt-24">
                <FocusedProgramPanel channel={focusedChannel} program={focusedEPG?.currentProgram || null} />
              </div>
              {/* Space for PiP video (320px + padding) */}
              <div className="w-96 shrink-0" />
            </div>

            {/* Timeline Header */}
            <div className="shrink-0 border-t border-white/10">
              <TimelineHeader slots={timelineSlots} />
            </div>

            {/* Channel Grid - takes remaining space */}
            <div ref={guideScrollRef} className="flex-1 overflow-y-auto">
              {filteredChannels.map((channel: Channel, index: number) => (
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

      {/* Info Modal */}
      <AnimatePresence>
        {showInfoModal && (
          <InfoModal
            program={currentEPG?.currentProgram || null}
            channel={currentChannel}
            onClose={() => setShowInfoModal(false)}
          />
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
