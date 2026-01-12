import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Settings } from "@shared/schema";

function updateFavicon(url: string | null) {
  const favicon = document.getElementById("favicon") as HTMLLinkElement;
  if (favicon && url) {
    favicon.href = url;
  }
}

export function FaviconUpdater() {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings?.favicon_url) {
      updateFavicon(settings.favicon_url);
    }
    // Update document title when settings load
    if (settings?.favicon_label) {
      document.title = settings.favicon_label;
    }
  }, [settings?.favicon_url, settings?.favicon_label]);

  return null; // This component doesn't render anything
}
