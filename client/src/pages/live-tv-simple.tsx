import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback, memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import Hls from "hls.js";
import { List, Volume2, VolumeX, Menu, Play, Pause, Maximize, Cast } from "lucide-react";
import { buildApiUrl, isNativePlatform, getDeviceType, getPlatform } from "@/lib/capacitor";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Chromecast } from "@caprockapps/capacitor-chromecast";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

interface Channel {
  GuideName: string;
  GuideNumber: string;
  URL: string;
  source: 'hdhomerun' | 'iptv' | 'static';
  iptvId?: string;
  epgId?: string;
  logo?: string;
  currentProgram?: Program | null;
}

interface Program {
  title: string;
  start: string;
  end: string;
  description?: string;
}

interface EPGProgram {
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
}

// Memoized channel list item
const ChannelItem = memo(({
  channel,
  isSelected,
  onSelect,
  epgDataMap
}: {
  channel: Channel;
  isSelected: boolean;
  onSelect: (channel: Channel) => void;
  epgDataMap: Map<string, EPGProgram | null>;
}) => {
  const currentProgram = channel.epgId ? epgDataMap.get(channel.epgId) : null;

  return (
    <div
      onClick={() => {
        console.log('[ChannelItem] Clicked:', channel.GuideName);
        onSelect(channel);
      }}
      className={cn(
        "group relative p-2.5 mb-1.5 rounded-lg cursor-pointer transition-all duration-150",
        isSelected
          ? "bg-red-600 text-white shadow-md"
          : "bg-white/5 hover:bg-white/10 active:bg-white/15"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Channel Logo */}
        {channel.logo ? (
          <div className="w-12 h-12 shrink-0 rounded overflow-hidden bg-white/10 flex items-center justify-center">
            <img
              src={channel.logo}
              alt={channel.GuideName}
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        ) : (
          <div className="w-12 h-12 shrink-0 rounded bg-white/10 flex items-center justify-center">
            <div className="text-white/40 text-xs font-bold">{channel.GuideNumber}</div>
          </div>
        )}

        {/* Channel Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded",
              isSelected ? "bg-white/20" : "bg-white/10"
            )}>
              {channel.GuideNumber}
            </span>
            <span className="font-semibold truncate text-sm leading-tight">
              {channel.GuideName}
            </span>
          </div>
          {/* Current Program from EPG */}
          {currentProgram && (
            <div className="text-xs text-white/60 truncate mt-0.5">
              {currentProgram.title}
            </div>
          )}
        </div>

        {/* Playing Indicator */}
        {isSelected && (
          <div className="shrink-0">
            <div className="flex gap-0.5 items-end h-4">
              <div className="w-0.5 bg-white rounded-full animate-pulse" style={{ height: '50%' }}></div>
              <div className="w-0.5 bg-white rounded-full animate-pulse" style={{ height: '100%', animationDelay: '0.15s' }}></div>
              <div className="w-0.5 bg-white rounded-full animate-pulse" style={{ height: '70%', animationDelay: '0.3s' }}></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ChannelItem.displayName = 'ChannelItem';

/**
 * Simplified, performant Live TV component
 * Works on all devices (phone/tablet/TV)
 */
export default function LiveTVSimple() {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showChannelList, setShowChannelList] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isTVDevice, setIsTVDevice] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch IPTV channels
  const { data: iptvChannels = [], isLoading: channelsLoading, error: channelsError } = useQuery<Channel[]>({
    queryKey: ["/api/iptv/channels"],
    select: (data: any) => {
      console.log('[LiveTV] Raw channel data:', data);
      const channels = (data?.channels || []).filter((ch: any) => !ch.hidden).map((ch: any) => ({
        GuideName: ch.name,
        GuideNumber: ch.number,
        URL: ch.streamUrl,
        source: 'iptv' as const,
        iptvId: ch.id,
        epgId: ch.epgId,
        logo: ch.logo
      }));
      console.log('[LiveTV] Processed channels:', channels.length, channels.slice(0, 3));
      return channels;
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch EPG data for first 100 channels only (same pattern as web Live TV page)
  // React Query handles batching and rate limiting automatically
  const channelsForEPG = iptvChannels.slice(0, 100);

  console.log('[LiveTV] Setting up EPG queries for', channelsForEPG.length, 'channels');
  console.log('[LiveTV] First 3 channels for EPG:', channelsForEPG.slice(0, 3).map(c => ({ name: c.GuideName, epgId: c.epgId })));

  const epgQueries = useQueries({
    queries: channelsForEPG.map((channel) => {
      // For IPTV channels, use epgId (XMLTV channel ID)
      const channelKey = channel.epgId;
      if (!channelKey) {
        return {
          queryKey: ['epg', 'upcoming', 'none'],
          queryFn: async () => [],
          staleTime: 5 * 60 * 1000,
          refetchInterval: 5 * 60 * 1000,
        };
      }
      return {
        queryKey: [`/api/epg/upcoming/${encodeURIComponent(channelKey)}`],
        queryFn: getQueryFn({ on401: "returnNull" }),
        select: (data: any) => (data?.programs || []) as EPGProgram[],
        staleTime: 5 * 60 * 1000, // 5 minutes
        refetchInterval: 5 * 60 * 1000,
      };
    })
  });


  // Keep channels simple to avoid re-renders breaking video
  const channels = iptvChannels;

  // Store EPG data in separate state to avoid breaking video rendering
  const [epgDataMap, setEpgDataMap] = useState<Map<string, EPGProgram | null>>(new Map());

  // Process EPG queries and update state when data changes
  useEffect(() => {
    // Only process if we have channels and at least some queries are successful
    const successfulQueries = epgQueries.filter(q => q.isSuccess).length;
    if (channelsForEPG.length === 0 || successfulQueries === 0) {
      console.log('[LiveTV] Skipping EPG processing - waiting for queries to complete');
      return;
    }

    const newEpgMap = new Map<string, EPGProgram | null>();
    const now = new Date();

    channelsForEPG.forEach((channel, index) => {
      if (channel.epgId) {
        const query = epgQueries[index];
        const programs = query?.data || [];

        // Find current program by comparing times
        const currentProgram = programs.find((program: EPGProgram) => {
          const start = new Date(program.startTime);
          const end = new Date(program.endTime);
          return start <= now && now < end;
        });

        newEpgMap.set(channel.epgId, currentProgram || null);
      }
    });

    setEpgDataMap(newEpgMap);
  }, [channelsForEPG.length, epgQueries.filter(q => q.isSuccess).length, epgQueries.filter(q => q.data && Array.isArray(q.data) && q.data.length > 0).length]);

  // Debug channel loading
  useEffect(() => {
    console.log('[LiveTV] Channels state:', {
      loading: channelsLoading,
      error: channelsError,
      count: channels.length,
      first: channels[0]
    });
  }, [channels, channelsLoading, channelsError]);

  // Reset controls timer - show controls and auto-hide after 5 seconds
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (!showChannelList) { // Don't hide if channel list is open
        setShowControls(false);
      }
    }, 5000);
  }, [showChannelList]);

  // Play stream function
  const playStream = useCallback(async (channel: Channel) => {
    console.log('[LiveTV] ========== Starting playStream ==========');
    console.log('[LiveTV] Channel:', {
      name: channel.GuideName,
      number: channel.GuideNumber,
      url: channel.URL,
      iptvId: channel.iptvId,
      source: channel.source
    });

    if (!videoRef.current) {
      console.error('[LiveTV] videoRef is null');
      return;
    }

    const video = videoRef.current;
    console.log('[LiveTV] Video element ready:', !!video);
    setIsLoading(true);
    setSelectedChannel(channel);
    setShowChannelList(false);

    // Clean up existing HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    try {
      console.log('[LiveTV] Channel URL from API:', channel.URL);
      let streamUrl = buildApiUrl(channel.URL);
      console.log('[LiveTV] Built stream URL:', streamUrl);
      console.log('[LiveTV] Is native platform?', isNativePlatform());
      console.log('[LiveTV] Channel source:', channel.source);
      console.log('[LiveTV] Channel iptvId:', channel.iptvId);

      // On native platforms, IPTV streams need a token for authentication
      if (isNativePlatform() && channel.source === 'iptv' && channel.iptvId) {
        console.log('[LiveTV] Native platform detected, getting token for:', channel.iptvId);
        try {
          const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
            streamId: channel.iptvId,
            deviceType: getPlatform()
          });
          console.log('[LiveTV] Token response status:', tokenResponse.status);
          const tokenData = await tokenResponse.json();
          console.log('[LiveTV] Token data:', tokenData);
          const { token } = tokenData;
          streamUrl = `${streamUrl}?token=${token}`;
          console.log('[LiveTV] Final stream URL with token:', streamUrl);
        } catch (tokenError) {
          console.error('[LiveTV] Token generation failed:', tokenError);
          throw tokenError;
        }
      } else {
        console.log('[LiveTV] Using stream URL without token');
      }

      if (Hls.isSupported()) {
        console.log('[LiveTV] HLS is supported, creating HLS instance');
        const hls = new Hls({
          debug: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 45,
          // Don't send credentials - we use token in URL instead
          xhrSetup: function(xhr: XMLHttpRequest) {
            xhr.withCredentials = false;
          },
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('[LiveTV] HLS manifest parsed, starting playback');
          video.play().then(() => {
            console.log('[LiveTV] Video playback started successfully');
            setIsPlaying(true);
            setIsLoading(false);
            setIsInitialLoad(false);
            resetControlsTimer();
          }).catch(err => {
            console.error('[LiveTV] Playback error:', err);
            setIsLoading(false);
          });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('[LiveTV] HLS error:', data);
          if (data.fatal) {
            console.error('[LiveTV] Fatal HLS error, destroying instance');
            hls.destroy();
            setIsLoading(false);
          }
        });

        console.log('[LiveTV] Attaching HLS to video and loading source:', streamUrl);
        hls.attachMedia(video);
        hls.loadSource(streamUrl);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        console.log('[LiveTV] Using native HLS support');
        video.src = streamUrl;
        video.play().then(() => {
          console.log('[LiveTV] Native playback started successfully');
          setIsPlaying(true);
          setIsLoading(false);
          setIsInitialLoad(false);
          resetControlsTimer();
        }).catch(err => {
          console.error('[LiveTV] Native playback error:', err);
          setIsLoading(false);
        });
      } else {
        console.error('[LiveTV] HLS not supported on this device');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Stream playback error:', error);
      setIsLoading(false);
    }
  }, [resetControlsTimer]);

  // Auto-play first channel on load
  useEffect(() => {
    console.log('[LiveTV] Auto-play effect:', { channelsCount: channels.length, hasSelectedChannel: !!selectedChannel, firstChannel: channels[0]?.GuideName });
    if (channels.length > 0 && !selectedChannel && channels[0]?.GuideName) {
      console.log('[LiveTV] Auto-playing first channel:', channels[0].GuideName);
      playStream(channels[0]);
    }
  }, [channels, selectedChannel]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newMuted = !prev;
      if (videoRef.current) {
        videoRef.current.muted = newMuted;
      }
      return newMuted;
    });
    resetControlsTimer();
  }, [resetControlsTimer]);

  const togglePlayPause = useCallback(() => {
    if (!videoRef.current) return;

    if (isPaused) {
      videoRef.current.play().then(() => {
        setIsPaused(false);
        setIsPlaying(true);
      }).catch(err => console.error('[LiveTV] Play error:', err));
    } else {
      videoRef.current.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
    resetControlsTimer();
  }, [isPaused, resetControlsTimer]);

  const toggleFullscreen = useCallback(async () => {
    console.log('[LiveTV] Fullscreen toggle clicked, current state:', isFullscreen);
    try {
      const video = videoRef.current;
      if (!video) {
        console.error('[LiveTV] No video element');
        return;
      }

      // On mobile platforms, request fullscreen on the video element
      if (isNativePlatform()) {
        console.log('[LiveTV] Native platform - toggling video fullscreen');
        const videoAny = video as any;

        // Check if currently in fullscreen
        const isInFullscreen = videoAny.webkitDisplayingFullscreen ||
                               document.fullscreenElement === video ||
                               videoAny.fullscreenElement === video;

        console.log('[LiveTV] Is currently fullscreen?', isInFullscreen);

        if (isInFullscreen) {
          // Exit fullscreen
          console.log('[LiveTV] Attempting to exit fullscreen');
          if (videoAny.webkitExitFullscreen) {
            console.log('[LiveTV] Using webkitExitFullscreen');
            videoAny.webkitExitFullscreen();
          } else if (document.exitFullscreen) {
            console.log('[LiveTV] Using document.exitFullscreen');
            await document.exitFullscreen();
          }
        } else {
          // Enter fullscreen
          console.log('[LiveTV] Attempting to enter fullscreen');
          if (videoAny.webkitEnterFullscreen) {
            console.log('[LiveTV] Using webkitEnterFullscreen');
            videoAny.webkitEnterFullscreen();
          } else if (videoAny.requestFullscreen) {
            console.log('[LiveTV] Using requestFullscreen');
            await videoAny.requestFullscreen();
          } else if (videoAny.webkitRequestFullscreen) {
            console.log('[LiveTV] Using webkitRequestFullscreen');
            await videoAny.webkitRequestFullscreen();
          } else {
            console.error('[LiveTV] No fullscreen API available');
          }
        }
      } else {
        // Desktop: toggle document fullscreen
        if (!document.fullscreenElement) {
          console.log('[LiveTV] Entering fullscreen');
          await document.documentElement.requestFullscreen();
        } else {
          console.log('[LiveTV] Exiting fullscreen');
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error('[LiveTV] Fullscreen error:', err);
    }
    resetControlsTimer();
  }, [resetControlsTimer, isFullscreen]);

  const initiateCast = useCallback(async () => {
    console.log('[LiveTV] Cast button clicked');

    // Use native Chromecast on Android/iOS
    if (isNativePlatform()) {
      try {
        if (isCasting) {
          // Stop casting - for now just update state
          // The plugin doesn't have a stopSession method, user can stop from notification
          setIsCasting(false);
          console.log('[LiveTV] Casting stopped');
          return;
        }

        console.log('[LiveTV] Requesting native cast session');
        await Chromecast.requestSession();
        console.log('[LiveTV] Cast session started');
        setIsCasting(true);

        // Launch media if we have a selected channel
        if (selectedChannel) {
          // For IPTV, we need to get a token for the stream
          let streamUrl = buildApiUrl(selectedChannel.URL);

          if (selectedChannel.source === 'iptv' && selectedChannel.iptvId) {
            try {
              const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
                streamId: selectedChannel.iptvId,
                deviceType: getPlatform()
              });
              const { token } = await tokenResponse.json();
              streamUrl = `${streamUrl}?token=${token}`;
            } catch (tokenError) {
              console.error('[LiveTV] Failed to get stream token for cast:', tokenError);
            }
          }

          console.log('[LiveTV] Launching media on cast device:', streamUrl);
          const success = await Chromecast.launchMedia(streamUrl);
          console.log('[LiveTV] Cast media launch result:', success);
        }
      } catch (err) {
        console.error('[LiveTV] Native cast error:', err);
        setIsCasting(false);
      }
      resetControlsTimer();
      return;
    }

    // Web Cast API fallback
    if (!window.chrome || !window.chrome.cast || !window.chrome.cast.isAvailable) {
      console.warn('[LiveTV] Cast API not available');
      return;
    }

    try {
      const castContext = window.chrome.cast.CastContext.getInstance();
      const castSession = castContext.getCurrentSession();

      if (castSession) {
        // Already casting, stop it
        castSession.endSession(true);
        setIsCasting(false);
      } else {
        // Start casting
        castContext.requestSession().then(() => {
          setIsCasting(true);

          // Load media if we have a stream
          if (selectedChannel) {
            const session = castContext.getCurrentSession();
            if (session) {
              const mediaInfo = new window.chrome.cast.media.MediaInfo(
                buildApiUrl(selectedChannel.URL),
                'application/x-mpegURL'
              );
              mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
              mediaInfo.metadata.title = selectedChannel.GuideName;

              const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
              session.loadMedia(request).then(
                () => console.log('[LiveTV] Media loaded on Cast device'),
                (err: any) => console.error('[LiveTV] Cast media load error:', err)
              );
            }
          }
        }).catch((err: any) => {
          console.error('[LiveTV] Cast session error:', err);
        });
      }
    } catch (err) {
      console.error('[LiveTV] Cast error:', err);
    }
    resetControlsTimer();
  }, [resetControlsTimer, selectedChannel, isCasting]);

  // Handle screen tap to toggle controls
  const handleScreenTap = useCallback(() => {
    if (showControls) {
      // If controls are visible, hide them immediately
      setShowControls(false);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    } else {
      // If controls are hidden, show them and start timer
      resetControlsTimer();
    }
  }, [showControls, resetControlsTimer]);

  // Get current program for selected channel from the EPG data map
  const currentProgram = selectedChannel?.epgId ? epgDataMap.get(selectedChannel.epgId) || null : null;

  // Track fullscreen state changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const video = videoRef.current as any;
      const isInFullscreen = !!(
        document.fullscreenElement ||
        video?.webkitDisplayingFullscreen
      );
      console.log('[LiveTV] Fullscreen state changed:', isInFullscreen);
      setIsFullscreen(isInFullscreen);
    };

    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    if (videoRef.current) {
      videoRef.current.addEventListener('webkitbeginfullscreen', () => {
        console.log('[LiveTV] Webkit began fullscreen');
        setIsFullscreen(true);
      });
      videoRef.current.addEventListener('webkitendfullscreen', () => {
        console.log('[LiveTV] Webkit ended fullscreen');
        setIsFullscreen(false);
      });
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Detect device type and initialize Chromecast on non-TV native platforms
  useEffect(() => {
    async function initChromecast() {
      if (!isNativePlatform()) return;

      try {
        const deviceType = await getDeviceType();

        // Track if this is a TV device
        if (deviceType === 'tv') {
          setIsTVDevice(true);
          console.log('[LiveTV] TV device detected, skipping Chromecast init');
          return;
        }

        console.log('[LiveTV] Initializing native Chromecast');
        await Chromecast.initialize({});
        console.log('[LiveTV] Chromecast initialized');
      } catch (err: any) {
        // Don't crash if Chromecast isn't available (e.g., no Google Play Services)
        console.warn('[LiveTV] Chromecast init skipped:', err?.message || err);
      }
    }

    initChromecast();
  }, []);

  return (
    <div
      className="relative w-screen h-screen bg-black overflow-hidden"
      onClick={handleScreenTap}
    >
      {/* Video Player */}
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full"
        style={{ objectFit: 'contain' }}
        playsInline
        muted={isMuted}
        controls={false}
        autoPlay={false}
        preload="none"
        poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"
        webkit-playsinline="true"
        x5-video-player-type="h5"
        x5-video-player-fullscreen="true"
      />

      {/* Initial Loading State */}
      {isInitialLoad && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-black to-gray-900 z-50">
          <div className="flex flex-col items-center gap-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="text-white text-xl font-medium">Loading Live TV...</div>
            {selectedChannel && (
              <div className="text-white/60 text-sm">
                {selectedChannel.GuideNumber} - {selectedChannel.GuideName}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Loading Indicator */}
      {isLoading && !isInitialLoad && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 border-4 border-white/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div className="text-white text-lg">Loading stream...</div>
          </div>
        </div>
      )}

      {/* Channel Picker Sheet */}
      <Sheet open={showChannelList} onOpenChange={setShowChannelList}>
        <SheetContent side="right" className="w-96 bg-black/95 border-l border-white/10 backdrop-blur-xl">
          <SheetHeader className="border-b border-white/10 pb-4 mb-4">
            <SheetTitle className="text-2xl font-bold text-white">Live Channels</SheetTitle>
            <SheetDescription className="text-white/60 text-sm">
              {channelsLoading ? (
                <span className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-white/20 border-t-white/60 rounded-full animate-spin"></div>
                  Loading channels...
                </span>
              ) : (
                <span>{channels.length} channels available</span>
              )}
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="h-full pr-4 pb-24">
            {channelsLoading && (
              <div className="flex flex-col items-center justify-center py-12 text-white/60">
                <div className="relative w-12 h-12 mb-4">
                  <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <div>Loading channels...</div>
              </div>
            )}
            {channelsError && (
              <div className="p-6 text-center bg-red-500/10 border border-red-500/20 rounded-xl text-red-500">
                <div className="font-semibold mb-1">Error loading channels</div>
                <div className="text-sm text-red-400">Please try again later</div>
              </div>
            )}
            {!channelsLoading && channels.length === 0 && (
              <div className="p-6 text-center bg-white/5 border border-white/10 rounded-xl text-white/60">
                No channels available
              </div>
            )}
            {channels.map((channel) => (
              <ChannelItem
                key={channel.GuideNumber}
                channel={channel}
                isSelected={selectedChannel?.GuideNumber === channel.GuideNumber}
                onSelect={playStream}
                epgDataMap={epgDataMap}
              />
            ))}
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Overlay Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-40"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar - Channel Info */}
            <div className="absolute top-0 left-0 right-0 p-4 bg-gradient-to-b from-black/90 to-transparent pointer-events-auto">
              <div className="flex items-center gap-3">
                <Link href="/home">
                  <Button variant="ghost" size="icon" className="text-white">
                    <Menu className="w-6 h-6" />
                  </Button>
                </Link>

                {/* Channel Logo */}
                {selectedChannel?.logo && (
                  <img
                    src={selectedChannel.logo}
                    alt={selectedChannel.GuideName}
                    className="w-12 h-12 object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}

                {/* Channel Info */}
                <div className="flex-1 text-white">
                  <div className="text-lg font-semibold">
                    {selectedChannel?.GuideName}
                  </div>
                  {/* Show current program from EPG */}
                  {currentProgram && (
                    <div className="text-sm text-white/80">
                      {currentProgram.title}
                    </div>
                  )}
                </div>

                {/* Channel Picker Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowChannelList(true);
                  }}
                >
                  <List className="w-6 h-6" />
                </Button>
              </div>
            </div>

            {/* Bottom Bar - Playback Controls */}
            <div className="absolute bottom-0 left-0 right-0 pointer-events-auto">
              <div className="bg-gradient-to-t from-black/95 via-black/90 to-transparent pt-8 pb-4 px-4">
                {/* Progress Bar */}
                <div className="mb-4 px-2">
                  <div className="relative h-1 bg-white/20 rounded-full group cursor-pointer">
                    <div className="absolute h-full bg-red-600 rounded-full" style={{ width: '0%' }}>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                  </div>
                </div>

                {/* Controls Row */}
                <div className="flex items-center justify-between gap-4 px-2">
                  {/* Left Side - Play/Pause & Volume */}
                  <div className="flex items-center gap-3">
                    <button
                      className="text-white hover:scale-110 transition-transform p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePlayPause();
                      }}
                    >
                      {isPaused ? (
                        <Play className="w-8 h-8 fill-white" />
                      ) : (
                        <Pause className="w-8 h-8 fill-white" />
                      )}
                    </button>

                    <button
                      className="text-white hover:scale-110 transition-transform p-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute();
                      }}
                    >
                      {isMuted ? (
                        <VolumeX className="w-6 h-6" />
                      ) : (
                        <Volume2 className="w-6 h-6" />
                      )}
                    </button>

                    {/* Live Badge */}
                    <div className="ml-2 px-3 py-1 bg-red-600 text-white text-xs font-bold rounded uppercase">
                      Live
                    </div>
                  </div>

                  {/* Right Side - Cast & Fullscreen */}
                  <div className="flex items-center gap-2">
                    {/* Cast Button - hide on TV devices (TV IS the cast target) */}
                    {!isTVDevice && (
                      <button
                        className="text-white hover:scale-110 transition-transform p-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          initiateCast();
                        }}
                      >
                        <Cast className={cn("w-6 h-6", isCasting && "text-red-600")} />
                      </button>
                    )}

                    {/* Fullscreen - hide on mobile platforms (they have native fullscreen) */}
                    {!isNativePlatform() && (
                      <button
                        className="text-white hover:scale-110 transition-transform p-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFullscreen();
                        }}
                      >
                        <Maximize className="w-6 h-6" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
