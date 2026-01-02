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
import { Plus, Edit2, Trash2, Wifi, WifiOff, Server, Users, RefreshCw, Loader2, MoreVertical, CheckCircle2, XCircle, AlertCircle, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { buildApiUrl } from '@/lib/capacitor';

interface IptvCredential {
  id: number;
  name: string;
  serverUrl: string;
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

interface ActiveStream {
  id: number;
  credentialId: number;
  userId: number;
  streamId: string;
  sessionToken: string;
  startedAt: string;
  lastHeartbeat: string;
  ipAddress: string | null;
}

interface CredentialFormData {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  maxConnections: string;
  notes: string;
  isActive: boolean;
}

const defaultFormData: CredentialFormData = {
  name: '',
  serverUrl: '',
  username: '',
  password: '',
  maxConnections: '1',
  notes: '',
  isActive: true,
};

export default function IptvCredentialsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isStreamsDialogOpen, setIsStreamsDialogOpen] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState<IptvCredential | null>(null);
  const [formData, setFormData] = useState<CredentialFormData>(defaultFormData);
  const [testingCredentialId, setTestingCredentialId] = useState<number | null>(null);

  const { data: credentials = [], isLoading } = useQuery<IptvCredential[]>({
    queryKey: ['/api/admin/iptv-credentials'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-credentials'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch credentials');
      return res.json();
    },
  });

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

  const createMutation = useMutation({
    mutationFn: async (data: CredentialFormData) => {
      const res = await fetch(buildApiUrl('/api/admin/iptv-credentials'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          serverUrl: data.serverUrl,
          username: data.username,
          password: data.password,
          maxConnections: parseInt(data.maxConnections),
          notes: data.notes || undefined,
          isActive: data.isActive,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create credential');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      setIsCreateDialogOpen(false);
      setFormData(defaultFormData);
      toast({
        title: 'Success',
        description: 'IPTV credential created successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: CredentialFormData }) => {
      const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: data.name,
          serverUrl: data.serverUrl,
          username: data.username,
          password: data.password || undefined, // Only send if changed
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      setIsEditDialogOpen(false);
      setSelectedCredential(null);
      setFormData(defaultFormData);
      toast({
        title: 'Success',
        description: 'IPTV credential updated successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      toast({
        title: 'Success',
        description: 'IPTV credential deleted successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const testMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      setTestingCredentialId(null);
      if (data.success) {
        toast({
          title: 'Connection Successful',
          description: `Status: ${data.status}${data.expiration ? `, Expires: ${format(new Date(data.expiration), 'PPP')}` : ''}`,
        });
      } else {
        toast({
          title: 'Connection Failed',
          description: data.error || 'Unable to connect to IPTV server',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      setTestingCredentialId(null);
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const disconnectAllMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['/api/admin/iptv-credentials'] });
      toast({
        title: 'Streams Disconnected',
        description: `${data.disconnected} stream(s) disconnected`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleEdit = async (credential: IptvCredential) => {
    const res = await fetch(buildApiUrl(`/api/admin/iptv-credentials/${credential.id}`), {
      credentials: 'include',
    });
    if (res.ok) {
      const data = await res.json();
      setFormData({
        name: data.name,
        serverUrl: data.serverUrl,
        username: data.username,
        password: '', // Don't show existing password
        maxConnections: data.maxConnections.toString(),
        notes: data.notes || '',
        isActive: data.isActive,
      });
      setSelectedCredential(credential);
      setIsEditDialogOpen(true);
    }
  };

  const handleViewStreams = (credential: IptvCredential) => {
    setSelectedCredential(credential);
    setIsStreamsDialogOpen(true);
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'unhealthy':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getHealthBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Healthy</Badge>;
      case 'unhealthy':
        return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Unhealthy</Badge>;
      default:
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Unknown</Badge>;
    }
  };

  const totalConnections = credentials.reduce((sum, c) => sum + c.maxConnections, 0);
  const totalActiveStreams = credentials.reduce((sum, c) => sum + c.activeStreams, 0);
  const healthyCredentials = credentials.filter(c => c.healthStatus === 'healthy').length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">IPTV Credentials</h1>
          <p className="text-muted-foreground">Manage IPTV provider credentials for subscription plans</p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Credential
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Credentials</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{credentials.length}</div>
            <p className="text-xs text-muted-foreground">{healthyCredentials} healthy</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Max Connections</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalConnections}</div>
            <p className="text-xs text-muted-foreground">across all credentials</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalActiveStreams}</div>
            <p className="text-xs text-muted-foreground">{totalConnections - totalActiveStreams} available</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Utilization</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalConnections > 0 ? Math.round((totalActiveStreams / totalConnections) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">stream capacity used</p>
          </CardContent>
        </Card>
      </div>

      {/* Credentials Table */}
      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>IPTV provider credentials and their status</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : credentials.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No IPTV credentials configured. Add your first credential to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead className="text-center">Connections</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((credential) => (
                  <TableRow key={credential.id}>
                    <TableCell className="font-medium">{credential.name}</TableCell>
                    <TableCell className="font-mono text-sm">{credential.serverUrl}</TableCell>
                    <TableCell className="font-mono text-sm">{credential.username}</TableCell>
                    <TableCell className="text-center">{credential.maxConnections}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={credential.activeStreams > 0 ? "default" : "secondary"}>
                        {credential.activeStreams}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getHealthIcon(credential.healthStatus)}
                        <span className="text-sm capitalize">{credential.healthStatus}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {credential.isActive ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-500/10 text-gray-500 border-gray-500/20">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(credential)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => testMutation.mutate(credential.id)}>
                            <RefreshCw className={`h-4 w-4 mr-2 ${testingCredentialId === credential.id ? 'animate-spin' : ''}`} />
                            Test Connection
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleViewStreams(credential)}>
                            <Eye className="h-4 w-4 mr-2" />
                            View Streams
                          </DropdownMenuItem>
                          {credential.activeStreams > 0 && (
                            <DropdownMenuItem onClick={() => disconnectAllMutation.mutate(credential.id)}>
                              <WifiOff className="h-4 w-4 mr-2" />
                              Disconnect All
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this credential?')) {
                                deleteMutation.mutate(credential.id);
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
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isCreateDialogOpen || isEditDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsCreateDialogOpen(false);
          setIsEditDialogOpen(false);
          setSelectedCredential(null);
          setFormData(defaultFormData);
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{isEditDialogOpen ? 'Edit Credential' : 'Add IPTV Credential'}</DialogTitle>
            <DialogDescription>
              {isEditDialogOpen
                ? 'Update the IPTV credential details. Leave password empty to keep existing.'
                : 'Add a new IPTV provider credential.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="My IPTV Provider"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="serverUrl">Server URL</Label>
              <Input
                id="serverUrl"
                placeholder="http://provider.example.com"
                value={formData.serverUrl}
                onChange={(e) => setFormData({ ...formData, serverUrl: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder={isEditDialogOpen ? '(unchanged)' : ''}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="maxConnections">Max Concurrent Connections</Label>
              <Input
                id="maxConnections"
                type="number"
                min="1"
                max="10"
                value={formData.maxConnections}
                onChange={(e) => setFormData({ ...formData, maxConnections: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of simultaneous streams allowed
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Optional notes about this credential..."
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
              />
              <Label htmlFor="isActive">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateDialogOpen(false);
                setIsEditDialogOpen(false);
                setSelectedCredential(null);
                setFormData(defaultFormData);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (isEditDialogOpen && selectedCredential) {
                  updateMutation.mutate({ id: selectedCredential.id, data: formData });
                } else {
                  createMutation.mutate(formData);
                }
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isEditDialogOpen ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Active Streams Dialog */}
      <Dialog open={isStreamsDialogOpen} onOpenChange={setIsStreamsDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Active Streams - {selectedCredential?.name}</DialogTitle>
            <DialogDescription>
              Currently active streams using this credential
            </DialogDescription>
          </DialogHeader>

          {streamsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : streamsData?.streams?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active streams
            </div>
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
                  {streamsData?.streams?.map((stream: ActiveStream) => (
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
            <Button variant="outline" onClick={() => setIsStreamsDialogOpen(false)}>
              Close
            </Button>
            {streamsData?.streams?.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (selectedCredential) {
                    disconnectAllMutation.mutate(selectedCredential.id);
                    setIsStreamsDialogOpen(false);
                  }
                }}
              >
                <WifiOff className="h-4 w-4 mr-2" />
                Disconnect All
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
