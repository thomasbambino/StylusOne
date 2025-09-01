import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tv, Signal, Wifi, WifiOff, Play, RefreshCw, Upload } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface HDHomeRunChannel {
  GuideNumber: string;
  GuideName: string;
  URL: string;
  HD: boolean;
  Favorite: boolean;
  DRM: boolean;
}

interface ChannelLogo {
  channelNumber: string;
  callSign: string;
  logoUrl: string;
  channelName?: string;
}

interface ChannelLineupCardProps {
  tvGuideData?: string;
}

export function ChannelLineupCard({ tvGuideData }: ChannelLineupCardProps) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  // Fetch HDHomeRun channels
  const { data: hdhrData, isLoading: hdhrLoading, error: hdhrError } = useQuery({
    queryKey: ['/api/hdhomerun/channels'],
    queryFn: async () => {
      const response = await fetch('/api/hdhomerun/channels');
      if (!response.ok) return { configured: false, channels: [] };
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Fetch channel logos
  const { data: logoData } = useQuery({
    queryKey: ['/api/channel-logos'],
    queryFn: async () => {
      const response = await fetch('/api/channel-logos');
      if (!response.ok) return { logos: [], count: 0 };
      return response.json();
    },
  });

  // Load logos from TV guide data
  const loadLogosMutation = useMutation({
    mutationFn: async (htmlData: string) => {
      const response = await fetch('/api/channel-logos/load-from-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ htmlData }),
      });
      if (!response.ok) throw new Error('Failed to load logos');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/channel-logos'] });
    },
  });

  const channels: HDHomeRunChannel[] = hdhrData?.channels || [];
  const logos: ChannelLogo[] = logoData?.logos || [];
  const isConfigured = hdhrData?.configured ?? false;

  // Create a map of channel numbers to logos for quick lookup
  const logoMap = new Map<string, string>();
  logos.forEach(logo => {
    logoMap.set(logo.channelNumber, logo.logoUrl);
    // Also map by call sign
    logoMap.set(logo.callSign, logo.logoUrl);
  });

  // Helper function to get logo URL for a channel
  const getChannelLogo = (channel: HDHomeRunChannel): string | null => {
    // Try exact match first
    let logoUrl = logoMap.get(channel.GuideNumber);
    if (logoUrl) return logoUrl;

    // Try by call sign/name
    logoUrl = logoMap.get(channel.GuideName);
    if (logoUrl) return logoUrl;

    // Try without decimal (8.1 -> 8)
    const baseNumber = channel.GuideNumber.split('.')[0];
    logoUrl = logoMap.get(baseNumber);
    if (logoUrl) return logoUrl;

    // Try with .1 suffix
    logoUrl = logoMap.get(baseNumber + '.1');
    if (logoUrl) return logoUrl;

    return null;
  };

  // Sort channels by guide number
  const sortedChannels = channels.sort((a, b) => {
    const aNum = parseFloat(a.GuideNumber) || 0;
    const bNum = parseFloat(b.GuideNumber) || 0;
    return aNum - bNum;
  });

  const displayChannels = showAll ? sortedChannels : sortedChannels.slice(0, 8);

  const handleLoadLogos = () => {
    if (tvGuideData) {
      loadLogosMutation.mutate(tvGuideData);
    }
  };

  if (!isConfigured) {
    return (
      <Card className="bg-card border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-blue-500" />
            <CardTitle>Channel Lineup</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            HD HomeRun device not configured
          </p>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <WifiOff className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No HD HomeRun device found</p>
            <p className="text-xs mt-1">Configure HDHOMERUN_URL in environment</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hdhrLoading) {
    return (
      <Card className="bg-card border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-blue-500" />
            <CardTitle>Channel Lineup</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
            <p>Loading channels...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (hdhrError || channels.length === 0) {
    return (
      <Card className="bg-card border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-blue-500" />
            <CardTitle>Channel Lineup</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Signal className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No channels available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tv className="h-5 w-5 text-blue-500" />
            <CardTitle>Channel Lineup</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {tvGuideData && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadLogos}
                disabled={loadLogosMutation.isPending}
                className="h-8 px-3"
              >
                <Upload className="h-3 w-3 mr-1" />
                {loadLogosMutation.isPending ? 'Loading...' : 'Load Logos'}
              </Button>
            )}
            <Badge variant="secondary" className="text-xs">
              {channels.length} channels
            </Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Available channels from your HD HomeRun device
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {displayChannels.map((channel, index) => {
            const logoUrl = getChannelLogo(channel);
            
            return (
              <div 
                key={index} 
                className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
              >
                {/* Channel Logo */}
                <div className="w-10 h-8 rounded bg-background flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {logoUrl ? (
                    <img 
                      src={logoUrl} 
                      alt={channel.GuideName}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        // Fallback to icon if image fails to load
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <Tv className={`h-4 w-4 text-muted-foreground ${logoUrl ? 'hidden' : ''}`} />
                </div>

                {/* Channel Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {channel.GuideNumber}
                    </span>
                    <span className="text-sm text-muted-foreground truncate">
                      {channel.GuideName}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1 mt-1">
                    {channel.HD && (
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        HD
                      </Badge>
                    )}
                    {channel.Favorite && (
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
                        ⭐
                      </Badge>
                    )}
                    {channel.DRM && (
                      <Badge variant="destructive" className="text-xs px-1.5 py-0">
                        DRM
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Play Button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                  onClick={() => {
                    // You can add navigation to live TV page or stream URL here
                    window.open(`/api/hdhomerun/stream/${channel.GuideNumber}`, '_blank');
                  }}
                >
                  <Play className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>

        {channels.length > 8 && (
          <div className="mt-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="text-xs"
            >
              {showAll ? 'Show Less' : `Show All ${channels.length} Channels`}
            </Button>
          </div>
        )}

        {logos.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <p className="text-xs text-muted-foreground text-center">
              {logoData.count} channel logos loaded
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}