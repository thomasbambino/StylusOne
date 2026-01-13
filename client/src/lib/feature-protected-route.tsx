import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { PageTransition } from "@/components/page-transition";
import { NavigationBar } from "@/components/navigation-bar";
import { useQuery } from "@tanstack/react-query";
import { FeatureGate } from "./feature-gate";
import { isNativePlatform, getDeviceType } from "@/lib/capacitor";
import { useEffect, useState, Suspense } from "react";

interface FeatureProtectedRouteProps {
  path: string;
  component: React.ComponentType;
  feature?: 'plex_access' | 'live_tv_access' | 'books_access' | 'game_servers_access';
  fullscreen?: boolean;
}

/**
 * Protected Route with optional feature gate
 * Requires authentication, approval, and optionally a subscription feature
 */
export function FeatureProtectedRoute({
  path,
  component: Component,
  feature,
  fullscreen = false,
}: FeatureProtectedRouteProps) {
  const ProtectedContent = () => {
    const { user, isLoading } = useAuth();
    const [isTVDevice, setIsTVDevice] = useState(false);

    // IMPORTANT: All hooks must be called before any conditional returns
    const { data: settings } = useQuery({
      queryKey: ["/api/settings"],
      // Uses default queryFn from queryClient which handles native platforms
      enabled: !!user?.approved, // Only fetch when user is approved
    });

    // Detect if this is a TV device
    useEffect(() => {
      async function detectDevice() {
        const deviceType = await getDeviceType();
        setIsTVDevice(deviceType === 'tv');
      }
      detectDevice();
    }, []);

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

    // Wrap lazy-loaded components in Suspense for proper loading handling
    const LazyContent = (
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
        </div>
      }>
        <Component />
      </Suspense>
    );

    const content = feature ? (
      <FeatureGate feature={feature}>
        {LazyContent}
      </FeatureGate>
    ) : (
      LazyContent
    );

    // On native mobile apps, TV devices, or fullscreen mode, don't show navigation bar
    const isNative = isNativePlatform();
    if (isTVDevice || fullscreen || isNative) {
      return content;
    }

    // On web, show full UI with navigation
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
