import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2, Loader2, Package, Tv, Search, X, ChevronLeft, ChevronRight, MoreVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { buildApiUrl } from '@/lib/capacitor';
import { ScrollArea } from '@/components/ui/scroll-area';

interface IptvProvider {
  id: number;
  name: string;
  enabledChannelCount: number;
}

interface ChannelPackage {
  id: number;
  providerId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  channelCount: number;
  providerName: string;
  createdAt: string;
  updatedAt: string;
}

interface PackageChannel {
  id: number;
  streamId: string;
  name: string;
  logo: string | null;
  categoryName: string | null;
  quality: string;
  sortOrder: number;
}

interface IptvChannel {
  id: number;
  streamId: string;
  name: string;
  logo: string | null;
  categoryName: string | null;
  quality: string;
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

interface PackageFormData {
  providerId: string;
  name: string;
  description: string;
  isActive: boolean;
}

const defaultFormData: PackageFormData = {
  providerId: '',
  name: '',
  description: '',
  isActive: true,
};

export default function IptvPackagesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddChannelsDialogOpen, setIsAddChannelsDialogOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<ChannelPackage | null>(null);
  const [formData, setFormData] = useState<PackageFormData>(defaultFormData);

  // For add channels dialog
  const [channelSearch, setChannelSearch] = useState('');
  const [channelPage, setChannelPage] = useState(1);
  const [selectedChannelsToAdd, setSelectedChannelsToAdd] = useState<Set<number>>(new Set());

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

