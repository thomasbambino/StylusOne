import { useQuery } from "@tanstack/react-query";
import { GameServerCardModern } from "@/components/game-server-card-modern";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RequestServerDialog } from "@/components/request-server-dialog";
import { 
  Server, 
  AlertCircle, 
  Activity,
  RefreshCw,
  WifiOff
} from "lucide-react";
import { motion } from "framer-motion";

interface AMPInstance {
  InstanceID: string;
  FriendlyName: string;
  Running: boolean;
  Status: string;
  State?: string;
  Metrics: {
    'CPU Usage': {
      RawValue: number;
      MaxValue: number;
    };
    'Memory Usage': {
      RawValue: number;
      MaxValue: number;
    };
    'Active Users': {
      RawValue: number;
      MaxValue: number;
    };
  };
  ApplicationEndpoints?: Array<{
    DisplayName: string;
    Endpoint: string;
  }>;
  // Include additional fields that might be present
  type?: string;
  Module?: string;
  ModuleDisplayName?: string;
  instanceId?: string;
  hidden?: boolean;
  show_player_count?: boolean;
  AppState?: number;
}

export default function GameServersPage() {

  const { data: gameServers, isLoading, error, refetch } = useQuery<AMPInstance[]>({
    queryKey: ['/api/game-servers'],
    queryFn: async () => {
      const response = await fetch('/api/game-servers', {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication required');
        }
        throw new Error('Failed to fetch game servers');
      }
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate summary statistics
  const runningServers = gameServers?.filter(server => {
    // Use the processed status field if available, otherwise fall back to raw data
    const isRunning = server.status !== undefined ? server.status : server.Running;
    return isRunning;
  }) || [];
  const offlineServers = gameServers?.filter(server => {
    const isRunning = server.status !== undefined ? server.status : server.Running;
    return !isRunning;
  }) || [];
  const totalPlayers = runningServers.reduce((sum, server) => 
    sum + (server.Metrics?.['Active Users']?.RawValue || server.playerCount || 0), 0
  );

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };


  if (error) {
    return (
      <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <Alert className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to load game servers: {error.message}
                {error.message === 'Authentication required' && (
                  <span className="block mt-2 text-sm">
                    Please ensure you are logged in and have permission to view game servers.
                  </span>
                )}
              </AlertDescription>
            </Alert>
            <div className="text-center py-12">
              <Server className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">Unable to Load Game Servers</h3>
              <p className="text-muted-foreground mb-6">
                There was an error connecting to the AMP service. Please check your configuration.
              </p>
              <Button onClick={() => refetch()} variant="outline">
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      className="min-h-screen bg-background"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      
      <motion.div 
        className="container mx-auto px-4 pb-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="max-w-[1600px] mx-auto">

          {/* Game Servers Sections */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {/* Loading skeletons */}
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card className="p-3 h-56">
                    <div className="animate-pulse space-y-2">
                      <div className="h-4 bg-muted rounded w-3/4" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                      <div className="h-2 bg-muted rounded w-full" />
                      <div className="h-12 bg-muted rounded" />
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          ) : !gameServers || gameServers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <Server className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-2">No Game Servers Found</h3>
              <p className="text-muted-foreground mb-6">
                No AMP instances are currently configured or accessible.
              </p>
              <div className="space-y-2 text-sm text-muted-foreground max-w-md mx-auto">
                <p>Please check:</p>
                <ul className="text-left list-disc list-inside space-y-1">
                  <li>AMP service is running and accessible</li>
                  <li>Credentials are configured correctly</li>
                  <li>Network connectivity to AMP server</li>
                </ul>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-12">
              {/* Online Servers Section */}
              {runningServers.length > 0 && (
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-lg">
                        <Activity className="h-5 w-5 text-green-500" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold text-green-500">Online Servers</h2>
                        <p className="text-sm text-muted-foreground">
                          {runningServers.length} server{runningServers.length !== 1 ? 's' : ''} running
                          {totalPlayers > 0 && <> • {totalPlayers} player{totalPlayers !== 1 ? 's' : ''} online</>}
                        </p>
                      </div>
                    </div>
                    <RequestServerDialog />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {runningServers.map((server) => (
                      <motion.div key={server.InstanceID || server.instanceId} variants={item}>
                        <GameServerCardModern 
                          server={{
                            id: 0,
                            instanceId: server.instanceId || server.InstanceID,
                            name: server.name || server.FriendlyName,
                            displayName: null,
                            type: server.type || server.Module || server.ModuleDisplayName || 'Unknown',
                            status: server.status !== undefined ? server.status : server.Running,
                            playerCount: server.playerCount !== undefined ? server.playerCount : (server.Metrics?.['Active Users']?.RawValue || 0),
                            maxPlayers: server.maxPlayers !== undefined ? server.maxPlayers : (server.Metrics?.['Active Users']?.MaxValue || 0),
                            hidden: false,
                            icon: null,
                            background: null,
                            show_player_count: true,
                            show_status_badge: true,
                            autoStart: false,
                            lastStatusCheck: null,
                            refreshInterval: 30,
                            // Add extra properties as any to avoid type errors
                            ...server as any
                          }} 
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Offline Servers Section */}
              {offlineServers.length > 0 && (
                <motion.div
                  variants={container}
                  initial="hidden"
                  animate="show"
                >
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-gray-500/10 rounded-lg">
                      <WifiOff className="h-5 w-5 text-gray-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-gray-500">Offline Servers</h2>
                      <p className="text-sm text-muted-foreground">
                        {offlineServers.length} server{offlineServers.length !== 1 ? 's' : ''} stopped
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {offlineServers.map((server) => (
                      <motion.div key={server.InstanceID || server.instanceId} variants={item}>
                        <GameServerCardModern 
                          server={{
                            id: 0,
                            instanceId: server.instanceId || server.InstanceID,
                            name: server.name || server.FriendlyName,
                            displayName: null,
                            type: server.type || server.Module || server.ModuleDisplayName || 'Unknown',
                            status: server.status !== undefined ? server.status : server.Running,
                            playerCount: server.playerCount !== undefined ? server.playerCount : (server.Metrics?.['Active Users']?.RawValue || 0),
                            maxPlayers: server.maxPlayers !== undefined ? server.maxPlayers : (server.Metrics?.['Active Users']?.MaxValue || 0),
                            hidden: false,
                            icon: null,
                            background: null,
                            show_player_count: true,
                            show_status_badge: true,
                            autoStart: false,
                            lastStatusCheck: null,
                            refreshInterval: 30,
                            // Add extra properties as any to avoid type errors
                            ...server as any
                          }} 
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* Footer Info */}
          {gameServers && gameServers.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-12 text-center text-sm text-muted-foreground"
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <Activity className="h-4 w-4" />
                <span>Auto-refreshes every 30 seconds</span>
              </div>
              <p>
                Showing {gameServers.length} server{gameServers.length !== 1 ? 's' : ''} from AMP
                {runningServers.length > 0 && (
                  <> • {totalPlayers} player{totalPlayers !== 1 ? 's' : ''} online</>
                )}
              </p>
            </motion.div>
          )}

        </div>
      </motion.div>
    </motion.div>
  );
}