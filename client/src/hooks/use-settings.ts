import { useQuery } from "@tanstack/react-query";

export interface Settings {
  site_title?: string;
  logo_url?: string;
}

export function useSettings() {
  return useQuery<Settings>({
    queryKey: ['/api/settings'],
    // Uses default queryFn from queryClient which handles native platforms
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}