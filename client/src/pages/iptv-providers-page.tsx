import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Server, Users, RefreshCw, Loader2, MoreVertical, CheckCircle2, XCircle, Tv, Download, Key, Eye, Wifi, WifiOff, Database, Clock, HardDrive, Calendar, Link2, Activity, Search, ArrowRight, AlertCircle, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { buildApiUrl } from '@/lib/capacitor';
import { ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface IptvProvider {
  id: number;
  name: string;
  providerType: 'xtream' | 'm3u';
  serverUrl: string | null;
  m3uUrl: string | null;
  xmltvUrl: string | null;
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

// Channel Mapping interfaces
interface ChannelMappingWithInfo {
  id: number;
  primaryChannelId: number;
  backupChannelId: number;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  primaryChannel: {
    id: number;
    name: string;
    logo: string | null;
    streamId: string;
    providerId: number;
    providerName: string;
  };
  backupChannel: {
    id: number;
    name: string;
    logo: string | null;
    streamId: string;
    providerId: number;
    providerName: string;
  };
}

interface BackupCandidate {
  id: number;
  name: string;
  logo: string | null;
  streamId: string;
  providerId: number;
  providerName: string;
  alreadyMapped: boolean;
}

interface ProviderHealthSummary {
  providerId: number;
  name: string;
  healthStatus: string;
  lastHealthCheck: string | null;
  uptime24h: number;
  lastError: string | null;
}

interface ProviderFormData {
  name: string;
  providerType: 'xtream' | 'm3u';
  serverUrl: string;
  m3uUrl: string;
  xmltvUrl: string;
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
  providerType: 'xtream',
  serverUrl: '',
  m3uUrl: '',
  xmltvUrl: '',
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
  const [activeTab, setActiveTab] = useState('providers');
  // Channel mapping state
  const [primaryProviderId, setPrimaryProviderId] = useState<number | null>(null);
  const [mappingEnabledFilter, setMappingEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [mappingPackageFilter, setMappingPackageFilter] = useState<number | null>(null);
  const [mappingPage, setMappingPage] = useState(1);
  // For the inline dropdown per provider
  const [openDropdown, setOpenDropdown] = useState<{ channelId: number; providerId: number } | null>(null);
  const [dropdownSearchQuery, setDropdownSearchQuery] = useState('');
  // Auto-mapping state
  const [isAutoMapDialogOpen, setIsAutoMapDialogOpen] = useState(false);
  const [autoMapTargetProvider, setAutoMapTargetProvider] = useState<number | null>(null);
  const [autoMapSuggestions, setAutoMapSuggestions] = useState<Array<{
    primaryChannelId: number;
    primaryChannelName: string;
    suggestedBackup: { id: number; name: string; confidence: number; isPriority: boolean } | null;
    existingMapping: boolean;
    selected: boolean;
  }>>([]);
  const [autoMapLoading, setAutoMapLoading] = useState(false);
  // Test failover state
  const [testFailoverChannel, setTestFailoverChannel] = useState<{ id: number; name: string; streamId: string } | null>(null);
  const [testFailoverResult, setTestFailoverResult] = useState<string | null>(null);
  const [testingFailover, setTestingFailover] = useState(false);
  // Selected channel for backup dialog (fallback UI)
  const [selectedChannelForMapping, setSelectedChannelForMapping] = useState<{
    id: number;
    name: string;
    streamId: string;
    providerId: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ channel: { id: number; name: string; logo: string | null; providerId: number; providerName: string }; confidence: number }>>([]);
  const [backupSearchQuery, setBackupSearchQuery] = useState('');

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

  // Fetch channel mappings
  const { data: channelMappingsData, isLoading: mappingsLoading, refetch: refetchMappings } = useQuery<{ mappings: ChannelMappingWithInfo[], stats: any }>({
    queryKey: ['/api/admin/channel-mappings'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch channel mappings');
      return res.json();
    },
    enabled: activeTab === 'mappings',
    staleTime: 0, // Always refetch
  });
  const channelMappings = channelMappingsData?.mappings || [];

  // Fetch provider health summary
  const { data: healthSummary = [], isLoading: healthLoading } = useQuery<ProviderHealthSummary[]>({
    queryKey: ['/api/admin/provider-health-summary'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/provider-health-summary'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch health summary');
      const data = await res.json();
      return data.providers || [];
    },
    enabled: activeTab === 'health',
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch channel packages for the primary provider
  const { data: providerPackages = [] } = useQuery<Array<{ id: number; name: string; channelCount: number; providerName: string }>>({
    queryKey: ['/api/admin/channel-packages', primaryProviderId],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/channel-packages'), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch packages');
      const allPackages = await res.json();
      // Filter to only packages for the primary provider
      return allPackages.filter((pkg: any) => pkg.providerId === primaryProviderId);
    },
    enabled: !!primaryProviderId && activeTab === 'mappings',
  });

  // Fetch channels in a specific package (for package filter)
  const { data: packageChannelsData, isLoading: packageChannelsLoading } = useQuery<{
    channels: Array<{ id: number; name: string; streamId?: string; logo: string | null; categoryName?: string | null; isEnabled?: boolean }>;
  }>({
    queryKey: ['/api/admin/channel-packages', mappingPackageFilter, 'channels'],
    queryFn: async () => {
      if (!mappingPackageFilter) return { channels: [] };
      const res = await fetch(buildApiUrl(`/api/admin/channel-packages/${mappingPackageFilter}`), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch package channels');
      const pkg = await res.json();
      return { channels: pkg.channels || [] };
    },
    enabled: !!mappingPackageFilter && activeTab === 'mappings',
  });

  // Fetch primary channels (paginated, filtered) - only when no package filter
  const { data: primaryChannelsData, isLoading: primaryChannelsLoading } = useQuery<{
    channels: Array<{ id: number; name: string; streamId: string; logo: string | null; categoryName: string | null; isEnabled: boolean }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['/api/admin/iptv-channels', primaryProviderId, mappingEnabledFilter, mappingPage],
    queryFn: async () => {
      let url = `/api/admin/iptv-channels?providerId=${primaryProviderId}&page=${mappingPage}&limit=25`;
      if (mappingEnabledFilter !== 'all') url += `&enabled=${mappingEnabledFilter === 'enabled'}`;
      const res = await fetch(buildApiUrl(url), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch channels');
      return res.json();
    },
    enabled: !!primaryProviderId && !mappingPackageFilter && activeTab === 'mappings',
  });

  // Combine data - use package channels when filter is active, otherwise use paginated channels
  const displayChannelsData = mappingPackageFilter
    ? {
        channels: packageChannelsData?.channels || [],
        pagination: { page: 1, limit: 999, total: packageChannelsData?.channels?.length || 0, totalPages: 1 }
      }
    : primaryChannelsData;
  const displayChannelsLoading = mappingPackageFilter ? packageChannelsLoading : primaryChannelsLoading;

  // Fetch suggestions for dropdown (when a dropdown is open)
  const { data: dropdownSuggestionsData, isLoading: dropdownSuggestionsLoading } = useQuery<{
    suggestions: Array<{ channel: { id: number; name: string; logo: string | null; providerId: number; providerName: string }; confidence: number; alreadyMapped?: boolean }>
  }>({
    queryKey: ['/api/admin/channel-mappings/suggest-for-provider', openDropdown?.channelId, openDropdown?.providerId, dropdownSearchQuery],
    queryFn: async () => {
      if (!openDropdown) return { suggestions: [] };
      let url = `/api/admin/channel-mappings/suggest-for-provider?channelId=${openDropdown.channelId}&targetProviderId=${openDropdown.providerId}`;
      if (dropdownSearchQuery.length >= 2) url += `&q=${encodeURIComponent(dropdownSearchQuery)}`;
      const res = await fetch(buildApiUrl(url), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to get suggestions');
      return res.json();
    },
    enabled: !!openDropdown,
  });

  // Search for backup channels (for dialog)
  const { data: backupSearchResults = [], isLoading: backupSearchLoading } = useQuery<Array<{ id: number; name: string; logo: string | null; providerId: number; providerName: string; alreadyMapped: boolean }>>({
    queryKey: ['/api/admin/channel-mappings/search', selectedChannelForMapping?.id, backupSearchQuery],
    queryFn: async () => {
      if (!selectedChannelForMapping || backupSearchQuery.length < 2) return [];
      const res = await fetch(
        buildApiUrl(`/api/admin/channel-mappings/search?primaryChannelId=${selectedChannelForMapping.id}&q=${encodeURIComponent(backupSearchQuery)}`),
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to search channels');
      const data = await res.json();
      return data.candidates || data || [];
    },
    enabled: !!selectedChannelForMapping && backupSearchQuery.length >= 2,
  });

  // Get other providers (not the primary one) for failover columns
  const otherProviders = providers.filter(p => p.isActive && p.id !== primaryProviderId);

  // Build a map of existing mappings by primary channel ID and target provider
  const mappingsByPrimaryAndProvider = channelMappings.reduce((acc, mapping) => {
    const key = `${mapping.primaryChannelId}-${mapping.backupChannel.providerId}`;
    acc[key] = mapping;
    return acc;
  }, {} as Record<string, ChannelMappingWithInfo>);

  // Helper to get existing mapping for a channel and provider
  const getExistingMapping = (channelId: number, targetProviderId: number): ChannelMappingWithInfo | undefined => {
    return mappingsByPrimaryAndProvider[`${channelId}-${targetProviderId}`];
  };

  // Create provider
  const createProviderMutation = useMutation({
    mutationFn: async (data: ProviderFormData) => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-providers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          providerType: data.providerType,
          serverUrl: data.providerType === 'xtream' ? data.serverUrl : undefined,
          m3uUrl: data.providerType === 'm3u' ? data.m3uUrl : undefined,
          xmltvUrl: data.providerType === 'm3u' ? data.xmltvUrl : undefined,
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
          providerType: data.providerType,
          serverUrl: data.providerType === 'xtream' ? data.serverUrl : null,
          m3uUrl: data.providerType === 'm3u' ? data.m3uUrl : null,
          xmltvUrl: data.providerType === 'm3u' ? data.xmltvUrl : null,
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

  // Create channel mapping
  const createMappingMutation = useMutation({
    mutationFn: async ({ primaryChannelId, backupChannelId, priority }: { primaryChannelId: number; backupChannelId: number; priority?: number }) => {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ primaryChannelId, backupChannelId, priority }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create mapping');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-mappings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-mappings/suggest-for-provider'] });
      refetchMappings(); // Force immediate refetch
      toast({ title: 'Success', description: 'Channel mapping created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete channel mapping
  const deleteMappingMutation = useMutation({
    mutationFn: async (mappingId: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/channel-mappings/${mappingId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete mapping');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-mappings'] });
      toast({ title: 'Success', description: 'Channel mapping deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Bulk create channel mappings
  const bulkCreateMappingsMutation = useMutation({
    mutationFn: async (mappings: Array<{ primaryChannelId: number; backupChannelId: number }>) => {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings/bulk-create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mappings }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create mappings');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-mappings'] });
      setIsAutoMapDialogOpen(false);
      setAutoMapSuggestions([]);
      toast({ title: 'Success', description: `Created ${data.created} channel mappings` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Function to load auto-map suggestions
  const loadAutoMapSuggestions = async (targetProviderId: number) => {
    if (!primaryProviderId || !displayChannelsData?.channels) return;

    setAutoMapLoading(true);
    setAutoMapTargetProvider(targetProviderId);

    try {
      const channelIds = displayChannelsData.channels.map((c: any) => c.id);
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings/auto-suggest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          primaryChannelIds: channelIds,
          targetProviderId,
          minConfidence: 50, // Show matches with 50%+ confidence
        }),
      });

      if (!res.ok) throw new Error('Failed to get suggestions');

      const data = await res.json();
      setAutoMapSuggestions(
        data.suggestions.map((s: any) => ({
          ...s,
          selected: s.suggestedBackup?.isPriority || false, // Auto-select US/Sling matches
        }))
      );
      setIsAutoMapDialogOpen(true);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to load auto-mapping suggestions', variant: 'destructive' });
    } finally {
      setAutoMapLoading(false);
    }
  };

  // Function to apply selected auto-mappings
  const applyAutoMappings = () => {
    const selectedMappings = autoMapSuggestions
      .filter(s => s.selected && s.suggestedBackup)
      .map(s => ({
        primaryChannelId: s.primaryChannelId,
        backupChannelId: s.suggestedBackup!.id,
      }));

    if (selectedMappings.length === 0) {
      toast({ title: 'No mappings selected', description: 'Select at least one mapping to apply', variant: 'destructive' });
      return;
    }

    bulkCreateMappingsMutation.mutate(selectedMappings);
  };

  // Test failover state - store full data for interactive dialog
  const [failoverTestData, setFailoverTestData] = useState<{
    primaryChannel: { id: number; name: string; streamId: string; providerName: string; providerHealth: string };
    backupChannels: Array<{ id: number; name: string; streamId: string; providerName: string; providerHealth: string; priority: number; isUsable: boolean; isHealthy: boolean; issues: string | null }>;
    failoverReady: boolean;
    totalMappings: number;
    usableBackups: number;
    healthyBackups: number;
  } | null>(null);

  // Test failover function
  const testFailover = async (channel: { id: number; name: string }) => {
    setTestingFailover(true);
    setTestFailoverResult(null);
    setFailoverTestData(null);

    try {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings/test-failover'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channelId: channel.id }),
      });

      if (!res.ok) throw new Error('Failed to test failover');

      const data = await res.json();
      setFailoverTestData(data);
      setTestFailoverResult('loaded'); // Signal that dialog should open
    } catch (error) {
      setTestFailoverResult('❌ Error testing failover');
    } finally {
      setTestingFailover(false);
    }
  };

  // Play backup stream for testing
  const playBackupStream = (streamId: string) => {
    const url = buildApiUrl(`/api/iptv/stream/${streamId}.m3u8`);
    window.open(url, '_blank');
  };

  // Test mode state
  const [testModeStreamId, setTestModeStreamId] = useState<string | null>(null);
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [togglingTestMode, setTogglingTestMode] = useState(false);

  // Toggle test failover mode
  const toggleTestMode = async (streamId: string, enable: boolean) => {
    setTogglingTestMode(true);
    try {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings/test-mode'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ streamId, enabled: enable }),
      });
      if (!res.ok) throw new Error('Failed to toggle test mode');
      const data = await res.json();
      setTestModeEnabled(data.testModeEnabled);
      toast({
        title: enable ? 'Test Mode Enabled' : 'Test Mode Disabled',
        description: data.message,
      });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to toggle test mode', variant: 'destructive' });
    } finally {
      setTogglingTestMode(false);
    }
  };

  // Check test mode status when failover data loads
  useEffect(() => {
    if (failoverTestData?.primaryChannel?.streamId) {
      const streamId = failoverTestData.primaryChannel.streamId;
      setTestModeStreamId(streamId);
      // Check current test mode status
      fetch(buildApiUrl(`/api/admin/channel-mappings/test-mode/${streamId}`), { credentials: 'include' })
        .then(res => res.json())
        .then(data => setTestModeEnabled(data.testModeEnabled))
        .catch(() => setTestModeEnabled(false));
    }
  }, [failoverTestData]);

  // Manual health check
  const healthCheckMutation = useMutation({
    mutationFn: async (providerId: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-providers/${providerId}/health-check`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Health check failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/provider-health-summary'] });
      toast({
        title: 'Health Check Complete',
        description: `Status: ${data.status}${data.responseTimeMs ? ` (${data.responseTimeMs}ms)` : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Get backup suggestions for a channel
  const getSuggestionsMutation = useMutation({
    mutationFn: async (channelId: number) => {
      const res = await fetch(buildApiUrl('/api/admin/channel-mappings/suggest'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channelId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to get suggestions');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setSuggestions(data.suggestions || []);
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
        providerType: fullProvider.providerType || 'xtream',
        serverUrl: fullProvider.serverUrl || '',
        m3uUrl: fullProvider.m3uUrl || '',
        xmltvUrl: fullProvider.xmltvUrl || '',
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

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="providers" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="mappings" className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Channel Mappings
          </TabsTrigger>
          <TabsTrigger value="health" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Health Dashboard
          </TabsTrigger>
        </TabsList>

        {/* Providers Tab */}
        <TabsContent value="providers" className="space-y-4">
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
        </TabsContent>

        {/* Channel Mappings Tab */}
        <TabsContent value="mappings" className="space-y-4">
          {/* Channel Mapping Configuration */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" />
                Channel Failover Mapping
              </CardTitle>
              <CardDescription>
                Set up backup channels for automatic failover. Select your primary provider, then assign backups from other providers for each channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Primary Provider Selection */}
              <div className="flex flex-wrap gap-4 items-end">
                <div className="w-72">
                  <Label className="text-sm font-medium mb-2 block">Primary Provider</Label>
                  <Select
                    value={primaryProviderId?.toString() || ''}
                    onValueChange={(value) => {
                      setPrimaryProviderId(parseInt(value));
                      setMappingPage(1);
                      setMappingPackageFilter(null);
                      setOpenDropdown(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select your primary provider..." />
                    </SelectTrigger>
                    <SelectContent>
                      {providers.filter(p => p.isActive).map((provider) => (
                        <SelectItem key={provider.id} value={provider.id.toString()}>
                          {provider.name} ({provider.enabledChannelCount} channels)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {primaryProviderId && (
                  <>
                    <div className="w-48">
                      <Label className="text-sm font-medium mb-2 block">Status</Label>
                      <Select
                        value={mappingEnabledFilter}
                        onValueChange={(value: 'all' | 'enabled' | 'disabled') => {
                          setMappingEnabledFilter(value);
                          setMappingPage(1);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All channels</SelectItem>
                          <SelectItem value="enabled">Enabled only</SelectItem>
                          <SelectItem value="disabled">Disabled only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {providerPackages.length > 0 && (
                      <div className="w-56">
                        <Label className="text-sm font-medium mb-2 block">Channel Package</Label>
                        <Select
                          value={mappingPackageFilter?.toString() || 'all'}
                          onValueChange={(value) => {
                            setMappingPackageFilter(value === 'all' ? null : parseInt(value));
                            setMappingPage(1);
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All channels</SelectItem>
                            {providerPackages.map((pkg) => (
                              <SelectItem key={pkg.id} value={pkg.id.toString()}>
                                {pkg.name} ({pkg.channelCount})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
              </div>
              {primaryProviderId && otherProviders.length > 0 && (
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Failover providers: {otherProviders.map(p => p.name).join(', ')}
                  </div>
                  <div className="flex gap-2">
                    {otherProviders.map(provider => (
                      <Button
                        key={provider.id}
                        variant="outline"
                        size="sm"
                        onClick={() => loadAutoMapSuggestions(provider.id)}
                        disabled={autoMapLoading}
                      >
                        {autoMapLoading && autoMapTargetProvider === provider.id ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-1" />
                        )}
                        Auto-Map to {provider.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mapping Table with Inline Dropdowns */}
              {!primaryProviderId ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">Select a Primary Provider</p>
                  <p className="text-sm">Choose your main provider to start mapping backup channels</p>
                </div>
              ) : otherProviders.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No Backup Providers Available</p>
                  <p className="text-sm">Add more active providers to set up failover mappings</p>
                </div>
              ) : displayChannelsLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (displayChannelsData?.channels?.length || 0) === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Tv className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No Channels Found</p>
                  <p className="text-sm">Try changing the filters or sync channels from the provider</p>
                </div>
              ) : (
                <>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="w-[300px]">Primary Channel</TableHead>
                          <TableHead className="w-[80px]">Status</TableHead>
                          {otherProviders.map((provider) => (
                            <TableHead key={provider.id} className="min-w-[200px]">
                              <div className="flex items-center gap-2">
                                <span>{provider.name}</span>
                                <Badge variant="outline" className="text-xs">{provider.channelCount}</Badge>
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayChannelsData?.channels.map((channel: any) => (
                          <TableRow key={channel.id}>
                            <TableCell className="font-medium">
                              <div className="flex items-center gap-2">
                                {channel.logo && (
                                  <img src={channel.logo} alt="" className="w-6 h-6 rounded object-contain bg-muted" />
                                )}
                                <span className="truncate max-w-[250px]">{channel.name}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge variant={channel.isEnabled ? 'default' : 'secondary'} className={channel.isEnabled ? 'bg-green-600 text-xs' : 'text-xs'}>
                                  {channel.isEnabled ? 'On' : 'Off'}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => testFailover({ id: channel.id, name: channel.name })}
                                  disabled={testingFailover}
                                  title="Test Failover"
                                >
                                  <Activity className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                            {otherProviders.map((provider) => {
                              const existingMapping = getExistingMapping(channel.id, provider.id);
                              const isOpen = openDropdown?.channelId === channel.id && openDropdown?.providerId === provider.id;

                              return (
                                <TableCell key={provider.id} className="relative">
                                  {existingMapping ? (
                                    <div className="flex items-center gap-1">
                                      <Badge variant="outline" className="text-xs truncate max-w-[150px]">
                                        {existingMapping.backupChannel.name}
                                      </Badge>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 shrink-0"
                                        onClick={() => {
                                          if (confirm('Remove this backup mapping?')) {
                                            deleteMappingMutation.mutate(existingMapping.id);
                                          }
                                        }}
                                      >
                                        <Trash2 className="h-3 w-3 text-destructive" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <div className="relative">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs w-full justify-start"
                                        onClick={() => {
                                          if (isOpen) {
                                            setOpenDropdown(null);
                                            setDropdownSearchQuery('');
                                          } else {
                                            setOpenDropdown({ channelId: channel.id, providerId: provider.id });
                                            setDropdownSearchQuery('');
                                          }
                                        }}
                                      >
                                        <Plus className="h-3 w-3 mr-1" />
                                        Add backup
                                      </Button>

                                      {/* Dropdown Panel */}
                                      {isOpen && (
                                        <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-popover border rounded-lg shadow-lg p-2">
                                          {/* Search Input */}
                                          <div className="relative mb-2">
                                            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                            <Input
                                              placeholder="Search channels..."
                                              className="h-8 pl-7 text-sm"
                                              value={dropdownSearchQuery}
                                              onChange={(e) => setDropdownSearchQuery(e.target.value)}
                                              autoFocus
                                            />
                                          </div>

                                          {/* Suggestions List */}
                                          <div className="max-h-48 overflow-y-auto">
                                            {dropdownSuggestionsLoading ? (
                                              <div className="flex justify-center py-4">
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                              </div>
                                            ) : (dropdownSuggestionsData?.suggestions?.length || 0) === 0 ? (
                                              <p className="text-center py-4 text-muted-foreground text-xs">
                                                {dropdownSearchQuery.length >= 2 ? 'No matches found' : 'No suggestions available'}
                                              </p>
                                            ) : (
                                              dropdownSuggestionsData?.suggestions.map((suggestion) => (
                                                <button
                                                  key={suggestion.channel.id}
                                                  className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted flex items-center justify-between disabled:opacity-50"
                                                  disabled={suggestion.alreadyMapped || createMappingMutation.isPending}
                                                  onClick={() => {
                                                    createMappingMutation.mutate({
                                                      primaryChannelId: channel.id,
                                                      backupChannelId: suggestion.channel.id,
                                                    }, {
                                                      onSuccess: () => {
                                                        setOpenDropdown(null);
                                                        setDropdownSearchQuery('');
                                                      }
                                                    });
                                                  }}
                                                >
                                                  <span className="truncate flex-1">{suggestion.channel.name}</span>
                                                  {suggestion.alreadyMapped ? (
                                                    <Badge variant="secondary" className="text-xs ml-2">Mapped</Badge>
                                                  ) : (
                                                    <Badge variant="outline" className="text-xs ml-2">{suggestion.confidence}%</Badge>
                                                  )}
                                                </button>
                                              ))
                                            )}
                                          </div>

                                          {/* Close Button */}
                                          <div className="border-t mt-2 pt-2">
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="w-full h-7 text-xs"
                                              onClick={() => {
                                                setOpenDropdown(null);
                                                setDropdownSearchQuery('');
                                              }}
                                            >
                                              Close
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination - only show when not filtering by package */}
                  {!mappingPackageFilter && displayChannelsData?.pagination && displayChannelsData.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <p className="text-sm text-muted-foreground">
                        Page {displayChannelsData.pagination.page} of {displayChannelsData.pagination.totalPages} ({displayChannelsData.pagination.total} channels)
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mappingPage <= 1}
                          onClick={() => {
                            setMappingPage(p => p - 1);
                            setOpenDropdown(null);
                          }}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mappingPage >= displayChannelsData.pagination.totalPages}
                          onClick={() => {
                            setMappingPage(p => p + 1);
                            setOpenDropdown(null);
                          }}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {/* Show count when filtering by package */}
                  {mappingPackageFilter && displayChannelsData?.channels && (
                    <p className="text-sm text-muted-foreground pt-2">
                      {displayChannelsData.channels.length} channels in this package
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Existing Mappings Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5" />
                Mapping Summary
              </CardTitle>
              <CardDescription>{channelMappings.length} backup mapping{channelMappings.length !== 1 ? 's' : ''} configured</CardDescription>
            </CardHeader>
            <CardContent>
              {mappingsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : channelMappings.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  No mappings configured yet. Use the table above to add backup channels.
                </p>
              ) : (
                <div className="grid gap-2 max-h-48 overflow-y-auto">
                  {channelMappings.slice(0, 20).map((mapping) => (
                    <div key={mapping.id} className="flex items-center gap-2 text-sm p-2 rounded bg-muted/30">
                      <span className="font-medium truncate flex-1">{mapping.primaryChannel.name}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <Badge variant="outline" className="truncate">{mapping.backupChannel.name}</Badge>
                      <Badge variant="secondary" className="text-xs shrink-0">{mapping.backupChannel.providerName}</Badge>
                    </div>
                  ))}
                  {channelMappings.length > 20 && (
                    <p className="text-center text-muted-foreground text-xs py-2">
                      + {channelMappings.length - 20} more mappings
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Health Dashboard Tab */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Provider Health Dashboard
                  </CardTitle>
                  <CardDescription>Monitor provider health status and uptime</CardDescription>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    healthSummary.forEach(p => healthCheckMutation.mutate(p.providerId));
                  }}
                  disabled={healthCheckMutation.isPending}
                >
                  {healthCheckMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Check All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {healthLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : healthSummary.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No providers to monitor</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {healthSummary.map((provider) => (
                    <div key={provider.providerId} className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className={`w-3 h-3 rounded-full ${
                          provider.healthStatus === 'healthy' ? 'bg-green-500' :
                          provider.healthStatus === 'degraded' ? 'bg-yellow-500' :
                          provider.healthStatus === 'unhealthy' ? 'bg-red-500' : 'bg-gray-400'
                        }`} />
                        <div>
                          <p className="font-medium">{provider.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Last check: {provider.lastHealthCheck
                              ? format(new Date(provider.lastHealthCheck), 'MMM d, h:mm a')
                              : 'Never'
                            }
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">24h Uptime</p>
                          <div className="flex items-center gap-2">
                            <Progress value={provider.uptime24h} className="w-24 h-2" />
                            <span className="text-sm font-medium">{provider.uptime24h}%</span>
                          </div>
                        </div>
                        {provider.lastError && (
                          <div className="flex items-center gap-2 text-destructive">
                            <AlertCircle className="h-4 w-4" />
                            <span className="text-sm">{provider.lastError}</span>
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => healthCheckMutation.mutate(provider.providerId)}
                          disabled={healthCheckMutation.isPending}
                        >
                          {healthCheckMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Provider Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add IPTV Provider</DialogTitle>
            <DialogDescription>Add a new IPTV provider</DialogDescription>
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
              <Label htmlFor="providerType">Provider Type</Label>
              <Select
                value={providerForm.providerType}
                onValueChange={(value: 'xtream' | 'm3u') => setProviderForm({ ...providerForm, providerType: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xtream">Xtream Codes (requires credentials)</SelectItem>
                  <SelectItem value="m3u">M3U Playlist (direct URLs)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {providerForm.providerType === 'xtream' ? (
              <div>
                <Label htmlFor="serverUrl">Server URL</Label>
                <Input
                  id="serverUrl"
                  value={providerForm.serverUrl}
                  onChange={(e) => setProviderForm({ ...providerForm, serverUrl: e.target.value })}
                  placeholder="http://example.com:8080"
                />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="m3uUrl">M3U Playlist URL</Label>
                  <Input
                    id="m3uUrl"
                    value={providerForm.m3uUrl}
                    onChange={(e) => setProviderForm({ ...providerForm, m3uUrl: e.target.value })}
                    placeholder="http://example.com/playlist.m3u"
                  />
                </div>
                <div>
                  <Label htmlFor="xmltvUrl">XMLTV EPG URL (optional)</Label>
                  <Input
                    id="xmltvUrl"
                    value={providerForm.xmltvUrl}
                    onChange={(e) => setProviderForm({ ...providerForm, xmltvUrl: e.target.value })}
                    placeholder="http://example.com/epg.xml"
                  />
                </div>
              </>
            )}
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
            <DialogDescription>
              {providerForm.providerType === 'xtream' ? 'Xtream Codes Provider' : 'M3U Playlist Provider'}
            </DialogDescription>
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
            {providerForm.providerType === 'xtream' ? (
              <div>
                <Label htmlFor="edit-serverUrl">Server URL</Label>
                <Input
                  id="edit-serverUrl"
                  value={providerForm.serverUrl}
                  onChange={(e) => setProviderForm({ ...providerForm, serverUrl: e.target.value })}
                />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="edit-m3uUrl">M3U Playlist URL</Label>
                  <Input
                    id="edit-m3uUrl"
                    value={providerForm.m3uUrl}
                    onChange={(e) => setProviderForm({ ...providerForm, m3uUrl: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-xmltvUrl">XMLTV EPG URL (optional)</Label>
                  <Input
                    id="edit-xmltvUrl"
                    value={providerForm.xmltvUrl}
                    onChange={(e) => setProviderForm({ ...providerForm, xmltvUrl: e.target.value })}
                  />
                </div>
              </>
            )}
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

      {/* Test Failover Result Dialog */}
      <Dialog open={!!testFailoverResult} onOpenChange={() => { setTestFailoverResult(null); setFailoverTestData(null); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Failover Test</DialogTitle>
          </DialogHeader>
          {testFailoverResult === 'loaded' && failoverTestData ? (
            <div className="space-y-4">
              {/* Primary Channel */}
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Primary: {failoverTestData.primaryChannel.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {failoverTestData.primaryChannel.providerName} ({failoverTestData.primaryChannel.providerHealth})
                    </p>
                  </div>
                  <Button size="sm" onClick={() => playBackupStream(failoverTestData.primaryChannel.streamId)}>
                    <Play className="h-4 w-4 mr-1" /> Play Primary
                  </Button>
                </div>
              </div>

              {/* Status */}
              <div className={`p-2 rounded text-center ${failoverTestData.failoverReady ? 'bg-green-500/20 text-green-500' : 'bg-yellow-500/20 text-yellow-600'}`}>
                {failoverTestData.failoverReady
                  ? `✅ Failover Ready (${failoverTestData.usableBackups}/${failoverTestData.totalMappings} usable, ${failoverTestData.healthyBackups} healthy)`
                  : failoverTestData.totalMappings > 0
                    ? `⚠️ ${failoverTestData.totalMappings} mapping(s) but none usable`
                    : '⚠️ No backups configured'
                }
              </div>

              {/* Test Mode Toggle */}
              {failoverTestData.failoverReady && (
                <div className={`p-3 rounded-lg border-2 ${testModeEnabled ? 'border-orange-500 bg-orange-500/10' : 'border-muted'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        {testModeEnabled ? '🔴 Test Mode ACTIVE' : 'Test Failover Mode'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {testModeEnabled
                          ? 'All users are receiving the backup stream'
                          : 'Enable to force all users to use backup stream'
                        }
                      </p>
                    </div>
                    <Button
                      variant={testModeEnabled ? 'destructive' : 'default'}
                      size="sm"
                      disabled={togglingTestMode}
                      onClick={() => toggleTestMode(failoverTestData.primaryChannel.streamId, !testModeEnabled)}
                    >
                      {togglingTestMode ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : testModeEnabled ? (
                        'Disable Test Mode'
                      ) : (
                        'Enable Test Mode'
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Backup Channels */}
              {failoverTestData.backupChannels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Backup Channels:</p>
                  {failoverTestData.backupChannels.map((backup, idx) => (
                    <div key={idx} className={`p-3 border rounded-lg ${backup.isUsable ? 'border-green-500/50' : 'border-red-500/50 opacity-60'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={backup.isUsable ? (backup.isHealthy ? 'text-green-500' : 'text-yellow-500') : 'text-red-500'}>
                              {backup.isUsable ? (backup.isHealthy ? '✓' : '⚠') : '✗'}
                            </span>
                            <span className="font-medium">{backup.priority}. {backup.name}</span>
                          </div>
                          <p className="text-sm text-muted-foreground ml-5">
                            {backup.providerName} ({backup.providerHealth})
                            {backup.issues && <span className="text-red-500"> [{backup.issues}]</span>}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={backup.isUsable ? 'default' : 'outline'}
                          onClick={() => playBackupStream(backup.streamId)}
                        >
                          <Play className="h-4 w-4 mr-1" /> Test
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg overflow-auto max-h-[400px]">
              {testFailoverResult}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTestFailoverResult(null); setFailoverTestData(null); }}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Auto-Map Review Dialog */}
      <Dialog open={isAutoMapDialogOpen} onOpenChange={setIsAutoMapDialogOpen}>
        <DialogContent className="sm:max-w-[900px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Auto-Map Review</DialogTitle>
            <DialogDescription>
              Review suggested channel mappings. US/Sling channels are auto-selected.
              {autoMapSuggestions.length > 0 && (
                <span className="ml-2 font-medium">
                  ({autoMapSuggestions.filter(s => s.selected).length} selected of {autoMapSuggestions.length} suggestions)
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[50vh] overflow-y-auto">
            {autoMapSuggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No high-confidence matches found for the displayed channels.
              </div>
            ) : (
              <>
                {/* Quick actions */}
                <div className="flex gap-2 pb-2 border-b">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAutoMapSuggestions(prev =>
                      prev.map(s => ({ ...s, selected: s.suggestedBackup?.isPriority || false }))
                    )}
                  >
                    Select US/Sling Only
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAutoMapSuggestions(prev =>
                      prev.map(s => ({ ...s, selected: true }))
                    )}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAutoMapSuggestions(prev =>
                      prev.map(s => ({ ...s, selected: false }))
                    )}
                  >
                    Deselect All
                  </Button>
                </div>

                {/* Suggestions table */}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={autoMapSuggestions.every(s => s.selected)}
                          onChange={(e) => setAutoMapSuggestions(prev =>
                            prev.map(s => ({ ...s, selected: e.target.checked }))
                          )}
                          className="rounded"
                        />
                      </TableHead>
                      <TableHead>Primary Channel</TableHead>
                      <TableHead>Suggested Backup</TableHead>
                      <TableHead className="w-24">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {autoMapSuggestions.map((suggestion) => (
                      <TableRow key={suggestion.primaryChannelId}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={suggestion.selected}
                            onChange={(e) => setAutoMapSuggestions(prev =>
                              prev.map(s =>
                                s.primaryChannelId === suggestion.primaryChannelId
                                  ? { ...s, selected: e.target.checked }
                                  : s
                              )
                            )}
                            className="rounded"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{suggestion.primaryChannelName}</TableCell>
                        <TableCell>
                          {suggestion.suggestedBackup ? (
                            <div className="flex items-center gap-2">
                              <span>{suggestion.suggestedBackup.name}</span>
                              {suggestion.suggestedBackup.isPriority && (
                                <Badge variant="default" className="text-xs">US/Sling</Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No match</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {suggestion.suggestedBackup && (
                            <Badge
                              variant={suggestion.suggestedBackup.confidence >= 70 ? 'default' : 'secondary'}
                            >
                              {suggestion.suggestedBackup.confidence}%
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAutoMapDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={applyAutoMappings}
              disabled={bulkCreateMappingsMutation.isPending || autoMapSuggestions.filter(s => s.selected).length === 0}
            >
              {bulkCreateMappingsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Apply {autoMapSuggestions.filter(s => s.selected).length} Mappings
            </Button>
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
                <Badge variant="outline" className="text-xs">
                  {provider.providerType === 'm3u' ? 'M3U' : 'Xtream'}
                </Badge>
                {provider.isActive ? (
                  <Badge variant="default" className="bg-green-500">Active</Badge>
                ) : (
                  <Badge variant="secondary">Inactive</Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                {provider.providerType === 'm3u' ? provider.m3uUrl : provider.serverUrl}
              </CardDescription>
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
                {provider.providerType !== 'm3u' && (
                  <DropdownMenuItem onClick={onAddCredential}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Credential
                  </DropdownMenuItem>
                )}
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
          {provider.providerType === 'm3u' ? (
            <div className="border rounded-lg p-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">M3U Playlist URL</p>
                <p className="text-sm break-all">{provider.m3uUrl || 'Not configured'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">XMLTV EPG URL</p>
                <p className="text-sm break-all">{provider.xmltvUrl || 'Not configured'}</p>
              </div>
              <div className="pt-2 text-xs text-muted-foreground">
                M3U providers don't require login credentials. Streams are accessed directly via the M3U playlist URLs.
              </div>
            </div>
          ) : (
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
          )}
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
