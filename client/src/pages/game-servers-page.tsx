import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import { GameServerCardModern } from "@/components/game-server-card-modern";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { 
  Gamepad2, 
  Server, 
  AlertCircle, 
  Users, 
  Activity,
  Settings as SettingsIcon,
  RefreshCw,
  WifiOff,
  Plus,
  Mail
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

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
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings", {
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },
  });

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
  const totalServers = gameServers?.length || 0;
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

  // Request functionality
  const { toast } = useToast();
  const { user } = useAuth();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [requestForm, setRequestForm] = useState({
    gameType: ''
  });

  const requestServerMutation = useMutation({
    mutationFn: async (requestData: typeof requestForm) => {
      const response = await fetch('/api/game-servers/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          game: requestData.gameType
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to submit request');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Request Submitted",
        description: "Your game server request has been sent to administrators.",
      });
      setRequestDialogOpen(false);
      setRequestForm({ gameType: '' });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit request. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.gameType) {
      toast({
        title: "Error",
        description: "Please select a game type.",
        variant: "destructive",
      });
      return;
    }
    requestServerMutation.mutate(requestForm);
  };

  const gameTypes = [
    'Minecraft',
    'Valheim',
    'Terraria',
    'ARK: Survival Evolved',
    'Rust',
    'CS2',
    'Team Fortress 2',
    'Garry\'s Mod',
    'Left 4 Dead 2',
    'Project Zomboid',
    'Satisfactory',
    'Palworld',
    'Other'
  ];

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
          
          {/* Request Server Button */}
          <div className="mb-8">
            <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
              <DialogTrigger asChild>
                <Button className="mb-4" size="lg">
                  <Plus className="h-4 w-4 mr-2" />
                  Request Game Server
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Request New Game Server
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleRequestSubmit} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="gameType">Game Type *</Label>
                    <Select
                      value={requestForm.gameType}
                      onValueChange={(value) => setRequestForm(prev => ({ ...prev, gameType: value }))}
                      required
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a game type" />
                      </SelectTrigger>
                      <SelectContent>
                        {gameTypes.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  
                  <div className="flex gap-2 pt-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setRequestDialogOpen(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={requestServerMutation.isPending}
                      className="flex-1"
                    >
                      {requestServerMutation.isPending ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 mr-2" />
                          Submit Request
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

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
                  <div className="flex items-center gap-3 mb-6">
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