import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Check, ServerCog, CreditCard, Loader2, Tv, BookOpen, Gamepad2, Film } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, SubscriptionPlan } from "@shared/schema";
import { Link } from "wouter";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { buildApiUrl } from "@/lib/capacitor";

interface FirstTimeLoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forceShow?: boolean; // For testing by superadmin
}

export function FirstTimeLoginDialog({ open, onOpenChange, forceShow = false }: FirstTimeLoginDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: plans = [] } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/subscriptions/plans"],
    queryFn: async () => {
      const res = await fetch(buildApiUrl('/api/subscriptions/plans'), {
        credentials: 'include',
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Create checkout session mutation
  const createCheckoutMutation = useMutation({
    mutationFn: async ({ planId, period }: { planId: number; period: 'monthly' | 'annual' }) => {
      const res = await apiRequest('POST', '/api/subscriptions/checkout', {
        plan_id: planId,
        billing_period: period,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create checkout session');
      }
      return res.json();
    },
    onSuccess: (data) => {
      // Redirect to Stripe checkout
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Checkout Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation to mark dialog as seen
  const markAsSeenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/users/mark-first-time-dialog-seen");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
  });

  const handleClose = () => {
    // Mark dialog as seen in database (unless it's a forced preview)
    if (!forceShow) {
      markAsSeenMutation.mutate();
    }
    onOpenChange(false);
  };

  const steps = [
    {
      title: `Welcome to ${settings?.site_title || 'Our Platform'}!`,
      description: (
        <div className="space-y-4">
          <p>
            You've been invited to access our exclusive platform featuring premium media,
            live TV, books, and gaming experiences.
          </p>
          <p>
            Let's take a few moments to get you set up and show you what's available.
          </p>
        </div>
      ),
      icon: settings?.logo_url ? (
        <div className="h-8 w-8 flex items-center justify-center">
          <img
            src={settings.logo_url}
            alt="Site Logo"
            className="max-h-full max-w-full"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.style.display = 'none';
              target.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-primary"><path d="M10 3H6a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h4M16 17l5-5-5-5M19.8 12H9"/><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9"/></svg>';
            }}
          />
        </div>
      ) : (
        <ServerCog className="h-8 w-8 text-primary" />
      ),
    },
    {
      title: "Explore Our Content",
      description: (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Discover the premium content and services available to you:
          </p>

          <div className="grid gap-3">
            {/* Plex Media */}
            <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Film className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-1">Streaming Media</h4>
                <p className="text-xs text-muted-foreground">
                  Thousands of movies, TV shows, and music. Stream on any device, request new content.
                </p>
              </div>
            </div>

            {/* Live TV */}
            <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Tv className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-1">Live TV</h4>
                <p className="text-xs text-muted-foreground">
                  Hundreds of live channels including sports, news, and entertainment.
                </p>
              </div>
            </div>

            {/* Books */}
            <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-1">Digital Library</h4>
                <p className="text-xs text-muted-foreground">
                  Browse thousands of ebooks, comics, and audiobooks. Organize with collections.
                </p>
              </div>
            </div>

            {/* Game Servers */}
            <div className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Gamepad2 className="h-5 w-5 text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-1">Game Servers</h4>
                <p className="text-xs text-muted-foreground">
                  Join multiplayer servers for popular games with friends on dedicated hardware.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
      icon: settings?.logo_url ? (
        <div className="h-8 w-8 flex items-center justify-center">
          <img
            src={settings.logo_url}
            alt="Site Logo"
            className="max-h-full max-w-full"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.onerror = null;
              target.style.display = 'none';
              target.parentElement!.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-primary"><path d="M10 3H6a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h4M16 17l5-5-5-5M19.8 12H9"/><path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9-9 9"/></svg>';
            }}
          />
        </div>
      ) : (
        <ServerCog className="h-8 w-8 text-primary" />
      ),
    },
    {
      title: "Choose Your Subscription Plan",
      description: (
        <div className="space-y-4">
          <p>
            Select a subscription plan to access premium content including streaming media, live TV,
            ebooks, and multiplayer game servers.
          </p>

          {plans.length > 0 && (
            <div className="space-y-3">
              {/* Billing Period Selection */}
              <div className="flex items-center justify-center gap-4 p-3 bg-muted/50 rounded-lg">
                <Label className="text-sm font-medium">Billing Period:</Label>
                <RadioGroup
                  value={billingPeriod}
                  onValueChange={(value) => setBillingPeriod(value as 'monthly' | 'annual')}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="monthly" id="monthly" />
                    <Label htmlFor="monthly" className="cursor-pointer">Monthly</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="annual" id="annual" />
                    <Label htmlFor="annual" className="cursor-pointer">Annual (Save $$$)</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Plan Selection */}
              <div className="grid gap-3 max-h-[250px] overflow-y-auto">
                {plans.map((plan) => {
                  const price = billingPeriod === 'monthly' ? plan.price_monthly : plan.price_annual;
                  const priceDisplay = billingPeriod === 'monthly'
                    ? `$${(price / 100).toFixed(2)}/mo`
                    : `$${(price / 100).toFixed(2)}/yr`;

                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "border rounded-lg p-4 hover:border-primary transition-colors cursor-pointer",
                        selectedPlanId === plan.id && "border-primary bg-primary/5"
                      )}
                      onClick={() => setSelectedPlanId(plan.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-start gap-2">
                          {selectedPlanId === plan.id && (
                            <Check className="h-5 w-5 text-primary mt-0.5" />
                          )}
                          <div>
                            <h4 className="font-semibold">{plan.name}</h4>
                            <p className="text-sm text-muted-foreground">{plan.description}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{priceDisplay}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {plan.features.plex_access && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Plex</span>
                        )}
                        {plan.features.live_tv_access && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Live TV</span>
                        )}
                        {plan.features.books_access && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Books</span>
                        )}
                        {plan.features.game_servers_access && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Game Servers</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Subscribe Button */}
              {selectedPlanId && (
                <Button
                  className="w-full"
                  onClick={() => createCheckoutMutation.mutate({ planId: selectedPlanId, period: billingPeriod })}
                  disabled={createCheckoutMutation.isPending}
                >
                  {createCheckoutMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>Subscribe Now</>
                  )}
                </Button>
              )}
            </div>
          )}

          {plans.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No subscription plans available at this time. You can browse features and subscribe later.
            </p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            You can also subscribe later from the "My Subscription" page
          </p>
        </div>
      ),
      icon: <CreditCard className="h-8 w-8 text-primary" />,
    },
  ];

  // Don't show if user has already seen it (unless forced to show for testing)
  const shouldShow = forceShow || (user && !user.has_seen_first_time_dialog);

  return (
    <Dialog open={open && shouldShow} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            {steps[currentStep - 1].icon}
            {steps[currentStep - 1].title}
          </DialogTitle>
          <DialogDescription>
            {steps[currentStep - 1].description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2 mt-4">
          {steps.map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-2 w-2 rounded-full transition-all duration-300",
                currentStep === index + 1
                  ? "bg-primary w-4"
                  : index + 1 < currentStep
                  ? "bg-primary opacity-70"
                  : "bg-muted"
              )}
            />
          ))}
        </div>

        <DialogFooter className="flex sm:justify-between">
          <div className="flex gap-2">
            {currentStep > 1 && (
              <Button
                variant="outline"
                onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 1))}
              >
                Previous
              </Button>
            )}
            {currentStep < steps.length ? (
              <Button onClick={() => setCurrentStep((prev) => Math.min(prev + 1, steps.length))}>
                Next
              </Button>
            ) : (
              <Button onClick={handleClose} className="gap-2">
                <Check className="h-4 w-4" />
                Got it
              </Button>
            )}
          </div>
          {currentStep < steps.length && (
            <Button variant="ghost" onClick={handleClose}>
              Skip Intro
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}