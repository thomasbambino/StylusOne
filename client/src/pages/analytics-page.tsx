import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  BarChart3,
  Users,
  Tv,
  History,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Loader2,
  Play,
  Clock,
  Eye,
  TrendingUp,
  XCircle,
  Monitor,
  Smartphone,
  Tablet
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDistanceToNow } from 'date-fns';
import { buildApiUrl } from '@/lib/capacitor';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface ActiveStream {
  id: number;
  userId: number;
  username: string;
  email: string | null;
  channelId: string;
  channelName: string;
  channelLogo: string | null;
  credentialId: number;
  credentialName: string | null;
  startedAt: string;
  lastHeartbeat: string;
  ipAddress: string | null;
  deviceType: string | null;
}

interface LiveStats {
  activeStreams: number;
  uniqueViewersToday: number;
  watchTimeToday: number;
  sessionsToday: number;
}

interface ChannelStat {
  channelId: string;
  channelName: string | null;
  channelLogo: string | null;
  totalWatchTime: number;
  uniqueViewers: number;
  totalSessions: number;
  avgSessionDuration: number;
  currentViewers: number;
}

interface UserStat {
  userId: number;
  username: string;
  email: string | null;
  totalWatchTime: number;
  channelsWatched: number;
  totalSessions: number;
  lastWatched: string | null;
  isWatching: boolean;
  currentChannel: string | null;
}

interface HistoryEntry {
  id: number;
  userId: number;
  username: string;
  channelId: string;
  channelName: string | null;
  programTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  deviceType: string | null;
  ipAddress: string | null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Format date/time in local timezone with 12-hour format
 */
function formatLocalDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  }) + ', ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'ios':
    case 'android':
      return <Smartphone className="h-4 w-4" />;
    case 'tablet':
      return <Tablet className="h-4 w-4" />;
    default:
      return <Monitor className="h-4 w-4" />;
  }
}

