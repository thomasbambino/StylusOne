import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Database,
  HardDrive,
  Shield,
  Key,
  Play,
  Activity,
  Film,
  CreditCard,
  Mail,
  Radio,
  Tv,
  Calendar,
  Gamepad2,
  CheckCircle2,
  XCircle,
  Clock,
  MinusCircle,
  RefreshCw,
  ChevronDown,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getQueryFn } from "@/lib/queryClient";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Types matching the API response
type ServiceStatus = 'success' | 'failed' | 'pending' | 'skipped';

interface ServiceInfo {
  name: string;
  status: ServiceStatus;
  message?: string;
  error?: string;
}

interface CategoryInfo {
  name: string;
  services: ServiceInfo[];
}

interface BackgroundTask {
  name: string;
  description: string;
}

interface SystemStatusResponse {
  categories: CategoryInfo[];
  backgroundTasks: BackgroundTask[];
  version: string;
  appName: string;
  lastUpdated: string;
}

// Map service names to icons
const serviceIcons: Record<string, React.ElementType> = {
  'Database': Database,
  'Session Store': HardDrive,
  'Firebase Admin': Shield,
  'Google OAuth': Key,
  'Plex': Play,
  'Tautulli': Activity,
  'TMDB': Film,
  'Stripe': CreditCard,
  'Mailgun': Mail,
  'SendGrid': Mail,
  'Email': Mail,
  'HD HomeRun': Radio,
  'Xtream Codes': Tv,
  'EPG Service': Calendar,
  'AMP': Gamepad2,
};

// Map category names to icons
const categoryIcons: Record<string, React.ElementType> = {
  'Infrastructure': Database,
  'Authentication': Shield,
  'Media Services': Film,
  'Payment & Email': CreditCard,
  'Live TV & IPTV': Tv,
  'Game Servers': Gamepad2,
};

