import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'wouter';
import { Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from 'wouter';

interface CurrentSubscription {
  plan_features: {
    plex_access: boolean;
    live_tv_access: boolean;
    books_access: boolean;
    game_servers_access: boolean;
    max_favorite_channels: number;
  };
  status: string;
}

interface FeatureGateProps {
  feature: 'plex_access' | 'live_tv_access' | 'books_access' | 'game_servers_access';
  children: React.ReactNode;
  redirectTo?: string;
  showUpgradePrompt?: boolean;
}

/**
 * Feature Gate Component
 * Restricts access to features based on user's subscription plan
 */
export function FeatureGate({
  feature,
  children,
  redirectTo,
  showUpgradePrompt = true,
}: FeatureGateProps) {
  const { data: subscription, isLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['/api/subscriptions/current'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions/current');
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-border" />
      </div>
    );
  }

  // Check if user has an active subscription with the required feature
  const hasAccess =
    subscription &&
    subscription.status === 'active' &&
    subscription.plan_features[feature];

  if (hasAccess) {
    return <>{children}</>;
  }

  // Redirect if specified
  if (redirectTo) {
    return <Redirect to={redirectTo} />;
  }

  // Show upgrade prompt
  if (showUpgradePrompt) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="max-w-lg">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-muted rounded-full">
                <Lock className="h-8 w-8 text-muted-foreground" />
              </div>
            </div>
            <CardTitle className="text-2xl">Upgrade Required</CardTitle>
            <CardDescription>
              This feature requires a subscription with {feature.replace('_', ' ')} enabled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Upgrade your plan to unlock this feature and enjoy all the benefits.
            </p>
            <div className="flex gap-2 justify-center">
              <Link href="/my-subscription">
                <Button>View Plans & Upgrade</Button>
              </Link>
              <Link href="/">
                <Button variant="outline">Go Back</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

/**
 * Hook to check if user has access to a feature
 */
export function useFeatureAccess(
  feature: 'plex_access' | 'live_tv_access' | 'books_access' | 'game_servers_access'
): { hasAccess: boolean; isLoading: boolean } {
  const { data: subscription, isLoading } = useQuery<CurrentSubscription | null>({
    queryKey: ['/api/subscriptions/current'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions/current');
      if (!res.ok) return null;
      return res.json();
    },
  });

  const hasAccess =
    subscription &&
    subscription.status === 'active' &&
    subscription.plan_features[feature];

  return { hasAccess: !!hasAccess, isLoading };
}
