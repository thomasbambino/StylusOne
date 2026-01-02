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
import { Plus, Edit2, Trash2, Users, DollarSign, Package, Check, X, Loader2, MoreVertical, Tv, Book, Gamepad2, CheckCircle2, XCircle, Calendar, TrendingUp, Server } from 'lucide-react';
import type { SubscriptionPlan } from '@shared/schema';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import { buildApiUrl } from '@/lib/capacitor';

interface PlanFormData {
  name: string;
  description: string;
  price_monthly: string;
  price_annual: string;
  features: {
    plex_access: boolean;
    live_tv_access: boolean;
    books_access: boolean;
    game_servers_access: boolean;
    max_favorite_channels: string;
  };
  is_active: boolean;
  sort_order: string;
}

const defaultFormData: PlanFormData = {
  name: '',
  description: '',
  price_monthly: '',
  price_annual: '',
  features: {
    plex_access: false,
    live_tv_access: false,
    books_access: false,
    game_servers_access: false,
    max_favorite_channels: '0',
  },
  is_active: true,
  sort_order: '0',
};

export default function SubscriptionPlansPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [formData, setFormData] = useState<PlanFormData>(defaultFormData);
  const [viewUsersDialog, setViewUsersDialog] = useState<{ open: boolean; planId: number; planName: string }>({
    open: false,
    planId: 0,
    planName: '',
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/admin/subscription-plans'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/subscription-plans'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch plans');
      return res.json();
    },
  });

  const { data: analytics } = useQuery({
    queryKey: ['/api/admin/analytics/mrr'],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/admin/analytics/mrr'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
  });

  const { data: planUsers = [], isLoading: planUsersLoading } = useQuery({
    queryKey: ['/api/admin/analytics/plans', viewUsersDialog.planId, 'users'],
    queryFn: async () => {
      console.log('Fetching users for plan:', viewUsersDialog.planId, viewUsersDialog.planName);
      const res = await fetch(buildApiUrl(`/api/admin/analytics/plans/${viewUsersDialog.planId}/users`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch plan users');
      const data = await res.json();
      console.log('Received plan users:', data);
      return data;
    },
    enabled: viewUsersDialog.open && viewUsersDialog.planId > 0,
  });

  const createPlanMutation = useMutation({
    mutationFn: async (data: PlanFormData) => {
      const res = await fetch('/api/admin/subscription-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          price_monthly: Math.round(parseFloat(data.price_monthly) * 100),
          price_annual: Math.round(parseFloat(data.price_annual) * 100),
          features: {
            ...data.features,
            max_favorite_channels: parseInt(data.features.max_favorite_channels),
          },
          is_active: data.is_active,
          sort_order: parseInt(data.sort_order),
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create plan');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-plans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics/mrr'] });
      setIsCreateDialogOpen(false);
      setFormData(defaultFormData);
      toast({
        title: 'Success',
        description: 'Subscription plan created successfully',
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

  const updatePlanMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: PlanFormData }) => {
      const res = await fetch(`/api/admin/subscription-plans/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          price_monthly: Math.round(parseFloat(data.price_monthly) * 100),
          price_annual: Math.round(parseFloat(data.price_annual) * 100),
          features: {
            ...data.features,
            max_favorite_channels: parseInt(data.features.max_favorite_channels),
          },
          is_active: data.is_active,
          sort_order: parseInt(data.sort_order),
        }),
      });
      if (!res.ok) throw new Error('Failed to update plan');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-plans'] });
      setIsEditDialogOpen(false);
      setSelectedPlan(null);
      setFormData(defaultFormData);
      toast({
        title: 'Success',
        description: 'Subscription plan updated successfully',
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

  const deletePlanMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/subscription-plans/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete plan');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-plans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/analytics/mrr'] });
      toast({
        title: 'Success',
        description: 'Subscription plan deleted successfully',
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

  const togglePlanMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/subscriptions/admin/plans/${id}/toggle`, {
        method: 'PATCH',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to toggle plan status');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/subscription-plans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/plans'] });
      toast({
        title: 'Success',
        description: data.message || 'Plan status updated successfully',
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

  const handleEdit = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setFormData({
      name: plan.name,
      description: plan.description || '',
      price_monthly: (plan.price_monthly / 100).toFixed(2),
      price_annual: (plan.price_annual / 100).toFixed(2),
      features: {
        ...plan.features,
        max_favorite_channels: plan.features.max_favorite_channels.toString(),
      },
      is_active: plan.is_active,
      sort_order: plan.sort_order.toString(),
    });
    setIsEditDialogOpen(true);
  };

  const handleDelete = (plan: SubscriptionPlan) => {
    if (confirm(`Are you sure you want to delete the "${plan.name}" plan? This action cannot be undone.`)) {
      deletePlanMutation.mutate(plan.id);
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createPlanMutation.mutate(formData);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPlan) {
      updatePlanMutation.mutate({ id: selectedPlan.id, data: formData });
    }
  };

  const getFeatureIcons = (plan: SubscriptionPlan) => {
    const features = [];
    if (plan.features.plex_access) features.push({ icon: Package, label: 'Plex' });
    if (plan.features.live_tv_access) features.push({ icon: Tv, label: 'Live TV' });
    if (plan.features.books_access) features.push({ icon: Book, label: 'Books' });
    if (plan.features.game_servers_access) features.push({ icon: Gamepad2, label: 'Game Servers' });
    return features;
  };

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Subscription Plans</h1>
          <p className="text-muted-foreground mt-1">Manage subscription plans and pricing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.href = '/iptv-credentials'}>
            <Server className="h-4 w-4 mr-2" />
            IPTV Sources
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Plan
          </Button>
        </div>
      </div>

      {/* Analytics */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Daily Revenue</CardTitle>
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${analytics.dailyRevenue?.toFixed(2) || '0.00'}</div>
              <p className="text-xs text-muted-foreground mt-1">Avg per day</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Revenue</CardTitle>
              <DollarSign className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${analytics.totalMRR?.toFixed(2) || '0.00'}</div>
              <p className="text-xs text-muted-foreground mt-1">MRR</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Annual Revenue</CardTitle>
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${analytics.totalARR?.toFixed(2) || '0.00'}</div>
              <p className="text-xs text-muted-foreground mt-1">ARR</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Subscribers</CardTitle>
              <Users className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalActiveSubscribers || 0}</div>
              <p className="text-xs text-muted-foreground mt-1">Users</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Available Plans</CardTitle>
              <Package className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{plans.filter(p => p.is_active).length} / {plans.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Active / Total</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plans Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Plans</h2>
        {plansLoading ? (
          <div className="text-center py-12">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No subscription plans yet</p>
                <p className="text-sm mt-1">Create your first plan to get started.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[250px]">Plan</TableHead>
                    <TableHead>Monthly Price</TableHead>
                    <TableHead>Annual Price</TableHead>
                    <TableHead>Features</TableHead>
                    <TableHead>Max Channels</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((plan) => {
                      const featureIcons = getFeatureIcons(plan);
                      return (
                        <TableRow
                          key={plan.id}
                          className={`cursor-pointer hover:bg-muted/50 ${!plan.is_active ? 'opacity-60' : ''}`}
                          onClick={() => setViewUsersDialog({ open: true, planId: plan.id, planName: plan.name })}
                        >
                          <TableCell>
                            <div>
                              <div className="font-medium">{plan.name}</div>
                              {plan.description && (
                                <div className="text-sm text-muted-foreground line-clamp-2 max-w-[230px]">
                                  {plan.description}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              ${(plan.price_monthly / 100).toFixed(2)}
                            </div>
                            <div className="text-sm text-muted-foreground">/month</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">
                              ${(plan.price_annual / 100).toFixed(2)}
                            </div>
                            <div className="text-sm text-muted-foreground">/year</div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              {featureIcons.map((feature, idx) => {
                                const Icon = feature.icon;
                                return (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-secondary"
                                    title={feature.label}
                                  >
                                    <Icon className="h-3 w-3" />
                                    <span>{feature.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">{plan.features.max_favorite_channels}</span>
                          </TableCell>
                          <TableCell>
                            {plan.is_active ? (
                              <Badge variant="default" className="flex items-center gap-1 w-fit bg-green-600">
                                <CheckCircle2 className="h-3 w-3" />
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                                <XCircle className="h-3 w-3" />
                                Inactive
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => togglePlanMutation.mutate(plan.id)}>
                                  {plan.is_active ? (
                                    <>
                                      <XCircle className="h-4 w-4 mr-2" />
                                      Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-4 w-4 mr-2" />
                                      Activate
                                    </>
                                  )}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleEdit(plan)}>
                                  <Edit2 className="h-4 w-4 mr-2" />
                                  Edit Plan
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDelete(plan)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Plan
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Plan Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Create Subscription Plan</DialogTitle>
              <DialogDescription>
                Create a new subscription plan with custom pricing and features
              </DialogDescription>
            </DialogHeader>

            <div className="my-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Plan Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Basic, Premium, Enterprise"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe what's included in this plan"
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* Pricing */}
              <div className="space-y-4">
                <h4 className="font-medium">Pricing</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="price_monthly">Monthly Price ($)</Label>
                    <Input
                      id="price_monthly"
                      type="number"
                      step="0.01"
                      value={formData.price_monthly}
                      onChange={(e) => setFormData({ ...formData, price_monthly: e.target.value })}
                      placeholder="9.99"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="price_annual">Annual Price ($)</Label>
                    <Input
                      id="price_annual"
                      type="number"
                      step="0.01"
                      value={formData.price_annual}
                      onChange={(e) => setFormData({ ...formData, price_annual: e.target.value })}
                      placeholder="99.99"
                      required
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Features */}
              <div className="space-y-4">
                <h4 className="font-medium">Features</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="plex_access" className="font-normal">Plex Access</Label>
                    <Switch
                      id="plex_access"
                      checked={formData.features.plex_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, plex_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="live_tv_access" className="font-normal">Live TV Access</Label>
                    <Switch
                      id="live_tv_access"
                      checked={formData.features.live_tv_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, live_tv_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="books_access" className="font-normal">Books Access</Label>
                    <Switch
                      id="books_access"
                      checked={formData.features.books_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, books_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="game_servers_access" className="font-normal">Game Servers Access</Label>
                    <Switch
                      id="game_servers_access"
                      checked={formData.features.game_servers_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, game_servers_access: checked }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="max_favorite_channels">Max Favorite Channels</Label>
                    <Input
                      id="max_favorite_channels"
                      type="number"
                      value={formData.features.max_favorite_channels}
                      onChange={(e) => setFormData({
                        ...formData,
                        features: { ...formData.features, max_favorite_channels: e.target.value }
                      })}
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="is_active" className="font-normal">Plan Active</Label>
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>
                <div>
                  <Label htmlFor="sort_order">Sort Order</Label>
                  <Input
                    id="sort_order"
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPlanMutation.isPending}>
                {createPlanMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Plan'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Plan Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Subscription Plan</DialogTitle>
              <DialogDescription>
                Update plan details, pricing, and features
              </DialogDescription>
            </DialogHeader>

            <div className="my-6 space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="edit-name">Plan Name</Label>
                  <Input
                    id="edit-name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Basic, Premium, Enterprise"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea
                    id="edit-description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe what's included in this plan"
                    rows={2}
                  />
                </div>
              </div>

              <Separator />

              {/* Pricing */}
              <div className="space-y-4">
                <h4 className="font-medium">Pricing</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="edit-price_monthly">Monthly Price ($)</Label>
                    <Input
                      id="edit-price_monthly"
                      type="number"
                      step="0.01"
                      value={formData.price_monthly}
                      onChange={(e) => setFormData({ ...formData, price_monthly: e.target.value })}
                      placeholder="9.99"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-price_annual">Annual Price ($)</Label>
                    <Input
                      id="edit-price_annual"
                      type="number"
                      step="0.01"
                      value={formData.price_annual}
                      onChange={(e) => setFormData({ ...formData, price_annual: e.target.value })}
                      placeholder="99.99"
                      required
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Features */}
              <div className="space-y-4">
                <h4 className="font-medium">Features</h4>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-plex_access" className="font-normal">Plex Access</Label>
                    <Switch
                      id="edit-plex_access"
                      checked={formData.features.plex_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, plex_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-live_tv_access" className="font-normal">Live TV Access</Label>
                    <Switch
                      id="edit-live_tv_access"
                      checked={formData.features.live_tv_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, live_tv_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-books_access" className="font-normal">Books Access</Label>
                    <Switch
                      id="edit-books_access"
                      checked={formData.features.books_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, books_access: checked }
                      })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="edit-game_servers_access" className="font-normal">Game Servers Access</Label>
                    <Switch
                      id="edit-game_servers_access"
                      checked={formData.features.game_servers_access}
                      onCheckedChange={(checked) => setFormData({
                        ...formData,
                        features: { ...formData.features, game_servers_access: checked }
                      })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-max_favorite_channels">Max Favorite Channels</Label>
                    <Input
                      id="edit-max_favorite_channels"
                      type="number"
                      value={formData.features.max_favorite_channels}
                      onChange={(e) => setFormData({
                        ...formData,
                        features: { ...formData.features, max_favorite_channels: e.target.value }
                      })}
                      placeholder="10"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-is_active" className="font-normal">Plan Active</Label>
                  <Switch
                    id="edit-is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>
                <div>
                  <Label htmlFor="edit-sort_order">Sort Order</Label>
                  <Input
                    id="edit-sort_order"
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePlanMutation.isPending}>
                {updatePlanMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Plan'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* View Plan Users Dialog */}
      <Dialog open={viewUsersDialog.open} onOpenChange={(open) => setViewUsersDialog({ ...viewUsersDialog, open })}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Users on {viewUsersDialog.planName} Plan</DialogTitle>
            <DialogDescription>
              All users currently subscribed to this plan
            </DialogDescription>
          </DialogHeader>

          {planUsersLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : planUsers.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No users on this plan yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                {planUsers.length} {planUsers.length === 1 ? 'user' : 'users'} subscribed
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Billing</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planUsers.map((user: any) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.username}</TableCell>
                      <TableCell className="text-sm">{user.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={user.status === 'active' ? 'default' : 'secondary'}
                          className={user.status === 'active' ? 'bg-green-600' : ''}
                        >
                          {user.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{user.billing_period}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(user.current_period_end), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(user.created_at), "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewUsersDialog({ ...viewUsersDialog, open: false })}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
