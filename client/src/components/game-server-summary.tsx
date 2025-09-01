import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Users } from "lucide-react";
import { GameServer } from "@shared/schema";

export function GameServerSummary() {
  const {
    data: gameServers,
    isLoading,
    error
  } = useQuery<GameServer[]>({
    queryKey: ['/api/game-servers'],
    refetchInterval: 15000, // 15 seconds - same as Plex
    staleTime: 10000, // 10 seconds before data is considered stale
  });
  
  // Share the adminUIVisible state to match the Ctrl+H behavior in other components
  const [showAdminDetails, setShowAdminDetails] = useState(() => {
    // Initialize from localStorage using the shared adminUIVisible key
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('adminUIVisible');
      return saved === 'true'; // true when 'true', false otherwise
    }
    return false;
  });
  
  // Sync state with localStorage changes from other components
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'adminUIVisible') {
        const newValue = e.newValue === 'true';
        setShowAdminDetails(newValue);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  // Handle keyboard shortcut for toggling admin details
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Look for Ctrl+H (or Cmd+H on Mac)
      if (e.key === 'h' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault(); // Prevent browser's history shortcut
        
        setShowAdminDetails(prevState => {
          const newState = !prevState;
          // Save to the shared localStorage key
          localStorage.setItem('adminUIVisible', String(newState));
          return newState;
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (isLoading) {
    return <GameServerSummarySkeleton />;
  }

  if (error || !gameServers) {
    return (
      <div className="p-4 border rounded-md bg-muted/30">
        <div className="text-destructive">
          Failed to load game server information
        </div>
      </div>
    );
  }

  // Calculate stats
  const onlineServers = gameServers.filter(server => server.status).length;
  const totalServers = gameServers.length;
  const totalPlayers = gameServers.reduce((total, server) => total + (server.playerCount || 0), 0);
  const maxPlayers = gameServers.reduce((total, server) => total + (server.maxPlayers || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium">
              <span className="text-primary">{onlineServers}</span> / {totalServers} servers online
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium">
              <span className="text-primary">{totalPlayers}</span> / {maxPlayers} players
            </div>
          </div>
        </div>
        
        {/* Display servers with active players */}
        {totalPlayers > 0 && (
          <div className="space-y-2 mt-2">
            <div className="text-sm font-medium">Active Players:</div>
            <div className="space-y-2">
              {gameServers
                .filter(server => server.playerCount && server.playerCount > 0)
                .map((server) => (
                  <div 
                    key={server.id} 
                    className="p-2 border rounded-md bg-card flex items-center gap-3"
                  >
                    <div className="h-8 w-8 rounded overflow-hidden bg-muted flex-shrink-0">
                      {server.icon ? (
                        <img 
                          src={server.icon} 
                          alt={server.name} 
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.onerror = null;
                            target.style.display = 'none';
                            target.parentElement!.innerHTML = '<div class="h-full w-full flex items-center justify-center"><svg class="h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 7v10" /><path d="M11 7v10" /><path d="m15 7 2 10" /></svg></div>';
                          }}
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <Server className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{server.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {server.playerCount} / {server.maxPlayers} players
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
        
        {/* Only show "No active players" message when showAdminDetails is true */}
        {totalPlayers === 0 && showAdminDetails && (
          <div className="p-3 text-center text-muted-foreground text-sm border rounded-md bg-muted/20 mt-2">
            No active players on any server
          </div>
        )}
      </div>
    </div>
  );
}

function GameServerSummarySkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}