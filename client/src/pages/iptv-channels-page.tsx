import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Search, Loader2, Tv, CheckCircle2, XCircle, Filter, ChevronLeft, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { buildApiUrl } from '@/lib/capacitor';
import { ScrollArea } from '@/components/ui/scroll-area';

interface IptvProvider {
  id: number;
  name: string;
  channelCount: number;
  enabledChannelCount: number;
}

interface IptvChannel {
  id: number;
  providerId: number;
  streamId: string;
  name: string;
  logo: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isEnabled: boolean;
  quality: '4k' | 'hd' | 'sd' | 'unknown';
  hasEPG: boolean;
  lastSeen: string | null;
  createdAt: string;
}

interface Category {
  categoryName: string | null;
  count: number;
  enabledCount: number;
}

interface PaginatedResponse {
  channels: IptvChannel[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export default function IptvChannelsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [enabledFilter, setEnabledFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 50;

  // Selection state
  const [selectedChannels, setSelectedChannels] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Fetch providers
  const { data: providers = [] } = useQuery<IptvProvider[]>({
    queryKey: ['/api/admin/iptv-providers'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-providers'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch providers');
      return res.json();
    },
  });

  // Fetch categories for selected provider
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/admin/iptv-channels/categories', selectedProviderId],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-channels/categories?providerId=${selectedProviderId}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
    enabled: !!selectedProviderId,
  });

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedProviderId) params.set('providerId', selectedProviderId.toString());
    if (searchQuery) params.set('search', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    if (enabledFilter !== 'all') params.set('enabled', enabledFilter);
    params.set('page', page.toString());
    params.set('limit', limit.toString());
    return params.toString();
  }, [selectedProviderId, searchQuery, selectedCategory, enabledFilter, page]);

  // Fetch channels
  const { data: channelsData, isLoading: channelsLoading } = useQuery<PaginatedResponse>({
    queryKey: ['/api/admin/iptv-channels', queryParams],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-channels?${queryParams}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch channels');
      return res.json();
    },
    enabled: !!selectedProviderId,
  });

  // Toggle channel enabled status
  const toggleChannelMutation = useMutation({
    mutationFn: async ({ channelId, isEnabled }: { channelId: number; isEnabled: boolean }) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-channels/${channelId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to update channel');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
    },
  });

  // Bulk update channels
  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ channelIds, isEnabled }: { channelIds: number[]; isEnabled: boolean }) => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-channels/bulk'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channelIds, isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to update channels');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      setSelectedChannels(new Set());
      setSelectAll(false);
      toast({ title: 'Success', description: `Updated ${data.updated} channels` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Bulk update category
  const bulkCategoryMutation = useMutation({
    mutationFn: async ({ categoryName, isEnabled }: { categoryName: string; isEnabled: boolean }) => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-channels/bulk-category'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ providerId: selectedProviderId, categoryName, isEnabled }),
      });
      if (!res.ok) throw new Error('Failed to update category');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-channels/categories'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-providers'] });
      toast({ title: 'Success', description: `Updated ${data.updated} channels in category` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectAll(checked);
    if (checked && channelsData?.channels) {
      setSelectedChannels(new Set(channelsData.channels.map(c => c.id)));
    } else {
      setSelectedChannels(new Set());
    }
  }, [channelsData?.channels]);

  const handleSelectChannel = useCallback((channelId: number, checked: boolean) => {
    setSelectedChannels(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(channelId);
      } else {
        newSet.delete(channelId);
      }
      return newSet;
    });
  }, []);

  const channels = channelsData?.channels || [];
  const pagination = channelsData?.pagination;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">IPTV Channels</h1>
        <p className="text-muted-foreground">Enable or disable channels from your providers</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Provider & Category Selection */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Provider</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Select
                value={selectedProviderId?.toString() || ''}
                onValueChange={(v) => {
                  setSelectedProviderId(v ? parseInt(v) : null);
                  setSelectedCategory('');
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.name} ({p.enabledChannelCount}/{p.channelCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedProviderId && categories.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Categories</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-[300px]">
                  <div className="space-y-1">
                    <Button
                      variant={selectedCategory === '' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="w-full justify-between"
                      onClick={() => {
                        setSelectedCategory('');
                        setPage(1);
                      }}
                    >
                      <span>All Categories</span>
                      <span className="text-muted-foreground">
                        {categories.reduce((sum, c) => sum + c.count, 0)}
                      </span>
                    </Button>
                    {categories.map((cat) => (
                      <div key={cat.categoryName || 'uncategorized'} className="flex items-center gap-1">
                        <Button
                          variant={selectedCategory === (cat.categoryName || '') ? 'secondary' : 'ghost'}
                          size="sm"
                          className="flex-1 justify-between text-left h-auto py-1"
                          onClick={() => {
                            setSelectedCategory(cat.categoryName || '');
                            setPage(1);
                          }}
                        >
                          <span className="truncate">{cat.categoryName || 'Uncategorized'}</span>
                          <span className="text-muted-foreground text-xs">
                            {cat.enabledCount}/{cat.count}
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => bulkCategoryMutation.mutate({
                            categoryName: cat.categoryName || '',
                            isEnabled: cat.enabledCount < cat.count
                          })}
                          title={cat.enabledCount < cat.count ? 'Enable all' : 'Disable all'}
                        >
                          {cat.enabledCount === cat.count ? (
                            <ToggleRight className="h-3 w-3 text-green-500" />
                          ) : (
                            <ToggleLeft className="h-3 w-3 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Main Content - Channel List */}
        <div className="lg:col-span-3 space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search channels..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(1);
                      }}
                      className="pl-10"
                    />
                  </div>
                </div>
                <Select value={enabledFilter} onValueChange={(v) => { setEnabledFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    <SelectItem value="true">Enabled</SelectItem>
                    <SelectItem value="false">Disabled</SelectItem>
                  </SelectContent>
                </Select>
                {selectedChannels.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{selectedChannels.size} selected</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => bulkUpdateMutation.mutate({ channelIds: Array.from(selectedChannels), isEnabled: true })}
                      disabled={bulkUpdateMutation.isPending}
                    >
                      Enable
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => bulkUpdateMutation.mutate({ channelIds: Array.from(selectedChannels), isEnabled: false })}
                      disabled={bulkUpdateMutation.isPending}
                    >
                      Disable
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Channels Table */}
          {!selectedProviderId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Tv className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select a provider to view channels</p>
              </CardContent>
            </Card>
          ) : channelsLoading ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              </CardContent>
            </Card>
          ) : channels.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Tv className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No channels found</p>
                <p className="text-sm">Try syncing channels from the provider</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={selectAll}
                          onCheckedChange={handleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="w-[80px]">Quality</TableHead>
                      <TableHead className="w-[80px] text-center">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channels.map((channel) => (
                      <TableRow key={channel.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedChannels.has(channel.id)}
                            onCheckedChange={(checked) => handleSelectChannel(channel.id, !!checked)}
                          />
                        </TableCell>
                        <TableCell>
                          {channel.logo ? (
                            <img
                              src={channel.logo}
                              alt=""
                              className="h-8 w-8 object-contain rounded"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="h-8 w-8 bg-muted rounded flex items-center justify-center">
                              <Tv className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{channel.name}</div>
                          <div className="text-xs text-muted-foreground">ID: {channel.streamId}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {channel.categoryName || '-'}
                        </TableCell>
                        <TableCell>
                          {channel.quality !== 'unknown' && (
                            <Badge variant="outline" className="uppercase">{channel.quality}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={channel.isEnabled}
                            onCheckedChange={(checked) => toggleChannelMutation.mutate({ channelId: channel.id, isEnabled: checked })}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {/* Pagination */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} channels
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm">
                      Page {pagination.page} of {pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                      disabled={page === pagination.totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
