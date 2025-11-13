import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Elements } from '@stripe/react-stripe-js';
import { getStripe } from '@/lib/stripe';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  CreditCard,
  Download,
  Check,
  AlertCircle,
  Calendar,
  DollarSign,
  Package
} from 'lucide-react';
import type { SubscriptionPlan } from '@shared/schema';
import { PaymentMethodForm } from '@/components/payment-method-form';

interface CurrentSubscription {
  id: number;
  plan_id: number;
  status: string;
  billing_period: 'monthly' | 'annual';
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  plan_name: string;
  plan_description: string | null;
  plan_features: {
    plex_access: boolean;
    live_tv_access: boolean;
    books_access: boolean;
    game_servers_access: boolean;
    max_favorite_channels: number;
  };
  price_monthly: number;
  price_annual: number;
}

interface Invoice {
  id: number;
  stripe_invoice_id: string;
  amount: number;
  status: string;
  invoice_pdf_url: string | null;
  invoice_number: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  created_at: string;
}

export default function MySubscriptionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isUpgradeDialogOpen, setIsUpgradeDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  // Fetch current subscription
  const { data: currentSubscription, isLoading: subscriptionLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['/api/subscriptions/current'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions/current');
      if (!res.ok) throw new Error('Failed to fetch subscription');
      return res.json();
    },
  });

  // Fetch available plans
  const { data: plans = [] } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/subscriptions/plans'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions/plans');
      if (!res.ok) throw new Error('Failed to fetch plans');
      return res.json();
    },
  });

  // Fetch invoices
  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ['/api/subscriptions/invoices'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions/invoices');
      if (!res.ok) throw new Error('Failed to fetch invoices');
      return res.json();
    },
  });

  // Cancel subscription mutation
  const cancelMutation = useMutation({
    mutationFn: async (immediately: boolean) => {
      const res = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediately }),
      });
      if (!res.ok) throw new Error('Failed to cancel subscription');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/current'] });
      toast({
        title: 'Subscription Canceled',
        description: 'Your subscription has been canceled.',
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

  // Reactivate subscription mutation
  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/subscriptions/reactivate', {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to reactivate subscription');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/current'] });
      toast({
        title: 'Subscription Reactivated',
        description: 'Your subscription has been reactivated.',
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

  // Create subscription mutation
  const createSubscriptionMutation = useMutation({
    mutationFn: async ({ planId, period, paymentMethodId }: { planId: number; period: 'monthly' | 'annual'; paymentMethodId: string }) => {
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          billing_period: period,
          payment_method_id: paymentMethodId,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create subscription');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/current'] });
      setIsUpgradeDialogOpen(false);
      toast({
        title: 'Subscription Created',
        description: 'Your subscription has been created successfully.',
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

  // Upgrade/downgrade mutation
  const upgradeMutation = useMutation({
    mutationFn: async ({ planId, period }: { planId: number; period: 'monthly' | 'annual' }) => {
      const res = await fetch('/api/subscriptions/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          billing_period: period,
        }),
      });
      if (!res.ok) throw new Error('Failed to update subscription');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/current'] });
      setIsUpgradeDialogOpen(false);
      toast({
        title: 'Subscription Updated',
        description: 'Your subscription has been updated successfully.',
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

  const handleCancel = () => {
    if (confirm('Are you sure you want to cancel your subscription? You will retain access until the end of your billing period.')) {
      cancelMutation.mutate(false);
    }
  };

  const handleCancelImmediately = () => {
    if (confirm('Are you sure you want to cancel immediately? You will lose access right away.')) {
      cancelMutation.mutate(true);
    }
  };

  const handleReactivate = () => {
    reactivateMutation.mutate();
  };

  const handleUpgrade = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
    setIsUpgradeDialogOpen(true);
  };

  const handleUpgradeConfirm = () => {
    if (selectedPlan) {
      upgradeMutation.mutate({
        planId: selectedPlan.id,
        period: billingPeriod,
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500">Active</Badge>;
      case 'canceled':
        return <Badge variant="destructive">Canceled</Badge>;
      case 'past_due':
        return <Badge variant="destructive">Past Due</Badge>;
      case 'trialing':
        return <Badge className="bg-blue-500">Trial</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (subscriptionLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">Loading subscription...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My Subscription</h1>
        <p className="text-muted-foreground">Manage your subscription and billing</p>
      </div>

      {/* Current Subscription */}
      {currentSubscription ? (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle>{currentSubscription.plan_name}</CardTitle>
                  <CardDescription className="mt-1">
                    {currentSubscription.plan_description}
                  </CardDescription>
                </div>
                {getStatusBadge(currentSubscription.status)}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      {formatPrice(
                        currentSubscription.billing_period === 'monthly'
                          ? currentSubscription.price_monthly
                          : currentSubscription.price_annual
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      per {currentSubscription.billing_period === 'monthly' ? 'month' : 'year'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      Renews {formatDate(currentSubscription.current_period_end)}
                    </div>
                    <div className="text-xs text-muted-foreground">Next billing date</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium capitalize">
                      {currentSubscription.billing_period} Billing
                    </div>
                    <div className="text-xs text-muted-foreground">Billing cycle</div>
                  </div>
                </div>
              </div>

              {/* Features */}
              <div>
                <h3 className="text-sm font-medium mb-3">Plan Features</h3>
                <div className="grid grid-cols-2 gap-2">
                  {currentSubscription.plan_features.plex_access && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500" />
                      Plex Access
                    </div>
                  )}
                  {currentSubscription.plan_features.live_tv_access && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500" />
                      Live TV Access
                    </div>
                  )}
                  {currentSubscription.plan_features.books_access && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500" />
                      Books Access
                    </div>
                  )}
                  {currentSubscription.plan_features.game_servers_access && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-green-500" />
                      Game Servers Access
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => setIsPaymentDialogOpen(true)}>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Update Payment Method
                </Button>

                {currentSubscription.status === 'active' && !currentSubscription.cancel_at_period_end && (
                  <Button variant="outline" onClick={handleCancel}>
                    Cancel Subscription
                  </Button>
                )}

                {currentSubscription.cancel_at_period_end && (
                  <Button variant="outline" onClick={handleReactivate}>
                    Reactivate Subscription
                  </Button>
                )}
              </div>

              {currentSubscription.cancel_at_period_end && (
                <div className="flex items-start gap-2 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                  <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-500 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium">Subscription Ending</div>
                    <div className="text-muted-foreground">
                      Your subscription will end on {formatDate(currentSubscription.current_period_end)}.
                      You can reactivate anytime before then.
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Billing History */}
          <Card>
            <CardHeader>
              <CardTitle>Billing History</CardTitle>
              <CardDescription>View and download your invoices</CardDescription>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No invoices yet
                </div>
              ) : (
                <div className="space-y-2">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div>
                        <div className="font-medium">
                          {invoice.invoice_number || `Invoice #${invoice.id}`}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(invoice.created_at)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-medium">{formatPrice(invoice.amount)}</div>
                          <Badge variant={invoice.status === 'paid' ? 'default' : 'destructive'}>
                            {invoice.status}
                          </Badge>
                        </div>
                        {invoice.invoice_pdf_url && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(`/api/subscriptions/invoices/${invoice.id}/download`, '_blank')}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* No subscription - show available plans */
        <div className="space-y-6">
          <Card className="bg-muted/50">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <AlertCircle className="h-8 w-8 text-muted-foreground" />
                <div>
                  <h3 className="font-medium">No Active Subscription</h3>
                  <p className="text-sm text-muted-foreground">
                    Subscribe to a plan to access premium features
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Available Plans */}
          <div>
            <h2 className="text-2xl font-bold mb-4">Available Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <Card key={plan.id}>
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="text-3xl font-bold">
                        {formatPrice(plan.price_monthly)}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatPrice(plan.price_annual)}/year
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      {plan.features.plex_access && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" />
                          Plex Access
                        </div>
                      )}
                      {plan.features.live_tv_access && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" />
                          Live TV Access
                        </div>
                      )}
                      {plan.features.books_access && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" />
                          Books Access
                        </div>
                      )}
                      {plan.features.game_servers_access && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-green-500" />
                          Game Servers Access
                        </div>
                      )}
                    </div>

                    <Button className="w-full" onClick={() => handleUpgrade(plan)}>
                      Subscribe Now
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Upgrade/Change Plan Dialog */}
      <Dialog open={isUpgradeDialogOpen} onOpenChange={setIsUpgradeDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {currentSubscription ? 'Change Plan' : 'Subscribe'}
            </DialogTitle>
            <DialogDescription>
              {selectedPlan && `Subscribe to ${selectedPlan.name}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Billing Period</label>
              <div className="flex gap-2 mt-2">
                <Button
                  variant={billingPeriod === 'monthly' ? 'default' : 'outline'}
                  onClick={() => setBillingPeriod('monthly')}
                  className="flex-1"
                >
                  Monthly
                  {selectedPlan && (
                    <span className="ml-2 text-xs">
                      {formatPrice(selectedPlan.price_monthly)}/mo
                    </span>
                  )}
                </Button>
                <Button
                  variant={billingPeriod === 'annual' ? 'default' : 'outline'}
                  onClick={() => setBillingPeriod('annual')}
                  className="flex-1"
                >
                  Annual
                  {selectedPlan && (
                    <span className="ml-2 text-xs">
                      {formatPrice(selectedPlan.price_annual)}/yr
                    </span>
                  )}
                </Button>
              </div>
            </div>

            {/* Show payment form for new subscriptions */}
            {!currentSubscription && selectedPlan && (
              <div>
                <label className="text-sm font-medium mb-2 block">Payment Information</label>
                <Elements stripe={getStripe()}>
                  <PaymentMethodForm
                    onSuccess={(paymentMethodId) => {
                      createSubscriptionMutation.mutate({
                        planId: selectedPlan.id,
                        period: billingPeriod,
                        paymentMethodId,
                      });
                    }}
                    submitButtonText="Subscribe"
                    isLoading={createSubscriptionMutation.isPending}
                  />
                </Elements>
              </div>
            )}
          </div>

          {/* Only show confirm button for existing subscriptions (upgrades) */}
          {currentSubscription && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsUpgradeDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpgradeConfirm} disabled={upgradeMutation.isPending}>
                {upgradeMutation.isPending ? 'Processing...' : 'Confirm'}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Update Payment Method Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Payment Method</DialogTitle>
            <DialogDescription>
              Add a new card to your account
            </DialogDescription>
          </DialogHeader>

          <Elements stripe={getStripe()}>
            <PaymentMethodForm onSuccess={() => setIsPaymentDialogOpen(false)} />
          </Elements>
        </DialogContent>
      </Dialog>
    </div>
  );
}
