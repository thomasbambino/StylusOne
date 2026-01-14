import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import { AuthProvider } from "./hooks/use-auth";
import AuthAdaptive from "@/pages/auth-adaptive";
import HomePage from "@/pages/home-page";
import Dashboard from "@/pages/dashboard";
import PendingPage from "@/pages/pending-page";
import AuthTvPage from "@/pages/auth-tv-page";
import TvCodePage from "@/pages/tvcode-page";
import { ProtectedRoute } from "./lib/protected-route";
import { FeatureProtectedRoute } from "./lib/feature-protected-route";
import { ThemeProvider } from "@/components/theme-provider";
import { FaviconUpdater } from "@/components/favicon-updater";
import { CacheUpdater } from "@/components/cache-updater";
import { getDeviceType, isNativePlatform } from "@/lib/capacitor";
import { ReminderProvider } from "@/contexts/ReminderContext";
import { useEffect, useState, lazy, Suspense } from "react";

// Lazy load larger pages for code splitting
const UsersPage = lazy(() => import("@/pages/users-page"));
const SettingsPage = lazy(() => import("@/pages/settings-page"));
const GameServersPage = lazy(() => import("@/pages/game-servers-page"));
const PlexPage = lazy(() => import("@/pages/plex-page"));
const LiveTVAdaptive = lazy(() => import("@/pages/live-tv-adaptive"));
const BooksPage = lazy(() => import("@/pages/books-page"));
const ServerSharePage = lazy(() => import("@/pages/server-share-page"));
const SubscriptionPlansPage = lazy(() => import("@/pages/subscription-plans-page"));
const IptvProvidersPage = lazy(() => import("@/pages/iptv-providers-page"));
const IptvChannelsPage = lazy(() => import("@/pages/iptv-channels-page"));
const IptvPackagesPage = lazy(() => import("@/pages/iptv-packages-page"));
const AnalyticsPage = lazy(() => import("@/pages/analytics-page"));
const MySubscriptionPage = lazy(() => import("@/pages/my-subscription-page"));
const MyReferralsPage = lazy(() => import("@/pages/my-referrals-page"));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-screen bg-background">
    <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
  </div>
);

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Homepage as primary screen */}
        <ProtectedRoute path="/" component={HomePage} />
        <ProtectedRoute path="/dashboard" component={Dashboard} />
        <FeatureProtectedRoute path="/plex" component={PlexPage} feature="plex_access" />
        <FeatureProtectedRoute path="/game-servers" component={GameServersPage} feature="game_servers_access" />
        <FeatureProtectedRoute path="/live-tv" component={LiveTVAdaptive} feature="live_tv_access" />
        <FeatureProtectedRoute path="/books" component={BooksPage} feature="books_access" />
        <ProtectedRoute path="/users" component={UsersPage} />
        <ProtectedRoute path="/settings" component={SettingsPage} />
        <ProtectedRoute path="/subscription-plans" component={SubscriptionPlansPage} />
        <ProtectedRoute path="/iptv-providers" component={IptvProvidersPage} />
        <ProtectedRoute path="/iptv-channels" component={IptvChannelsPage} />
        <ProtectedRoute path="/iptv-packages" component={IptvPackagesPage} />
        <ProtectedRoute path="/analytics" component={AnalyticsPage} />
        <ProtectedRoute path="/my-subscription" component={MySubscriptionPage} />
        <ProtectedRoute path="/my-referrals" component={MyReferralsPage} />
        <Route path="/server/:serverId" component={ServerSharePage} />
        <Route path="/auth" component={AuthAdaptive} />
        <Route path="/auth-tv" component={AuthTvPage} />
        <Route path="/tvcode" component={TvCodePage} />
        <Route path="/pending" component={PendingPage} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [location] = useLocation();
  const isSharePage = location.startsWith('/server/');
  const [isTVDevice, setIsTVDevice] = useState(false);

  // Detect if running on TV device
  useEffect(() => {
    async function detectDevice() {
      const deviceType = await getDeviceType();
      setIsTVDevice(deviceType === 'tv');
    }
    detectDevice();
  }, []);

  // Hide splash screen on native platforms once app is ready
  useEffect(() => {
    if (isNativePlatform() && typeof window !== 'undefined' && (window as any).__hideInitialSplash) {
      // Small delay to ensure app has rendered
      const timer = setTimeout(() => {
        (window as any).__hideInitialSplash();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background text-foreground">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ReminderProvider>
              <FaviconUpdater />
              <CacheUpdater />
              <Router />
              <Toaster />
            </ReminderProvider>
          </AuthProvider>
        </QueryClientProvider>
      </div>
    </ThemeProvider>
  );
}

export default App;