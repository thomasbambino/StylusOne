import { useQuery } from "@tanstack/react-query";
import { GameServer } from "@shared/schema";
import { GameServerCard } from "./game-server-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";

interface GameServerListProps {
  className?: string;
}

export function GameServerList({ className }: GameServerListProps) {
  const { data: servers, error, isLoading } = useQuery<GameServer[]>({
    queryKey: ["/api/game-servers"],
    refetchInterval: 10000, // Refetch every 10 seconds
    staleTime: 5000, // Consider data fresh for 5 seconds
    retry: 3, // Retry failed requests up to 3 times
  });

  // Track which servers are visible (for intersection observer)
  const [visibleServers, setVisibleServers] = useState<Set<string>>(new Set());
  // Track whether to show offline servers
  const [showOfflineServers, setShowOfflineServers] = useState(false);
  const observerMap = useRef(new Map<string, IntersectionObserver>());

  // Create groups: Online servers and offline servers (both grouped by type)
  const { onlineServers, offlineServersByType } = useMemo(() => {
    if (!servers) return { onlineServers: [], offlineServersByType: {} };
    
    // Group servers by type
    const serversByType = servers.reduce((groups, server) => {
      const type = server.type || 'unknown';
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(server);
      return groups;
    }, {} as Record<string, GameServer[]>);
    
    // First, collect online servers grouped by type
    const onlineResult: GameServer[] = [];
    const offlineByType: Record<string, GameServer[]> = {};
    
    // Add online servers first, grouped by type
    Object.keys(serversByType).sort().forEach(type => {
      // Get all online servers of this type
      const onlineServersOfType = serversByType[type].filter(server => server.status);
      
      // Sort online servers of this type by name
      onlineServersOfType.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      // Add them to result
      onlineResult.push(...onlineServersOfType);
    });
    
    // Group offline servers by type
    Object.keys(serversByType).sort().forEach(type => {
      // Get all offline servers of this type
      const offlineServersOfType = serversByType[type].filter(server => !server.status);
      
      // If there are offline servers of this type, add them to the offlineByType object
      if (offlineServersOfType.length > 0) {
        // Sort offline servers of this type by name
        offlineServersOfType.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        offlineByType[type] = offlineServersOfType;
      }
    });
    
    return { onlineServers: onlineResult, offlineServersByType: offlineByType };
  }, [servers]);

  // Calculate the number of offline servers
  const offlineServerCount = useMemo(() => {
    return Object.values(offlineServersByType).reduce(
      (count, serverGroup) => count + serverGroup.length, 
      0
    );
  }, [offlineServersByType]);

  useEffect(() => {
    // Cleanup observers when component unmounts
    return () => {
      observerMap.current.forEach(observer => observer.disconnect());
      observerMap.current.clear();
    };
  }, []);

  // Create observer for a server card
  const observeServer = (instanceId: string, element: HTMLElement) => {
    if (observerMap.current.has(instanceId)) {
      observerMap.current.get(instanceId)?.disconnect();
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisibleServers(prev => new Set(prev).add(instanceId));
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    observerMap.current.set(instanceId, observer);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load game servers</AlertDescription>
      </Alert>
    );
  }

  const capitalizeGameType = (type: string) =>
    type.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

  return (
    <div className="space-y-6">
      {/* Online servers */}
      <div className="space-y-4">
        {onlineServers.length > 0 && (
          <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>
            {onlineServers.map((server) => (
              <div
                key={server.instanceId}
                ref={el => el && observeServer(server.instanceId, el)}
                className="min-h-[200px]"
              >
                {visibleServers.has(server.instanceId) && (
                  <GameServerCard server={server} />
                )}
                {!visibleServers.has(server.instanceId) && (
                  <div className="h-full w-full rounded-lg border bg-card animate-pulse" />
                )}
              </div>
            ))}
          </div>
        )}
        {onlineServers.length === 0 && !isLoading && (
          <div className="text-center py-4 bg-muted/30 rounded-lg text-muted-foreground">
            No online servers found
          </div>
        )}
      </div>

      {/* Show/Hide Offline Servers Button */}
      {offlineServerCount > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOfflineServers(!showOfflineServers)}
            className="flex items-center gap-2"
          >
            {showOfflineServers ? (
              <>
                <EyeOffIcon className="h-4 w-4" />
                <span>Hide Offline Servers ({offlineServerCount})</span>
              </>
            ) : (
              <>
                <EyeIcon className="h-4 w-4" />
                <span>Show Offline Servers ({offlineServerCount})</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Offline servers - simple list but sorted by type, with animation */}
      <div 
        className={cn(
          "transition-all duration-300 ease-in-out overflow-hidden",
          showOfflineServers ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        )}
        aria-hidden={!showOfflineServers}
      >
        <div className="mt-4">
          <h3 className="text-sm font-medium text-muted-foreground border-b pb-1 mb-3">
            Offline Servers
          </h3>
          <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>
            {/* Flatten the offline servers by type, but keep them sorted */}
            {Object.keys(offlineServersByType).sort().flatMap(type => 
              offlineServersByType[type].map(server => (
                <div
                  key={server.instanceId}
                  ref={el => el && observeServer(server.instanceId, el)}
                  className="min-h-[200px]"
                >
                  {visibleServers.has(server.instanceId) && (
                    <GameServerCard server={server} />
                  )}
                  {!visibleServers.has(server.instanceId) && (
                    <div className="h-full w-full rounded-lg border bg-card animate-pulse" />
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Loading state */}
      {!servers && isLoading && (
        <div className="flex items-center justify-center text-muted-foreground">
          <div className="animate-pulse">Loading game servers...</div>
        </div>
      )}
      
      {/* No servers state */}
      {servers?.length === 0 && (
        <div className="text-center text-muted-foreground">
          No game servers found
        </div>
      )}
    </div>
  );
}