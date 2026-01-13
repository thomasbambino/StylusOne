import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import Hls from "hls.js";
import { List, Volume2, VolumeX, Maximize, Star, StarOff, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildApiUrl, isNativePlatform, getPlatform } from "@/lib/capacitor";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";

interface Channel {
  GuideName: string;
  GuideNumber: string;
  URL: string;
  source: 'hdhomerun' | 'iptv' | 'static';
  iptvId?: string;
  epgId?: string;
  logo?: string;
}

interface EPGProgram {
  title: string;
  start: string;
  stop: string;
  description?: string;
}

/**
 * Phone-optimized Live TV interface
 * Features:
 * - Fullscreen video playback
 * - Minimal overlay UI that auto-hides
 * - Bottom sheet for channel selection
 * - Touch-friendly controls
 */
export default function LiveTVPhone() {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showChannelList, setShowChannelList] = useState(false);

  // Auto-hide controls after 3 seconds
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  }, []);

  // Fetch IPTV channels
  const { data: iptvChannels = [] } = useQuery<Channel[]>({
    queryKey: ["/api/iptv/channels"],
    select: (data: any) =>
      (data?.channels || []).filter((ch: any) => !ch.hidden).map((ch: any) => ({
        ...ch,
        source: 'iptv' as const
      }))
  });

  // Fetch favorite channels
  const { data: favoriteChannels = [] } = useQuery({
    queryKey: ["/api/favorite-channels"],
  });

  const isFavorite = (channelId: string) =>
    favoriteChannels?.some((fav: any) => fav.channelId === channelId);

  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ channelId, channelName, isFav }: any) => {
      if (isFav) {
        const res = await apiRequest('DELETE', `/api/favorite-channels/${channelId}`, null);
        return res.json();
      } else {
        const res = await apiRequest('POST', '/api/favorite-channels', {
          channelId,
          channelName,
          channelLogo: null
        });
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/favorite-channels'] });
    },
  });

  const channels = iptvChannels;

  // Play stream function
  const playStream = useCallback(async (channel: Channel) => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    setIsLoading(true);
    setSelectedChannel(channel);
    setShowChannelList(false);

    // Clean up existing HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    try {
      let streamUrl = buildApiUrl(channel.URL);

      // On native platforms, IPTV streams need a token for authentication
      if (isNativePlatform() && channel.source === 'iptv' && channel.iptvId) {
        const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
          streamId: channel.iptvId,
          deviceType: getPlatform()
        });
        const { token } = await tokenResponse.json();
        streamUrl = `${streamUrl}?token=${token}`;
      }

      if (Hls.isSupported()) {
        const hls = new Hls({
          debug: false,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 45,
          xhrSetup: function(xhr: XMLHttpRequest) {
            xhr.withCredentials = true;
          },
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().then(() => {
            setIsPlaying(true);
            setIsLoading(false);
            resetControlsTimer();
          }).catch(err => {
            console.error('Playback error:', err);
            setIsLoading(false);
          });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', data);
          if (data.fatal) {
            hls.destroy();
            setIsLoading(false);
          }
        });

        hls.attachMedia(video);
        hls.loadSource(streamUrl);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          resetControlsTimer();
        }).catch(err => {
          console.error('Playback error:', err);
          setIsLoading(false);
        });
      }
    } catch (error) {
      console.error('Stream playback error:', error);
      setIsLoading(false);
    }
  }, [resetControlsTimer]);

  // Auto-play first channel on load
  useEffect(() => {
    if (channels.length > 0 && !selectedChannel) {
      playStream(channels[0]);
    }
  }, [channels, selectedChannel, playStream]);

  // EPG data for current channel
  const { data: currentProgram } = useQuery<EPGProgram | null>({
    queryKey: selectedChannel ? [`/api/epg/upcoming/${encodeURIComponent(selectedChannel.epgId || selectedChannel.GuideNumber)}`] : ['no-channel'],
    queryFn: selectedChannel ? getQueryFn({ on401: "returnNull" }) : undefined,
    enabled: !!selectedChannel,
    select: (data: any) => {
      const programs = data?.programs || [];
      const now = new Date();
      return programs.find((p: EPGProgram) =>
        new Date(p.start) <= now && new Date(p.stop) > now
      ) || null;
    },
    refetchInterval: 60000,
  });

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
    resetControlsTimer();
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
    resetControlsTimer();
  };

  return (
    <div
      className="relative w-screen h-screen bg-black"
      onClick={() => resetControlsTimer()}
    >
      {/* Video Player */}
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        muted={isMuted}
      />

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-xl">Loading...</div>
        </div>
      )}

      {/* Overlay Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 pointer-events-none"
          >
            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 p-4 pointer-events-auto">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-white text-lg font-semibold">
                    {selectedChannel?.GuideNumber} - {selectedChannel?.GuideName}
                  </div>
                  {currentProgram && (
                    <div className="text-white/80 text-sm mt-1">{currentProgram.title}</div>
                  )}
                </div>
                <Sheet open={showChannelList} onOpenChange={setShowChannelList}>
                  <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-white">
                      <List className="w-6 h-6" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="bottom" className="h-[70vh]">
                    <SheetHeader>
                      <SheetTitle>Select Channel</SheetTitle>
                      <p className="text-sm text-muted-foreground">Choose a channel to watch</p>
                    </SheetHeader>
                    <ScrollArea className="h-full mt-4">
                      <div className="space-y-2 pb-4">
                        {channels.map((channel) => {
                          const isSelected = selectedChannel?.GuideNumber === channel.GuideNumber;
                          const isFav = isFavorite(channel.iptvId || channel.GuideNumber);

                          return (
                            <div
                              key={channel.GuideNumber}
                              className={cn(
                                "p-3 rounded-lg cursor-pointer transition-all border",
                                isSelected ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                              )}
                              onClick={() => playStream(channel)}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <Badge variant={isSelected ? "secondary" : "outline"} className="text-xs">
                                    {channel.GuideNumber}
                                  </Badge>
                                  <div className="font-medium truncate">{channel.GuideName}</div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavoriteMutation.mutate({
                                      channelId: channel.iptvId || channel.GuideNumber,
                                      channelName: channel.GuideName,
                                      isFav
                                    });
                                  }}
                                >
                                  {isFav ? (
                                    <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                  ) : (
                                    <StarOff className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </SheetContent>
                </Sheet>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-auto">
              <div className="flex items-center justify-between">
                <div className="text-white/80 text-xs">
                  {currentProgram && (
                    <>
                      {new Date(currentProgram.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
                      {new Date(currentProgram.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="text-white" onClick={toggleMute}>
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="text-white" onClick={toggleFullscreen}>
                    <Maximize className="w-5 h-5" />
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