export default function AnalyticsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('realtime');
  const [historyPage, setHistoryPage] = useState(1);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Real-time queries
  const { data: activeStreams = [], isLoading: streamsLoading, refetch: refetchStreams } = useQuery<ActiveStream[]>({
    queryKey: ['/api/admin/analytics/active-streams'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/analytics/active-streams'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch active streams');
      return res.json();
    },
    refetchInterval: activeTab === 'realtime' ? 10000 : false,
  });

  const { data: liveStats, isLoading: statsLoading } = useQuery<LiveStats>({
    queryKey: ['/api/admin/analytics/live-stats'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/analytics/live-stats'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch live stats');
      return res.json();
    },
    refetchInterval: activeTab === 'realtime' ? 10000 : false,
  });

  // Channel analytics
  const { data: channelStats = [], isLoading: channelsLoading } = useQuery<ChannelStat[]>({
    queryKey: ['/api/admin/analytics/channels', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      const res = await fetch(buildApiUrl(`/api/admin/analytics/channels?${params}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch channel analytics');
      return res.json();
    },
    enabled: activeTab === 'channels',
  });

  // User analytics
  const { data: userStats = [], isLoading: usersLoading } = useQuery<UserStat[]>({
    queryKey: ['/api/admin/analytics/users', dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      const res = await fetch(buildApiUrl(`/api/admin/analytics/users?${params}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch user analytics');
      return res.json();
    },
    enabled: activeTab === 'users',
  });

  // History
  const { data: historyData, isLoading: historyLoading } = useQuery<{
    history: HistoryEntry[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>({
    queryKey: ['/api/admin/analytics/history', historyPage, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: '50',
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      const res = await fetch(buildApiUrl(`/api/admin/analytics/history?${params}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    enabled: activeTab === 'history',
  });

  // Disconnect stream mutation
  const disconnectMutation = useMutation({
    mutationFn: async (streamId: number) => {
      const res = await fetch(buildApiUrl(`/api/admin/analytics/active-streams/${streamId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to disconnect stream');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics/active-streams'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics/live-stats'] });
      toast({ title: 'Stream disconnected' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/analytics/export'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        }),
      });
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `viewing-history-${dateRange.startDate}-to-${dateRange.endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => {
      toast({ title: 'Export complete', description: 'CSV file downloaded' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/analytics/history'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          confirm: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to delete history');
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics'] });
      setIsDeleteDialogOpen(false);
      setDeleteConfirmText('');
      toast({ title: 'Deleted', description: `${data.deleted} records removed` });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  // Prepare chart data for top 10 channels
  const chartData = channelStats.slice(0, 10).map((stat) => ({
    name: stat.channelName || stat.channelId,
    hours: Math.round(stat.totalWatchTime / 3600 * 10) / 10,
  }));

  return (
    <div className="container mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">Viewing history and stream analytics</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Export CSV
          </Button>
          <Button
            variant="destructive"
            onClick={() => setIsDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Data
          </Button>
        </div>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label>From</Label>
              <Input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label>To</Label>
              <Input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="w-40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 lg:w-[400px]">
          <TabsTrigger value="realtime" className="flex items-center gap-2">
            <Play className="h-4 w-4" />
            Real-Time
          </TabsTrigger>
          <TabsTrigger value="channels" className="flex items-center gap-2">
            <Tv className="h-4 w-4" />
            Channels
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Real-Time Tab */}
        <TabsContent value="realtime" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Streams</CardTitle>
                <Play className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{liveStats?.activeStreams ?? 0}</div>
                <p className="text-xs text-muted-foreground">Currently watching</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Unique Viewers</CardTitle>
                <Eye className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{liveStats?.uniqueViewersToday ?? 0}</div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Watch Time</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatDuration(liveStats?.watchTimeToday ?? 0)}
                </div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sessions</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{liveStats?.sessionsToday ?? 0}</div>
                <p className="text-xs text-muted-foreground">Today</p>
              </CardContent>
            </Card>
          </div>

          {/* Active Streams Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Active Streams</CardTitle>
                <CardDescription>Currently playing streams</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchStreams()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              {streamsLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : activeStreams.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  No active streams
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Device</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeStreams.map((stream) => (
                      <TableRow key={stream.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{stream.username}</p>
                            {stream.email && (
                              <p className="text-xs text-muted-foreground">{stream.email}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {stream.channelLogo && (
                              <img src={stream.channelLogo} alt="" className="h-8 w-auto max-w-[48px] object-contain rounded" />
                            )}
                            <span>{stream.channelName}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(stream.startedAt))}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {getDeviceIcon(stream.deviceType)}
                            <span className="text-xs">{stream.deviceType || 'web'}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {stream.ipAddress || '-'}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disconnectMutation.mutate(stream.id)}
                            disabled={disconnectMutation.isPending}
                          >
                            <XCircle className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-4">
          {/* Chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Top Channels by Watch Time</CardTitle>
                <CardDescription>Hours watched per channel</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={150} />
                      <Tooltip />
                      <Bar dataKey="hours" fill="#8884d8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Channels Table */}
          <Card>
            <CardHeader>
              <CardTitle>Channel Statistics</CardTitle>
              <CardDescription>Viewing statistics by channel</CardDescription>
            </CardHeader>
            <CardContent>
              {channelsLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : channelStats.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  No channel data available
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Watch Time</TableHead>
                      <TableHead className="text-right">Unique Viewers</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead className="text-right">Avg Duration</TableHead>
                      <TableHead className="text-right">Now Watching</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {channelStats.map((stat) => (
                      <TableRow key={stat.channelId}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {stat.channelLogo && (
                              <img src={stat.channelLogo} alt="" className="h-8 w-auto max-w-[48px] object-contain rounded" />
                            )}
                            <span>{stat.channelName || stat.channelId}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatDuration(stat.totalWatchTime)}</TableCell>
                        <TableCell className="text-right">{stat.uniqueViewers}</TableCell>
                        <TableCell className="text-right">{stat.totalSessions}</TableCell>
                        <TableCell className="text-right">{formatDuration(stat.avgSessionDuration)}</TableCell>
                        <TableCell className="text-right">
                          {stat.currentViewers > 0 ? (
                            <Badge variant="default">{stat.currentViewers}</Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>User Statistics</CardTitle>
              <CardDescription>Viewing statistics by user</CardDescription>
            </CardHeader>
            <CardContent>
              {usersLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : userStats.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  No user data available
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Watch Time</TableHead>
                      <TableHead className="text-right">Channels</TableHead>
                      <TableHead className="text-right">Sessions</TableHead>
                      <TableHead>Last Active</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userStats.map((stat) => (
                      <TableRow key={stat.userId}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{stat.username}</p>
                            {stat.email && (
                              <p className="text-xs text-muted-foreground">{stat.email}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{formatDuration(stat.totalWatchTime)}</TableCell>
                        <TableCell className="text-right">{stat.channelsWatched}</TableCell>
                        <TableCell className="text-right">{stat.totalSessions}</TableCell>
                        <TableCell>
                          {stat.isWatching
                            ? 'Now'
                            : stat.lastWatched
                              ? formatDistanceToNow(new Date(stat.lastWatched), { addSuffix: true })
                              : '-'
                          }
                        </TableCell>
                        <TableCell>
                          {stat.isWatching ? (
                            <Badge variant="default" className="bg-green-600">
                              <Play className="h-3 w-3 mr-1" />
                              {stat.currentChannel || 'Watching'}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Offline</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Viewing History</CardTitle>
              <CardDescription>Complete watch history log</CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !historyData?.history?.length ? (
                <div className="text-center p-8 text-muted-foreground">
                  No history available
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date/Time</TableHead>
                        <TableHead>User</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Program</TableHead>
                        <TableHead className="text-right">Duration</TableHead>
                        <TableHead>Device</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyData.history.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-sm">
                            {formatLocalDateTime(entry.startedAt)}
                          </TableCell>
                          <TableCell>{entry.username}</TableCell>
                          <TableCell>{entry.channelName || entry.channelId}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {entry.programTitle || '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {entry.durationSeconds ? formatDuration(entry.durationSeconds) : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {getDeviceIcon(entry.deviceType)}
                              <span className="text-xs">{entry.deviceType || 'web'}</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  {historyData.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">
                        Page {historyData.pagination.page} of {historyData.pagination.totalPages}
                        {' '}({historyData.pagination.total} total)
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                          disabled={historyPage === 1}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setHistoryPage((p) => p + 1)}
                          disabled={historyPage >= historyData.pagination.totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Viewing History</DialogTitle>
            <DialogDescription>
              This will permanently delete all viewing history from {dateRange.startDate} to {dateRange.endDate}.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Type "DELETE" to confirm</Label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteConfirmText !== 'DELETE' || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete Data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
