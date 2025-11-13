import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { PageTransition } from "@/components/page-transition";
import { NavigationBar } from "@/components/navigation-bar";
import { useQuery } from "@tanstack/react-query";
import { FeatureGate } from "./feature-gate";

interface FeatureProtectedRouteProps {
  path: string;
  component: React.ComponentType;
  feature?: 'plex_access' | 'live_tv_access' | 'books_access' | 'game_servers_access';
}

/**
 * Protected Route with optional feature gate
 * Requires authentication, approval, and optionally a subscription feature
 */
export function FeatureProtectedRoute({
  path,
  component: Component,
  feature,
}: FeatureProtectedRouteProps) {
  const ProtectedContent = () => {
    const { user, isLoading } = useAuth();

    // IMPORTANT: All hooks must be called before any conditional returns
    const { data: settings } = useQuery({
      queryKey: ["/api/settings"],
      queryFn: async () => {
        const response = await fetch("/api/settings");
        if (!response.ok) {
          throw new Error("Failed to fetch settings");
        }
        return response.json();
      },
      enabled: !!user?.approved, // Only fetch when user is approved
    });

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      );
    }

    if (!user) {
      return <Redirect to="/auth" />;
    }

    if (!user.approved) {
      return <Redirect to="/pending" />;
    }

    const content = feature ? (
      <FeatureGate feature={feature}>
        <Component />
      </FeatureGate>
    ) : (
      <Component />
    );

    return (
      <>
        <NavigationBar settings={settings} />
        <div className="pt-20">
          <PageTransition>
            {content}
          </PageTransition>
        </div>
      </>
    );
  };

  return <Route path={path} component={ProtectedContent} />;
}
