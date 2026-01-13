import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { PageTransition } from "@/components/page-transition";
import { NavigationBar } from "@/components/navigation-bar";
import { useQuery } from "@tanstack/react-query";
import { isNativePlatform } from "@/lib/capacitor";
import { Suspense } from "react";

interface ProtectedRouteProps {
  path: string;
  component: React.ComponentType;
}

export function ProtectedRoute({
  path,
  component: Component,
}: ProtectedRouteProps) {
  const ProtectedContent = () => {
    const { user, isLoading } = useAuth();

    // IMPORTANT: All hooks must be called before any conditional returns
    const { data: settings } = useQuery({
      queryKey: ["/api/settings"],
      // Uses default queryFn from queryClient which handles native platforms
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

    // Hide navigation bar on native mobile apps
    const isNative = isNativePlatform();

    return (
      <>
        {!isNative && <NavigationBar settings={settings} />}
        <div className={isNative ? "" : "pt-20"}>
          <PageTransition>
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-border" />
              </div>
            }>
              <Component />
            </Suspense>
          </PageTransition>
        </div>
      </>
    );
  };

  return <Route path={path} component={ProtectedContent} />;
}