// Status indicator component
function StatusIndicator({ status }: { status: ServiceStatus }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'pending':
      return <Clock className="h-5 w-5 text-yellow-500 animate-pulse" />;
    case 'skipped':
      return <MinusCircle className="h-5 w-5 text-muted-foreground" />;
    default:
      return <MinusCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

// Status badge component
function StatusBadge({ status }: { status: ServiceStatus }) {
  const variants: Record<ServiceStatus, string> = {
    success: 'bg-green-500/10 text-green-500 border-green-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    skipped: 'bg-muted text-muted-foreground border-muted',
  };

  const labels: Record<ServiceStatus, string> = {
    success: 'Online',
    failed: 'Offline',
    pending: 'Loading',
    skipped: 'Disabled',
  };

  return (
    <Badge variant="outline" className={cn("text-xs", variants[status])}>
      {labels[status]}
    </Badge>
  );
}

// Service card component
function ServiceCard({ service }: { service: ServiceInfo }) {
  const Icon = serviceIcons[service.name] || Database;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Determine if this service has a test action
  const hasTestAction = ['Tautulli', 'AMP'].includes(service.name);
  const hasRefreshAction = service.name === 'EPG Service';

  const testMutation = useMutation({
    mutationFn: async () => {
      let endpoint = '';
      if (service.name === 'Tautulli') {
        endpoint = '/api/tautulli/test';
      } else if (service.name === 'AMP') {
        endpoint = '/api/amp-test';
      }
      const response = await fetch(endpoint, { credentials: 'include' });
      if (!response.ok) throw new Error('Test failed');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'Connection successful', description: `${service.name} is responding` });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/system/status'] });
    },
    onError: () => {
      toast({ title: 'Connection failed', description: `Could not reach ${service.name}`, variant: 'destructive' });
    },
  });

  const refreshEPGMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/epg/update', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Refresh failed');
      return response.json();
    },
    onSuccess: () => {
      toast({ title: 'EPG Refresh started', description: 'Cache is being rebuilt' });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/system/status'] });
    },
    onError: () => {
      toast({ title: 'EPG Refresh failed', description: 'Could not start refresh', variant: 'destructive' });
    },
  });

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              "flex-shrink-0 p-2 rounded-lg",
              service.status === 'success' && "bg-green-500/10",
              service.status === 'failed' && "bg-red-500/10",
              service.status === 'pending' && "bg-yellow-500/10",
              service.status === 'skipped' && "bg-muted",
            )}>
              <Icon className={cn(
                "h-5 w-5",
                service.status === 'success' && "text-green-500",
                service.status === 'failed' && "text-red-500",
                service.status === 'pending' && "text-yellow-500",
                service.status === 'skipped' && "text-muted-foreground",
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-sm truncate">{service.name}</h4>
                <StatusBadge status={service.status} />
              </div>
              <p className={cn(
                "text-xs mt-1 truncate",
                service.status === 'failed' ? "text-red-500" : "text-muted-foreground"
              )}>
                {service.error || service.message || 'No details'}
              </p>
            </div>
          </div>
          <StatusIndicator status={service.status} />
        </div>

        {/* Action buttons */}
        {(hasTestAction || hasRefreshAction) && service.status !== 'skipped' && (
          <div className="mt-3 pt-3 border-t">
            {hasTestAction && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending ? (
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3 mr-1" />
                )}
                Test Connection
              </Button>
            )}
            {hasRefreshAction && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => refreshEPGMutation.mutate()}
                disabled={refreshEPGMutation.isPending}
              >
                {refreshEPGMutation.isPending ? (
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3 mr-1" />
                )}
                Refresh Cache
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Category section component
function CategorySection({ category, defaultOpen = true }: { category: CategoryInfo; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = categoryIcons[category.name] || Database;

  const successCount = category.services.filter(s => s.status === 'success').length;
  const failedCount = category.services.filter(s => s.status === 'failed').length;
  const totalCount = category.services.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">{category.name}</span>
          <div className="flex items-center gap-1 ml-2">
            {failedCount > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5">
                {failedCount} failed
              </Badge>
            )}
            <Badge variant="secondary" className="text-xs px-1.5">
              {successCount}/{totalCount}
            </Badge>
          </div>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          isOpen && "rotate-180"
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        <div className="grid gap-2">
          {category.services.map((service) => (
            <ServiceCard key={service.name} service={service} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Background tasks section
function BackgroundTasksSection({ tasks }: { tasks: BackgroundTask[] }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Background Tasks</span>
          <Badge variant="secondary" className="text-xs px-1.5">
            {tasks.length} active
          </Badge>
        </div>
        <ChevronDown className={cn(
          "h-4 w-4 text-muted-foreground transition-transform",
          isOpen && "rotate-180"
        )} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-2 pl-6">
          {tasks.map((task) => (
            <div key={task.name} className="flex items-center gap-2 text-sm py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
              <span className="font-medium">{task.name}</span>
              <span className="text-muted-foreground text-xs">{task.description}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Loading skeleton
function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Main component
export function SystemDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery<SystemStatusResponse>({
    queryKey: ['/api/admin/system/status'],
    queryFn: getQueryFn({ on401: 'returnNull' }),
    refetchInterval: 60000, // Auto-refresh every 60 seconds
    staleTime: 30000, // Consider data stale after 30 seconds
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/admin/system/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Refresh failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/system/status'] });
      toast({ title: 'Status refreshed', description: 'All service statuses updated' });
    },
    onError: () => {
      toast({ title: 'Refresh failed', description: 'Could not refresh status', variant: 'destructive' });
    },
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <XCircle className="h-12 w-12 text-red-500 mb-4" />
        <h3 className="font-medium">Failed to load system status</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => refetch()}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Calculate summary stats
  const allServices = data.categories.flatMap(c => c.services);
  const successCount = allServices.filter(s => s.status === 'success').length;
  const failedCount = allServices.filter(s => s.status === 'failed').length;
  const totalCount = allServices.length;

  return (
    <div className="space-y-4">
      {/* Header with version and refresh */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {data.appName} Dashboard v{data.version}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={failedCount > 0 ? "destructive" : "secondary"}>
              {successCount} online
            </Badge>
            {failedCount > 0 && (
              <Badge variant="destructive">{failedCount} offline</Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {totalCount} services
            </Badge>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending || isFetching}
        >
          <RefreshCw className={cn(
            "h-4 w-4 mr-2",
            (refreshMutation.isPending || isFetching) && "animate-spin"
          )} />
          Refresh
        </Button>
      </div>

      {/* Categories */}
      <div className="space-y-4">
        {data.categories.map((category) => (
          <CategorySection key={category.name} category={category} />
        ))}
      </div>

      {/* Background tasks */}
      {data.backgroundTasks.length > 0 && (
        <BackgroundTasksSection tasks={data.backgroundTasks} />
      )}

      {/* Last updated */}
      <p className="text-xs text-muted-foreground text-center pt-2">
        Last updated: {new Date(data.lastUpdated).toLocaleTimeString()}
      </p>
    </div>
  );
}
