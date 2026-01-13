import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Server, Users, RefreshCw, Loader2, MoreVertical, CheckCircle2, XCircle, Tv, Download, Key, Eye, Wifi, WifiOff, Database, Clock, HardDrive, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { buildApiUrl } from '@/lib/capacitor';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface IptvProvider {
  id: number;
  name: string;
  serverUrl: string;
  isActive: boolean;
  notes: string | null;
  lastChannelSync: string | null;
  credentialCount: number;
  channelCount: number;
  enabledChannelCount: number;
  totalMaxConnections: number;
  createdAt: string;
  updatedAt: string;
}

interface EPGStats {
  channels: number;
  programs: number;
  lastFetch: string | null;
  oldestProgram: string | null;
  newestProgram: string | null;
  cacheSizeBytes: number;
  nextRefresh: string | null;
  refreshIntervalHours: number;
  dataRangeDays: number;
}

interface ActiveStream {
  id: number;
  credentialId: number;
  userId: number;
  streamId: string;
  sessionToken: string;
  startedAt: string;
  lastHeartbeat: string;
  ipAddress: string | null;
  credentialName?: string;
}

interface EPGChannelSummary {
  channelId: string;
  programCount: number;
  currentProgram: string | null;
  nextProgram: string | null;
}

interface IptvCredential {
  id: number;
  providerId: number;
  name: string;
  username: string;
  maxConnections: number;
  isActive: boolean;
  notes: string | null;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthCheck: string | null;
  activeStreams: number;
  createdAt: string;
  updatedAt: string;
}

interface ProviderFormData {
  name: string;
  serverUrl: string;
  notes: string;
  isActive: boolean;
}

interface CredentialFormData {
  name: string;
  username: string;
  password: string;
  maxConnections: string;
  notes: string;
  isActive: boolean;
}

const defaultProviderForm: ProviderFormData = {
  name: '',
  serverUrl: '',
  notes: '',
  isActive: true,
};

const defaultCredentialForm: CredentialFormData = {
  name: '',
  username: '',
  password: '',
  maxConnections: '1',
  notes: '',
  isActive: true,
};

