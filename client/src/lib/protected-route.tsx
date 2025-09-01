import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";
import { PageTransition } from "@/components/page-transition";
import { NavigationBar } from "@/components/navigation-bar";
import { useQuery } from "@tanstack/react-query";

export function ProtectedRoute({
  component: Component,
}: {
  component: React.ComponentType;
}) {
  const { user, isLoading } = useAuth();

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

  const { data: settings } = useQuery({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const response = await fetch("/api/settings");
      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }
      return response.json();
    },
  });

  return (
    <>
      <NavigationBar settings={settings} />
      <div className="pt-20">
        <PageTransition>
          <Component />
        </PageTransition>
      </div>
    </>
  );
}