  // Fetch packages
  const { data: packages = [], isLoading } = useQuery<ChannelPackage[]>({
    queryKey: ['/api/admin/channel-packages'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/channel-packages'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch packages');
      return res.json();
    },
  });

  // Fetch package details with channels
  const { data: packageDetails } = useQuery<ChannelPackage & { channels: PackageChannel[] }>({
    queryKey: ['/api/admin/channel-packages', selectedPackage?.id],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/channel-packages/${selectedPackage?.id}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch package details');
      return res.json();
    },
    enabled: !!selectedPackage && (isEditDialogOpen || isAddChannelsDialogOpen),
  });

  // Fetch available channels for adding to package
  const channelQueryParams = useMemo(() => {
    if (!selectedPackage) return '';
    const params = new URLSearchParams();
    params.set('providerId', selectedPackage.providerId.toString());
    params.set('enabled', 'true');
    if (channelSearch) params.set('search', channelSearch);
    params.set('page', channelPage.toString());
    params.set('limit', '50');
    return params.toString();
  }, [selectedPackage, channelSearch, channelPage]);

  const { data: availableChannelsData, isLoading: channelsLoading } = useQuery<PaginatedResponse>({
    queryKey: ['/api/admin/iptv-channels', channelQueryParams],
    queryFn: async () => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-channels?${channelQueryParams}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch channels');
      return res.json();
    },
    enabled: isAddChannelsDialogOpen && !!selectedPackage,
  });

  // Create package
  const createMutation = useMutation({
    mutationFn: async (data: PackageFormData) => {
      const res = await fetch(buildApiUrl('/api/admin/channel-packages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          providerId: parseInt(data.providerId),
          name: data.name,
          description: data.description || undefined,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create package');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-packages'] });
      setIsCreateDialogOpen(false);
      setFormData(defaultFormData);
      toast({ title: 'Success', description: 'Package created successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Update package - uses POST endpoint for better Cloudflare compatibility
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: PackageFormData }) => {
      // Use POST endpoint which has better compatibility with Cloudflare/WAF
      const url = buildApiUrl(`/api/admin/channel-packages/${id}/update`);
      console.log('[UPDATE-PACKAGE] Calling POST', url, data);
      const body = JSON.stringify({
        name: data.name,
        description: data.description || null,
        isActive: data.isActive,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
      });
      console.log('[UPDATE-PACKAGE] Response:', res.status, res.statusText);
      if (!res.ok) {
        const contentType = res.headers.get('content-type');
        console.log('[UPDATE-PACKAGE] Error content-type:', contentType);
        if (contentType && contentType.includes('application/json')) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to update package');
        } else {
          const text = await res.text();
          console.log('[UPDATE-PACKAGE] Non-JSON response:', text.substring(0, 200));
          throw new Error(`Server error: ${res.status} ${res.statusText}`);
        }
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-packages'] });
      setIsEditDialogOpen(false);
      setSelectedPackage(null);
      setFormData(defaultFormData);
      toast({ title: 'Success', description: 'Package updated successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete package
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/channel-packages/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete package');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-packages'] });
      toast({ title: 'Success', description: 'Package deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Add channels to package
  const addChannelsMutation = useMutation({
    mutationFn: async ({ packageId, channelIds }: { packageId: number; channelIds: number[] }) => {
      const res = await fetch(buildApiUrl(`/api/admin/channel-packages/${packageId}/channels`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channelIds }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add channels');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-packages'] });
      setSelectedChannelsToAdd(new Set());
      toast({ title: 'Success', description: `Added ${data.added} channels to package` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Remove channel from package - uses optimistic updates for instant UI feedback
  const removeChannelMutation = useMutation({
    mutationFn: async ({ packageId, channelId }: { packageId: number; channelId: number }) => {
      const res = await fetch(buildApiUrl(`/api/admin/channel-packages/${packageId}/channels/${channelId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to remove channel');
        } else {
          throw new Error(`Server error: ${res.status} ${res.statusText}`);
        }
      }
      return res.json();
    },
    // Optimistic update - immediately remove from UI
    onMutate: async ({ packageId, channelId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/admin/channel-packages', packageId] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData(['/api/admin/channel-packages', packageId]);

      // Optimistically update the cache
      queryClient.setQueryData(['/api/admin/channel-packages', packageId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          channels: old.channels?.filter((c: any) => c.id !== channelId) || [],
        };
      });

      return { previousData, packageId };
    },
    onError: (error: Error, _variables, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['/api/admin/channel-packages', context.packageId], context.previousData);
      }
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
    onSettled: (_data, _error, variables) => {
      // Refetch to ensure consistency (but UI already updated)
      queryClient.invalidateQueries({ queryKey: ['/api/admin/channel-packages'] });
    },
  });

  const handleEdit = (pkg: ChannelPackage) => {
    setSelectedPackage(pkg);
    setFormData({
      providerId: pkg.providerId.toString(),
      name: pkg.name,
      description: pkg.description || '',
      isActive: pkg.isActive,
    });
    setIsEditDialogOpen(true);
  };

  const handleAddChannels = (pkg: ChannelPackage) => {
    setSelectedPackage(pkg);
    setChannelSearch('');
    setChannelPage(1);
    setSelectedChannelsToAdd(new Set());
    setIsAddChannelsDialogOpen(true);
  };

  const handleToggleChannelSelection = (channelId: number) => {
    setSelectedChannelsToAdd(prev => {
      const newSet = new Set(prev);
      if (newSet.has(channelId)) {
        newSet.delete(channelId);
      } else {
        newSet.add(channelId);
      }
      return newSet;
    });
  };

  // Get IDs of channels already in the package
  const existingChannelIds = new Set(packageDetails?.channels?.map(c => c.id) || []);
  const availableChannels = availableChannelsData?.channels.filter(c => !existingChannelIds.has(c.id)) || [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Channel Packages</h1>
          <p className="text-muted-foreground">Create and manage channel packages for subscription plans</p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Package
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : packages.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No channel packages created</p>
            <p className="text-sm">Create a package to organize channels</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <Card key={pkg.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {pkg.name}
                      {pkg.isActive ? (
                        <Badge variant="default" className="bg-green-500 text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {pkg.providerName}
                    </CardDescription>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEdit(pkg)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddChannels(pkg)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Channels
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          if (confirm(`Delete package "${pkg.name}"?`)) {
                            deleteMutation.mutate(pkg.id);
                          }
                        }}
                        className="text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                {pkg.description && (
                  <p className="text-sm text-muted-foreground mb-3">{pkg.description}</p>
                )}
                <div className="flex items-center gap-2">
                  <Tv className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{pkg.channelCount} channels</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Package Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Channel Package</DialogTitle>
            <DialogDescription>Create a new channel package from a provider</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Provider</Label>
              <Select
                value={formData.providerId}
                onValueChange={(v) => setFormData({ ...formData, providerId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.name} ({p.enabledChannelCount} enabled)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="name">Package Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Basic TV Package"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(formData)} disabled={createMutation.isPending || !formData.providerId || !formData.name}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Package Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Package: {selectedPackage?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <div className="space-y-4 mb-6">
              <div>
                <Label htmlFor="edit-name">Package Name</Label>
                <Input
                  id="edit-name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label>Active</Label>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label>Channels ({packageDetails?.channels?.length || 0})</Label>
                <Button variant="outline" size="sm" onClick={() => selectedPackage && handleAddChannels(selectedPackage)}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Channels
                </Button>
              </div>
              <ScrollArea className="h-[250px] border rounded-md">
                {packageDetails?.channels?.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    No channels in this package
                  </div>
                ) : (
                  <Table>
                    <TableBody>
                      {packageDetails?.channels?.map((channel) => (
                        <TableRow key={channel.id}>
                          <TableCell className="w-[50px]">
                            {channel.logo ? (
                              <img src={channel.logo} alt="" className="h-6 w-6 object-contain rounded" />
                            ) : (
                              <Tv className="h-6 w-6 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell>{channel.name}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{channel.categoryName || '-'}</TableCell>
                          <TableCell className="w-[50px]">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => selectedPackage && removeChannelMutation.mutate({ packageId: selectedPackage.id, channelId: channel.id })}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ScrollArea>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedPackage && updateMutation.mutate({ id: selectedPackage.id, data: formData })}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Channels Dialog */}
      <Dialog open={isAddChannelsDialogOpen} onOpenChange={setIsAddChannelsDialogOpen}>
        <DialogContent className="max-w-2xl h-[80vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Add Channels to {selectedPackage?.name}</DialogTitle>
            <DialogDescription>Select enabled channels from the provider to add to this package</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-4 flex-shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search channels..."
                  value={channelSearch}
                  onChange={(e) => {
                    setChannelSearch(e.target.value);
                    setChannelPage(1);
                  }}
                  className="pl-10"
                />
              </div>
              {selectedChannelsToAdd.size > 0 && (
                <Badge variant="secondary">{selectedChannelsToAdd.size} selected</Badge>
              )}
            </div>
            <div className="flex-1 min-h-0 border rounded-md overflow-hidden">
              <ScrollArea className="h-full">
              {channelsLoading ? (
                <div className="p-8 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              ) : availableChannels.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {channelSearch ? 'No matching channels found' : 'All enabled channels are already in this package'}
                </div>
              ) : (
                <Table>
                  <TableBody>
                    {availableChannels.map((channel) => (
                      <TableRow
                        key={channel.id}
                        className="cursor-pointer"
                        onClick={() => handleToggleChannelSelection(channel.id)}
                      >
                        <TableCell className="w-[40px]">
                          <Checkbox
                            checked={selectedChannelsToAdd.has(channel.id)}
                            onCheckedChange={() => handleToggleChannelSelection(channel.id)}
                          />
                        </TableCell>
                        <TableCell className="w-[50px]">
                          {channel.logo ? (
                            <img src={channel.logo} alt="" className="h-6 w-6 object-contain rounded" />
                          ) : (
                            <Tv className="h-6 w-6 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell>{channel.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{channel.categoryName || '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              </ScrollArea>
            </div>
            {availableChannelsData?.pagination && availableChannelsData.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between mt-2 pt-2 border-t flex-shrink-0">
                <p className="text-xs text-muted-foreground">
                  Page {availableChannelsData.pagination.page} of {availableChannelsData.pagination.totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setChannelPage(p => Math.max(1, p - 1))}
                    disabled={channelPage === 1}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setChannelPage(p => p + 1)}
                    disabled={channelPage >= availableChannelsData.pagination.totalPages}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={() => setIsAddChannelsDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedPackage && addChannelsMutation.mutate({ packageId: selectedPackage.id, channelIds: Array.from(selectedChannelsToAdd) })}
              disabled={addChannelsMutation.isPending || selectedChannelsToAdd.size === 0}
            >
              {addChannelsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add {selectedChannelsToAdd.size} Channels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
