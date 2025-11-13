import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import { AuthProvider } from "./hooks/use-auth";
import AuthPage from "@/pages/auth-page";
import HomePage from "@/pages/home-page";
import Dashboard from "@/pages/dashboard";
import UsersPage from "@/pages/users-page";
import PendingPage from "@/pages/pending-page";
import SettingsPage from "@/pages/settings-page";
import GameServersPage from "@/pages/game-servers-page";
import PlexPage from "@/pages/plex-page";
import LiveTVPage from "@/pages/live-tv-page";
import BooksPage from "@/pages/books-page";
import ServerSharePage from "@/pages/server-share-page";
import SubscriptionPlansPage from "@/pages/subscription-plans-page";
import MySubscriptionPage from "@/pages/my-subscription-page";
import { ProtectedRoute } from "./lib/protected-route";
import { FeatureProtectedRoute } from "./lib/feature-protected-route";
import { ThemeProvider } from "@/components/theme-provider";
import { DiscordButton } from "@/components/discord-button";
import { FaviconUpdater } from "@/components/favicon-updater";
import { CacheUpdater } from "@/components/cache-updater";

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={HomePage} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <FeatureProtectedRoute path="/plex" component={PlexPage} feature="plex_access" />
      <FeatureProtectedRoute path="/game-servers" component={GameServersPage} feature="game_servers_access" />
      <FeatureProtectedRoute path="/live-tv" component={LiveTVPage} feature="live_tv_access" />
      <FeatureProtectedRoute path="/books" component={BooksPage} feature="books_access" />
      <ProtectedRoute path="/users" component={UsersPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <ProtectedRoute path="/subscription-plans" component={SubscriptionPlansPage} />
      <ProtectedRoute path="/my-subscription" component={MySubscriptionPage} />
      <Route path="/server/:serverId" component={ServerSharePage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/pending" component={PendingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [location] = useLocation();
  const isSharePage = location.startsWith('/server/');

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background text-foreground">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <FaviconUpdater />
            <CacheUpdater />
            <Router />
            <Toaster />
            {!isSharePage && (
              <div className="fixed bottom-4 right-4 flex items-center gap-2" style={{ zIndex: 9999 }}>
                <DiscordButton />
              </div>
            )}
          </AuthProvider>
        </QueryClientProvider>
      </div>
    </ThemeProvider>
  );
}

export default App;