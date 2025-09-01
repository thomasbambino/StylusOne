import { Button } from "@/components/ui/button";
import { SiDiscord } from "react-icons/si";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import { useLocation } from "wouter";

export function DiscordButton() {
  const [location] = useLocation();
  const { data: settings } = useQuery<Settings>({ 
    queryKey: ["/api/settings"]
  });

  // Don't render on the auth page
  if (location === "/auth") {
    return null;
  }

  const handleDiscordClick = () => {
    if (settings?.discord_url) {
      window.open(settings.discord_url, '_blank');
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={handleDiscordClick}
      aria-label="Join Discord"
    >
      <SiDiscord className="h-5 w-5" />
    </Button>
  );
}