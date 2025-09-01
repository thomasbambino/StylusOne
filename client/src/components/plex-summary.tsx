import { useQuery } from "@tanstack/react-query";
import { Film, Tv, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PlexServerInfo } from "./plex-streams";
import { PLEX_QUERY_KEY } from "../lib/plexCache";

export function PlexSummary() {
  const {
    data: plexInfo,
    isLoading,
    error,
  } = useQuery<PlexServerInfo>({
    queryKey: [PLEX_QUERY_KEY],
    staleTime: 10000, // 10 seconds before data is considered stale
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  if (isLoading) {
    return <PlexSummarySkeleton />;
  }

  if (error || !plexInfo) {
    return (
      <div className="text-destructive text-sm">
        Failed to load Plex info
      </div>
    );
  }

  if (!plexInfo.status) {
    return (
      <div className="text-amber-500 text-sm">
        Plex server is offline
        {plexInfo.error && (
          <span className="block text-xs text-muted-foreground mt-1">
            Reason: {plexInfo.error}
          </span>
        )}
      </div>
    );
  }

  // Get movie and show counts
  const movieLibrary = plexInfo.libraries?.find(lib => lib.type === "movie");
  const showLibrary = plexInfo.libraries?.find(lib => lib.type === "show");
  const movieCount = movieLibrary?.count || 0;
  const showCount = showLibrary?.count || 0;

  return (
    <div className="flex justify-between items-center w-full">
      <div className="flex space-x-4">
        <div className="flex items-center">
          <User className="h-4 w-4 mr-1 text-primary" />
          <span className="text-sm font-medium">
            {plexInfo.activeStreamCount} {plexInfo.activeStreamCount === 1 ? "stream" : "streams"}
          </span>
        </div>
        
        <div className="flex items-center">
          <Film className="h-4 w-4 mr-1 text-primary" />
          <span className="text-sm font-medium">
            {movieCount.toLocaleString()} movies
          </span>
        </div>
        
        <div className="flex items-center">
          <Tv className="h-4 w-4 mr-1 text-primary" />
          <span className="text-sm font-medium">
            {showCount.toLocaleString()} shows
          </span>
        </div>
      </div>
    </div>
  );
}

function PlexSummarySkeleton() {
  return (
    <div className="flex justify-between items-center w-full">
      <div className="flex space-x-4">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-24" />
      </div>
    </div>
  );
}