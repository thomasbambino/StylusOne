import { GameServer } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Users, 
  Globe, 
  Play, 
  Square, 
  RotateCw, 
  Skull,
  Wifi,
  WifiOff,
  Clock,
  Gamepad2,
  Server,
  Activity,
  ChevronRight
} from "lucide-react";
import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { getGameArtwork, getGameBanner, getGameIcon } from "@/lib/game-artwork";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GameServerCardModernProps {
  server: GameServer;
}

export function GameServerCardModern({ server }: GameServerCardModernProps) {
  const { user } = useAuth();
  const [showDetails, setShowDetails] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Poll for status updates when transitioning
  useEffect(() => {
    if (!isTransitioning) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
    }, 1000); // Poll every 1 second during transitions (more frequent)

    // Stop polling after 45 seconds (longer timeout)
    const timeout = setTimeout(() => {
      console.log('Stopping transition polling due to timeout');
      setIsTransitioning(false);
    }, 45000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isTransitioning, queryClient]);

  // Store previous status to detect changes
  const [previousStatus, setPreviousStatus] = useState(server.status);
  
  // Stop transitioning when server status actually changes
  useEffect(() => {
    if (server.status !== previousStatus) {
      console.log('Server status changed from', previousStatus, 'to', server.status);
      setPreviousStatus(server.status);
      
      if (isTransitioning) {
        // Give a small delay to ensure the status is stable
        const timeout = setTimeout(() => {
          console.log('Stopping transition due to status change');
          setIsTransitioning(false);
        }, 1500);
        
        return () => clearTimeout(timeout);
      }
    }
  }, [server.status, previousStatus, isTransitioning]);

  // Get game artwork
  const gameArtwork = getGameArtwork(server.type || 'Unknown');
  const gameBanner = getGameBanner(server.type || 'Unknown');
  const gameIcon = getGameIcon(server.type || 'Unknown');

  // Server control mutations
  const startMutation = useMutation({
    mutationFn: async () => {
      console.log('startMutation.mutationFn called for server:', server.instanceId);
      try {
        console.log('Making fetch request to:', `/api/game-servers/${server.instanceId}/start`);
        const res = await fetch(`/api/game-servers/${server.instanceId}/start`, {
          method: "POST",
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        console.log('Fetch response status:', res.status, res.statusText);
        if (!res.ok) {
          const error = await res.text();
          console.error('Response error text:', error);
          throw new Error(`Failed to start server: ${error}`);
        }
        const result = await res.json();
        console.log('Start server success result:', result);
        return result;
      } catch (error) {
        console.error('Fetch error in mutationFn:', error);
        throw error;
      }
    },
    onMutate: () => {
      console.log('startMutation.onMutate called');
      setIsTransitioning(true);
    },
    onSuccess: (data) => {
      console.log('startMutation.onSuccess called with data:', data);
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      
      // Immediately start aggressive polling
      const pollInterval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      }, 500); // Poll every 500ms immediately after success
      
      // Stop aggressive polling after 10 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 10000);
    },
    onError: (error) => {
      console.error('startMutation.onError called with error:', error);
      alert(`Failed to start server: ${error.message}`);
      setIsTransitioning(false);
    },
    onSettled: () => {
      console.log('startMutation.onSettled called');
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/game-servers/${server.instanceId}/stop`, {
        method: "POST",
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to stop server: ${error}`);
      }
      return res.json();
    },
    onMutate: () => {
      setIsTransitioning(true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      
      // Immediately start aggressive polling
      const pollInterval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      }, 500); // Poll every 500ms immediately after success
      
      // Stop aggressive polling after 10 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 10000);
    },
    onError: (error) => {
      console.error('Stop server error:', error);
      alert(`Failed to stop server: ${error.message}`);
      setIsTransitioning(false);
    },
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/game-servers/${server.instanceId}/restart`, {
        method: "POST",
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to restart server: ${error}`);
      }
      return res.json();
    },
    onMutate: () => {
      setIsTransitioning(true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      // Keep transitioning state active for polling
    },
    onError: (error) => {
      console.error('Restart server error:', error);
      setIsTransitioning(false);
    },
  });

  const killMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/game-servers/${server.instanceId}/kill`, {
        method: "POST",
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to kill server: ${error}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
    },
    onError: (error) => {
      console.error('Kill server error:', error);
    },
  });

  const isLoading = startMutation.isPending || stopMutation.isPending || 
                    restartMutation.isPending || killMutation.isPending || isTransitioning;

  // Calculate player percentage
  const playerPercentage = server.maxPlayers > 0 
    ? (server.playerCount / server.maxPlayers) * 100 
    : 0;

  // Get status color
  const getStatusColor = () => {
    if (!server.status) return "bg-gray-500";
    if (server.playerCount > 0) return "bg-green-500";
    return "bg-blue-500";
  };

  // Get player color based on capacity
  const getPlayerColor = () => {
    if (playerPercentage >= 90) return "text-red-500";
    if (playerPercentage >= 70) return "text-orange-500";
    if (playerPercentage >= 50) return "text-yellow-500";
    return "text-green-500";
  };

  return (
    <>
      <TooltipProvider>
        <motion.div
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeInOut" }}
        >
          <Card className={cn(
            "group relative overflow-hidden transition-all duration-300",
            server.status ? "h-56" : "h-32",
            "hover:shadow-xl hover:shadow-primary/10",
            "border-border/50 backdrop-blur-sm flex flex-col",
          !server.status && "opacity-75"
        )}>
          {/* Game artwork background */}
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-25 group-hover:opacity-35 transition-opacity duration-500 dark:opacity-20 dark:group-hover:opacity-30"
            style={{
              backgroundImage: `url(${gameBanner})`,
              filter: 'blur(1px)'
            }}
          />
          
          {/* Overlay for better text readability - lighter in light mode for more background visibility */}
          <div className="absolute inset-0 bg-gradient-to-br from-background/85 via-background/75 to-background/65 dark:from-background/90 dark:via-background/80 dark:to-background/60" />

          {/* Status indicator bar */}
          <div 
            className={cn(
              "absolute top-0 left-0 right-0 h-1",
              getStatusColor(),
              server.status && "animate-pulse"
            )} 
            style={{ backgroundColor: gameArtwork.color }}
          />

          {/* Background gradient effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="relative p-3 flex flex-col flex-1">
            {/* Header */}
            <div className={cn("flex items-start justify-between", server.status ? "mb-2" : "mb-0")}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-lg truncate">
                    {server.name}
                  </h3>
                  {isTransitioning ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <RotateCw className="h-4 w-4 text-yellow-500 animate-spin" />
                      </TooltipTrigger>
                      <TooltipContent>Transitioning...</TooltipContent>
                    </Tooltip>
                  ) : server.status ? (
                    <Tooltip>
                      <TooltipTrigger>
                        <Wifi className="h-4 w-4 text-green-500" />
                      </TooltipTrigger>
                      <TooltipContent>Online</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger>
                        <WifiOff className="h-4 w-4 text-gray-500" />
                      </TooltipTrigger>
                      <TooltipContent>Offline</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="secondary" 
                    className="text-xs"
                    style={{ 
                      backgroundColor: `${gameArtwork.color}20`,
                      borderColor: `${gameArtwork.color}40`,
                      color: gameArtwork.color
                    }}
                  >
                    <img 
                      src={gameIcon} 
                      alt={server.type} 
                      className="h-4 w-4 mr-1 rounded-sm"
                      onError={(e) => {
                        // Fallback to gamepad icon if image fails to load
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const gamepadIcon = target.nextElementSibling as HTMLElement;
                        if (gamepadIcon) gamepadIcon.style.display = 'inline';
                      }}
                    />
                    <Gamepad2 className="h-4 w-4 mr-1" style={{ display: 'none' }} />
                    {server.type || "Unknown"}
                  </Badge>
                  {server.version && (
                    <Badge variant="outline" className="text-xs">
                      {server.version}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Game Logo and Actions */}
              <div className="flex items-center gap-2">
                {/* Game Logo */}
                <div className="opacity-70 group-hover:opacity-90 transition-opacity">
                  <img 
                    src={gameArtwork.logo} 
                    alt={`${server.type} logo`}
                    className="h-12 w-auto max-w-36 object-contain"
                    onError={(e) => {
                      // Hide logo if it fails to load
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>

              </div>
            </div>

            {/* Server Info Grid */}
            {server.status && (
            <div className="space-y-2">
              {/* Players Section */}
              {server.status && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Players
                    </span>
                    <span className={cn("font-medium", getPlayerColor())}>
                      {server.playerCount || 0} / {server.maxPlayers || 0}
                    </span>
                  </div>
                  <Progress 
                    value={playerPercentage} 
                    className="h-1.5"
                  />
                </div>
              )}

              {/* Connection Info */}
              {server.status && (
                <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    <code className="font-mono text-xs">
                      game.stylus.services:{(server as any).port || "25565"}
                    </code>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`game.stylus.services:${(server as any).port || "25565"}`);
                    }}
                    className="h-6 text-xs px-2"
                  >
                    Copy
                  </Button>
                </div>
              )}
            </div>
            )}


              {/* Offline message */}
              {!server.status && (
                <div className="flex items-center justify-between mt-auto">
                  <div className="flex items-center text-muted-foreground">
                    <WifiOff className="h-3.5 w-3.5 mr-1.5" />
                    <span className="text-xs">Offline</span>
                  </div>
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    transition={{ duration: 0.1 }}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => {
                        console.log('Start button clicked for server:', server.name, 'instanceId:', server.instanceId);
                        console.log('startMutation object:', startMutation);
                        console.log('startMutation.mutate type:', typeof startMutation.mutate);
                        console.log('Calling startMutation.mutate()...');
                        try {
                          startMutation.mutate();
                          console.log('startMutation.mutate() called successfully');
                        } catch (error) {
                          console.error('Error calling startMutation.mutate():', error);
                        }
                      }}
                      disabled={isLoading}
                    >
                      <Play className="h-3 w-3 text-green-500" />
                    </Button>
                  </motion.div>
                </div>
              )}

            {/* Quick Actions Bar */}
            {server.status && (
              <div className="mt-auto pt-2 border-t flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDetails(true)}
                  className="text-xs"
                >
                  View Details
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
                
                <div className="flex gap-1">
                    {server.status ? (
                      // Online server: Show stop button
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <motion.div
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                              transition={{ duration: 0.1 }}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                                onClick={() => {
                                console.log('Stop button clicked for server:', server.name, 'instanceId:', server.instanceId);
                                stopMutation.mutate();
                              }}
                                disabled={isLoading}
                              >
                                <Square className="h-3 w-3" />
                              </Button>
                            </motion.div>
                          </TooltipTrigger>
                          <TooltipContent>Stop Server</TooltipContent>
                        </Tooltip>
                      </>
                    ) : (
                      // Offline server: Show start button
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            whileTap={{ scale: 0.9 }}
                            transition={{ duration: 0.1 }}
                          >
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-green-500 hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-950"
                              onClick={() => {
                                console.log('Start button clicked for server:', server.name, 'instanceId:', server.instanceId);
                                console.log('startMutation object:', startMutation);
                                console.log('Calling startMutation.mutate()...');
                                try {
                                  startMutation.mutate();
                                  console.log('startMutation.mutate() called successfully');
                                } catch (error) {
                                  console.error('Error calling startMutation.mutate():', error);
                                }
                              }}
                              disabled={isLoading}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent>Start Server</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
              </div>
            )}
          </div>

          {/* Loading Overlay */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center"
            >
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-primary rounded-full animate-bounce" />
                <div className="h-2 w-2 bg-primary rounded-full animate-bounce delay-100" />
                <div className="h-2 w-2 bg-primary rounded-full animate-bounce delay-200" />
              </div>
            </motion.div>
          )}
        </Card>
        </motion.div>
      </TooltipProvider>


      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{server.name} - Details</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-semibold mb-2">Server Information</h3>
                <div className="space-y-2 text-sm">
                  <div><span className="font-medium">Name:</span> {server.name}</div>
                  <div><span className="font-medium">Type:</span> {server.type || "Unknown"}</div>
                  <div><span className="font-medium">Status:</span> 
                    <Badge className={`ml-2 ${
                      isTransitioning ? 'bg-yellow-500 animate-pulse' : 
                      server.status ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {isTransitioning ? 'Transitioning...' : 
                       server.status ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                  <div><span className="font-medium">Instance ID:</span> {server.instanceId}</div>
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">Connection</h3>
                <div className="space-y-2 text-sm">
                  {server.ip && (
                    <div>
                      <span className="font-medium">Address:</span>
                      <code className="ml-2 px-2 py-1 bg-muted rounded text-xs">
                        {server.ip}:{server.port || "25565"}
                      </code>
                    </div>
                  )}
                  <div><span className="font-medium">Version:</span> {server.version || "Unknown"}</div>
                  <div><span className="font-medium">Players:</span> {server.playerCount || 0} / {server.maxPlayers || 0}</div>
                </div>
              </div>
            </div>

            {/* Players List */}
            {server.status && server.players && server.players.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Online Players</h3>
                <div className="flex flex-wrap gap-2">
                  {server.players.map((player, i) => (
                    <Badge key={i} variant="secondary">{player}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Server Stats */}
            {server.status && <ServerMetrics serverId={server.instanceId} server={server} />}

            {/* Additional AMP Data */}
            {server.status && <AdditionalServerInfo serverId={server.instanceId} server={server} />}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Server Metrics Component  
function ServerMetrics({ serverId, server }: { serverId: string; server: GameServer }) {
  const { data: metrics, isLoading, error } = useQuery({
    queryKey: [`/api/game-servers/${serverId}/metrics`],
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: !!serverId,
  });

  if (isLoading) {
    return (
      <div>
        <h3 className="font-semibold mb-2">Performance</h3>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-3 bg-muted/50 rounded animate-pulse">
              <div className="h-4 bg-muted rounded mb-2"></div>
              <div className="h-6 bg-muted rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h3 className="font-semibold mb-2">Performance</h3>
        <div className="p-3 bg-muted/50 rounded text-center">
          <div className="text-sm text-muted-foreground">Unable to load metrics</div>
        </div>
      </div>
    );
  }


  const formatUptime = (startTime?: string) => {
    if (!startTime) return "N/A";
    
    const start = new Date(startTime);
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  // Match old component behavior exactly
  const cpuValue = metrics?.cpu || 0;
  const memoryValue = metrics?.memory || 0;

  return (
    <div>
      <h3 className="font-semibold mb-2">Performance</h3>
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-muted/50 rounded">
          <div className="text-sm text-muted-foreground">CPU Usage</div>
          <div className="text-lg font-semibold">
            {metrics ? `${cpuValue.toFixed(1)}%` : "N/A"}
          </div>
          {metrics && (
            <Progress value={cpuValue} className="mt-1 h-1" />
          )}
        </div>
        <div className="p-3 bg-muted/50 rounded">
          <div className="text-sm text-muted-foreground">Memory</div>
          <div className="text-lg font-semibold">
            {metrics ? `${(memoryValue / 1024).toFixed(1)} GB` : "N/A"}
          </div>
          {metrics && (
            <Progress value={(memoryValue / (server.allocatedMemory || 8192)) * 100} className="mt-1 h-1" />
          )}
        </div>
      </div>
    </div>
  );
}

// Additional Server Info Component
function AdditionalServerInfo({ serverId, server }: { serverId: string; server: GameServer }) {
  const { data: metrics, isLoading, error } = useQuery({
    queryKey: [`/api/game-servers/${serverId}/metrics`],
    refetchInterval: 30000,
    enabled: !!serverId,
  });

  if (isLoading || error || !metrics?.debug) {
    return null;
  }

  const debug = metrics.debug;
  const maxMemoryMB = debug.rawMetrics?.['Memory Usage']?.MaxValue || 0;

  return (
    <div className="space-y-4">
      {/* Resource Allocation */}
      {maxMemoryMB > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Resource Allocation</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-muted/50 rounded">
              <div className="text-sm text-muted-foreground">Max Memory</div>
              <div className="text-lg font-semibold">
                {(maxMemoryMB / 1024).toFixed(1)} GB
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded">
              <div className="text-sm text-muted-foreground">Max Players</div>
              <div className="text-lg font-semibold">
                {metrics.maxPlayers || "Unlimited"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Application Info */}
      {debug.applicationName && (
        <div>
          <h3 className="font-semibold mb-2">Application</h3>
          <div className="space-y-2 text-sm">
            <div><span className="font-medium">Module:</span> {debug.applicationName}</div>
            <div><span className="font-medium">State:</span> 
              <Badge className="ml-2" variant={debug.state === 'Ready' ? 'default' : 'secondary'}>
                {debug.state || 'Unknown'}
              </Badge>
            </div>
            {debug.uptime && (
              <div><span className="font-medium">Uptime:</span> {debug.uptime}</div>
            )}
          </div>
        </div>
      )}

      {/* Application Endpoints */}
      {debug.fullInstance?.ApplicationEndpoints && debug.fullInstance.ApplicationEndpoints.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Application Endpoints</h3>
          <div className="space-y-2">
            {debug.fullInstance.ApplicationEndpoints.map((endpoint: any, index: number) => (
              <div key={index} className="flex items-center justify-between p-3 bg-muted/50 rounded">
                <div>
                  <div className="font-medium text-sm">{endpoint.DisplayName}</div>
                  <code className="text-xs text-muted-foreground">{endpoint.Endpoint}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (endpoint.Endpoint.startsWith('http')) {
                      window.open(endpoint.Endpoint, '_blank');
                    } else {
                      navigator.clipboard.writeText(endpoint.Endpoint);
                    }
                  }}
                  className="h-7 text-xs"
                >
                  {endpoint.Endpoint.startsWith('http') ? 'Open' : 'Copy'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enhanced Connection */}
      <div>
        <h3 className="font-semibold mb-2">Enhanced Connection Info</h3>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded">
            <div>
              <div className="font-medium">Game Server</div>
              <code className="text-xs">game.stylus.services:{(server as any).port || "25565"}</code>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(`game.stylus.services:${(server as any).port || "25565"}`);
              }}
              className="h-7 text-xs"
            >
              Copy
            </Button>
          </div>
          <div><span className="font-medium">Instance ID:</span> {server.instanceId}</div>
          <div><span className="font-medium">Running:</span> 
            <Badge className="ml-2" variant={debug.running ? 'default' : 'destructive'}>
              {debug.running ? 'Yes' : 'No'}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}