import { IService } from './interfaces';
import { spawn } from 'child_process';

/**
 * Interface for Plex stream information
 */
export interface PlexStream {
  user: string;
  title: string;
  type: string;
  device: string;
  progress: number;
  duration: number;
  quality: string;
  state: string;
}

/**
 * Interface for Plex library section information
 */
export interface PlexLibrarySection {
  title: string;
  type: string;
  count: number;
}

/**
 * Interface for Plex server information
 */
export interface PlexServerInfo {
  status: boolean;
  version?: string;
  streams: PlexStream[];
  libraries?: PlexLibrarySection[];
  activeStreamCount: number;
  uptime?: string;
  error?: string; // Error field for better diagnostics
}

/**
 * Service for interacting with Plex Media Server
 */
export class PlexService implements IService {
  private token: string;
  private lastFetchTime: number = 0;
  private cachedServerInfo: PlexServerInfo | null = null;
  private cacheTTL: number = 30000; // 30 seconds cache
  private connectionRetries: number = 0;
  private maxRetries: number = 3;
  private baseUrl: string;
  private initialized: boolean = false;

  constructor() {
    this.token = process.env.PLEX_TOKEN || '';
    this.baseUrl = process.env.PLEX_SERVER_URL || '';
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.token) {
      this.initialized = true;
      console.log('Plex Service initialized');
    } else {
      console.warn('Plex Service not fully configured - missing token');
    }
  }

  /**
   * Reinitialize the service with new configuration
   */
  async reinitialize(token?: string, baseUrl?: string): Promise<void> {
    if (token) this.token = token;
    if (baseUrl) this.baseUrl = baseUrl;
    
    this.cachedServerInfo = null;
    this.lastFetchTime = 0;
    this.connectionRetries = 0;
    
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const info = await this.getServerInfo();
      return info.status;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get Plex server information
   */
  async getServerInfo(): Promise<PlexServerInfo> {
    // Check if we have a recent cache
    const now = Date.now();
    if (this.cachedServerInfo && now - this.lastFetchTime < this.cacheTTL) {
      console.log('Using cached Plex server info');
      return this.cachedServerInfo;
    }

    // If we've already retried too many times, use the cache regardless of age
    if (this.connectionRetries >= this.maxRetries && this.cachedServerInfo) {
      console.log('Using cached Plex server info (hit retry limit)');
      return this.cachedServerInfo;
    }

    try {
      // Use Python and plexapi to get the server info
      const directServer = this.baseUrl ? true : false;
      
      const pythonScript = `
from plexapi.myplex import MyPlexAccount
from plexapi.server import PlexServer
import json
import time
import sys

try:
    # Connection details
    token = "${this.token}"
    direct_server = ${directServer}
    
    if direct_server:
        server_url = "${this.baseUrl}"
        server = PlexServer(server_url, token)
    else:
        account = MyPlexAccount(token=token)
        server = account.resource('${process.env.PLEX_SERVER_NAME || "Plex Media Server"}').connect()
    
    # Gather server information
    server_info = {}
    server_info["status"] = True
    server_info["version"] = server.version
    server_info["streams"] = []
    server_info["libraries"] = []
    
    # Get uptime in a readable format
    uptime_seconds = server.systemDevice.timespan or 0
    
    if uptime_seconds >= 86400:
        days = uptime_seconds // 86400
        uptime_seconds %= 86400
        hours = uptime_seconds // 3600
        uptime = f"{days}d {hours}h"
    elif uptime_seconds >= 3600:
        hours = uptime_seconds // 3600
        uptime_seconds %= 3600
        minutes = uptime_seconds // 60
        uptime = f"{hours}h {minutes}m"
    else:
        minutes = uptime_seconds // 60
        uptime = f"{minutes}m"
    
    server_info["uptime"] = uptime
    
    # Get active streams
    for session in server.sessions():
        stream = {}
        stream["user"] = session.usernames[0] if session.usernames else "Unknown"
        stream["title"] = session.title
        stream["type"] = session.type
        stream["device"] = session.player.device if session.player else "Unknown"
        
        # Convert milliseconds to percentage
        try:
            if session.duration > 0:
                stream["progress"] = int((session.viewOffset / session.duration) * 100)
            else:
                stream["progress"] = 0
        except:
            stream["progress"] = 0
        
        stream["duration"] = session.duration
        
        # Get stream quality
        stream["quality"] = "Unknown"
        for media in session.media:
            for part in media.parts:
                if part.streams:
                    for s in part.streams:
                        if s.streamType == 1:  # Video stream
                            width = getattr(s, 'width', 0)
                            height = getattr(s, 'height', 0)
                            if width >= 3840 or height >= 2160:
                                stream["quality"] = "4K"
                            elif width >= 1920 or height >= 1080:
                                stream["quality"] = "1080p"
                            elif width >= 1280 or height >= 720:
                                stream["quality"] = "720p"
                            elif width >= 720 or height >= 480:
                                stream["quality"] = "SD"
                            else:
                                stream["quality"] = f"{width}x{height}"
        
        # Get state (playing, paused, buffering)
        stream["state"] = session.players[0].state if session.players else "unknown"
        
        server_info["streams"].append(stream)
    
    server_info["activeStreamCount"] = len(server_info["streams"])
    
    # Get library sections
    for section in server.library.sections():
        lib = {}
        lib["title"] = section.title
        lib["type"] = section.type
        lib["count"] = section.totalSize
        server_info["libraries"].append(lib)
    
    # Output as JSON
    print(json.dumps(server_info))
    sys.exit(0)
except Exception as e:
    # Return error information
    error_info = {
        "status": False,
        "streams": [],
        "activeStreamCount": 0,
        "error": str(e)
    }
    print(json.dumps(error_info))
    sys.exit(1)
`;

      return new Promise<PlexServerInfo>((resolve, reject) => {
        console.log('Fetching Plex server info...');
        const python = spawn('python3', ['-c', pythonScript]);
        
        let dataString = '';
        let errorString = '';
        
        python.stdout.on('data', (data) => {
          dataString += data.toString();
        });
        
        python.stderr.on('data', (data) => {
          errorString += data.toString();
        });
        
        python.on('close', (code) => {
          if (code !== 0) {
            console.error('Error fetching Plex server info:', errorString);
            this.connectionRetries++;
            
            // If we have a cached result, return it instead
            if (this.cachedServerInfo) {
              console.log(`Plex API error (retry ${this.connectionRetries}/${this.maxRetries}), using cached data`);
              resolve(this.cachedServerInfo);
            } else {
              // Otherwise return an error state
              const errorInfo: PlexServerInfo = {
                status: false,
                streams: [],
                activeStreamCount: 0,
                error: errorString || 'Unknown error fetching Plex server info'
              };
              this.cachedServerInfo = errorInfo; // Cache the error state too
              this.lastFetchTime = now;
              resolve(errorInfo);
            }
          } else {
            try {
              const result = JSON.parse(dataString) as PlexServerInfo;
              this.cachedServerInfo = result;
              this.lastFetchTime = now;
              this.connectionRetries = 0; // Reset retry counter on success
              resolve(result);
            } catch (parseError) {
              console.error('Error parsing Plex server info:', parseError);
              this.connectionRetries++;
              
              // If we have a cached result, return it instead
              if (this.cachedServerInfo) {
                console.log(`Plex API parse error (retry ${this.connectionRetries}/${this.maxRetries}), using cached data`);
                resolve(this.cachedServerInfo);
              } else {
                // Otherwise return an error state
                const errorInfo: PlexServerInfo = {
                  status: false,
                  streams: [],
                  activeStreamCount: 0,
                  error: 'Error parsing Plex server data'
                };
                this.cachedServerInfo = errorInfo;
                this.lastFetchTime = now;
                resolve(errorInfo);
              }
            }
          }
        });
      });
    } catch (error) {
      console.error('Error in getServerInfo:', error);
      
      // If we have a cached result, return it
      if (this.cachedServerInfo) {
        return this.cachedServerInfo;
      }
      
      // Otherwise return an error state
      return {
        status: false,
        streams: [],
        activeStreamCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error fetching Plex server info'
      };
    }
  }
}

// Export a singleton instance
export const plexService = new PlexService();