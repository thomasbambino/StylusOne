import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import Hls from "hls.js";
import { Play, Volume2, VolumeX, Maximize, Star, StarOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildApiUrl, isNativePlatform, getPlatform } from "@/lib/capacitor";
import { getQueryFn, apiRequest } from "@/lib/queryClient";

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

interface FavoriteChannel {
  channelId: string;
  channelName: string;
  channelLogo?: string | null;
}

/**
 * Tablet-optimized Live TV interface
 * Features:
 * - Side-by-side layout: video on left, channel guide on right
 * - Touch-friendly channel list
 * - EPG program information
 * - Landscape-optimized layout
 */
export default function LiveTVTablet() {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

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
  const { data: favoriteChannels = [] } = useQuery<FavoriteChannel[]>({
    queryKey: ["/api/favorite-channels"],
  });

  const isFavorite = (channelId: string) =>
    favoriteChannels?.some((fav) => fav.channelId === channelId);

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
          }).catch(() => {
            setIsLoading(false);
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
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
        }).catch(() => {
          setIsLoading(false);
        });
      }
    } catch {
      setIsLoading(false);
    }
  }, []);

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
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Left Side - Video Player */}
      <div className="flex-1 flex flex-col bg-black">
        <div className="relative flex-1">
          <video
            ref={videoRef}
            className="w-full h-full"
            playsInline
            muted={isMuted}
          />

          {/* Loading Indicator */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-white text-2xl">Loading...</div>
            </div>
          )}

          {/* Video Controls Overlay */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <div className="text-xl font-semibold">{selectedChannel?.GuideName}</div>
                {currentProgram && (
                  <div className="text-sm text-white/80">{currentProgram.title}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                >
                  {isMuted ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                >
                  <Maximize className="w-6 h-6 text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Now Playing Info */}
        {currentProgram && (
          <div className="bg-card p-4 border-t">
            <div className="text-lg font-semibold">{currentProgram.title}</div>
            {currentProgram.description && (
              <div className="text-sm text-muted-foreground mt-1">{currentProgram.description}</div>
            )}
            <div className="text-xs text-muted-foreground mt-2">
              {new Date(currentProgram.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
              {new Date(currentProgram.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        )}
      </div>

      {/* Right Side - Channel Guide */}
      <div className="w-96 bg-card border-l flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-2xl font-semibold">Channels</h2>
          <p className="text-sm text-muted-foreground">{channels.length} available</p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {channels.map((channel) => {
              const isSelected = selectedChannel?.GuideNumber === channel.GuideNumber;
              const isFav = isFavorite(channel.iptvId || channel.GuideNumber);

              return (
                <Card
                  key={channel.GuideNumber}
                  className={cn(
                    "p-3 mb-2 cursor-pointer transition-all hover:bg-accent",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  onClick={() => playStream(channel)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={isSelected ? "secondary" : "outline"} className="text-xs">
                          {channel.GuideNumber}
                        </Badge>
                        <div className="font-medium truncate">{channel.GuideName}</div>
                      </div>
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
                      className="flex-shrink-0"
                    >
                      {isFav ? (
                        <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                      ) : (
                        <StarOff className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
