import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Progress } from "@/components/ui/progress";
import { 
  Play, 
  Tv, 
  Gamepad2,
  Users,
  Film,
  Music,
  Server,
  Wifi,
  WifiOff,
  TrendingUp,
  Clock,
  ChevronRight,
  AlertCircle,
  UserPlus,
  Search,
  ExternalLink
} from "lucide-react";
import { Settings } from "@shared/schema";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { getGameArtwork } from "@/lib/game-artwork";
import { motion } from "framer-motion";

const plexInviteSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type PlexInviteForm = z.infer<typeof plexInviteSchema>;

// Component for rendering individual favorite channel with EPG data (no hooks version)
const FavoriteChannelItem = React.memo(function FavoriteChannelItem({
  favorite,
  program
}: {
  favorite: { id: number, channelId: string, channelName: string, channelLogo: string | null },
  program?: { title?: string, startTime?: string, endTime?: string } | null
}) {
  return (
    <div className="bg-accent/10 rounded-lg p-3 border border-border/50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
            {favorite.channelLogo ? (
              <img
                src={favorite.channelLogo}
                alt={favorite.channelName}
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <Tv className="w-4 h-4 text-blue-500" />
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate">{favorite.channelName}</div>
          <div className="text-xs text-muted-foreground truncate">
            {program?.title || 'Loading...'}
          </div>
          {program?.startTime && program?.endTime && (
            <div className="text-[10px] text-muted-foreground">
              {new Date(program.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} -
              {new Date(program.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default function HomePage() {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });
  const { toast } = useToast();
  const [showPlexDialog, setShowPlexDialog] = useState(false);
  
  const form = useForm<PlexInviteForm>({
    resolver: zodResolver(plexInviteSchema),
    defaultValues: {
      email: "",
    },
  });

  const createPlexAccountMutation = useMutation({
    mutationFn: async (data: PlexInviteForm) => {
      const response = await fetch("/api/services/plex/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Failed to send invitation");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Invitation sent!",
        description: "Check your email for the Plex server invitation.",
      });
      setShowPlexDialog(false);
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send invitation",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PlexInviteForm) => {
    createPlexAccountMutation.mutate(data);
  };
  
  // Fetch Plex activity from Tautulli
  const { data: plexActivity } = useQuery({
    queryKey: ['/api/tautulli/activity'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/activity');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch Plex libraries
  const { data: plexLibraries } = useQuery({
    queryKey: ['/api/tautulli/libraries'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/libraries');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Fetch recently added
  const { data: recentlyAdded } = useQuery({
    queryKey: ['/api/tautulli/recently-added'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/recently-added');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });


  // Fetch Game Servers data
  const { data: gameServers } = useQuery({
    queryKey: ['/api/game-servers'],
    queryFn: async () => {
      const response = await fetch('/api/game-servers');
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch IPTV channels instead of HDHomeRun
  const { data: iptvStatus } = useQuery({
    queryKey: ['/api/iptv/status'],
    queryFn: async () => {
      const response = await fetch('/api/iptv/status', {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  const { data: iptvChannels } = useQuery({
    queryKey: ['/api/iptv/channels'],
    queryFn: async () => {
      const response = await fetch('/api/iptv/channels', {
        credentials: 'include',
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: iptvStatus?.configured === true,
    refetchInterval: 60000,
  });

  // Fetch favorite channels
  const { data: favoriteChannels = [] } = useQuery<Array<{id: number, channelId: string, channelName: string, channelLogo: string | null}>>({
    queryKey: ['/api/favorite-channels'],
    queryFn: async () => {
      const response = await fetch('/api/favorite-channels', {
        credentials: 'include',
      });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Extract channels from the response
  const liveTVChannels = iptvChannels?.channels || [];

  // Fetch EPG data for all favorite channels in a single query
  // Use useMemo to stabilize the channel IDs array and prevent unnecessary re-renders
  const favoriteChannelIds = useMemo(
    () => favoriteChannels.map(fav => fav.channelId),
    [favoriteChannels]
  );

  const { data: favoriteProgramsData = {} } = useQuery<Record<string, any>>({
    queryKey: ['/api/epg/batch', favoriteChannelIds.join(',')],
    queryFn: async () => {
      if (favoriteChannelIds.length === 0) return {};

      const programs: Record<string, any> = {};
      await Promise.all(
        favoriteChannelIds.map(async (channelId) => {
          try {
            const response = await fetch(`/api/epg/current/${channelId}`, {
              credentials: 'include',
            });
            if (response.ok) {
              const data = await response.json();
              programs[channelId] = data.program;
            }
          } catch (error) {
            console.error(`Failed to fetch EPG for ${channelId}:`, error);
          }
        })
      );
      return programs;
    },
    refetchInterval: 300000, // 5 minutes
  });


  // Fetch Tautulli server info for machine ID (needed for Plex URLs)
  const { data: serverInfoData } = useQuery({
    queryKey: ['/api/tautulli/server-info'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/server-info');
      if (!response.ok) throw new Error('Failed to fetch server info');
      return response.json();
    },
    refetchInterval: 60000,
  });

  const runningServers = gameServers?.filter((s: any) => s.status === true) || [];
  const totalPlayers = runningServers.reduce((sum: number, s: any) => 
    sum + (s.playerCount || 0), 0
  );

  // Extract libraries from the correct data structure (same as Plex page)  
  const libraries = (plexLibraries || []) as any[];
  const recentlyAddedItems = recentlyAdded?.recently_added || [];

  // Helper function to get thumbnail URL (same as Plex page)
  const getThumbnailUrl = (item: any, width = 150, height = 225) => {
    const thumb = item.grandparent_thumb || item.parent_thumb || item.thumb;
    if (thumb) {
      return `/api/tautulli/proxy-image?img=${encodeURIComponent(thumb)}&width=${width}&height=${height}`;
    }
    return null;
  };

  const openInPlex = (item: any) => {
    
    // For episodes, use the grandparent (series) rating key to open the series page
    // For movies, use the direct rating key
    let targetKey = item.rating_key;
    
    if (item.media_type === 'episode' && item.grandparent_rating_key) {
      targetKey = item.grandparent_rating_key;
    }
    
    // Get server machine identifier from Tautulli server info
    const machineId = serverInfoData?.data?.pms_identifier;
    
    // Use Plex cloud URL format if we have machine ID, otherwise fallback to local
    let plexWebUrl;
    if (machineId) {
      // Plex cloud format: https://app.plex.tv/desktop/#!/server/{machineId}/details?key=%2Flibrary%2Fmetadata%2F{key}
      plexWebUrl = `https://app.plex.tv/desktop/#!/server/${machineId}/details?key=%2Flibrary%2Fmetadata%2F${targetKey}`;
    } else {
      // Fallback to local format
      const plexUrl = settings?.plexUrl || 'http://localhost:32400';
      plexWebUrl = `${plexUrl}/web/index.html#!/media/${targetKey}`;
    }
    
    // Open in new tab
    window.open(plexWebUrl, '_blank');
  };

  return (
    <motion.div 
      className="min-h-screen bg-background"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      
      <motion.div 
        className="pb-8 px-4 md:px-8 max-w-[1600px] mx-auto"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Welcome to {settings?.site_title || "Homelab Dashboard"}</h1>
          <p className="text-muted-foreground">System overview and quick access to all services</p>
        </div>

        <motion.div 
          className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {/* Plex Overview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Card className="relative overflow-hidden flex flex-col hover:shadow-lg transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-orange-500/10 to-transparent rounded-bl-full" />
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-lg">
                    <Play className="h-5 w-5 text-orange-500" />
                  </div>
                  <div>
                    <CardTitle>Plex Media Server</CardTitle>
                    <CardDescription>Streaming & Entertainment</CardDescription>
                  </div>
                </div>
                {plexActivity ? (
                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                    <Wifi className="h-3 w-3 mr-1" />
                    Online
                  </Badge>
                ) : (
                  <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
                    <WifiOff className="h-3 w-3 mr-1" />
                    Connecting
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="flex-1 space-y-4">
                {plexActivity ? (
                  <>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{plexActivity?.stream_count || 0}</div>
                        <div className="text-xs text-muted-foreground">Active Streams</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold">
                          {libraries.find((lib: any) => lib.section_type === 'movie')?.count || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Movies</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold">
                          {libraries.find((lib: any) => lib.section_type === 'show')?.count || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">TV Shows</div>
                      </div>
                    </div>
                    {/* Recently Added Carousel */}
                    {recentlyAddedItems && recentlyAddedItems.length > 0 && (
                      <div className="pt-4 flex-1 flex flex-col">
                        <div className="relative overflow-hidden flex-1 min-h-[120px]">
                          <div 
                            className="flex gap-4 h-full"
                            ref={(el) => {
                              if (el && recentlyAddedItems?.length > 0) {
                                // Clear any existing animation
                                el.style.animation = 'none';
                                
                                // Calculate dimensions
                                const itemWidth = 96; // 80px width + 16px gap
                                const baseItems = Math.min(recentlyAddedItems.length, 20);
                                const totalItems = baseItems * 6; // 6 repetitions
                                const totalWidth = totalItems * itemWidth;
                                const oneLoopWidth = baseItems * itemWidth;
                                
                                // Create smooth continuous scroll animation
                                let scrollPosition = 0;
                                const scrollSpeed = 0.15; // pixels per frame (much slower)
                                
                                const animate = () => {
                                  scrollPosition += scrollSpeed;
                                  
                                  // Reset at one full loop (1/6 of total width) to create seamless loop
                                  if (scrollPosition >= oneLoopWidth) {
                                    scrollPosition = 0;
                                  }
                                  
                                  el.style.transform = `translateX(-${scrollPosition}px)`;
                                  requestAnimationFrame(animate);
                                };
                                
                                animate();
                              }
                            }}
                          >
                            {/* Create 6 copies for seamless looping */}
                            {(() => {
                              const baseItems = recentlyAddedItems.slice(0, Math.min(recentlyAddedItems.length, 20));
                              const repeatedItems = [];
                              for (let rep = 0; rep < 6; rep++) {
                                baseItems.forEach(item => repeatedItems.push(item));
                              }
                              return repeatedItems;
                            })().map((item: any, i: number) => (
                              <div key={`${item.rating_key}-${i}`} className="flex-shrink-0 w-20 h-28 relative group cursor-pointer" onClick={() => openInPlex(item)}>
                                {getThumbnailUrl(item, 160, 224) ? (
                                  <img
                                    src={getThumbnailUrl(item, 160, 224)!}
                                    alt={item.title}
                                    className="w-full h-full object-cover rounded shadow-sm group-hover:scale-105 transition-transform duration-200"
                                    loading="lazy"
                                    onError={(e) => {
                                      (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQiIGhlaWdodD0iOTYiIHZpZXdCb3g9IjAgMCA2NCA5NiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9Ijk2IiBmaWxsPSIjMzczNzM3Ii8+CjxwYXRoIGQ9Ik0zMiA0OEwzMiA0OCIgc3Ryb2tlPSIjNzM3Mzc0IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K';
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full bg-muted rounded flex items-center justify-center">
                                    {item.media_type === 'movie' ? (
                                      <Film className="h-6 w-6 text-muted-foreground" />
                                    ) : (
                                      <Tv className="h-6 w-6 text-muted-foreground" />
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        <h4 className="text-sm font-medium text-center text-muted-foreground mt-3">Recently Added</h4>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Unable to connect to Plex server</p>
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="mt-4" style={{ paddingBottom: '16px' }}>
                  <div className="grid grid-cols-2 gap-6">
                    <Dialog open={showPlexDialog} onOpenChange={setShowPlexDialog}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full">
                          <UserPlus className="h-4 w-4 mr-2" />
                          Join Plex
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Join Plex Server</DialogTitle>
                          <DialogDescription>
                            Enter your email address to receive an invitation to join the Plex server.
                          </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                              id="email"
                              type="email"
                              {...form.register("email")}
                              placeholder="your@email.com"
                            />
                            {form.formState.errors.email && (
                              <p className="text-sm text-destructive">
                                {form.formState.errors.email.message}
                              </p>
                            )}
                          </div>
                          <DialogFooter>
                            <Button
                              type="submit"
                              disabled={createPlexAccountMutation.isPending}
                            >
                              {createPlexAccountMutation.isPending ? "Sending..." : "Send Invitation"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </DialogContent>
                    </Dialog>
                    
                    <Button variant="outline" size="sm" className="w-full" onClick={() => window.open('https://overseerr.stylus.services/login', '_blank')}>
                      <Search className="h-4 w-4 mr-2" />
                      Request Content
                    </Button>
                  </div>
                  
                  <div style={{ paddingTop: '16px' }}>
                    <Link href="/plex">
                      <Button className="w-full" variant="outline">
                        View Plex Dashboard
                        <ChevronRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  </div>
                </div>
            </CardContent>
          </Card>
          </motion.div>

          {/* Game Servers Overview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Card className="relative overflow-hidden flex flex-col hover:shadow-lg transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-500/10 to-transparent rounded-bl-full" />
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-lg">
                    <Gamepad2 className="h-5 w-5 text-purple-500" />
                  </div>
                  <div>
                    <CardTitle>Game Servers</CardTitle>
                    <CardDescription>AMP Management</CardDescription>
                  </div>
                </div>
                <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">
                  {runningServers.length} Active
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{runningServers.length}</div>
                    <div className="text-xs text-muted-foreground">Running</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{totalPlayers}</div>
                    <div className="text-xs text-muted-foreground">Players</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{gameServers?.length || 0}</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                </div>
                
                {runningServers.length > 0 && (
                  <div className="space-y-2 flex-1">
                    <p className="text-xs text-muted-foreground">Active Servers</p>
                    <div className="space-y-2 min-h-[180px]">
                    {runningServers.slice(0, 3).map((server: any) => (
                      <div key={server.instanceId} className="bg-accent/10 rounded-lg p-3 border border-border/50">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center justify-center bg-white rounded p-1 shadow-sm">
                            <img
                              src={getGameArtwork(server.type || 'GenericModule').logo}
                              alt={`${server.type || 'Game'} logo`}
                              className="w-12 h-8 object-contain"
                              onError={(e) => {
                                // Fallback to text badge - using safe DOM manipulation instead of innerHTML
                                const parent = (e.target as HTMLImageElement).parentElement;
                                if (parent) {
                                  const gameType = server.type || 'Game';
                                  // Create element safely without innerHTML
                                  const fallbackDiv = document.createElement('div');
                                  fallbackDiv.className = 'w-12 h-8 flex items-center justify-center text-gray-700 font-bold text-xs rounded bg-gray-200';
                                  // Use textContent to safely set text (prevents XSS)
                                  fallbackDiv.textContent = gameType.substring(0, 3).toUpperCase();
                                  // Clear parent and append safe element
                                  parent.innerHTML = '';
                                  parent.appendChild(fallbackDiv);
                                }
                              }}
                            />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-foreground">
                              {server.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {server.status ? 'Running' : 'Offline'}
                            </div>
                          </div>
                          <div className="flex items-center justify-center w-12 h-6 bg-background rounded text-xs font-bold border">
                            {server.playerCount || 0}/{server.maxPlayers || 4}
                          </div>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="space-y-2 mt-4">
                  <Link href="/game-servers">
                    <Button className="w-full" variant="outline">
                      Manage Game Servers
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
            </CardContent>
          </Card>
          </motion.div>

          {/* Live TV Overview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <Card className="relative overflow-hidden hover:shadow-lg transition-shadow duration-300">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-500/10 to-transparent rounded-bl-full" />
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg">
                    <Tv className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle>Live TV</CardTitle>
                    <CardDescription>IPTV Streaming</CardDescription>
                  </div>
                </div>
                <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">
                  {liveTVChannels?.length || 0} Channels
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="flex-1 space-y-4">
                {liveTVChannels && liveTVChannels.length > 0 ? (
                  <>
                    {/* Favorite Channels - Show up to 3 */}
                    {favoriteChannels.length > 0 && (
                      <div className="space-y-2 flex-1">
                        <p className="text-xs text-muted-foreground">Favorites</p>
                        <div className="space-y-2 min-h-[180px]">
                          {[0, 1, 2].map((index) => {
                            const fav = favoriteChannels[index];
                            if (!fav) return null;
                            return (
                              <FavoriteChannelItem
                                key={fav.id}
                                favorite={fav}
                                program={favoriteProgramsData[fav.channelId]}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4 text-muted-foreground">
                    <Tv className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No channels available</p>
                    <p className="text-xs mt-1">Check IPTV connection</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 mt-4">
                  <Link href="/live-tv">
                    <Button className="w-full" variant="outline">
                      Watch Live TV
                      <ChevronRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </div>
            </CardContent>
          </Card>
          </motion.div>
        </motion.div>

      </motion.div>
    </motion.div>
  );
}