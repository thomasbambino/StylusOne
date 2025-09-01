import { Service } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, ExternalLink, Settings, Trash2, UserPlus } from "lucide-react";
import { EditServiceDialog } from "./edit-service-dialog";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { prefetchPlexData, refreshPlexData } from "../lib/plexCache";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Settings as SettingsType } from "@shared/schema";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription as DialogDescriptionType,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlexStreams } from "./plex-streams";
import { PlexSummary } from "./plex-summary";
import { GameServerSummary } from "./game-server-summary";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Add email schema for validation
const plexAccountSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type PlexAccountFormData = z.infer<typeof plexAccountSchema>;

interface ServiceCardProps {
  service: Service;
  isDragging?: boolean;
  showAdminControls?: boolean;
}

export function ServiceCard({ service, isDragging, showAdminControls = true }: ServiceCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const [showPlexDialog, setShowPlexDialog] = useState(false);
  // Use adminUIVisible to control the visibility of admin details in sync with other admin elements
  const [showAdminDetails, setShowAdminDetails] = useState(() => {
    // Initialize from localStorage, using the shared adminUIVisible key
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('adminUIVisible');
      // When adminUIVisible is 'true', we display admin details
      // When adminUIVisible is 'false' or not set, we hide admin details
      return saved !== null ? saved === 'true' : false;
    }
    return false;
  });
  
  // Sync state with localStorage when adminUIVisible changes in other components
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
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isPlex = service.name.toLowerCase().includes('plex');
  const isAMP = service.name.toLowerCase().includes('amp');
  
  // Prefetch and refresh Plex data at regular intervals
  useEffect(() => {
    if (isPlex) {
      // Initial prefetch to ensure data is available instantly
      prefetchPlexData();

      // Set up automatic refresh for Plex data every 20 seconds
      const refreshInterval = setInterval(() => {
        refreshPlexData();
      }, 20000); // 20 seconds
      
      return () => clearInterval(refreshInterval);
    }
  }, [isPlex]);
  
  // Handle keyboard shortcut for toggling admin details
  useEffect(() => {
    if (!isAdmin) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Look for Ctrl+H (or Cmd+H on Mac)
      if (e.key === 'h' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault(); // Prevent browser's history shortcut
        
        // Use the same localStorage key that other admin elements use
        const storageKey = 'adminUIVisible';
        
        setShowAdminDetails(prevState => {
          const newState = !prevState;
          // Save to the shared localStorage
          localStorage.setItem(storageKey, String(newState));
          return newState;
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdmin]);

  const form = useForm<PlexAccountFormData>({
    resolver: zodResolver(plexAccountSchema),
    defaultValues: {
      email: "",
    },
  });

  const createPlexAccountMutation = useMutation({
    mutationFn: async (data: PlexAccountFormData) => {
      const response = await apiRequest("POST", `/api/services/plex/account`, data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create Plex account");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Plex account invitation sent successfully",
      });
      setShowPlexDialog(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send invitation",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: PlexAccountFormData) => {
    createPlexAccountMutation.mutate(data);
  };

  // Hide NSFW content from users without permission
  if (service.isNSFW && !user?.can_view_nsfw && !isAdmin) {
    return null;
  }

  const { data: settings } = useQuery<SettingsType>({
    queryKey: ["/api/settings"],
  });

  const deleteServiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/services/${service.id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/services"] });
      toast({
        title: "Service deleted",
        description: "The service has been deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete service",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Use the appropriate visibility settings based on user role
  const showRefreshInterval = isAdmin ? settings?.admin_show_refresh_interval : settings?.show_refresh_interval;
  const showLastChecked = isAdmin ? settings?.admin_show_last_checked : settings?.show_last_checked;
  const showServiceUrl = isAdmin ? settings?.admin_show_service_url : settings?.show_service_url;

  // Create the background style with proper URL formatting
  const cardStyle = service.background ? {
    backgroundImage: `url('${service.background}')`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  } : {};

  return (
    <Card
      className={`relative transition-all duration-200 border-0 shadow-none ${isDragging ? "scale-[1.02]" : ""}`}
      style={cardStyle}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {service.icon && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-6 h-6 flex items-center justify-center cursor-pointer">
                      <img
                        src={service.icon}
                        alt={`${service.name} icon`}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </TooltipTrigger>
                  {isAdmin && (
                    <TooltipContent side="bottom">
                      <p>Press Ctrl+H to toggle admin UI</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}
            <CardTitle className="text-sm font-medium">{service.name}</CardTitle>
          </div>
          {service.tooltip && (
            <p className="text-sm text-muted-foreground pt-1">{service.tooltip}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {service.show_status_badge && (
            <Badge
              variant="default"
              style={{
                backgroundColor: service.status ?
                  settings?.online_color || "#22c55e" :
                  settings?.offline_color || "#ef4444",
                color: "white"
              }}
            >
              {service.status ? "Online" : "Offline"}
            </Badge>
          )}
          {service.isNSFW && (
            <Badge
              variant="outline"
              style={{
                backgroundColor: "#ec4899",
                color: "white",
                borderColor: "#ec4899"
              }}
            >
              NSFW
            </Badge>
          )}
          {service.name.toLowerCase().includes('plex') && (
            <Dialog open={showPlexDialog} onOpenChange={setShowPlexDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Join Plex
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Join Plex Server</DialogTitle>
                  <DialogDescriptionType>
                    Enter your email address to receive an invitation to join the Plex server.
                  </DialogDescriptionType>
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
          )}
          {isAdmin && showAdminDetails && (
            <>
              <Button variant="ghost" size="icon" onClick={() => setShowEdit(true)}>
                <Settings className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Service</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete {service.name}? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteServiceMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showServiceUrl && (
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1"
          >
            <ExternalLink className="h-4 w-4" />
            {service.url}
          </a>
        )}
        
        {isPlex && (
          <div className="space-y-4">
            {/* Show PlexSummary for all users */}
            <div>
              <PlexSummary />
            </div>
            
            {/* Only render stream details for admins when showAdminDetails is true */}
            {isAdmin && showAdminDetails && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Stream Details</h3>
                </div>
                
                <div className="pt-2">
                  <PlexStreams />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Display Game Server Summary for AMP Server */}
        {isAMP && (
          <div className="space-y-4">
            {/* Show GameServerSummary for all users */}
            <div>
              <GameServerSummary />
            </div>
          </div>
        )}
        
        {showLastChecked && (
          <p className="text-sm text-muted-foreground">
            Last checked: {new Date(service.lastChecked).toLocaleString()}
          </p>
        )}
        {showRefreshInterval && (
          <p className="text-sm text-muted-foreground">
            Refresh interval: {service.refreshInterval}s
          </p>
        )}
      </CardContent>
      {isAdmin && showAdminDetails && (
        <EditServiceDialog
          service={service}
          open={showEdit}
          onOpenChange={setShowEdit}
        />
      )}
    </Card>
  );
}