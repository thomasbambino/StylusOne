import { useQuery } from "@tanstack/react-query";

export interface Settings {
  site_title?: string;
  logo_url?: string;
}

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ['/api/settings'],
    queryFn: async () => {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }
      return response.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}