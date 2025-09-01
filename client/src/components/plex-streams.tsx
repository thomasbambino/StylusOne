import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";
import { User, Film, Tv, Pause, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { PLEX_QUERY_KEY } from "../lib/plexCache";

export interface PlexStream {
  user: string;
  title: string;
  type: string;
  device: string;
  progress: number;
  duration: number;
  quality: string;
  state: string;
  thumb?: string; // Optional thumbnail URL for the media
}

export interface PlexLibrarySection {
  title: string;
  type: string;
  count: number;
}

export interface PlexServerInfo {
  status: boolean;
  version?: string;
  streams: PlexStream[];
  libraries?: PlexLibrarySection[];
  activeStreamCount: number;
  uptime?: string;
  error?: string; // Add error field for better diagnostics
}

export function PlexStreams() {
  const [refreshInterval, setRefreshInterval] = useState(15000); // 15 seconds - more frequent updates
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [localStreams, setLocalStreams] = useState<PlexStream[]>([]);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);

  const {
    data: plexInfo,
    isLoading,
    error,
    refetch,
  } = useQuery<PlexServerInfo>({
    queryKey: [PLEX_QUERY_KEY],
    refetchInterval: autoRefresh ? refreshInterval : false,
    staleTime: 10000, // 10 seconds before data is considered stale
    refetchOnMount: true, // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window gets focus
  });

  // Update local streams whenever the server data changes
  useEffect(() => {
    if (plexInfo?.streams && plexInfo.streams.length > 0) {
      setLocalStreams(plexInfo.streams);
      setLastUpdateTime(Date.now());
    }
  }, [plexInfo]);

  // Continuously update progress for active streams
  useEffect(() => {
    if (!localStreams.length || !lastUpdateTime) return;

    const progressInterval = setInterval(() => {
      setLocalStreams(prevStreams => 
        prevStreams.map(stream => {
          // Only update progress for playing streams
          if (stream.state === 'playing') {
            const elapsedMs = Date.now() - lastUpdateTime;
            const elapsedSec = elapsedMs / 1000;
            
            // Calculate how much progress to add
            // 1000ms duration = 100% progress
            const progressIncrement = (elapsedSec / (stream.duration / 1000)) * 100;
            
            // Cap at 100% and ensure we don't go backwards
            return {
              ...stream,
              progress: Math.min(100, stream.progress + progressIncrement)
            };
          }
          return stream;
        })
      );
      
      // Update the last time we calculated
      setLastUpdateTime(Date.now());
    }, 1000); // Update every second
    
    return () => clearInterval(progressInterval);
  }, [localStreams, lastUpdateTime]);

  // Auto refresh handling
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      refetch();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, refetch]);

  if (isLoading) {
    return <PlexStreamsSkeleton />;
  }

  if (error || !plexInfo) {
    return (
      <div className="p-4 border rounded-md bg-muted/30">
        <div className="text-destructive">
          Failed to load Plex server information
        </div>
      </div>
    );
  }

  if (!plexInfo.status) {
    return (
      <div className="p-4 border rounded-md bg-muted/30">
        <div className="text-amber-500 font-medium">Plex server is offline</div>
        {plexInfo.error && (
          <div className="text-xs text-muted-foreground mt-2">
            <span className="font-medium">Error details:</span> {plexInfo.error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          <span className="text-primary">
            {plexInfo.activeStreamCount} active {plexInfo.activeStreamCount === 1 ? "stream" : "streams"}
          </span>
        </div>
      </div>

      {localStreams.length === 0 ? (
        <div className="p-4 text-center text-muted-foreground text-sm border rounded-md bg-muted/20">
          No active streams
        </div>
      ) : (
        <div className="space-y-3">
          {localStreams.map((stream, index) => (
            <div
              key={index}
              className="p-3 border rounded-md bg-card"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center">
                  {stream.thumb ? (
                    <div className="h-10 w-16 rounded overflow-hidden mr-2 bg-muted flex-shrink-0">
                      <img 
                        src={stream.thumb} 
                        alt="Media thumbnail"
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          // Fallback to user icon if image fails to load
                          const target = e.target as HTMLImageElement;
                          target.onerror = null;
                          target.style.display = 'none';
                          target.parentElement!.innerHTML = '<div class="h-full w-full flex items-center justify-center"><svg class="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="h-10 w-16 rounded bg-muted flex items-center justify-center mr-2 flex-shrink-0">
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-medium">{stream.user}</div>
                    <div className="text-xs text-muted-foreground">
                      {stream.device} • {stream.quality}
                    </div>
                  </div>
                </div>
                <div className="flex items-center">
                  {stream.type === "movie" ? (
                    <Film className="h-4 w-4 text-muted-foreground mr-1" />
                  ) : (
                    <Tv className="h-4 w-4 text-muted-foreground mr-1" />
                  )}
                  {stream.state === "paused" ? (
                    <Pause className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Play className="h-4 w-4 text-green-500" />
                  )}
                </div>
              </div>
              <div className="mb-1 text-sm">{stream.title}</div>
              <div className="relative pt-1">
                <Progress value={stream.progress} className="h-1.5" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <div>
                    {formatTime(
                      Math.floor((stream.duration / 1000) * (stream.progress / 100))
                    )}
                  </div>
                  <div>{formatTime(Math.floor(stream.duration / 1000))}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

{/* Libraries section removed as requested */}
    </div>
  );
}

function PlexStreamsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="p-3 border rounded-md">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center">
                <Skeleton className="h-10 w-16 rounded mr-2" />
                <div>
                  <Skeleton className="h-4 w-24 mb-1" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-5 w-10" />
            </div>
            <Skeleton className="h-4 w-full max-w-[200px] mb-2" />
            <Skeleton className="h-1.5 w-full mb-1" />
            <div className="flex justify-between">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}