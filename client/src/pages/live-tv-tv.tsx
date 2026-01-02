import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Play, Pause, Volume2, VolumeX, Info, Plus, MoreHorizontal, Star, X, Check, CreditCard, Calendar, ExternalLink, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getQueryFn, apiRequest, queryClient } from '@/lib/queryClient';
import { buildApiUrl, isNativePlatform } from '@/lib/capacitor';
import { useAuth } from '@/hooks/use-auth';
import Hls from 'hls.js';

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

// Action Buttons (Add, Info, More)
const ActionButtons = memo(({
  isFavorite,
  onToggleFavorite,
  onShowInfo,
  onShowMenu
}: {
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onShowInfo: () => void;
  onShowMenu: () => void;
}) => (
  <div className="flex items-center gap-6">
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors focus:bg-white/20 focus:ring-2 focus:ring-white"
      onClick={onToggleFavorite}
    >
      {isFavorite ? (
        <Star className="w-7 h-7 text-white fill-white" />
      ) : (
        <Plus className="w-7 h-7 text-white/80" />
      )}
    </button>
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors"
      onClick={onShowInfo}
    >
      <Info className="w-7 h-7 text-white/80" />
    </button>
    <button
      className="p-3 hover:bg-white/10 rounded-full transition-colors"
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
  >
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      className="bg-zinc-900 rounded-xl p-8 max-w-2xl w-full mx-8"
      onClick={e => e.stopPropagation()}
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
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
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
  onShowFavorites,
  onShowSubscription,
  onLogout,
  onClose
}: {
  onShowFavorites: () => void;
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
  >
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-20 right-12 bg-zinc-800 rounded-lg shadow-xl overflow-hidden min-w-[200px]"
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full px-6 py-4 text-left text-white hover:bg-white/10 flex items-center gap-3 border-b border-white/10"
        onClick={() => {
          onShowFavorites();
          onClose();
        }}
      >
        <Star className="w-5 h-5 text-white fill-white" />
        <span className="text-lg">Favorites</span>
      </button>
      <button
        className="w-full px-6 py-4 text-left text-white hover:bg-white/10 flex items-center gap-3 border-b border-white/10"
        onClick={() => {
          onShowSubscription();
          onClose();
        }}
      >
        <CreditCard className="w-5 h-5 text-white" />
        <span className="text-lg">My Subscription</span>
      </button>
      <button
        className="w-full px-6 py-4 text-left text-white hover:bg-white/10 flex items-center gap-3"
        onClick={() => {
          onLogout();
          onClose();
        }}
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
  onClose
}: {
  favorites: any[];
  channels: Channel[];
  onSelectChannel: (channel: Channel) => void;
  onClose: () => void;
}) => {
  // Map favorites to full channel objects
  const favoriteChannels = useMemo(() => {
    return favorites.map(fav => {
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
  }, [favorites, channels]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/90 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-xl p-6 max-w-lg w-full mx-8 max-h-[70vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star className="w-6 h-6 text-white fill-white" />
            Favorites
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
            <X className="w-6 h-6 text-white/60" />
          </button>
        </div>

        {favoriteChannels.length === 0 ? (
          <p className="text-white/50 text-center py-8">No favorite channels yet. Press + on a channel to add it.</p>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-2">
            {favoriteChannels.map((channel) => (
              <button
                key={channel.iptvId}
                className="w-full px-4 py-3 flex items-center gap-4 hover:bg-white/10 rounded-lg transition-colors"
                onClick={() => {
                  if (channel.URL) {
                    onSelectChannel(channel);
                  }
                  onClose();
                }}
              >
                {channel.logo ? (
                  <img src={channel.logo} alt="" className="w-12 h-9 object-contain" />
                ) : (
                  <div className="w-12 h-9 bg-white/10 rounded flex items-center justify-center">
                    <Star className="w-5 h-5 text-white/30" />
                  </div>
                )}
                <span className="text-white text-lg">{channel.GuideName}</span>
              </button>
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
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-zinc-900 rounded-xl p-6 max-w-md w-full mx-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-white" />
            My Subscription
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full">
            <X className="w-6 h-6 text-white/60" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-8 text-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
            <p className="text-white/50 mt-4">Loading subscription...</p>
          </div>
        ) : subscription ? (
          <div className="space-y-4">
            {/* Plan Name & Status */}
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold text-white">{subscription.plan_name}</h3>
                <p className="text-white/60 text-sm capitalize">{subscription.billing_period} billing</p>
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
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-3xl font-bold text-white">
                {formatPrice(subscription.billing_period === 'monthly'
                  ? subscription.price_monthly
                  : subscription.price_annual)}
                <span className="text-lg font-normal text-white/60">
                  /{subscription.billing_period === 'monthly' ? 'mo' : 'yr'}
                </span>
              </div>
            </div>

            {/* Dates */}
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-white/80">
                <Calendar className="w-5 h-5 text-white/50" />
                <div>
                  <p className="text-sm text-white/50">Started</p>
                  <p>{formatDate(subscription.current_period_start)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 text-white/80">
                <Calendar className="w-5 h-5 text-white/50" />
                <div>
                  <p className="text-sm text-white/50">
                    {subscription.cancel_at_period_end ? 'Expires' : 'Renews'}
                  </p>
                  <p>
                    {formatDate(subscription.current_period_end)}
                    <span className="text-white/50 ml-2">
                      ({getDaysRemaining(subscription.current_period_end)} days)
                    </span>
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
              className="w-full mt-4 py-3 bg-white/10 hover:bg-white/20 rounded-lg text-white flex items-center justify-center gap-2 transition-colors"
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
  onSelect
}: {
  channel: Channel;
  epgData: ChannelEPG | undefined;
  timelineStart: Date;
  timelineEnd: Date;
  isFocused: boolean;
  isPlaying: boolean;
  onSelect: () => void;
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
        "flex h-14 cursor-pointer transition-all border-b border-white/5",
        isFocused && "bg-white/10 ring-2 ring-white/50"
      )}
    >
      {/* Channel Info */}
      <div className={cn(
        "w-48 shrink-0 flex items-center gap-3 px-3 border-r border-white/10",
        isPlaying && "bg-red-600/20"
      )}>
        <div className="w-10 h-10 rounded bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
          {channel.logo ? (
            <img src={channel.logo} alt="" className="w-full h-full object-contain p-1" />
          ) : (
            <span className="text-xs font-bold text-white/60">{channel.GuideNumber}</span>
          )}
        </div>
        <div className="min-w-0">
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

  // View state: 'player' (fullscreen) or 'guide' (with PiP)
  const [viewMode, setViewMode] = useState<'player' | 'guide'>('player');
  const [showOverlay, setShowOverlay] = useState(true);

  // Playback state
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Guide navigation
  const [focusedChannelIndex, setFocusedChannelIndex] = useState(0);

  // Time ticker for auto-updating program info (updates every 30 seconds)
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Modal/popup state
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showMenuPopup, setShowMenuPopup] = useState(false);
  const [showFavoritesPopup, setShowFavoritesPopup] = useState(false);
  const [showSubscriptionPopup, setShowSubscriptionPopup] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const overlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const guideScrollRef = useRef<HTMLDivElement>(null);

  // Query client for mutations
  const queryClient = useQueryClient();

  // Auto-update current time every 30 seconds to refresh program info
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const { data: channelsData } = useQuery({
    queryKey: ['/api/iptv/channels'],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const channels = useMemo(() => {
    const raw = (channelsData as any)?.channels || [];
    return raw.filter((ch: any) => !ch.hidden).map((ch: any) => ({
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
  }, [channelsData]);

  // Favorites query
  const { data: favoritesData } = useQuery({
    queryKey: ['/api/favorite-channels'],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Subscription query
  const { data: subscriptionData, isLoading: subscriptionLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['/api/subscriptions/current'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: showSubscriptionPopup, // Only fetch when popup is opened
  });

  const favorites = useMemo(() => {
    // API returns array directly, not { favorites: [...] }
    return Array.isArray(favoritesData) ? favoritesData : [];
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

  // Focused channel in guide
  const focusedChannel = channels[focusedChannelIndex] || null;
  const focusedEPG = focusedChannel?.iptvId ? epgDataMap.get(focusedChannel.iptvId) : undefined;

  // ============================================================================
  // VIDEO PLAYBACK
  // ============================================================================

  const playStream = useCallback(async (channel: Channel) => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    setIsLoading(true);
    setSelectedChannel(channel);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    try {
      let streamUrl = buildApiUrl(channel.URL);

      if (isNativePlatform() && channel.source === 'iptv' && channel.iptvId) {
        const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
          streamId: channel.iptvId
        });
        const { token } = await tokenResponse.json();
        streamUrl = `${streamUrl}?token=${token}`;
      }

      if (Hls.isSupported()) {
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
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
        }).catch(() => setIsLoading(false));
      }
    } catch (error) {
      console.error('[TV] Stream error:', error);
      setIsLoading(false);
    }
  }, []);

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

  // Auto-play first channel with delay to prevent overwhelming emulator
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      // Small delay before auto-playing to let UI settle
      const timer = setTimeout(() => {
        playStream(channels[0]);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [channels, selectedChannel, playStream]);

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
    };
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      {/* Video Element - Full screen or PiP */}
      <motion.div
        className="absolute bg-black"
        animate={viewMode === 'guide' ? {
          top: 24,
          right: 24,
          width: 320,
          height: 180,
          zIndex: 30,
          borderRadius: 12
        } : {
          top: 0,
          right: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          borderRadius: 0
        }}
        transition={{ duration: 0.3, ease: 'easeInOut' }}
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
        />
        {/* Loading Indicator - inside video container */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 rounded-xl">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {viewMode === 'guide' && !isLoading && (
          <div className="absolute bottom-2 left-2 right-2">
            <div className="text-xs text-white truncate">{currentChannel?.GuideName}</div>
          </div>
        )}
      </motion.div>

      {/* Player Overlay - Only in player mode */}
      <AnimatePresence>
        {viewMode === 'player' && showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10"
          >
            {/* Bottom gradient */}
            <div className="absolute inset-x-0 bottom-0 h-96 bg-gradient-to-t from-black via-black/80 to-transparent" />

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

            {/* Channel Logo + Name - Bottom Left, vertically centered with controls */}
            <div className="absolute bottom-8 left-12 h-16 flex items-center gap-2">
              {currentChannel?.logo && (
                <img
                  src={currentChannel.logo}
                  alt=""
                  className="h-5 w-auto object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <span className="text-white text-base font-medium">{currentChannel?.GuideName}</span>
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
            <div className="absolute bottom-8 right-12">
              <ActionButtons
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                onShowInfo={() => setShowInfoModal(true)}
                onShowMenu={() => setShowMenuPopup(true)}
              />
            </div>

            {/* Down arrow hint */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-white/40 text-sm flex items-center gap-1">
              <ChevronDown className="w-4 h-4" />
              Press down for guide
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guide View */}
      <AnimatePresence>
        {viewMode === 'guide' && (
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 bg-black/95 z-20 flex flex-col"
          >
            {/* Top section - Program details on left, PiP space on right */}
            <div className="h-52 shrink-0 flex">
              {/* Program Details - fills left side */}
              <div className="flex-1 flex items-end pb-4">
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
              {channels.map((channel: Channel, index: number) => (
                <GuideChannelRow
                  key={channel.iptvId || channel.GuideNumber}
                  channel={channel}
                  epgData={epgDataMap.get(channel.iptvId || '')}
                  timelineStart={timelineStart}
                  timelineEnd={timelineEnd}
                  isFocused={focusedChannelIndex === index}
                  isPlaying={selectedChannel?.iptvId === channel.iptvId}
                  onSelect={() => selectChannelFromGuide(channel)}
                />
              ))}
            </div>

            {/* Scroll hint */}
            <div className="py-2 border-t border-white/10 text-center text-white/40 text-sm shrink-0">
              ↑ Scroll up to return to video
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
            onShowFavorites={() => setShowFavoritesPopup(true)}
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
            favorites={favorites}
            channels={channels}
            onSelectChannel={(channel) => {
              playStream(channel);
              setShowFavoritesPopup(false);
            }}
            onClose={() => setShowFavoritesPopup(false)}
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
