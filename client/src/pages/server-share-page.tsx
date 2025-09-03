import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSettings } from "@/hooks/use-settings";
import { 
  Users, 
  Globe, 
  Gamepad2,
  Copy,
  ExternalLink,
  Wifi,
  WifiOff,
  Clock,
  Server,
  CheckCircle,
  Share2,
  ServerCog
} from "lucide-react";
import { getGameArtwork, getGameBanner, getGameIcon } from "@/lib/game-artwork";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

interface GameServer {
  instanceId: string;
  name: string;
  type?: string;
  status: boolean;
  connectionString?: string;
  serverIP?: string;
  serverPort?: number;
  version?: string;
  uptime?: string;
  Metrics?: {
    'Active Users'?: {
      RawValue: number;
      MaxValue: number;
    };
  };
}

export default function ServerSharePage() {
  const { serverId } = useParams<{ serverId: string }>();
  const { data: settings } = useSettings();
  const { toast } = useToast();

  const { data: server, isLoading, error } = useQuery({
    queryKey: [`/api/game-servers/${serverId}`],
    queryFn: async () => {
      const response = await fetch(`/api/game-servers/${serverId}`);
      if (!response.ok) {
        throw new Error('Server not found');
      }
      return response.json() as Promise<GameServer>;
    },
    enabled: !!serverId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="animate-spin h-12 w-12 border-4 border-primary rounded-full border-t-transparent mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">Loading server information...</p>
        </motion.div>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-md mx-4"
        >
          <Server className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">Server Not Found</h3>
          <p className="text-muted-foreground mb-6">
            The requested server could not be found or is no longer available.
          </p>
          <Button 
            onClick={() => window.location.href = '/game-servers'}
          >
            View All Servers
          </Button>
        </motion.div>
      </div>
    );
  }

  // Get game artwork - match exactly how server cards do it
  const serverType = server.type || 'Unknown';
  console.log('🎮 Server type received:', serverType);
  
  const gameArtwork = getGameArtwork(serverType);
  const gameBanner = getGameBanner(serverType);
  const gameIcon = getGameIcon(serverType);
  
  console.log('🎨 Artwork URLs:', { 
    serverType, 
    gameIcon, 
    gameBanner, 
    gameArtworkLogo: gameArtwork.logo,
    gameArtworkColor: gameArtwork.color 
  });
  
  // Test if images are accessible
  console.log('🔍 Testing image access:');
  console.log('Game Icon URL test:', gameIcon);
  console.log('Game Banner URL test:', gameBanner);
  console.log('Game Logo URL test:', gameArtwork.logo);

  // Get player data from AMP metrics (same as server cards)
  const currentPlayers = server.Metrics?.['Active Users']?.RawValue ?? 0;
  const maxPlayers = server.Metrics?.['Active Users']?.MaxValue ?? 0;
  const playerPercentage = maxPlayers > 0 ? (currentPlayers / maxPlayers) * 100 : 0;

  const connectionString = server.connectionString || `game.stylus.services:${(server as any).port || server.serverPort}`;

  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: message,
      duration: 2000,
    });
  };

  const shareUrl = () => {
    copyToClipboard(window.location.href, "Share link copied to clipboard");
  };

  // Get player color based on capacity (same as server cards)
  const getPlayerColor = () => {
    if (playerPercentage >= 90) return "text-red-500";
    if (playerPercentage >= 70) return "text-orange-500";
    if (playerPercentage >= 50) return "text-yellow-500";
    return "text-green-500";
  };

  return (
    <div className="min-h-screen bg-background relative">

      {/* Main Content - Designed like server cards */}
      <div className="min-h-screen flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {/* Main Server Card - Exactly like GameServerCardModern */}
          <Card className={cn(
            "group relative overflow-hidden transition-all duration-300",
            "hover:shadow-xl hover:shadow-primary/10",
            "border-border/50 backdrop-blur-sm mb-8 w-[550px]",
            !server.status && "opacity-75"
          )}>
            {/* Game artwork background */}
            <div 
              className="absolute inset-0 bg-cover bg-center opacity-20 group-hover:opacity-30 transition-opacity duration-500"
              style={{
                backgroundImage: gameBanner && gameBanner !== 'https://via.placeholder.com/460x215/374151/ffffff?text=Game+Server' ? `url(${gameBanner})` : 'none',
                backgroundColor: gameBanner && gameBanner !== 'https://via.placeholder.com/460x215/374151/ffffff?text=Game+Server' ? 'transparent' : gameArtwork.color + '20',
                filter: 'blur(1px)'
              }}
            />
            {console.log('🖼️ Background banner URL being used:', gameBanner)}
            
            {/* Dark overlay for better text readability */}
            <div className="absolute inset-0 bg-gradient-to-br from-background/90 via-background/80 to-background/60" />

            {/* Status indicator bar */}
            <div 
              className={cn(
                "absolute top-0 left-0 right-0 h-1",
                server.status ? "bg-green-500" : "bg-gray-500",
                server.status && "animate-pulse"
              )} 
              style={{ backgroundColor: server.status ? gameArtwork.color : undefined }}
            />

            {/* Background gradient effect */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="relative p-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="font-semibold text-xl truncate">
                      {server.name}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2 mb-4">
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
                        onLoad={() => console.log('✅ Badge game icon loaded successfully:', gameIcon)}
                        onError={(e) => {
                          console.log('❌ Badge game icon failed to load:', gameIcon);
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const gamepadIcon = target.nextElementSibling as HTMLElement;
                          if (gamepadIcon) gamepadIcon.style.display = 'inline';
                        }}
                      />
                      <Gamepad2 className="h-4 w-4 mr-1" style={{ display: 'none' }} />
                      {server.type || "Unknown"}
                    </Badge>
                    {server.status ? (
                      <Badge className="bg-green-500/20 text-green-400 text-xs">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Online
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <WifiOff className="h-3 w-3 mr-1" />
                        Offline
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Game Logo */}
                <div className="opacity-60 group-hover:opacity-80 transition-opacity">
                  <img 
                    src={gameArtwork.logo} 
                    alt={`${server.type} logo`}
                    className="h-16 w-auto max-w-32 object-contain"
                    onLoad={() => console.log('✅ Main game logo loaded successfully:', gameArtwork.logo)}
                    onError={(e) => {
                      console.log('❌ Main game logo failed to load:', gameArtwork.logo);
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const fallback = target.nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                  {/* Fallback for when logo doesn't load - hidden by default */}
                  <div className="h-16 w-32 flex items-center justify-center bg-muted/20 rounded text-muted-foreground text-xs font-medium opacity-50" style={{ display: 'none' }}>
                    {serverType}
                  </div>
                </div>
              </div>

              {/* Server Info Grid */}
              <div className="space-y-6">
                {/* Players Section */}
                {server.status && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        Players
                      </span>
                      <span className={cn("font-medium", getPlayerColor())}>
                        {currentPlayers} / {maxPlayers}
                      </span>
                    </div>
                    {maxPlayers > 0 && (
                      <Progress 
                        value={playerPercentage} 
                        className="h-2"
                      />
                    )}
                  </div>
                )}

                {/* Connection Info */}
                {server.status && (
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-5 w-5 text-muted-foreground" />
                      <code className="font-mono text-base">
                        {connectionString}
                      </code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(connectionString, "Server address copied to clipboard!")}
                      className="h-8"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {/* Share Button */}
                <div className="flex justify-center">
                  <Button
                    onClick={shareUrl}
                    variant="outline"
                    className="w-full"
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Share Server
                  </Button>
                </div>

                {/* Uptime for online servers */}
                {server.status && server.uptime && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    <span>Uptime: {server.uptime}</span>
                  </div>
                )}

                {/* Offline message */}
                {!server.status && (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <WifiOff className="h-6 w-6 mr-3" />
                    <div className="text-center">
                      <p className="text-lg font-medium">Server is Currently Offline</p>
                      <p className="text-sm">Check back later or contact the server administrator</p>
                    </div>
                  </div>
                )}
              </div>

            </div>
          </Card>
        </motion.div>

      </div>
      
      {/* Branding - Fixed to bottom right of page */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="fixed bottom-6 right-6 flex items-center gap-3 text-muted-foreground text-lg"
      >
        {settings?.logo_url ? (
          <img
            src={settings.logo_url}
            alt="Site Logo"
            className="h-6 w-6 object-contain"
          />
        ) : (
          <ServerCog className="h-6 w-6" />
        )}
        <span className="font-semibold">{settings?.site_title || 'Homelab Dashboard'}</span>
      </motion.div>
    </div>
  );
}