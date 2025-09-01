import { plexService } from './plex-service';

/**
 * The interval (in milliseconds) at which the background tasks will run
 */
const REFRESH_INTERVAL = 30000; // 30 seconds (increased from 15 seconds)

/**
 * Refreshes Plex data in the background regardless of whether users are connected
 * This ensures that when a user loads the dashboard, the data is already fresh
 */
async function refreshPlexData(): Promise<void> {
  try {
    // Reduced logging - no need to log every refresh
    // console.log('Background task: Refreshing Plex data'); 
    await plexService.getServerInfo();
    // console.log('Background task: Plex data refreshed successfully');
  } catch (error) {
    // Always log errors
    console.error('Background task: Failed to refresh Plex data', error);
  }
}

/**
 * Starts all background tasks
 */
export function startBackgroundTasks(): void {
  console.log('Starting background tasks');
  
  // Initial data load
  refreshPlexData().catch(err => 
    console.error('Error in initial Plex data refresh:', err)
  );
  
  // Set up intervals for each task
  setInterval(refreshPlexData, REFRESH_INTERVAL);
}