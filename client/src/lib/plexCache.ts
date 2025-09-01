import { queryClient } from "./queryClient";
import { PlexServerInfo } from "../components/plex-streams";

// The query key for Plex server data
export const PLEX_QUERY_KEY = "/api/services/plex/details";

// Initial placeholder values for immediate loading
const initialPlexData: PlexServerInfo = {
  status: true,
  streams: [],
  libraries: [
    { title: "Movies", type: "movie", count: 0 },
    { title: "TV Shows", type: "show", count: 0 }
  ],
  activeStreamCount: 0
};

/**
 * Prefetch and cache Plex data
 * This can be called on app start to ensure Plex data is ready
 */
export async function prefetchPlexData(): Promise<void> {
  // First set initial data to avoid loading states
  queryClient.setQueryData([PLEX_QUERY_KEY], initialPlexData);
  
  // Then fetch the real data
  try {
    await queryClient.prefetchQuery({
      queryKey: [PLEX_QUERY_KEY],
      staleTime: 10000, // 10 seconds - make it stale faster to encourage refreshes
    });
    console.log("Plex data prefetched successfully");
  } catch (error) {
    console.error("Failed to prefetch Plex data", error);
  }
}

/**
 * Manually refresh the Plex data
 */
export async function refreshPlexData(): Promise<void> {
  try {
    await queryClient.invalidateQueries({ queryKey: [PLEX_QUERY_KEY] });
    console.log("Plex data refreshed");
  } catch (error) {
    console.error("Failed to refresh Plex data", error);
  }
}