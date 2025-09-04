import { useQuery } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, Tv, Film, Server, Activity, Plus, History } from "lucide-react";
import { motion } from "framer-motion";

export default function PlexPage() {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

  // Fetch current activity (active streams)
  const { data: activity } = useQuery({
    queryKey: ['/api/tautulli/activity'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/activity');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 30000,
  });

  // Fetch libraries for stats
  const { data: libraries } = useQuery({
    queryKey: ['/api/tautulli/libraries'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/libraries');
      if (!response.ok) return [];
      return response.json();
    },
  });

  // Fetch recently added content
  const { data: recentlyAdded } = useQuery({
    queryKey: ['/api/tautulli/recently-added'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/recently-added?count=10');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Fetch recently watched content (from history)
  const { data: recentlyWatched } = useQuery({
    queryKey: ['/api/tautulli/history'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/history?length=10');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Fetch server info
  const { data: serverInfo } = useQuery({
    queryKey: ['/api/tautulli/server-info'],
    queryFn: async () => {
      const response = await fetch('/api/tautulli/server-info');
      if (!response.ok) return null;
      return response.json();
    },
    refetchInterval: 60000,
  });

  // Helper function to get thumbnail URL
  const getThumbnailUrl = (item: any, width = 100, height = 150) => {
    const thumb = item.grandparent_thumb || item.parent_thumb || item.thumb;
    if (thumb) {
      return `/api/tautulli/proxy-image?img=${encodeURIComponent(thumb)}&width=${width}&height=${height}`;
    }
    return undefined;
  };

  // Helper function to get high-res background artwork
  const getBackgroundUrl = (item: any) => {
    const art = item.art || item.grandparent_art || item.parent_art;
    if (art) {
      return `/api/tautulli/proxy-image?img=${encodeURIComponent(art)}&width=800&height=450`;
    }
    return undefined;
  };

  // Helper function to format duration
  const formatDuration = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  // Helper function to get progress percentage
  const getProgressPercentage = (viewOffset: number, duration: number) => {
    if (!duration || duration === 0) return 0;
    return Math.min(Math.max((viewOffset / duration) * 100, 0), 100);
  };

  // Format date/time
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} min ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hours ago`;
    } else {
      const month = date.toLocaleString('default', { month: 'short' });
      const day = date.getDate();
      const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${month} ${day} at ${time}`;
    }
  };

  // Function to open item in Plex
  const openInPlex = (item: any) => {
    // For episodes, use the grandparent (series) rating key to open the series page
    // For movies, use the direct rating key
    let targetKey = item.rating_key;
    
    if (item.media_type === 'episode' && item.grandparent_rating_key) {
      targetKey = item.grandparent_rating_key;
    }
    
    // Get server machine identifier from server info
    const machineId = serverInfo?.data?.pms_identifier;
    
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

  // Calculate stats
  const activeStreams = activity?.sessions?.length || 0;
  const tvShowCount = libraries?.find((lib: any) => lib.section_type === 'show')?.count || 0;
  const movieCount = libraries?.find((lib: any) => lib.section_type === 'movie')?.count || 0;
  const serverStatus = serverInfo?.data ? 'Online' : 'Offline';

  const recentlyAddedItems = recentlyAdded?.recently_added || [];
  const historyItems = recentlyWatched?.data || [];

  return (
    <motion.div 
      className="min-h-screen bg-background"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      <motion.div 
        className="container mx-auto px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="max-w-7xl mx-auto">
          {/* Stats Cards */}
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {/* Active Streams */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Active Streams
                  </CardTitle>
                  <Activity className="h-4 w-4 text-blue-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{activeStreams}</div>
                <p className="text-xs text-muted-foreground mt-1">Currently streaming</p>
              </CardContent>
            </Card>
            </motion.div>

            {/* TV Shows */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    TV Shows
                  </CardTitle>
                  <Tv className="h-4 w-4 text-blue-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{tvShowCount}</div>
                <p className="text-xs text-muted-foreground mt-1">Series available</p>
              </CardContent>
            </Card>
            </motion.div>

            {/* Movies */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Movies
                  </CardTitle>
                  <Film className="h-4 w-4 text-blue-500" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{movieCount}</div>
                <p className="text-xs text-muted-foreground mt-1">Films available</p>
              </CardContent>
            </Card>
            </motion.div>

            {/* Server Status */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Server Status
                    </CardTitle>
                    <Server className="h-4 w-4 text-blue-500" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-500">{serverStatus}</div>
                  <p className="text-xs text-muted-foreground mt-1">Connection status</p>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Main Content Grid */}
          <motion.div 
            className="grid grid-cols-1 lg:grid-cols-3 gap-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {/* Active Sessions */}
            <motion.div 
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300 h-[500px] flex flex-col">
                <CardHeader className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Play className="h-5 w-5 text-blue-500" />
                    <CardTitle>Active Sessions</CardTitle>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Current streams from your Plex server
                  </p>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-3">
                  {activity?.sessions && activity.sessions.length > 0 ? (
                    <div className="space-y-4">
                      {activity.sessions.map((session: any, index: number) => {
                        const backgroundUrl = getBackgroundUrl(session);
                        const thumbnailUrl = getThumbnailUrl(session, 80, 120);
                        const progressPercent = getProgressPercentage(session.view_offset, session.duration);
                        const remainingTime = session.duration ? formatDuration(session.duration - session.view_offset) : '';
                        
                        return (
                          <motion.div
                            key={index}
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.3, delay: index * 0.1 }}
                            className="relative overflow-hidden rounded-2xl group"
                            style={{
                              background: backgroundUrl 
                                ? `url(${backgroundUrl})` 
                                : 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)',
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 8px 32px -8px rgba(0, 0, 0, 0.15)',
                              height: '140px'
                            }}
                          >
                            {/* Glass overlay */}
                            <div className="absolute inset-0"
                              style={{
                                background: 'rgba(255, 255, 255, 0.1)',
                                backdropFilter: 'saturate(180%) blur(10px)',
                                WebkitBackdropFilter: 'saturate(180%) blur(10px)',
                                borderRadius: '16px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                              }}
                            />
                            
                            {/* Dark gradient overlay for better text readability */}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent rounded-2xl" />
                            
                            {/* Content */}
                            <div className="relative h-full p-4 flex flex-col justify-between">
                              {/* Top section - Status and quality info */}
                              <div className="flex justify-between items-start">
                                <div className="flex items-center gap-2 text-white/70 text-xs">
                                  <span>{session.user}</span>
                                  <span>•</span>
                                  <span>{session.player}</span>
                                  {session.quality && (
                                    <>
                                      <span>•</span>
                                      <span>{session.quality}</span>
                                    </>
                                  )}
                                </div>
                                
                                {/* Status indicator */}
                                <div className={`
                                  px-2 py-1 rounded-full text-xs font-medium backdrop-blur-sm
                                  ${session.state === 'playing' 
                                    ? 'bg-green-500/20 text-green-100 border border-green-400/30' 
                                    : 'bg-yellow-500/20 text-yellow-100 border border-yellow-400/30'
                                  }
                                `}>
                                  <div className="flex items-center gap-1">
                                    {session.state === 'playing' ? (
                                      <>
                                        <Play className="w-3 h-3" />
                                        Playing
                                      </>
                                    ) : (
                                      <>
                                        <Pause className="w-3 h-3" />
                                        Paused
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Bottom section - Main content */}
                              <div className="flex items-end gap-3 w-full">
                                {/* Thumbnail */}
                                <div className="flex-shrink-0">
                                  {thumbnailUrl ? (
                                    <img 
                                      src={thumbnailUrl} 
                                      alt={session.title}
                                      className="w-12 h-18 rounded-lg object-cover shadow-lg"
                                      style={{
                                        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.3)'
                                      }}
                                    />
                                  ) : (
                                    <div className="w-12 h-18 bg-black/30 rounded-lg flex items-center justify-center backdrop-blur-sm">
                                      {session.media_type === 'movie' ? (
                                        <Film className="h-5 w-5 text-white/80" />
                                      ) : (
                                        <Tv className="h-5 w-5 text-white/80" />
                                      )}
                                    </div>
                                  )}
                                </div>
                                
                                {/* Content Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="space-y-1">
                                    {/* Title */}
                                    <h3 className="font-semibold text-white text-sm truncate leading-tight">
                                      {session.grandparent_title || session.title}
                                    </h3>
                                    
                                    {/* Subtitle/Episode */}
                                    {session.parent_title && (
                                      <p className="text-white/90 text-xs truncate">
                                        {session.parent_title}
                                      </p>
                                    )}
                                    
                                    
                                    {/* Progress bar */}
                                    {session.duration && (
                                      <div className="mt-2">
                                        <div className="w-full bg-white/20 rounded-full h-1 mb-1">
                                          <div 
                                            className="bg-white rounded-full h-1 transition-all duration-300"
                                            style={{ width: `${progressPercent}%` }}
                                          />
                                        </div>
                                        <div className="flex justify-between text-white/60 text-xs">
                                          <span>{formatDuration(session.view_offset)}</span>
                                          <span>{remainingTime} left</span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/50 mb-4">
                        <Play className="h-6 w-6" />
                      </div>
                      <p>No active streams.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Recently Added - Second Column */}
            <motion.div 
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300 h-[500px] flex flex-col">
                <CardHeader className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-blue-500" />
                    <CardTitle>Recently Added</CardTitle>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Latest content added to your Plex server
                  </p>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  {recentlyAddedItems.length > 0 ? (
                    <div className="space-y-3">
                      {recentlyAddedItems.slice(0, 5).map((item: any, index: number) => (
                        <div key={index} className="flex items-start gap-3 cursor-pointer hover:bg-accent/50 rounded-lg p-2 -m-2 transition-colors" onClick={() => openInPlex(item)}>
                          {getThumbnailUrl(item) ? (
                            <img 
                              src={getThumbnailUrl(item, 60, 90)} 
                              alt={item.title}
                              className="w-10 h-14 rounded object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
                              {item.media_type === 'movie' ? (
                                <Film className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Tv className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.grandparent_title || item.title}
                            </p>
                            {item.parent_title && (
                              <p className="text-xs text-muted-foreground truncate">
                                {item.parent_title}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {formatDate(item.added_at)}
                            </p>
                            <Badge variant="outline" className="mt-1 text-xs">
                              {item.media_type === 'movie' ? 'Movie' : 'TV Show'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No recently added content.
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Recently Watched - Third Column */}
            <motion.div 
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.7 }}
            >
              <Card className="bg-card border hover:shadow-lg transition-shadow duration-300 h-[500px] flex flex-col">
                <CardHeader className="flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-blue-500" />
                    <CardTitle>Recently Watched</CardTitle>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Latest content watched on your Plex server
                  </p>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto">
                  {historyItems.length > 0 ? (
                    <div className="space-y-3">
                      {historyItems.slice(0, 5).map((item: any, index: number) => (
                        <div key={index} className="flex items-start gap-3 cursor-pointer hover:bg-accent/50 rounded-lg p-2 -m-2 transition-colors" onClick={() => openInPlex(item)}>
                          {getThumbnailUrl(item) ? (
                            <img 
                              src={getThumbnailUrl(item, 60, 90)} 
                              alt={item.title}
                              className="w-10 h-14 rounded object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
                              {item.media_type === 'movie' ? (
                                <Film className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <Tv className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.grandparent_title || item.title}
                            </p>
                            {item.parent_title && (
                              <p className="text-xs text-muted-foreground truncate">
                                {item.parent_title}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {item.user} • {formatDate(item.stopped)}
                            </p>
                            <Badge variant="outline" className="mt-1 text-xs">
                              {item.media_type === 'movie' ? 'Movie' : 'TV Show'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No recent activity.
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}