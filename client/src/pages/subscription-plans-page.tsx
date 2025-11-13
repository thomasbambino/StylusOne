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
import { Plus, Edit2, Trash2, Users, DollarSign, TrendingUp, Package } from 'lucide-react';
import type { SubscriptionPlan } from '@shared/schema';

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

  // Fetch all subscription plans
  const { data: plans = [], isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/admin/subscription-plans'],
    queryFn: async () => {
      const res = await fetch('/api/admin/subscription-plans');
      if (!res.ok) throw new Error('Failed to fetch plans');
      return res.json();
    },
  });

  // Fetch MRR analytics
  const { data: analytics } = useQuery({
    queryKey: ['/api/admin/analytics/mrr'],
    queryFn: async () => {
      const res = await fetch('/api/admin/analytics/mrr');
      if (!res.ok) throw new Error('Failed to fetch analytics');
      return res.json();
    },
  });

  // Create plan mutation
  const createPlanMutation = useMutation({
    mutationFn: async (data: PlanFormData) => {
      const res = await fetch('/api/admin/subscription-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description,
          price_monthly: Math.round(parseFloat(data.price_monthly) * 100), // Convert to cents
          price_annual: Math.round(parseFloat(data.price_annual) * 100), // Convert to cents
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

  // Update plan mutation
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

  // Delete plan mutation
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

  const PlanFormFields = () => (
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
          rows={3}
        />
      </div>

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

      <div className="space-y-3">
        <Label>Features</Label>

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
  );

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Subscription Plans</h1>
          <p className="text-muted-foreground">Manage subscription plans and pricing</p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Plan
        </Button>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Recurring Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${analytics.totalMRR?.toFixed(2) || '0.00'}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Subscribers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalActiveSubscribers || 0}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Plans</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{plans.length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plans List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plansLoading ? (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            Loading plans...
          </div>
        ) : plans.length === 0 ? (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            No subscription plans yet. Create one to get started.
          </div>
        ) : (
          plans.map((plan) => (
            <Card key={plan.id} className={!plan.is_active ? 'opacity-60' : ''}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription className="mt-1">{plan.description}</CardDescription>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(plan)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(plan)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-3xl font-bold">
                    ${(plan.price_monthly / 100).toFixed(2)}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    ${(plan.price_annual / 100).toFixed(2)}/year
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${plan.features.plex_access ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Plex Access
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${plan.features.live_tv_access ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Live TV Access
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${plan.features.books_access ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Books Access
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${plan.features.game_servers_access ? 'bg-green-500' : 'bg-gray-300'}`} />
                    Game Servers Access
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {plan.features.max_favorite_channels} favorite channels
                  </div>
                </div>

                {!plan.is_active && (
                  <div className="text-xs text-yellow-600 dark:text-yellow-500">
                    Inactive - not available for subscription
                  </div>
                )}
              </CardContent>
            </Card>
          ))
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

            <div className="my-4">
              <PlanFormFields />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPlanMutation.isPending}>
                {createPlanMutation.isPending ? 'Creating...' : 'Create Plan'}
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

            <div className="my-4">
              <PlanFormFields />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updatePlanMutation.isPending}>
                {updatePlanMutation.isPending ? 'Updating...' : 'Update Plan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
