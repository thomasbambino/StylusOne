import { QueryClientProvider } from "@tanstack/react-query";
import { Switch, Route } from "wouter";
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
import { ProtectedRoute } from "./lib/protected-route";
import { ThemeProvider } from "@/components/theme-provider";
import { DiscordButton } from "@/components/discord-button";
import { FaviconUpdater } from "@/components/favicon-updater";

function Router() {
  return (
    <Switch>
      <ProtectedRoute path="/" component={HomePage} />
      <ProtectedRoute path="/dashboard" component={Dashboard} />
      <ProtectedRoute path="/plex" component={PlexPage} />
      <ProtectedRoute path="/game-servers" component={GameServersPage} />
      <ProtectedRoute path="/live-tv" component={LiveTVPage} />
      <ProtectedRoute path="/books" component={BooksPage} />
      <ProtectedRoute path="/users" component={UsersPage} />
      <ProtectedRoute path="/settings" component={SettingsPage} />
      <Route path="/server/:serverId" component={ServerSharePage} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/pending" component={PendingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background text-foreground">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <FaviconUpdater />
            <Router />
            <Toaster />
            <div className="fixed bottom-4 right-4 flex items-center gap-2" style={{ zIndex: 9999 }}>
              <DiscordButton />
            </div>
          </AuthProvider>
        </QueryClientProvider>
      </div>
    </ThemeProvider>
  );
}

export default App;