export default function IptvProvidersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false);
  const [isEditCredentialDialogOpen, setIsEditCredentialDialogOpen] = useState(false);
  const [isStreamsDialogOpen, setIsStreamsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<IptvProvider | null>(null);
  const [selectedCredential, setSelectedCredential] = useState<IptvCredential | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormData>(defaultProviderForm);
  const [credentialForm, setCredentialForm] = useState<CredentialFormData>(defaultCredentialForm);
  const [expandedProviders, setExpandedProviders] = useState<Set<number>>(new Set());
  const [syncingProviderId, setSyncingProviderId] = useState<number | null>(null);
  const [testingCredentialId, setTestingCredentialId] = useState<number | null>(null);
  const [isEpgDataDialogOpen, setIsEpgDataDialogOpen] = useState(false);
  const [isAllStreamsDialogOpen, setIsAllStreamsDialogOpen] = useState(false);

  // Fetch providers
  const { data: providers = [], isLoading } = useQuery<IptvProvider[]>({
    queryKey: ['/api/admin/iptv-providers'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-providers'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch providers');
      return res.json();
    },
  });

  // Fetch EPG stats
  const { data: epgStats, isLoading: epgStatsLoading } = useQuery<EPGStats>({
    queryKey: ['/api/admin/epg/stats'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/epg/stats'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch EPG stats');
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch all active streams
  const { data: allActiveStreams = [], isLoading: allStreamsLoading } = useQuery<ActiveStream[]>({
    queryKey: ['/api/admin/iptv-credentials/all-streams'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-credentials/all-streams'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch active streams');
      return res.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch EPG data summary (only when dialog is open)
  const { data: epgData = [], isLoading: epgDataLoading } = useQuery<EPGChannelSummary[]>({
    queryKey: ['/api/admin/epg/data'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/epg/data'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch EPG data');
      return res.json();
    },
    enabled: isEpgDataDialogOpen,
  });

  // Create provider
  const createProviderMutation = useMutation({
    mutationFn: async (data: ProviderFormData) => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-providers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          serverUrl: data.serverUrl,
          notes: data.notes || undefined,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      setIsCreateDialogOpen(false);
      setProviderForm(defaultProviderForm);
      toast({ title: 'Success', description: 'Provider created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update provider
  const updateProviderMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: ProviderFormData }) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          serverUrl: data.serverUrl,
          notes: data.notes || null,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      setIsEditDialogOpen(false);
      setSelectedProvider(null);
      setProviderForm(defaultProviderForm);
      toast({ title: 'Success', description: 'Provider updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete provider
  const deleteProviderMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete provider');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      toast({ title: 'Success', description: 'Provider deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Sync channels
  const syncChannelsMutation = useMutation({
    mutationFn: async (providerId: number) => {
      setSyncingProviderId(providerId);
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${providerId}/sync`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to sync channels');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setSyncingProviderId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      toast({
        title: 'Channels Synced',
        description: `Total: ${data.totalChannels}, New: ${data.newChannels}, Updated: ${data.updatedChannels}`,
      });
    },
    onError: (error: Error) => {
      setSyncingProviderId(null);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Add credential
  const addCredentialMutation = useMutation({
    mutationFn: async ({ providerId, data }: { providerId: number; data: CredentialFormData }) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${providerId}/credentials`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          username: data.username,
          password: data.password,
          maxConnections: parseInt(data.maxConnections),
          notes: data.notes || undefined,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add credential');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers', selectedProvider?.id, 'credentials'] });
      setIsCredentialDialogOpen(false);
      setCredentialForm(defaultCredentialForm);
      toast({ title: 'Success', description: 'Credential added successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update credential
  const updateCredentialMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CredentialFormData }) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          username: data.username,
          password: data.password || undefined,
          maxConnections: parseInt(data.maxConnections),
          notes: data.notes || null,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update credential');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      setIsEditCredentialDialogOpen(false);
      setSelectedCredential(null);
      setCredentialForm(defaultCredentialForm);
      toast({ title: 'Success', description: 'Credential updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete credential
  const deleteCredentialMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete credential');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      toast({ title: 'Success', description: 'Credential deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Test credential
  const testCredentialMutation = useMutation({
    mutationFn: async (id: number) => {
      setTestingCredentialId(id);
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${id}/test`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to test credential');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      setTestingCredentialId(null);
      if (data.success) {
        toast({
          title: 'Connection Successful',
          description: `Status: ${data.status}${data.expiration ? `, Expires: ${format(new Date(data.expiration), 'PPP')}` : ''}`,
        });
      } else {
        toast({
          title: 'Connection Failed',
          description: data.error || 'Unable to connect',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      setTestingCredentialId(null);
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Disconnect all streams for a credential
  const disconnectStreamsMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${id}/disconnect-all`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to disconnect streams');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      toast({
        title: 'Streams Disconnected',
        description: `${data.disconnected} stream(s) disconnected`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Clear all streams across all credentials
  const clearAllStreamsMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-credentials/clear-all-streams'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to clear streams');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      toast({
        title: 'Streams Cleared',
        description: `${data.cleared} stream(s) removed`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Refresh EPG data
  const refreshEpgMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/epg/refresh'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to refresh EPG');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/epg/stats'] });
      toast({
        title: 'EPG Refresh Started',
        description: 'EPG data is being updated from the provider',
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Fetch streams for selected credential
  const { data: streamsData, isLoading: streamsLoading } = useQuery({
    queryKey: ['/api/admin/iptv-credentials', selectedCredential?.id, 'streams'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${selectedCredential?.id}/streams`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch streams');
      return res.json();
    },
    enabled: isStreamsDialogOpen && selectedCredential !== null,
  });

  const handleEditCredential = async (credential: IptvCredential) => {
    const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${credential.id}`), {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      setCredentialForm({
        name: data.name,
        username: data.username,
        password: '',
        maxConnections: data.maxConnections.toString(),
        notes: data.notes || '',
        isActive: data.isActive,
      });
      setSelectedCredential(credential);
      setIsEditCredentialDialogOpen(true);
    }
  };

  const handleViewStreams = (credential: IptvCredential) => {
    setSelectedCredential(credential);
    setIsStreamsDialogOpen(true);
  };

  const handleEditProvider = async (provider: IptvProvider) => {
    // Fetch full details with decrypted serverUrl
    const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${provider.id}`), {
      credentials: 'include',
    });
    if (res.ok) {
      const fullProvider = await res.json();
      setSelectedProvider(provider);
      setProviderForm({
        name: fullProvider.name,
        serverUrl: fullProvider.serverUrl,
        notes: fullProvider.notes || '',
        isActive: fullProvider.isActive,
      });
      setIsEditDialogOpen(true);
    }
  };

  const toggleExpanded = (providerId: number) => {
    setExpandedProviders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(providerId)) {
        newSet.delete(providerId);
      } else {
        newSet.add(providerId);
      }
      return newSet;
    });
  };

  // Computed stats
  const totalCredentials = providers.reduce((sum, p) => sum + p.credentialCount, 0);
  const totalMaxConnections = providers.reduce((sum, p) => sum + p.totalMaxConnections, 0);
  const totalActiveStreams = allActiveStreams.length;
  const utilizationPercent = totalMaxConnections > 0 ? Math.round((totalActiveStreams / totalMaxConnections) * 100) : 0;

  // Format file size
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">IPTV Providers</h1>
          <p className="text-muted-foreground">Manage IPTV providers and their credentials</p>
        </div>
        <div className="flex gap-2">
          {totalActiveStreams > 0 && (
            <Button
              variant="outline"
              onClick={() => clearAllStreamsMutation.mutate()}
              disabled={clearAllStreamsMutation.isPending}
            >
              {clearAllStreamsMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <WifiOff className="h-4 w-4 mr-2" />
              )}
              Clear All Streams
            </Button>
          )}
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Provider
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Providers</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{providers.length}</div>
            <p className="text-xs text-muted-foreground">{totalCredentials} credentials</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setIsAllStreamsDialogOpen(true)}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allStreamsLoading ? '...' : totalActiveStreams}</div>
            <p className="text-xs text-muted-foreground">of {totalMaxConnections} max</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilization</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{utilizationPercent}%</div>
            <p className="text-xs text-muted-foreground">{totalMaxConnections - totalActiveStreams} available</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Channels</CardTitle>
            <Tv className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {providers.reduce((sum, p) => sum + p.enabledChannelCount, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              of {providers.reduce((sum, p) => sum + p.channelCount, 0)} total
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">EPG Programs</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {epgStatsLoading ? '...' : (epgStats?.programs?.toLocaleString() || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {epgStats?.channels || 0} channels
            </p>
          </CardContent>
        </Card>
      </div>

      {/* EPG Cache Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                EPG Data Cache
              </CardTitle>
              <CardDescription>Electronic Program Guide data from your IPTV provider</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsEpgDataDialogOpen(true)}
              >
                <Eye className="h-4 w-4 mr-2" />
                View Data
              </Button>
              <Button
                variant="outline"
                onClick={() => refreshEpgMutation.mutate()}
                disabled={refreshEpgMutation.isPending}
              >
                {refreshEpgMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh Now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {epgStatsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : epgStats ? (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Cache Size</p>
                  <p className="text-lg font-bold">{formatBytes(epgStats.cacheSizeBytes)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Last Updated</p>
                  <p className="text-sm text-muted-foreground">
                    {epgStats.lastFetch ? format(new Date(epgStats.lastFetch), 'MMM d, h:mm a') : 'Never'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Next Refresh</p>
                  <p className="text-sm text-muted-foreground">
                    {epgStats.nextRefresh ? format(new Date(epgStats.nextRefresh), 'MMM d, h:mm a') : 'N/A'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Data Range</p>
                  <p className="text-sm text-muted-foreground">
                    {epgStats.dataRangeDays} days of data, refresh every {epgStats.refreshIntervalHours}h
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">No EPG data available</p>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No IPTV providers configured</p>
            <p className="text-sm">Add a provider to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isExpanded={expandedProviders.has(provider.id)}
              onToggleExpand={() => toggleExpanded(provider.id)}
              onEdit={() => handleEditProvider(provider)}
              onDelete={() => {
                if (confirm(`Delete provider "${provider.name}"? This will also delete all credentials and channels.`)) {
                  deleteProviderMutation.mutate(provider.id);
                }
              }}
              onSync={() => syncChannelsMutation.mutate(provider.id)}
              onAddCredential={() => {
                setSelectedProvider(provider);
                setCredentialForm(defaultCredentialForm);
                setIsCredentialDialogOpen(true);
              }}
              onEditCredential={handleEditCredential}
              onDeleteCredential={(cred) => deleteCredentialMutation.mutate(cred.id)}
              onTestCredential={(cred) => testCredentialMutation.mutate(cred.id)}
              onViewStreams={handleViewStreams}
              onDisconnectStreams={(cred) => disconnectStreamsMutation.mutate(cred.id)}
              isSyncing={syncingProviderId === provider.id}
              testingCredentialId={testingCredentialId}
            />
          ))}
        </div>
      )}

      {/* Create Provider Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add IPTV Provider</DialogTitle>
            <DialogDescription>Add a new IPTV provider (Xtream Codes compatible)</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Provider Name</Label>
              <Input
                id="name"
                value={providerForm.name}
                onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                placeholder="My IPTV Provider"
              />
            </div>
            <div>
              <Label htmlFor="serverUrl">Server URL</Label>
              <Input
                id="serverUrl"
                value={providerForm.serverUrl}
                onChange={(e) => setProviderForm({ ...providerForm, serverUrl: e.target.value })}
                placeholder="http://example.com:8080"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={providerForm.notes}
                onChange={(e) => setProviderForm({ ...providerForm, notes: e.target.value })}
                placeholder="Optional notes..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={providerForm.isActive}
                onCheckedChange={(checked) => setProviderForm({ ...providerForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createProviderMutation.mutate(providerForm)} disabled={createProviderMutation.isPending}>
              {createProviderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Provider Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Provider</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Provider Name</Label>
              <Input
                id="edit-name"
                value={providerForm.name}
                onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-serverUrl">Server URL</Label>
              <Input
                id="edit-serverUrl"
                value={providerForm.serverUrl}
                onChange={(e) => setProviderForm({ ...providerForm, serverUrl: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                value={providerForm.notes}
                onChange={(e) => setProviderForm({ ...providerForm, notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={providerForm.isActive}
                onCheckedChange={(checked) => setProviderForm({ ...providerForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedProvider && updateProviderMutation.mutate({ id: selectedProvider.id, data: providerForm })}
              disabled={updateProviderMutation.isPending}
            >
              {updateProviderMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Credential Dialog */}
      <Dialog open={isCredentialDialogOpen} onOpenChange={setIsCredentialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Credential</DialogTitle>
            <DialogDescription>Add a new login credential to {selectedProvider?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cred-name">Name</Label>
              <Input
                id="cred-name"
                value={credentialForm.name}
                onChange={(e) => setCredentialForm({ ...credentialForm, name: e.target.value })}
                placeholder="Login 1"
              />
            </div>
            <div>
              <Label htmlFor="cred-username">Username</Label>
              <Input
                id="cred-username"
                value={credentialForm.username}
                onChange={(e) => setCredentialForm({ ...credentialForm, username: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cred-password">Password</Label>
              <Input
                id="cred-password"
                type="password"
                value={credentialForm.password}
                onChange={(e) => setCredentialForm({ ...credentialForm, password: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cred-maxConnections">Max Connections</Label>
              <Input
                id="cred-maxConnections"
                type="number"
                min="1"
                max="100"
                value={credentialForm.maxConnections}
                onChange={(e) => setCredentialForm({ ...credentialForm, maxConnections: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="cred-notes">Notes</Label>
              <Textarea
                id="cred-notes"
                value={credentialForm.notes}
                onChange={(e) => setCredentialForm({ ...credentialForm, notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={credentialForm.isActive}
                onCheckedChange={(checked) => setCredentialForm({ ...credentialForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCredentialDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedProvider && addCredentialMutation.mutate({ providerId: selectedProvider.id, data: credentialForm })}
              disabled={addCredentialMutation.isPending}
            >
              {addCredentialMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Credential Dialog */}
      <Dialog open={isEditCredentialDialogOpen} onOpenChange={(open) => {
        setIsEditCredentialDialogOpen(open);
        if (!open) {
          setSelectedCredential(null);
          setCredentialForm(defaultCredentialForm);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Credential</DialogTitle>
            <DialogDescription>Update credential details. Leave password empty to keep existing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-cred-name">Name</Label>
              <Input
                id="edit-cred-name"
                value={credentialForm.name}
                onChange={(e) => setCredentialForm({ ...credentialForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-cred-username">Username</Label>
              <Input
                id="edit-cred-username"
                value={credentialForm.username}
                onChange={(e) => setCredentialForm({ ...credentialForm, username: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-cred-password">Password</Label>
              <Input
                id="edit-cred-password"
                type="password"
                placeholder="(unchanged)"
                value={credentialForm.password}
                onChange={(e) => setCredentialForm({ ...credentialForm, password: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-cred-maxConnections">Max Connections</Label>
              <Input
                id="edit-cred-maxConnections"
                type="number"
                min="1"
                max="100"
                value={credentialForm.maxConnections}
                onChange={(e) => setCredentialForm({ ...credentialForm, maxConnections: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-cred-notes">Notes</Label>
              <Textarea
                id="edit-cred-notes"
                value={credentialForm.notes}
                onChange={(e) => setCredentialForm({ ...credentialForm, notes: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={credentialForm.isActive}
                onCheckedChange={(checked) => setCredentialForm({ ...credentialForm, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditCredentialDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedCredential && updateCredentialMutation.mutate({ id: selectedCredential.id, data: credentialForm })}
              disabled={updateCredentialMutation.isPending}
            >
              {updateCredentialMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Streams Dialog */}
      <Dialog open={isStreamsDialogOpen} onOpenChange={setIsStreamsDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Active Streams - {selectedCredential?.name}</DialogTitle>
            <DialogDescription>Currently active streams using this credential</DialogDescription>
          </DialogHeader>
          {streamsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : streamsData?.streams?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No active streams</div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Capacity: {streamsData?.capacity?.used} / {streamsData?.capacity?.max} streams
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead>Stream ID</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Last Heartbeat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {streamsData?.streams?.map((stream: any) => (
                    <TableRow key={stream.id}>
                      <TableCell>{stream.userId}</TableCell>
                      <TableCell className="font-mono">{stream.streamId}</TableCell>
                      <TableCell>{format(new Date(stream.startedAt), 'PPp')}</TableCell>
                      <TableCell>{format(new Date(stream.lastHeartbeat), 'PPp')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStreamsDialogOpen(false)}>Close</Button>
            {streamsData?.streams?.length > 0 && selectedCredential && (
              <Button
                variant="destructive"
                onClick={() => {
                  disconnectStreamsMutation.mutate(selectedCredential.id);
                  setIsStreamsDialogOpen(false);
                }}
              >
                <WifiOff className="h-4 w-4 mr-2" />
                Disconnect All
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* All Active Streams Dialog */}
      <Dialog open={isAllStreamsDialogOpen} onOpenChange={setIsAllStreamsDialogOpen}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle>All Active Streams</DialogTitle>
            <DialogDescription>Currently active streams across all credentials</DialogDescription>
          </DialogHeader>
          {allStreamsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : allActiveStreams.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No active streams</div>
          ) : (
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credential</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Stream ID</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allActiveStreams.map((stream) => (
                    <TableRow key={stream.id}>
                      <TableCell className="font-medium">{stream.credentialName || `ID: ${stream.credentialId}`}</TableCell>
                      <TableCell>{stream.userId}</TableCell>
                      <TableCell className="font-mono text-xs">{stream.streamId}</TableCell>
                      <TableCell>{format(new Date(stream.startedAt), 'PPp')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAllStreamsDialogOpen(false)}>Close</Button>
            {allActiveStreams.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => {
                  clearAllStreamsMutation.mutate();
                  setIsAllStreamsDialogOpen(false);
                }}
                disabled={clearAllStreamsMutation.isPending}
              >
                {clearAllStreamsMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <WifiOff className="h-4 w-4 mr-2" />
                )}
                Clear All Streams
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EPG Data Viewer Dialog */}
      <Dialog open={isEpgDataDialogOpen} onOpenChange={setIsEpgDataDialogOpen}>
        <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>EPG Data</DialogTitle>
            <DialogDescription>
              {epgStats?.channels || 0} channels with {epgStats?.programs?.toLocaleString() || 0} programs cached
            </DialogDescription>
          </DialogHeader>
          {epgDataLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : epgData.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No EPG data available</div>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Channel</TableHead>
                    <TableHead>Programs</TableHead>
                    <TableHead>Now Playing</TableHead>
                    <TableHead>Up Next</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {epgData.map((channel) => (
                    <TableRow key={channel.channelId}>
                      <TableCell className="font-medium">{channel.channelId}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{channel.programCount}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {channel.currentProgram || <span className="text-muted-foreground">-</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {channel.nextProgram || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEpgDataDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ProviderCardProps {
  provider: IptvProvider;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSync: () => void;
  onAddCredential: () => void;
  onEditCredential: (credential: IptvCredential) => void;
  onDeleteCredential: (credential: IptvCredential) => void;
  onTestCredential: (credential: IptvCredential) => void;
  onViewStreams: (credential: IptvCredential) => void;
  onDisconnectStreams: (credential: IptvCredential) => void;
  isSyncing: boolean;
  testingCredentialId: number | null;
}

function ProviderCard({
  provider,
  isExpanded,
  onToggleExpand,
  onEdit,
  onDelete,
  onSync,
  onAddCredential,
  onEditCredential,
  onDeleteCredential,
  onTestCredential,
  onViewStreams,
  onDisconnectStreams,
  isSyncing,
  testingCredentialId,
}: ProviderCardProps) {
  // Fetch credentials when expanded
  const { data: credentials = [], isLoading: credentialsLoading } = useQuery<IptvCredential[]>({
    queryKey: ['/api/admin/iptv-providers', provider.id, 'credentials'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${provider.id}/credentials`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch credentials');
      return res.json();
    },
    enabled: isExpanded,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onToggleExpand}>
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            <div>
              <CardTitle className="flex items-center gap-2">
                {provider.name}
                {provider.isActive ? (
                  <Badge variant="default" className="bg-green-500">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">{provider.serverUrl}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mr-4">
              <div className="flex items-center gap-1">
                <Key className="h-4 w-4" />
                <span>{provider.credentialCount} creds</span>
              </div>
              <div className="flex items-center gap-1">
                <Tv className="h-4 w-4" />
                <span>{provider.enabledChannelCount}/{provider.channelCount} channels</span>
              </div>
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                <span>{provider.totalMaxConnections} streams</span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={onSync} disabled={isSyncing}>
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-1">Sync</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onAddCredential}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Credential
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          <div className="border rounded-lg">
            <div className="p-3 border-b bg-muted/50 flex justify-between items-center">
              <h4 className="font-medium text-sm">Credentials</h4>
              <Button variant="outline" size="sm" onClick={onAddCredential}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {credentialsLoading ? (
              <div className="p-4 text-center">
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              </div>
            ) : credentials.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No credentials added yet
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Streams</TableHead>
                    <TableHead>Max</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((cred) => (
                    <TableRow key={cred.id}>
                      <TableCell className="font-medium">{cred.name}</TableCell>
                      <TableCell className="text-muted-foreground">{cred.username}</TableCell>
                      <TableCell>
                        {cred.healthStatus === 'healthy' && <Badge className="bg-green-500">Healthy</Badge>}
                        {cred.healthStatus === 'unhealthy' && <Badge variant="destructive">Unhealthy</Badge>}
                        {cred.healthStatus === 'unknown' && <Badge variant="secondary">Unknown</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={cred.activeStreams > 0 ? "default" : "secondary"}>
                          {cred.activeStreams}
                        </Badge>
                      </TableCell>
                      <TableCell>{cred.maxConnections}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onEditCredential(cred)}>
                              <Edit2 className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onTestCredential(cred)}>
                              <RefreshCw className={`h-4 w-4 mr-2 ${testingCredentialId === cred.id ? 'animate-spin' : ''}`} />
                              Test Connection
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onViewStreams(cred)}>
                              <Eye className="h-4 w-4 mr-2" />
                              View Streams
                            </DropdownMenuItem>
                            {cred.activeStreams > 0 && (
                              <DropdownMenuItem onClick={() => onDisconnectStreams(cred)}>
                                <WifiOff className="h-4 w-4 mr-2" />
                                Disconnect All
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => {
                                if (confirm('Delete this credential?')) {
                                  onDeleteCredential(cred);
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          {provider.lastChannelSync && (
            <p className="text-xs text-muted-foreground mt-3">
              Last sync: {format(new Date(provider.lastChannelSync), 'MMM d, yyyy h:mm a')}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
